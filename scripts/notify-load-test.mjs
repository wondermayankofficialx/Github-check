import fs from "node:fs/promises";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  throw new Error("Telegram secrets are missing.");
}

const stage = process.env.LOAD_STAGE || "unknown";
const outcome = process.env.LOAD_OUTCOME || "unknown";
const target = process.env.TARGET_URL || "unknown";

let summary = null;

try {
  summary = JSON.parse(
    await fs.readFile("reports/k6-summary.json", "utf8")
  );
} catch {
  console.log("No k6 summary file was generated.");
}

const metrics = summary?.metrics || {};

const avg = metrics.http_req_duration?.values?.avg;
const p95 = metrics.http_req_duration?.values?.["p(95)"];
const failed = metrics.http_req_failed?.values?.rate;
const rps = metrics.http_reqs?.values?.rate;
const maxVus = metrics.vus_max?.values?.max;

const formatMs = value =>
  typeof value === "number"
    ? `${value.toFixed(0)} ms`
    : "Unavailable";

const formatPercent = value =>
  typeof value === "number"
    ? `${(value * 100).toFixed(2)}%`
    : "Unavailable";

const formatNumber = value =>
  typeof value === "number"
    ? value.toFixed(2)
    : "Unavailable";

const passed = outcome === "success";

const lines = [
  passed
    ? "🟢 THUNDERSTUDY LOAD TEST"
    : "🔴 THUNDERSTUDY LOAD TEST",
  "",
  `Result: ${passed ? "Completed" : "Failed / Aborted"}`,
  `Stage: ${stage.toUpperCase()}`,
  `Website: ${target}`,
  "",
  "📊 PERFORMANCE RESULTS",
  `Average response: ${formatMs(avg)}`,
  `P95 response: ${formatMs(p95)}`,
  `Failed request rate: ${formatPercent(failed)}`,
  `Requests per second: ${formatNumber(rps)}`,
  `Maximum virtual users: ${formatNumber(maxVus)}`,
  "",
  "Note: A completed test is not proof of unlimited capacity."
];

if (!summary) {
  lines.push(
    "",
    "The detailed k6 metrics are unavailable. Check the GitHub Actions logs."
  );
}

const runUrl =
  `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

lines.push("", `GitHub report: ${runUrl}`);

const response = await fetch(
  `https://api.telegram.org/bot${TOKEN}/sendMessage`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: lines.join("\n"),
      disable_web_page_preview: true
    })
  }
);

const result = await response.json();

if (!response.ok || !result.ok) {
  throw new Error(
    result.description || "Telegram notification failed."
  );
}

console.log("Telegram load-test report sent.");
