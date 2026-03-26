// @ts-check

/**
 * Chunk Repository — NEXUS:2: Unified CRUD for persisted chunks.
 *
 * Storage format: .lcs/chunks/{project-slug}/chunks.jsonl
 * One chunk per line, JSON-encoded.
 *
 * Search uses TF-IDF ranking (reimplemented here, independent of
 * the memory store's TF-IDF to keep concerns separate).
 */

import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk
 * @typedef {import("../types/core-contracts.d.ts").ChunkKind} ChunkKind
 * @typedef {import("../types/core-contracts.d.ts").ScoredChunk} ScoredChunk
 * @typedef {import("../types/core-contracts.d.ts").ChunkRepository} ChunkRepositoryType
 * @typedef {import("../types/core-contracts.d.ts").ChunkRepositoryStats} ChunkRepositoryStats
 */

// ── Constants ────────────────────────────────────────────────────────

/** Common stopwords filtered from search queries and documents */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "de", "del", "el", "en",
  "es", "for", "from", "has", "he", "in", "is", "it", "its", "la", "las",
  "lo", "los", "of", "on", "or", "que", "se", "the", "to", "un", "una",
  "was", "were", "will", "with", "y"
]);

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Slugify a project id for use as a directory name.
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/(^-|-$)/gu, "");

  return slug || "_default";
}

// ── TF-IDF Search Engine ─────────────────────────────────────────────

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

    // Smoothed IDF: log((N + 1) / (docsWithTerm + 1)) + 1
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

// ── Persistence ──────────────────────────────────────────────────────

/**
 * @param {string} baseDir
 * @param {string} projectId
 * @returns {string}
 */
function projectDir(baseDir, projectId) {
  return path.join(baseDir, slugify(projectId));
}

/**
 * @param {string} baseDir
 * @param {string} projectId
 * @returns {string}
 */
function chunksFilePath(baseDir, projectId) {
  return path.join(projectDir(baseDir, projectId), "chunks.jsonl");
}

/**
 * @param {string} filePath
 * @returns {Promise<Chunk[]>}
 */
async function readChunks(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    /** @type {Chunk[]} */
    const chunks = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        if (!parsed || typeof parsed !== "object") {
          continue;
        }

        const c = /** @type {Record<string, unknown>} */ (parsed);

        chunks.push({
          id: typeof c.id === "string" ? c.id : "",
          source: typeof c.source === "string" ? c.source : "",
          kind: /** @type {ChunkKind} */ (typeof c.kind === "string" ? c.kind : "doc"),
          content: typeof c.content === "string" ? c.content : "",
          certainty: typeof c.certainty === "number" ? c.certainty : undefined,
          recency: typeof c.recency === "number" ? c.recency : undefined,
          teachingValue: typeof c.teachingValue === "number" ? c.teachingValue : undefined,
          priority: typeof c.priority === "number" ? c.priority : undefined,
          tokens: Array.isArray(c.tokens) ? c.tokens : undefined,
          tags: (c.tags && typeof c.tags === "object") ? /** @type {Record<string, unknown>} */ (c.tags) : undefined
        });
      } catch {
        // skip malformed lines
      }
    }

    return chunks;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      /** @type {{ code: string }} */ (error).code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

/**
 * @param {string} filePath
 * @param {Chunk[]} chunks
 * @returns {Promise<void>}
 */
async function writeChunks(filePath, chunks) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = chunks.map((c) => JSON.stringify(c)).join("\n");
  await writeFile(filePath, payload ? `${payload}\n` : "", "utf8");
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Creates a chunk repository for persisting and searching chunks.
 * @param {{ baseDir?: string, filePath?: string }} [options]
 * @returns {ChunkRepositoryType}
 */
