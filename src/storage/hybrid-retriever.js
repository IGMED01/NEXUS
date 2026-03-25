// @ts-check

/**
 * Hybrid Retriever — NEXUS:2: Combines BM25, TF-IDF, and signal scores.
 *
 * Retrieval pipeline:
 *   1. BM25 search → top 3*limit candidates
 *   2. TF-IDF on those candidates
 *   3. Signal score from chunk metadata (certainty + teachingValue + priority) / 3
 *   4. Normalize each score set to [0,1]
 *   5. Weighted combination → final score
 *   6. Sort, filter by minScore, return top limit
 */

import { createBM25Index, createBm25Index } from "./bm25-index.js";

/**
 * @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk
 * @typedef {import("../types/core-contracts.d.ts").ChunkKind} ChunkKind
 * @typedef {import("../types/core-contracts.d.ts").BM25Index} BM25IndexType
 * @typedef {import("../types/core-contracts.d.ts").HybridRetriever} HybridRetrieverType
 * @typedef {import("../types/core-contracts.d.ts").HybridRetrieverOptions} HybridRetrieverOptions
 * @typedef {import("../types/core-contracts.d.ts").HybridResult} HybridResult
 */

// ── Constants ────────────────────────────────────────────────────────

/** Common stopwords filtered from search queries and documents */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "de", "del", "el", "en",
  "es", "for", "from", "has", "he", "in", "is", "it", "its", "la", "las",
  "lo", "los", "of", "on", "or", "que", "se", "the", "to", "un", "una",
  "was", "were", "will", "with", "y"
]);

// ── TF-IDF (local reimplementation for retriever scope) ─────────────

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

/**
 * Compute term frequency: count of each term / total terms.
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function termFrequency(tokens) {
  /** @type {Map<string, number>} */
  const counts = new Map();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const total = tokens.length || 1;
  /** @type {Map<string, number>} */
  const tf = new Map();

  for (const [term, count] of counts) {
    tf.set(term, count / total);
  }

  return tf;
}

/**
 * Compute inverse document frequency for query terms across a corpus.
 * @param {string[]} queryTerms
 * @param {Map<string, number>[]} documentTFs
 * @returns {Map<string, number>}
 */
function inverseDocumentFrequency(queryTerms, documentTFs) {
  const N = documentTFs.length || 1;
  /** @type {Map<string, number>} */
  const idf = new Map();

  for (const term of queryTerms) {
    let docsWithTerm = 0;

    for (const tf of documentTFs) {
      if (tf.has(term)) {
        docsWithTerm++;
      }
    }

    idf.set(term, Math.log((N + 1) / (docsWithTerm + 1)) + 1);
  }

  return idf;
}

/**
 * Score a single document against query terms using TF-IDF.
 * @param {Map<string, number>} docTF
 * @param {string[]} queryTerms
 * @param {Map<string, number>} idf
 * @returns {number}
 */
function tfidfScore(docTF, queryTerms, idf) {
  let score = 0;

  for (const term of queryTerms) {
    const tf = docTF.get(term) ?? 0;
    const idfVal = idf.get(term) ?? 1;
    score += tf * idfVal;
  }

  return score;
}

/**
 * Build searchable text from a chunk.
 * @param {Chunk} chunk
 * @returns {string}
 */
function chunkToSearchText(chunk) {
  return `${chunk.source} ${chunk.kind} ${chunk.content}`;
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Creates a hybrid retriever.
 * Supports:
 *   1) legacy mode: createHybridRetriever(documents[])
 *   2) advanced mode: createHybridRetriever({ bm25Weight, ... })
 *
 * @param {HybridRetrieverOptions | Array<{ id: string, source?: string, content: string }>} [options]
 * @returns {HybridRetrieverType | { search: (query: string, options?: { limit?: number }) => Array<{ id: string, score: number, lexicalScore: number, keywordScore: number }> }}
 */
