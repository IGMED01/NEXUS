// @ts-check

/**
 * @typedef {{
 *   id?: string,
 *   source?: string,
 *   kind?: string,
 *   content?: string
 * }} TaggableChunk
 */

/**
 * @typedef {{
 *   topic: string,
 *   domain: string,
 *   type: string,
 *   confidence: number
 * }} ChunkTags
 */

const DOMAIN_PATTERNS = [
  { domain: "security", pattern: /\b(auth|token|jwt|secret|encryption|security)\b/iu },
  { domain: "memory", pattern: /\b(memory|recall|engram|session|knowledge)\b/iu },
  { domain: "observability", pattern: /\b(metric|trace|observability|dashboard|monitor)\b/iu },
  { domain: "api", pattern: /\b(api|endpoint|route|http|request|response)\b/iu },
  { domain: "testing", pattern: /\b(test|assert|fixture|spec|mock)\b/iu }
];

const TOPIC_PATTERNS = [
  { topic: "auth-validation", pattern: /\b(auth|validation|session)\b/iu },
  { topic: "context-selection", pattern: /\b(context|chunk|selector|ranking|noise)\b/iu },
  { topic: "teaching", pattern: /\b(teach|mentor|learning|packet)\b/iu },
  { topic: "sync", pattern: /\b(sync|notion|integration|webhook)\b/iu },
  { topic: "release-quality", pattern: /\b(ci|benchmark|release|versioning|contract)\b/iu }
];

/**
 * NEXUS:1 — add lightweight metadata tags to chunks.
 * @param {TaggableChunk} chunk
 * @returns {ChunkTags}
 */
export function tagChunkMetadata(chunk) {
  const source = String(chunk.source ?? "");
  const kind = String(chunk.kind ?? "doc");
  const text = `${source}\n${String(chunk.content ?? "")}`;

  const domainHit = DOMAIN_PATTERNS.find((entry) => entry.pattern.test(text));
  const topicHit = TOPIC_PATTERNS.find((entry) => entry.pattern.test(text));

  return {
    topic: topicHit?.topic ?? "general",
    domain: domainHit?.domain ?? "general",
    type: normalizeType(kind),
    confidence: computeConfidence({
      hasTopic: Boolean(topicHit),
      hasDomain: Boolean(domainHit),
      kind
    })
  };
}

/**
 * @param {string} kind
 */
function normalizeType(kind) {
  if (kind === "code" || kind === "test" || kind === "spec" || kind === "log" || kind === "chat") {
    return kind;
  }

  return "doc";
}

/**
 * @param {{ hasTopic: boolean, hasDomain: boolean, kind: string }} input
 */
function computeConfidence(input) {
  let score = 0.45;

  if (input.hasTopic) {
    score += 0.2;
  }

  if (input.hasDomain) {
    score += 0.2;
  }

  if (input.kind === "code" || input.kind === "test" || input.kind === "spec") {
    score += 0.1;
  }

  return Math.max(0, Math.min(0.95, Number(score.toFixed(2))));
}
