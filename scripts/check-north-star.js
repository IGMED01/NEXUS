import path from "node:path";

import {
  formatNorthStarGateReport,
  runNorthStarGate
} from "../src/ci/north-star-gate.js";

/**
 * @param {string[]} argv
 * @param {string} key
 * @param {string} fallback
 */
function option(argv, key, fallback) {
  const index = argv.indexOf(`--${key}`);

  if (index === -1) {
    return fallback;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return fallback;
  }

  return value;
}

/**
 * @param {string} value
 * @param {number} fallback
 */
function numberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const argv = process.argv.slice(2);
const filePathRaw = option(argv, "file", ".lcs/observability.json");
const filePath = path.resolve(filePathRaw);

const result = await runNorthStarGate({
  filePath,
  thresholds: {
    minRuns: numberOption(option(argv, "min-runs", "1"), 1),
    minBlockedRuns: numberOption(option(argv, "min-blocked-runs", "1"), 1),
    minPreventedErrors: numberOption(option(argv, "min-prevented-errors", "1"), 1),
    minPreventedErrorRate: numberOption(option(argv, "min-prevented-error-rate", "0.005"), 0.005),
    maxDegradedRate: argv.includes("--max-degraded-rate")
      ? numberOption(option(argv, "max-degraded-rate", "1"), 1)
      : null
  }
});

const report = formatNorthStarGateReport(result);

if (result.passed) {
  console.log(report);
  process.exitCode = 0;
} else {
  console.error(report);
  process.exitCode = 1;
}