export function createHybridRetriever(options) {
  if (Array.isArray(options)) {
    return createLegacyHybridRetriever(options);
  }

  const bm25Weight = options?.bm25Weight ?? 0.4;
  const tfidfWeight = options?.tfidfWeight ?? 0.3;
  const signalWeight = options?.signalWeight ?? 0.3;

  const bm25 = createBM25Index();

  /** @type {Map<string, Chunk>} All indexed chunks, keyed by id */
  const chunkMap = new Map();

  /**
   * @param {Chunk[]} chunks
   */
  function index(chunks) {
    bm25.clear();
    chunkMap.clear();

    for (const chunk of chunks) {
      chunkMap.set(chunk.id, chunk);
      bm25.addDocument(chunk.id, chunkToSearchText(chunk));
    }
  }

  /**
   * @param {string} query
   * @param {{ limit?: number, minScore?: number, kindFilter?: ChunkKind[] }} [searchOptions]
   * @returns {HybridResult[]}
   */
  function search(query, searchOptions) {
    const limit = Math.max(1, Math.trunc(searchOptions?.limit ?? 10));
    const minScore = searchOptions?.minScore ?? 0;
    const kindFilter = searchOptions?.kindFilter;

    if (chunkMap.size === 0) {
      return [];
    }

    // Step 1: BM25 search — get top 3*limit candidates
    const bm25Results = bm25.search(query, 3 * limit);

    if (!bm25Results.length) {
      return [];
    }

    // Collect candidate chunks (apply kind filter)
    /** @type {Array<{ chunk: Chunk, bm25Score: number }>} */
    const candidates = [];

    for (const result of bm25Results) {
      const chunk = chunkMap.get(result.id);

      if (!chunk) {
        continue;
      }

      if (kindFilter && kindFilter.length > 0 && !kindFilter.includes(chunk.kind)) {
        continue;
      }

      candidates.push({ chunk, bm25Score: result.score });
    }

    if (!candidates.length) {
      return [];
    }

    // Step 2: TF-IDF on the candidates
    const queryTerms = tokenize(query);
    const docTFs = candidates.map((c) =>
      termFrequency(tokenize(chunkToSearchText(c.chunk)))
    );
    const idf = inverseDocumentFrequency(queryTerms, docTFs);

    /** @type {number[]} */
    const tfidfScores = candidates.map((c, i) =>
      tfidfScore(docTFs[i], queryTerms, idf)
    );

    // Step 3: Signal scores from metadata
    /** @type {number[]} */
    const signalScores = candidates.map((c) => {
      const certainty = c.chunk.certainty ?? 0;
      const teachingValue = c.chunk.teachingValue ?? 0;
      const priority = c.chunk.priority ?? 0;
      return (certainty + teachingValue + priority) / 3;
    });

    // Step 4: Normalize each score set to [0,1]
    const maxBM25 = Math.max(...candidates.map((c) => c.bm25Score));
    const maxTFIDF = Math.max(...tfidfScores);
    const maxSignal = Math.max(...signalScores);

    const normBM25 = candidates.map((c) =>
      maxBM25 > 0 ? c.bm25Score / maxBM25 : 0
    );
    const normTFIDF = tfidfScores.map((s) =>
      maxTFIDF > 0 ? s / maxTFIDF : 0
    );
    const normSignal = signalScores.map((s) =>
      maxSignal > 0 ? s / maxSignal : 0
    );

    // Step 5: Weighted combination
    /** @type {HybridResult[]} */
    const results = [];

    for (let i = 0; i < candidates.length; i++) {
      const finalScore =
        bm25Weight * normBM25[i] +
        tfidfWeight * normTFIDF[i] +
        signalWeight * normSignal[i];

      if (finalScore >= minScore) {
        results.push({
          chunk: candidates[i].chunk,
          score: finalScore,
          breakdown: {
            bm25: normBM25[i],
            tfidf: normTFIDF[i],
            signal: normSignal[i]
          }
        });
      }
    }

    // Step 6: Sort and limit
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  function size() {
    return chunkMap.size;
  }

  return {
    index,
    search,
    size
  };
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function tokenizeLegacy(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * @param {Array<{ id: string, source?: string, content: string }>} documents
 */
function createLegacyHybridRetriever(documents) {
  const bm25 = createBm25Index(documents);
  const byId = new Map(documents.map((document) => [document.id, document]));

  return {
    /**
     * @param {string} query
     * @param {{ limit?: number }} [options]
     */
    search(query, options = {}) {
      const bm25Results = bm25.search(query);
      const bm25Map = new Map(bm25Results.map((entry) => [entry.id, entry.score]));
      const queryTokens = tokenizeLegacy(query);
      const limit = typeof options.limit === "number" ? Math.max(0, options.limit) : documents.length;

      return documents
        .map((document) => {
          const contentTokens = new Set(tokenizeLegacy(document.content));
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
