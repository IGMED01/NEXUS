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

import type { BM25Index as BM25IndexType, BM25Result } from "../types/core-contracts.d.ts";

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
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00e0-\u024f]+/gu, " ")
    .split(/\s+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// ── Internal Types ───────────────────────────────────────────────────

interface DocEntry {
  id: string;
  tokens: string[];
  tf: Map<string, number>;
  length: number;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createBM25Index(): BM25IndexType {
  /** All indexed documents */
  const docs = new Map<string, DocEntry>();

  /** Document frequency: how many documents contain each term */
  const df = new Map<string, number>();

  /** Total token count across all documents */
  let totalTokens = 0;

  /**
   * Recompute document frequency map from scratch.
   * Called after removals to keep df consistent.
   */
  function rebuildDF(): void {
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
   */
  function buildTF(tokens: string[]): Map<string, number> {
    const counts = new Map<string, number>();

    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    return counts;
  }

  function addDocument(id: string, text: string): void {
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

  function addDocuments(items: Array<{ id: string; text: string }>): void {
    for (const item of items) {
      addDocument(item.id, item.text);
    }
  }

  function removeDocument(id: string): void {
    const doc = docs.get(id);

    if (!doc) {
      return;
    }

    docs.delete(id);
    rebuildDF();
  }

  function search(query: string, limit?: number): BM25Result[] {
    const queryTokens = tokenize(query);

    if (!queryTokens.length || docs.size === 0) {
      return [];
    }

    const N = docs.size;
    const avgdl = totalTokens / (N || 1);
    const maxResults = Math.max(1, Math.trunc(limit ?? 10));

    /** @type {BM25Result[]} */
    const results: BM25Result[] = [];

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

  function clear(): void {
    docs.clear();
    df.clear();
    totalTokens = 0;
  }

  function size(): number {
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
 * Legacy compatibility alias used by older tests/imports.
 */
export function createBm25Index(): BM25IndexType {
  return createBM25Index();
}
