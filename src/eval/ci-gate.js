// @ts-check

/**
 * @typedef {{
 *   consistency?: number,
 *   relevance?: number,
 *   safety?: number,
 *   cost?: number
 * }} EvalScores
 */

/**
 * @typedef {{
 *   consistency?: number,
 *   relevance?: number,
 *   safety?: number,
 *   cost?: number
 * }} EvalThresholds
 */

/**
 * @param {unknown} value
 */
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * NEXUS:7 — CI gate that blocks release when eval scores are below thresholds.
 * @param {{ scores: EvalScores, thresholds?: EvalThresholds }} input
 */
export function evaluateCiGate(input) {
  const scores = input?.scores ?? {};
  const thresholds = {
    consistency: 0.65,
    relevance: 0.6,
    safety: 0.85,
    cost: 0,
    ...(input?.thresholds ?? {})
  };

  /** @type {Array<{ metric: string, score: number, threshold: number, pass: boolean }>} */
  const checks = [];

  for (const [metric, threshold] of Object.entries(thresholds)) {
    const numericThreshold = finite(threshold);
    const score = finite(scores[/** @type {keyof EvalScores} */ (metric)]);
    const pass = metric === "cost" ? score <= numericThreshold : score >= numericThreshold;

    checks.push({
      metric,
      score: Number(score.toFixed(4)),
      threshold: Number(numericThreshold.toFixed(4)),
      pass
    });
  }

  const failed = checks.filter((check) => !check.pass);

  return {
    status: failed.length ? "blocked" : "pass",
    checks,
    failed,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    }
  };
}

/**
 * @param {ReturnType<typeof evaluateCiGate>} report
 */
export function formatCiGateReport(report) {
  const lines = [
    `CI Gate: ${report.status.toUpperCase()}`,
    ""
  ];

  for (const check of report.checks) {
    const comparator = check.metric === "cost" ? "<=" : ">=";
    lines.push(
      `- ${check.metric}: ${check.score} ${comparator} ${check.threshold} -> ${check.pass ? "PASS" : "FAIL"}`
    );
  }

  if (report.failed.length) {
    lines.push("");
    lines.push("Blocked metrics:");
    for (const failed of report.failed) {
      lines.push(`- ${failed.metric}`);
    }
  }

  return lines.join("\n");
}
