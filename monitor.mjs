
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const config = JSON.parse(
  await fs.readFile("monitor.config.json", "utf8")
);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  throw new Error("Missing Telegram GitHub secrets.");
}

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");

await fs.mkdir("reports", { recursive: true });
await fs.mkdir("screenshots", { recursive: true });

function ignored(value, patterns = []) {
  return patterns.some(pattern =>
    value.toLowerCase().includes(pattern.toLowerCase())
  );
}

async function checkWebsite(target, browser) {
  const result = {
    name: target.name,
    url: target.url,
    status: "HEALTHY",
    httpStatus: null,
    responseMs: null,
    title: "",
    errors: [],
    warnings: [],
    consoleErrors: [],
    javascriptErrors: [],
    failedRequests: [],
    screenshot: null
  };

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }
  });

  const page = await context.newPage();

  page.setDefaultTimeout(config.timeoutMs || 30000);

  page.on("console", message => {
    if (message.type() === "error") {
      const error = message.text();

      if (!ignored(error, config.ignoreConsoleErrorPatterns)) {
        result.consoleErrors.push(error.slice(0, 500));
      }
    }
  });

  page.on("pageerror", error => {
    result.javascriptErrors.push(
      String(error.message).slice(0, 500)
    );
  });

  page.on("requestfailed", request => {
    const error = request.failure()?.errorText || "Request failed";

    if (
      error !== "net::ERR_ABORTED" &&
      !ignored(
        request.url(),
        config.ignoreFailedRequestPatterns
      )
    ) {
      result.failedRequests.push(
        `${request.url()} — ${error}`.slice(0, 500)
      );
    }
  });

  const start = Date.now();

  try {
    const response = await page.goto(target.url, {
      waitUntil: config.navigationWaitUntil || "domcontentloaded",
      timeout: config.timeoutMs || 30000
    });

    result.responseMs = Date.now() - start;
    result.httpStatus = response?.status() ?? null;
    result.title = await page.title().catch(() => "");

    if (!response) {
      result.errors.push("No main document response received.");
    } else if (response.status() >= 400) {
      result.errors.push(
        `HTTP error: ${response.status()}`
      );
    }

    const body = await page.locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "");

    if (!body.trim()) {
      result.errors.push("Website page content is empty.");
    }

    for (const required of target.requiredText || []) {
      if (!body.toLowerCase().includes(required.toLowerCase())) {
        result.errors.push(
          `Required content missing: ${required}`
        );
      }
    }

    if (result.responseMs > (config.slowResponseMs || 5000)) {
      result.warnings.push(
        `Slow response: ${(result.responseMs / 1000).toFixed(2)} seconds`
      );
    }

  } catch (error) {
    result.responseMs = Date.now() - start;

    result.errors.push(
      `Browser/navigation error: ${String(error.message).slice(0, 600)}`
    );
  }

  if (result.consoleErrors.length) {
    result.errors.push(
      `${result.consoleErrors.length} browser console error(s).`
    );
  }

  if (result.javascriptErrors.length) {
    result.errors.push(
      `${result.javascriptErrors.length} JavaScript error(s).`
    );
  }

  if (result.failedRequests.length) {
    result.warnings.push(
      `${result.failedRequests.length} network request(s) failed.`
    );
  }

  if (result.errors.length) {
    result.status = "FAILED";
  } else if (result.warnings.length) {
    result.status = "WARNING";
  }

  if (result.status !== "HEALTHY") {
    const filename =
      `${target.name.replace(/[^a-z0-9]/gi, "-")}-${stamp}.png`;

    const screenshotPath = path.join("screenshots", filename);

    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        timeout: 15000
      });

      result.screenshot = screenshotPath;

    } catch (error) {
      result.warnings.push(
        `Screenshot failed: ${error.message}`
      );
    }
  }

  await context.close();

  return result;
}

async function telegram(method, form) {
  const response = await fetch(
    `https://api.telegram.org/bot${TOKEN}/${method}`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20000)
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      data.description || `Telegram error ${response.status}`
    );
  }

  return data;
}

async function sendReport(results, overall) {
  const healthy = results.filter(
    r => r.status === "HEALTHY"
  ).length;

  const warnings = results.filter(
    r => r.status === "WARNING"
  ).length;

  const failed = results.filter(
    r => r.status === "FAILED"
  ).length;

  const icon = failed ? "🚨" : warnings ? "⚠️" : "✅";

  const lines = [
    `${icon} THUNDERSTUDY GUARDIAN`,
    `Overall: ${overall}`,
    `Healthy: ${healthy}/${results.length}`,
    `Warnings: ${warnings}`,
    `Failed: ${failed}`,
    `Time: ${now.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata"
    })} IST`,
    ""
  ];

  for (const r of results) {
    const mark =
      r.status === "HEALTHY" ? "🟢" :
      r.status === "WARNING" ? "🟡" : "🔴";

    lines.push(`${mark} ${r.name}`);
    lines.push(r.url);
    lines.push(`Status: ${r.status}`);
    lines.push(`HTTP: ${r.httpStatus ?? "Unavailable"}`);
    lines.push(
      `Response: ${
        r.responseMs === null
          ? "Unavailable"
          : (r.responseMs / 1000).toFixed(2) + "s"
      }`
    );

    if (r.title) {
      lines.push(`Title: ${r.title.slice(0, 100)}`);
    }

    for (const error of r.errors.slice(0, 4)) {
      lines.push(`❌ ${error}`);
    }

    for (const warning of r.warnings.slice(0, 3)) {
      lines.push(`⚠️ ${warning}`);
    }

    for (const error of r.consoleErrors.slice(0, 2)) {
      lines.push(`Console: ${error}`);
    }

    for (const error of r.javascriptErrors.slice(0, 2)) {
      lines.push(`JS: ${error}`);
    }

    lines.push("");
  }

  const message = lines.join("\n").slice(0, 3900);

  await telegram(
    "sendMessage",
    new URLSearchParams({
      chat_id: CHAT_ID,
      text: message,
      disable_web_page_preview: "true"
    })
  );

  // Send screenshots for problematic websites.
  for (const r of results.filter(x => x.screenshot)) {
    const form = new FormData();

    form.append("chat_id", CHAT_ID);
    form.append(
      "caption",
      `${r.name} — ${r.status}\n${r.url}`
    );

    form.append(
      "photo",
      new Blob([
        await fs.readFile(r.screenshot)
      ], { type: "image/png" }),
      path.basename(r.screenshot)
    );

    await telegram("sendPhoto", form);
  }
}

const browser = await chromium.launch({
  headless: true
});

let results;

try {
  results = await Promise.all(
    config.targets.map(target =>
      checkWebsite(target, browser)
    )
  );
} finally {
  await browser.close();
}

const failed = results.some(
  r => r.status === "FAILED"
);

const warning = results.some(
  r => r.status === "WARNING"
);

const overall = failed
  ? "PROBLEMS DETECTED"
  : warning
    ? "HEALTHY WITH WARNINGS"
    : "ALL SYSTEMS HEALTHY";

const report = {
  service: "ThunderStudy Guardian",
  checkedAt: now.toISOString(),
  overall,
  results
};

const reportPath = path.join(
  "reports",
  `report-${stamp}.json`
);

await fs.writeFile(
  reportPath,
  JSON.stringify(report, null, 2)
);

await sendReport(results, overall);

console.log(JSON.stringify(report, null, 2));

if (failed) {
  process.exitCode = 1;
}
