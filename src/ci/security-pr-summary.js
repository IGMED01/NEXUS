export const SECURITY_PIPELINE_SUMMARY_MARKER = "<!-- security-pipeline-summary -->";

export const SECURITY_PIPELINE_GATE_THRESHOLDS = Object.freeze({
  minIncludedFindings: 1,
  minSelectedTeachChunks: 1,
  minPriority: 0.84
});

/**
 * @typedef {{
 *   id?: unknown,
 *   priority?: unknown
 * }} SummaryChunk
 */

/**
 * @typedef {{
 *   chunks?: SummaryChunk[]
 * }} SummaryChunksPayload
 */

/**
 * @typedef {{
 *   selectedContext?: unknown[]
 * }} SummaryTeachPayload
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @param {SummaryChunksPayload} chunksPayload
 * @param {SummaryTeachPayload} teachPayload
 */
export function collectSecurityPipelineMetrics(chunksPayload, teachPayload) {
  const chunks = Array.isArray(chunksPayload?.chunks) ? chunksPayload.chunks : [];
  const selectedTeachChunks = Array.isArray(teachPayload?.selectedContext)
    ? teachPayload.selectedContext.length
    : 0;
  const priorities = chunks.map((chunk) => toFiniteNumber(chunk.priority));
  const maxPriority = priorities.length ? Math.max(...priorities) : 0;
  const includedFindings = chunks.length;

  const qualityPassed =
    includedFindings >= SECURITY_PIPELINE_GATE_THRESHOLDS.minIncludedFindings &&
    selectedTeachChunks >= SECURITY_PIPELINE_GATE_THRESHOLDS.minSelectedTeachChunks &&
    maxPriority >= SECURITY_PIPELINE_GATE_THRESHOLDS.minPriority;

  return {
    chunks,
    includedFindings,
    selectedTeachChunks,
    maxPriority,
    qualityPassed
  };
}

/**
 * @param {string} body
 * @param {string} label
 * @returns {number | null}
 */
export function parseSecuritySummaryMetric(body, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`- ${escapedLabel}:\\s*(-?\\d+(?:\\.\\d+)?)`, "i");
  const match = body.match(pattern);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {number} currentValue
 * @param {number | null} previousValue
 * @param {number} decimals
 * @returns {string}
 */
export function formatSecurityMetricDelta(currentValue, previousValue, decimals) {
  if (typeof previousValue !== "number" || !Number.isFinite(previousValue)) {
    return "n/a";
  }

  const delta = currentValue - previousValue;
  const rendered = delta.toFixed(decimals);
  return delta > 0 ? `+${rendered}` : rendered;
}

/**
 * @param {{
 *   nodeVersion: string,
 *   chunksPayload: SummaryChunksPayload,
 *   teachPayload: SummaryTeachPayload,
 *   previousCommentBody?: string
 * }} input
 */
export function buildSecurityPipelineSummaryComment(input) {
  const metrics = collectSecurityPipelineMetrics(input.chunksPayload, input.teachPayload);
  const previousBody = input.previousCommentBody ?? "";
  const previousMetrics = previousBody.includes(SECURITY_PIPELINE_SUMMARY_MARKER)
    ? {
        includedFindings: parseSecuritySummaryMetric(previousBody, "Included findings"),
        selectedTeachChunks: parseSecuritySummaryMetric(previousBody, "Selected teach chunks"),
        maxPriority: parseSecuritySummaryMetric(previousBody, "Max finding priority")
      }
    : null;
  const deltaLines = previousMetrics
    ? [
        "- Delta vs previous comment:",
        `  - Included findings: ${formatSecurityMetricDelta(
          metrics.includedFindings,
          previousMetrics.includedFindings,
          0
        )}`,
        `  - Selected teach chunks: ${formatSecurityMetricDelta(
          metrics.selectedTeachChunks,
          previousMetrics.selectedTeachChunks,
          0
        )}`,
        `  - Max finding priority: ${formatSecurityMetricDelta(
          metrics.maxPriority,
          previousMetrics.maxPriority,
          3
        )}`
      ]
    : ["- Delta vs previous comment: baseline (first run on this PR)"];
  const topFindings = metrics.chunks
    .slice(0, 3)
    .map(
      (chunk) =>
        `  - ${typeof chunk.id === "string" ? chunk.id : "unknown"} (priority=${toFiniteNumber(chunk.priority).toFixed(3)})`
    )
    .join("\n");
  const body = [
    SECURITY_PIPELINE_SUMMARY_MARKER,
    "## Security pipeline summary",
    `- Node: ${input.nodeVersion}`,
    `- Included findings: ${metrics.includedFindings}`,
    `- Selected teach chunks: ${metrics.selectedTeachChunks}`,
    `- Max finding priority: ${metrics.maxPriority.toFixed(3)}`,
    `- Quality gate: ${metrics.qualityPassed ? "PASS" : "FAIL"} (minIncluded=${SECURITY_PIPELINE_GATE_THRESHOLDS.minIncludedFindings}, minSelected=${SECURITY_PIPELINE_GATE_THRESHOLDS.minSelectedTeachChunks}, minPriority=${SECURITY_PIPELINE_GATE_THRESHOLDS.minPriority.toFixed(2)})`,
    ...deltaLines,
    "- Top findings:",
    topFindings || "  - none"
  ].join("\n");

  return {
    body,
    metrics,
    previousMetrics
  };
}
