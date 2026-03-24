// @ts-check

/**
 * @typedef {{
 *   id: string,
 *   content: string
 * }} SearchDocument
 */

/**
 * @typedef {{
 *   id: string,
 *   score: number
 * }} SearchResult
 */

const K1 = 1.5;
const B = 0.75;

/**
 * @param {string} value
 */
function tokenize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * NEXUS:2 — minimal BM25 index for lexical retrieval.
 * @param {SearchDocument[]} documents
 */
export function createBm25Index(documents) {
  const normalizedDocuments = documents.map((document) => {
    const tokens = tokenize(document.content);
    /** @type {Map<string, number>} */
    const frequencies = new Map();

    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }

    return {
      id: document.id,
      length: tokens.length,
      frequencies
    };
  });

  const avgDocumentLength =
    normalizedDocuments.reduce((total, document) => total + document.length, 0) /
      Math.max(1, normalizedDocuments.length) || 0;

  /** @type {Map<string, number>} */
  const documentFrequency = new Map();

  for (const document of normalizedDocuments) {
    for (const term of document.frequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return {
    size: normalizedDocuments.length,
    avgDocumentLength,

    /**
     * @param {string} query
     * @param {{ limit?: number }} [options]
     * @returns {SearchResult[]}
     */
    search(query, options = {}) {
      const queryTerms = tokenize(query);
      const scores = new Map();

      for (const term of queryTerms) {
        const df = documentFrequency.get(term) ?? 0;

        if (!df) {
          continue;
        }

        const idf = Math.log(1 + (normalizedDocuments.length - df + 0.5) / (df + 0.5));

        for (const document of normalizedDocuments) {
          const frequency = document.frequencies.get(term) ?? 0;

          if (!frequency) {
            continue;
          }

          const denominator =
            frequency +
            K1 * (1 - B + B * (document.length / Math.max(1, avgDocumentLength)));
          const contribution = idf * ((frequency * (K1 + 1)) / denominator);
          scores.set(document.id, (scores.get(document.id) ?? 0) + contribution);
        }
      }

      const limit = typeof options.limit === "number" ? Math.max(0, options.limit) : normalizedDocuments.length;

      return [...scores.entries()]
        .map(([id, score]) => ({
          id,
          score: Number(score.toFixed(6))
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
    }
  };
}
