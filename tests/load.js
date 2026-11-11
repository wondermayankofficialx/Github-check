
import http from "k6/http";
import { check, sleep } from "k6";

const target = __ENV.TARGET_URL || "https://thunderstudy.site/";
const stage = __ENV.LOAD_STAGE || "smoke";

// Only allow the ThunderStudy domains.
const allowedHosts = [
  "thunderstudy.site",
  "nt.thunderstudy.site",
  "physicswallah.thunderstudy.site"
];

const parsed = new URL(target);

if (
  parsed.protocol !== "https:" ||
  !allowedHosts.includes(parsed.hostname)
) {
  throw new Error("Target URL is not on the approved HTTPS allowlist.");
}

// Conservative initial load profiles.
const profiles = {
  smoke: {
    stages: [
      { duration: "15s", target: 1 },
      { duration: "30s", target: 5 },
      { duration: "15s", target: 0 }
    ]
  },

  light: {
    stages: [
      { duration: "30s", target: 5 },
      { duration: "1m", target: 10 },
      { duration: "30s", target: 0 }
    ]
  },

  medium: {
    stages: [
      { duration: "1m", target: 10 },
      { duration: "2m", target: 25 },
      { duration: "1m", target: 0 }
    ]
  },

  heavy: {
    stages: [
      { duration: "1m", target: 10 },
      { duration: "2m", target: 25 },
      { duration: "1m", target: 50 },
      { duration: "2m", target: 50 },
      { duration: "1m", target: 0 }
    ]
  },
  
extreme: {
  stages: [
    { duration: "2m", target: 100 },
    { duration: "3m", target: 500 },
    { duration: "3m", target: 1000 },
    { duration: "5m", target: 2500 },
    { duration: "5m", target: 5000 },
    { duration: "2m", target: 0 }
  ]
}
  
};

if (!profiles[stage]) {
  throw new Error("Invalid load stage: " + stage);
}

export const options = {
  stages: profiles[stage].stages,

  discardResponseBodies: true,

  userAgent: "ThunderStudy-LoadGuardian/1.0",

  thresholds: {
    http_req_failed: [
      {
        threshold: "rate<0.02",
        abortOnFail: true,
        delayAbortEval: "30s"
      }
    ],

    http_req_duration: [
      {
        threshold: "p(95)<2000",
        abortOnFail: true,
        delayAbortEval: "30s"
      }
    ]
  }
};

export default function () {
  const response = http.get(target, {
    timeout: "10s",
    tags: {
      service: "ThunderStudy",
      stage
    }
  });

  check(response, {
    "HTTP status is 200": r => r.status === 200
  });

  // Avoid generating an unnecessarily aggressive request rate.
  sleep(1.5);
}