export function createChunkRepository(options) {
  const baseDir = path.resolve(options?.baseDir ?? ".lcs/chunks");
  const filePath = path.resolve(options?.filePath ?? path.join(baseDir, "_default", "chunks.jsonl"));

  /**
   * @param {string} projectId
   * @param {Chunk[]} chunks
   * @returns {Promise<{ saved: number }>}
   */
  async function save(projectId, chunks) {
    if (!chunks.length) {
      return { saved: 0 };
    }

    const fp = chunksFilePath(baseDir, projectId);
    const existing = await readChunks(fp);

    // Upsert: replace existing chunks with same id, add new ones
    /** @type {Map<string, Chunk>} */
    const updated = new Map();

    for (const c of existing) {
      updated.set(c.id, c);
    }

    for (const c of chunks) {
      updated.set(c.id, c);
    }

    await writeChunks(fp, Array.from(updated.values()));

    return { saved: chunks.length };
  }

  /**
   * @param {string} projectId
   * @returns {Promise<Chunk[]>}
   */
  async function load(projectId) {
    return readChunks(chunksFilePath(baseDir, projectId));
  }

  /**
   * @param {string} projectId
   * @param {string[]} chunkIds
   * @returns {Promise<{ removed: number }>}
   */
  async function remove(projectId, chunkIds) {
    const fp = chunksFilePath(baseDir, projectId);
    const existing = await readChunks(fp);
    const toRemove = new Set(chunkIds);
    const filtered = existing.filter((c) => !toRemove.has(c.id));
    const removedCount = existing.length - filtered.length;

    if (removedCount > 0) {
      await writeChunks(fp, filtered);
    }

    return { removed: removedCount };
  }

  /**
   * @param {string} projectId
   * @param {string} query
   * @param {number} [limit]
   * @returns {Promise<ScoredChunk[]>}
   */
  async function search(projectId, query, limit) {
    const chunks = await readChunks(chunksFilePath(baseDir, projectId));
    const queryTerms = tokenize(query);
    const maxResults = Math.max(1, Math.trunc(limit ?? 10));

    if (!queryTerms.length || !chunks.length) {
      return [];
    }

    // Build TF for all documents
    const docs = chunks.map((chunk) => ({
      chunk,
      tf: termFrequency(tokenize(chunkToSearchText(chunk)))
    }));

    // Compute IDF across the corpus
    const idf = inverseDocumentFrequency(
      queryTerms,
      docs.map((d) => d.tf)
    );

    // Score and rank
    /** @type {ScoredChunk[]} */
    const scored = [];

    for (const doc of docs) {
      const score = tfidfScore(doc.tf, queryTerms, idf);

      if (score > 0) {
        scored.push({ chunk: doc.chunk, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxResults);
  }

  /**
   * @param {string} projectId
   * @returns {Promise<ChunkRepositoryStats>}
   */
  async function stats(projectId) {
    const fp = chunksFilePath(baseDir, projectId);
    const chunks = await readChunks(fp);

    /** @type {Record<string, number>} */
    const byKind = {};

    for (const chunk of chunks) {
      byKind[chunk.kind] = (byKind[chunk.kind] ?? 0) + 1;
    }

    let sizeBytes = 0;

    try {
      const s = await stat(fp);
      sizeBytes = s.size;
    } catch {
      // file doesn't exist = 0 bytes
    }

    return {
      totalChunks: chunks.length,
      byKind,
      sizeBytes
    };
  }

  /**
   * @returns {Promise<string[]>}
   */
  async function listProjects() {
    try {
      const dirs = await readdir(baseDir, { withFileTypes: true });

      /** @type {string[]} */
      const projects = [];

      for (const dirent of dirs) {
        if (dirent.isDirectory()) {
          projects.push(dirent.name);
        }
      }

      return projects.sort();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        /** @type {{ code: string }} */ (error).code === "ENOENT"
      ) {
        return [];
      }

      throw error;
    }
  }

  /**
   * @param {string} projectId
   * @returns {Promise<void>}
   */
  async function clear(projectId) {
    const fp = chunksFilePath(baseDir, projectId);

    try {
      await writeChunks(fp, []);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        /** @type {{ code: string }} */ (error).code === "ENOENT"
      ) {
        return;
      }

      throw error;
    }
  }

  /**
   * Legacy API: upsert a single chunk into repository.filePath.
   * @param {{ id: string, source?: string, kind?: string, content: string, metadata?: Record<string, unknown> }} chunk
   */
  async function upsertChunk(chunk) {
    if (!chunk || typeof chunk.id !== "string" || chunk.id.trim() === "") {
      throw new Error("chunk id is required");
    }

    if (typeof chunk.content !== "string") {
      throw new Error("chunk content must be a string");
    }

    const current = await readChunks(filePath);
    const index = current.findIndex((entry) => entry.id === chunk.id);
    const normalized = {
      id: chunk.id,
      source: chunk.source ?? chunk.id,
      kind: /** @type {ChunkKind} */ (chunk.kind ?? "doc"),
      content: chunk.content,
      metadata: chunk.metadata ?? {}
    };

    if (index >= 0) {
      current[index] = normalized;
    } else {
      current.push(normalized);
    }

    await writeChunks(filePath, current);
    return normalized;
  }

  /**
   * Legacy API: get chunks by id from repository.filePath.
   * @param {string[]} ids
   */
  async function getChunksById(ids) {
    const current = await readChunks(filePath);
    const wanted = new Set(ids);
    return current.filter((entry) => wanted.has(entry.id));
  }

  /**
   * Legacy API: list chunks from repository.filePath with filters.
   * @param {{ kind?: string, sourceIncludes?: string, limit?: number }} [filters]
   */
  async function listChunks(filters = {}) {
    const current = await readChunks(filePath);
    let result = [...current];

    if (filters.kind) {
      result = result.filter((entry) => entry.kind === filters.kind);
    }

    if (filters.sourceIncludes) {
      const needle = filters.sourceIncludes.toLowerCase();
      result = result.filter((entry) => String(entry.source ?? "").toLowerCase().includes(needle));
    }

    if (typeof filters.limit === "number") {
      result = result.slice(0, Math.max(0, filters.limit));
    }

    return result;
  }

  return {
    filePath,
    upsertChunk,
    getChunksById,
    listChunks,
    save,
    load,
    remove,
    search,
    stats,
    listProjects,
    clear
  };
}
