// @ts-check

import { getObservabilityReport } from "../observability/metrics-store.js";

/**
 * @typedef {{
 *   minRuns?: number,
 *   minBlockedRuns?: number,
 *   minPreventedErrors?: number,
 *   minPreventedErrorRate?: number,
 *   maxDegradedRate?: number | null
 * }} NorthStarThresholdsInput
 */

/**
 * @typedef {{
 *   minRuns: number,
 *   minBlockedRuns: number,
 *   minPreventedErrors: number,
 *   minPreventedErrorRate: number,
 *   maxDegradedRate: number | null
 * }} NorthStarThresholds
 */

/**
 * @typedef {{
 *   id: string,
 *   passed: boolean,
 *   detail: string
 * }} NorthStarCheck
 */

/**
 * @param {unknown} value
 */
function toFiniteNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }

  return value;
}

/**
 * @param {number} value
 */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {NorthStarThresholdsInput} [input]
 * @returns {NorthStarThresholds}
 */
export function normalizeNorthStarThresholds(input = {}) {
  return {
    minRuns: Math.max(1, Math.round(toFiniteNumber(input.minRuns ?? 1))),
    minBlockedRuns: Math.max(0, Math.round(toFiniteNumber(input.minBlockedRuns ?? 1))),
    minPreventedErrors: Math.max(0, Math.round(toFiniteNumber(input.minPreventedErrors ?? 1))),
    minPreventedErrorRate: Math.max(0, toFiniteNumber(input.minPreventedErrorRate ?? 0.005)),
    maxDegradedRate:
      input.maxDegradedRate === null || input.maxDegradedRate === undefined
        ? null
        : Math.min(1, Math.max(0, toFiniteNumber(input.maxDegradedRate)))
  };
}

/**
 * @param {{
 *   observability: {
 *     found: boolean,
 *     filePath: string,
 *     loadError?: string,
 *     totals: {
 *       runs: number,
 *       degradedRuns: number,
 *       blockedRuns: number,
 *       preventedErrors: number,
 *       degradedRate: number
 *     }
 *   },
 *   thresholds?: NorthStarThresholdsInput
 * }} input
 */
export function evaluateNorthStarGate(input) {
  const thresholds = normalizeNorthStarThresholds(input.thresholds);
  const totals = input.observability.totals;
  const runs = Math.max(0, Math.round(toFiniteNumber(totals.runs)));
  const blockedRuns = Math.max(0, Math.round(toFiniteNumber(totals.blockedRuns)));
  const preventedErrors = Math.max(0, Math.round(toFiniteNumber(totals.preventedErrors)));
  const degradedRate = Math.max(0, Math.min(1, toFiniteNumber(totals.degradedRate)));
  const preventedErrorRate = runs > 0 ? preventedErrors / runs : 0;
  const blockedCoverage = blockedRuns > 0 ? preventedErrors / blockedRuns : 0;

  /** @type {NorthStarCheck[]} */
  const checks = [];

  checks.push({
    id: "metrics-file",
    passed: input.observability.found === true,
    detail:
      input.observability.found === true
        ? `observability file found at ${input.observability.filePath}`
        : `observability file not found at ${input.observability.filePath}`
  });

  checks.push({
    id: "min-runs",
    passed: runs >= thresholds.minRuns,
    detail: `runs=${runs} (required >= ${thresholds.minRuns})`
  });

  checks.push({
    id: "min-blocked-runs",
    passed: blockedRuns >= thresholds.minBlockedRuns,
    detail: `blockedRuns=${blockedRuns} (required >= ${thresholds.minBlockedRuns})`
  });

  checks.push({
    id: "min-prevented-errors",
    passed: preventedErrors >= thresholds.minPreventedErrors,
    detail: `preventedErrors=${preventedErrors} (required >= ${thresholds.minPreventedErrors})`
  });

  checks.push({
    id: "prevented-errors-consistency",
    passed: preventedErrors <= blockedRuns,
    detail: `preventedErrors=${preventedErrors} must be <= blockedRuns=${blockedRuns}`
  });

  checks.push({
    id: "prevented-error-rate",
    passed: preventedErrorRate >= thresholds.minPreventedErrorRate,
    detail: `preventedErrorRate=${round(preventedErrorRate)} (required >= ${round(
      thresholds.minPreventedErrorRate
    )})`
  });

  if (thresholds.maxDegradedRate !== null) {
    checks.push({
      id: "max-degraded-rate",
      passed: degradedRate <= thresholds.maxDegradedRate,
      detail: `degradedRate=${round(degradedRate)} (required <= ${round(
        thresholds.maxDegradedRate
      )})`
    });
  }

  const failures = checks.filter((check) => !check.passed).map((check) => check.detail);

  return {
    passed: failures.length === 0,
    thresholds,
    checks,
    failures,
    metrics: {
      filePath: input.observability.filePath,
      found: input.observability.found,
      loadError: input.observability.loadError ?? "",
      runs,
      blockedRuns,
      preventedErrors,
      degradedRate: round(degradedRate),
      preventedErrorRate: round(preventedErrorRate),
      blockedCoverage: round(blockedCoverage)
    }
  };
}

/**
 * @param {ReturnType<typeof evaluateNorthStarGate>} result
 */
export function formatNorthStarGateReport(result) {
  const lines = [
    "North Star gate:",
    `- passed: ${result.passed ? "yes" : "no"}`,
    `- metrics file: ${result.metrics.filePath}`,
    `- metrics found: ${result.metrics.found ? "yes" : "no"}`,
    `- runs: ${result.metrics.runs}`,
    `- blocked runs: ${result.metrics.blockedRuns}`,
    `- prevented errors: ${result.metrics.preventedErrors}`,
    `- prevented error rate: ${result.metrics.preventedErrorRate}`,
    `- blocked coverage: ${result.metrics.blockedCoverage}`,
    `- degraded rate: ${result.metrics.degradedRate}`,
    "",
    "Checks:"
  ];

  for (const check of result.checks) {
    lines.push(`- [${check.passed ? "pass" : "fail"}] ${check.id}: ${check.detail}`);
  }

  if (result.metrics.loadError) {
    lines.push("");
    lines.push(`Load error: ${result.metrics.loadError}`);
  }

  return lines.join("\n");
}

/**
 * @param {{ cwd?: string, filePath?: string, thresholds?: NorthStarThresholdsInput }} [options]
 */
export async function runNorthStarGate(options = {}) {
  const observability = await getObservabilityReport({
    cwd: options.cwd,
    filePath: options.filePath
  });

  return evaluateNorthStarGate({
    observability,
    thresholds: options.thresholds
  });
}

