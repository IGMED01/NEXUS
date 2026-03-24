// @ts-check

import { createBm25Index } from "./bm25-index.js";

/**
 * @typedef {{
 *   id: string,
 *   source?: string,
 *   content: string
 * }} RetrieverDocument
 */

/**
 * @typedef {{
 *   id: string,
 *   score: number,
 *   lexicalScore: number,
 *   keywordScore: number
 * }} HybridSearchResult
 */

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
 * NEXUS:2 — hybrid retriever combining BM25 and keyword overlap.
 * @param {RetrieverDocument[]} documents
 */
export function createHybridRetriever(documents) {
  const bm25 = createBm25Index(documents);
  const byId = new Map(documents.map((document) => [document.id, document]));

  return {
    /**
     * @param {string} query
     * @param {{ limit?: number }} [options]
     * @returns {HybridSearchResult[]}
     */
    search(query, options = {}) {
      const bm25Results = bm25.search(query);
      const bm25Map = new Map(bm25Results.map((entry) => [entry.id, entry.score]));
      const queryTokens = tokenize(query);
      const limit = typeof options.limit === "number" ? Math.max(0, options.limit) : documents.length;

      return documents
        .map((document) => {
          const contentTokens = new Set(tokenize(document.content));
          const overlap = queryTokens.filter((token) => contentTokens.has(token)).length;
          const keywordScore = queryTokens.length ? overlap / queryTokens.length : 0;
          const lexicalScore = bm25Map.get(document.id) ?? 0;
          const score = Number((lexicalScore * 0.75 + keywordScore * 0.25).toFixed(6));

          return {
            id: document.id,
            score,
            lexicalScore: Number(lexicalScore.toFixed(6)),
            keywordScore: Number(keywordScore.toFixed(6))
          };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((entry) => ({
          ...entry,
          id: byId.get(entry.id)?.id ?? entry.id
        }));
    }
  };
}
