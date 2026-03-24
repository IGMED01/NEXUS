// @ts-check

/**
 * @param {string} value
 */
function tokenize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * @param {string[]} left
 * @param {string[]} right
 */
function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  if (!leftSet.size || !rightSet.size) {
    return 0;
  }

  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (leftSet.size + rightSet.size - intersection);
}

/**
 * NEXUS:7 — score consistency between multiple responses.
 * @param {Array<{ id?: string, content: string }>} responses
 */
export function scoreResponseConsistency(responses) {
  const normalized = responses
    .filter((entry) => entry && typeof entry.content === "string")
    .map((entry, index) => ({
      id: entry.id || `response-${index + 1}`,
      content: entry.content.trim(),
      tokens: tokenize(entry.content)
    }))
    .filter((entry) => entry.content.length > 0);

  if (normalized.length < 2) {
    return {
      score: normalized.length ? 1 : 0,
      pairs: [],
      status: normalized.length ? "insufficient-sample" : "empty"
    };
  }

  /** @type {Array<{ leftId: string, rightId: string, similarity: number }>} */
  const pairs = [];

  for (let index = 0; index < normalized.length; index += 1) {
    for (let cursor = index + 1; cursor < normalized.length; cursor += 1) {
      const left = normalized[index];
      const right = normalized[cursor];

      pairs.push({
        leftId: left.id,
        rightId: right.id,
        similarity: Number(jaccard(left.tokens, right.tokens).toFixed(4))
      });
    }
  }

  const aggregate = pairs.reduce((total, pair) => total + pair.similarity, 0) / pairs.length;

  return {
    score: Number(aggregate.toFixed(4)),
    pairs,
    status: aggregate >= 0.65 ? "consistent" : aggregate >= 0.45 ? "mixed" : "inconsistent"
  };
}
