// @ts-check

/**
 * BM25 Ranking Index — NEXUS:2: Okapi BM25 lexical search.
 *
 * In-memory BM25 index for fast lexical retrieval over chunks.
 * Rebuilt from persisted chunks on startup — no persistence needed.
 *
 * BM25 parameters: k1 = 1.5, b = 0.75 (standard Okapi BM25)
 * Formula:
 *   score(D,Q) = Σ IDF(qi) * (f(qi,D) * (k1+1)) / (f(qi,D) + k1 * (1 - b + b * |D|/avgdl))
 *   IDF(qi) = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
 */

/**
 * @typedef {import("../types/core-contracts.d.ts").BM25Index} BM25IndexType
 * @typedef {import("../types/core-contracts.d.ts").BM25Result} BM25Result
 */

// ── Constants ────────────────────────────────────────────────────────

const K1 = 1.5;
const B = 0.75;

/** Common stopwords filtered from search queries and documents */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "de", "del", "el", "en",
  "es", "for", "from", "has", "he", "in", "is", "it", "its", "la", "las",
  "lo", "los", "of", "on", "or", "que", "se", "the", "to", "un", "una",
  "was", "were", "will", "with", "y"
]);

// ── Tokenizer ────────────────────────────────────────────────────────

/**
 * Tokenize text into normalized terms, filtering stopwords.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00e0-\u024f]+/gu, " ")
    .split(/\s+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: string,
 *   tokens: string[],
 *   tf: Map<string, number>,
 *   length: number
 * }} DocEntry
 */

/**
 * Creates an in-memory BM25 index for lexical search.
 * @returns {BM25IndexType}
 */
export function createBM25Index() {
  /** @type {Map<string, DocEntry>} */
  const docs = new Map();

  /** @type {Map<string, number>} Document frequency per term */
  const df = new Map();

  /** Total token count across all documents */
  let totalTokens = 0;

  /**
   * Recompute document frequency map from scratch.
   */
  function rebuildDF() {
    df.clear();
    totalTokens = 0;

    for (const doc of docs.values()) {
      totalTokens += doc.length;

      for (const term of doc.tf.keys()) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
  }

  /**
   * Compute raw term frequency counts for a token list.
   * @param {string[]} tokens
   * @returns {Map<string, number>}
   */
  function buildTF(tokens) {
    /** @type {Map<string, number>} */
    const counts = new Map();

    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    return counts;
  }

  /**
   * @param {string} id
   * @param {string} text
   */
  function addDocument(id, text) {
    // Remove existing document with same id first
    if (docs.has(id)) {
      removeDocument(id);
    }

    const tokens = tokenize(text);
    const tf = buildTF(tokens);

    docs.set(id, { id, tokens, tf, length: tokens.length });

    // Update df incrementally
    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }

    totalTokens += tokens.length;
  }

  /**
   * @param {Array<{ id: string, text: string }>} items
   */
  function addDocuments(items) {
    for (const item of items) {
      addDocument(item.id, item.text);
    }
  }

  /**
   * @param {string} id
   */
  function removeDocument(id) {
    const doc = docs.get(id);

    if (!doc) {
      return;
    }

    docs.delete(id);
    rebuildDF();
  }

  /**
   * @param {string} query
   * @param {number} [limit]
   * @returns {BM25Result[]}
   */
  function search(query, limit) {
    const queryTokens = tokenize(query);

    if (!queryTokens.length || docs.size === 0) {
      return [];
    }

    const N = docs.size;
    const avgdl = totalTokens / (N || 1);
    const maxResults = Math.max(1, Math.trunc(limit ?? 10));

    /** @type {BM25Result[]} */
    const results = [];

    for (const doc of docs.values()) {
      let score = 0;

      for (const qi of queryTokens) {
        const nqi = df.get(qi) ?? 0;

        // IDF(qi) = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
        const idf = Math.log((N - nqi + 0.5) / (nqi + 0.5) + 1);

        // f(qi, D) — raw term frequency of qi in document D
        const fqiD = doc.tf.get(qi) ?? 0;

        if (fqiD === 0) {
          continue;
        }

        // BM25 term score
        const numerator = fqiD * (K1 + 1);
        const denominator = fqiD + K1 * (1 - B + B * (doc.length / avgdl));
        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        results.push({ id: doc.id, score });
      }
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, maxResults);
  }

  function clear() {
    docs.clear();
    df.clear();
    totalTokens = 0;
  }

  function size() {
    return docs.size;
  }

  return {
    addDocument,
    addDocuments,
    removeDocument,
    search,
    clear,
    size
  };
}

/**
 * Legacy compatibility factory used by older tests/imports.
 * Accepts initial documents and exposes search(query, { limit }).
 *
 * @param {Array<{ id: string, content: string }>} [documents]
 */
export function createBm25Index(documents = []) {
  const index = createBM25Index();

  if (Array.isArray(documents) && documents.length > 0) {
    index.addDocuments(
      documents.map((entry) => ({
        id: entry.id,
        text: entry.content
      }))
    );
  }

  return {
    size: index.size(),
    /**
     * @param {string} query
     * @param {{ limit?: number }} [options]
     */
    search(query, options = {}) {
      const limit =
        typeof options.limit === "number" && Number.isFinite(options.limit)
          ? Math.max(1, Math.trunc(options.limit))
          : undefined;

      return index.search(query, limit).map((entry) => ({
        id: entry.id,
        score: Number(entry.score.toFixed(6))
      }));
    }
  };
}
