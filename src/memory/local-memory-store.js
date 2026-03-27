// @ts-check

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createChunkRepository } from "../storage/chunk-repository.js";
import { buildCloseSummaryContent } from "./memory-utils.js";

/**
 * @typedef {import("../types/core-contracts.d.ts").MemoryEntry} MemoryEntry
 * @typedef {import("../types/core-contracts.d.ts").MemorySearchOptions} MemorySearchOptions
 * @typedef {import("../types/core-contracts.d.ts").MemorySaveInput} MemorySaveInput
 * @typedef {import("../types/core-contracts.d.ts").MemoryCloseInput} MemoryCloseInput
 * @typedef {import("../types/core-contracts.d.ts").MemorySearchResult} MemorySearchResult
 * @typedef {import("../types/core-contracts.d.ts").MemorySaveResult} MemorySaveResult
 * @typedef {import("../types/core-contracts.d.ts").MemoryHealthResult} MemoryHealthResult
 * @typedef {import("../types/core-contracts.d.ts").MemoryProvider} MemoryProvider
 */

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * @param {string} value
 * @returns {string}
 */
function compactLine(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  const slug = compactLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/(^-|-$)/gu, "");

  return slug || "memory";
}

/**
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(value, maxLength) {
  const compacted = compactLine(value);
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

// ── TF-IDF Search Engine ─────────────────────────────────────────────

/** Common stopwords filtered from search queries and documents */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "de", "del", "el", "en",
  "es", "for", "from", "has", "he", "in", "is", "it", "its", "la", "las",
  "lo", "los", "of", "on", "or", "que", "se", "the", "to", "un", "una",
  "was", "were", "will", "with", "y"
]);

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
 * Build searchable text from a memory entry (title + content + type + topic).
 * @param {MemoryEntry} entry
 * @returns {string}
 */
function entryToSearchText(entry) {
  return `${entry.title} ${entry.content} ${entry.type} ${entry.topic}`;
}

/**
 * @typedef {{
 *   entry: MemoryEntry,
 *   score: number
 * }} ScoredEntry
 */

/**
 * Search entries using TF-IDF ranking.
 * @param {MemoryEntry[]} entries
 * @param {string} query
 * @param {{ project?: string, scope?: string, type?: string, limit?: number }} options
 * @returns {ScoredEntry[]}
 */
function searchWithTFIDF(entries, query, options) {
  // Pre-filter by metadata
  const candidates = entries.filter((entry) => {
    if (options.project && entry.project && entry.project !== options.project) {
      return false;
    }

    if (options.scope && entry.scope !== options.scope) {
      return false;
    }

    if (options.type && entry.type !== options.type) {
      return false;
    }

    return true;
  });

  const queryTerms = tokenize(query);
  const limit = Math.max(1, Math.trunc(options.limit ?? 5));

  // If no query terms, return most recent
  if (!queryTerms.length) {
    return candidates
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((entry) => ({ entry, score: 1 }));
  }

  // Build TF for all candidate documents
  /** @type {{ entry: MemoryEntry, tf: Map<string, number> }[]} */
  const docs = candidates.map((entry) => ({
    entry,
    tf: termFrequency(tokenize(entryToSearchText(entry)))
  }));

  // Compute IDF across the corpus
  const idf = inverseDocumentFrequency(
    queryTerms,
    docs.map((d) => d.tf)
  );

  // Score and rank
  /** @type {ScoredEntry[]} */
  const scored = [];

  for (const doc of docs) {
    const score = tfidfScore(doc.tf, queryTerms, idf);

    if (score > 0) {
      scored.push({ entry: doc.entry, score });
    }
  }

  // Sort by score descending, break ties by recency
  scored.sort((a, b) => {
    const scoreDiff = b.score - a.score;

    if (Math.abs(scoreDiff) > 0.001) {
      return scoreDiff;
    }

    return b.entry.createdAt.localeCompare(a.entry.createdAt);
  });

  return scored.slice(0, limit);
}

// ── Persistence Layer ────────────────────────────────────────────────

/**
 * Resolve the storage path for a project.
 * Uses per-project directories: .lcs/memory/{project}/memories.jsonl
 * Falls back to .lcs/memory/_default/memories.jsonl for unscoped entries.
 * @param {string} baseDir
 * @param {string} [project]
 * @returns {string}
 */
function projectFilePath(baseDir, project) {
  const projectSlug = project ? slugify(project) : "_default";
  return path.join(baseDir, projectSlug, "memories.jsonl");
}

/**
 * @param {string} filePath
 * @returns {Promise<MemoryEntry[]>}
 */
async function readEntries(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    /** @type {MemoryEntry[]} */
    const entries = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        if (!parsed || typeof parsed !== "object") {
          continue;
        }

        const candidate = /** @type {Record<string, unknown>} */ (parsed);
        const createdAt =
          typeof candidate.createdAt === "string" && candidate.createdAt
            ? candidate.createdAt
            : new Date().toISOString();

        entries.push({
          id: typeof candidate.id === "string" ? candidate.id : slugify(createdAt),
          title: typeof candidate.title === "string" ? candidate.title : "Untitled memory",
          content: typeof candidate.content === "string" ? candidate.content : "",
          type: typeof candidate.type === "string" ? candidate.type : "learning",
          project: typeof candidate.project === "string" ? candidate.project : "",
          scope: typeof candidate.scope === "string" ? candidate.scope : "project",
          topic: typeof candidate.topic === "string" ? candidate.topic : "",
          createdAt,
          ...extractHygieneMetadata(candidate)
        });
      } catch {
        // ignore malformed local line
      }
    }

    return entries;
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

/**
 * Normalize an unknown value to a plain record.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Record<string, unknown>}
 */
function extractHygieneMetadata(record) {
  /** @type {Record<string, unknown>} */
  const metadata = {};

  if (typeof record.sourceKind === "string" && record.sourceKind.trim()) {
    metadata.sourceKind = record.sourceKind.trim();
  }

  if (typeof record.reviewStatus === "string" && record.reviewStatus.trim()) {
    metadata.reviewStatus = record.reviewStatus.trim();
  }

  if (typeof record.protected === "boolean") {
    metadata.protected = record.protected;
  }

  for (const key of ["signalScore", "duplicateScore", "durabilityScore", "healthScore"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      metadata[key] = value;
    }
  }

  if (typeof record.expiresAt === "string" && record.expiresAt.trim()) {
    metadata.expiresAt = record.expiresAt.trim();
  }

  if (Array.isArray(record.supersedes) && record.supersedes.every((item) => typeof item === "string")) {
    metadata.supersedes = [...record.supersedes];
  }

  if (
    Array.isArray(record.reviewReasons) &&
    record.reviewReasons.every((item) => typeof item === "string")
  ) {
    metadata.reviewReasons = [...record.reviewReasons];
  }

  return metadata;
}

/**
 * Write entries to a JSONL file, creating parent directories as needed.
 * @param {string} filePath
 * @param {MemoryEntry[]} entries
 * @returns {Promise<void>}
 */
async function writeEntries(filePath, entries) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e));
  await writeFile(filePath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}

/**
 * @param {Array<{ id: string, content: string, metadata?: unknown }>} chunks
 * @returns {MemoryEntry[]}
 */
function mapChunksToEntries(chunks) {
  return chunks
    .map((chunk) => {
      const metadata = asRecord(chunk.metadata);
      const createdAt =
        typeof metadata.createdAt === "string" && metadata.createdAt
          ? metadata.createdAt
          : new Date().toISOString();

      return {
        id: chunk.id,
        title:
          typeof metadata.title === "string" && metadata.title
            ? metadata.title
            : "Untitled memory",
        content: chunk.content,
        type:
          typeof metadata.type === "string" && metadata.type
            ? metadata.type
            : "learning",
        project:
          typeof metadata.project === "string" ? metadata.project : "",
        scope:
          typeof metadata.scope === "string" && metadata.scope
            ? metadata.scope
            : "project",
        topic:
          typeof metadata.topic === "string" ? metadata.topic : "",
        createdAt,
        ...extractHygieneMetadata(metadata)
      };
    })
    .sort((/** @type {MemoryEntry} */ left, /** @type {MemoryEntry} */ right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * Read all entries across all project directories.
 * @param {string} baseDir
 * @returns {Promise<MemoryEntry[]>}
 */
async function readAllEntries(baseDir) {
  /** @type {MemoryEntry[]} */
  const all = [];

  try {
    const dirs = await readdir(baseDir, { withFileTypes: true });

    for (const dirent of dirs) {
      if (!dirent.isDirectory()) {
        continue;
      }

      const fp = path.join(baseDir, dirent.name, "memories.jsonl");
      const entries = await readEntries(fp);
      all.push(...entries);
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  return all;
}

// ── Legacy Migration ─────────────────────────────────────────────────

/**
 * Migrate old single-file store to per-project layout if needed.
 * @param {string} legacyPath - Old .lcs/local-memory-store.jsonl
 * @param {string} baseDir - New .lcs/memory/
 */
async function migrateIfNeeded(legacyPath, baseDir) {
  try {
    const entries = await readEntries(legacyPath);

    if (!entries.length) {
      return;
    }

    // Group by project
    /** @type {Map<string, MemoryEntry[]>} */
    const byProject = new Map();

    for (const entry of entries) {
      const key = entry.project || "_default";

      if (!byProject.has(key)) {
        byProject.set(key, []);
      }

      byProject.get(key)?.push(entry);
    }

    // Write to new per-project files
    for (const [project, projectEntries] of byProject) {
      const fp = projectFilePath(baseDir, project === "_default" ? undefined : project);
      const existing = await readEntries(fp);
      const existingIds = new Set(existing.map((e) => e.id));
      const newEntries = projectEntries.filter((e) => !existingIds.has(e.id));

      if (newEntries.length) {
        await writeEntries(fp, [...existing, ...newEntries]);
      }
    }

    // Rename legacy file to mark as migrated
    const { rename } = await import("node:fs/promises");
    await rename(legacyPath, `${legacyPath}.migrated`);
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    // Migration failure is non-fatal — log and continue
    process.stderr.write(`[lcs] migration warning: ${error}\n`);
  }
}

// ── Output Formatters ────────────────────────────────────────────────

/**
 * @param {MemoryEntry[]} entries
 * @returns {string}
 */
function toSearchStdout(entries) {
  if (!entries.length) {
    return "No memories found for that query.";
  }

  /** @type {string[]} */
  const lines = [`Found ${entries.length} memories:`, ""];

  entries.forEach((entry, index) => {
    lines.push(`[${index + 1}] #${entry.id} (${entry.type}) - ${entry.title}`);
    lines.push(`    ${truncate(entry.content, 220)}`);
    lines.push(`    ${entry.createdAt} | project: ${entry.project || "local"} | scope: ${entry.scope}`);
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

/**
 * @param {MemoryEntry[]} entries
 * @param {string} [project]
 * @returns {string}
 */
function toContextStdout(entries, project) {
  if (!entries.length) {
    return "No local memories available.";
  }

  const lines = ["Recent local memories:", ""];

  entries.forEach((entry, index) => {
    lines.push(
      `${index + 1}. [${entry.type}] ${entry.title} (${entry.createdAt})${
        entry.project ? ` | project: ${entry.project}` : ""
      }`
    );
  });

  if (project) {
    lines.push("");
    lines.push(`Filtered project: ${project}`);
  }

  return lines.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Creates a local memory store implementing the MemoryProvider interface.
 *
 * Storage layout:
 *   .lcs/memory/{project-slug}/memories.jsonl
 *   .lcs/memory/_default/memories.jsonl (for unscoped memories)
 *
 * Search uses TF-IDF ranking instead of naive substring matching.
 *
 * @param {{
 *   cwd?: string,
 *   filePath?: string,
 *   baseDir?: string
 * }} [options]
 * @returns {MemoryProvider & { config: { cwd: string, filePath: string, dataDir: string, baseDir: string } }}
 */
export function createLocalMemoryStore(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const baseDir = path.resolve(cwd, options.baseDir ?? ".lcs/memory");
  const legacyFilePath = path.resolve(cwd, options.filePath ?? ".lcs/local-memory-store.jsonl");
  const dataDir = path.dirname(legacyFilePath);

  /** @type {boolean} */
  let migrationChecked = false;

  async function ensureMigration() {
    if (!migrationChecked) {
      migrationChecked = true;
      await migrateIfNeeded(legacyFilePath, baseDir);
    }
  }

  // ── MemoryProvider: search ──

  /**
   * @param {string} query
   * @param {MemorySearchOptions} [searchOptions]
   * @returns {Promise<MemorySearchResult>}
   */
  async function search(query, searchOptions = {}) {
    await ensureMigration();
    const project = searchOptions.project;
    const entries = project
      ? await readEntries(projectFilePath(baseDir, project))
      : await readAllEntries(baseDir);

    const results = searchWithTFIDF(entries, query, {
      project: searchOptions.project,
      scope: searchOptions.scope,
      type: searchOptions.type,
      limit: searchOptions.limit
    });

    return {
      entries: results.map((r) => r.entry),
      stdout: toSearchStdout(results.map((r) => r.entry)),
      provider: "local"
    };
  }

  // ── MemoryProvider: save ──

  /**
   * @param {MemorySaveInput} input
   * @returns {Promise<MemorySaveResult>}
   */
  async function save(input) {
    await ensureMigration();
    const fp = projectFilePath(baseDir, input.project);
    const entries = await readEntries(fp);
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[-:.TZ]/gu, "")}-${slugify(input.title).slice(0, 20)}`;

    /** @type {MemoryEntry} */
    const entry = {
      id,
      title: input.title,
      content: input.content,
      type: input.type ?? "learning",
      project: input.project ?? "",
      scope: input.scope ?? "project",
      topic: input.topic ?? "",
      createdAt,
      ...extractHygieneMetadata(asRecord(input))
    };

    entries.push(entry);
    await writeEntries(fp, entries);

    return {
      id,
      stdout: `Saved local memory #${id}`,
      provider: "local"
    };
  }

  // ── MemoryProvider: delete ──

  /**
   * @param {string} id
   * @param {string} [project]
   * @returns {Promise<{ deleted: boolean, id: string }>}
   */
  async function deleteMemory(id, project) {
    await ensureMigration();

    if (project) {
      const fp = projectFilePath(baseDir, project);
      const entries = await readEntries(fp);
      const filtered = entries.filter((e) => e.id !== id);

      if (filtered.length < entries.length) {
        await writeEntries(fp, filtered);
        return { deleted: true, id };
      }

      return { deleted: false, id };
    }

    // Search across all projects
    try {
      const dirs = await readdir(baseDir, { withFileTypes: true });

      for (const dirent of dirs) {
        if (!dirent.isDirectory()) {
          continue;
        }

        const fp = path.join(baseDir, dirent.name, "memories.jsonl");
        const entries = await readEntries(fp);
        const filtered = entries.filter((e) => e.id !== id);

        if (filtered.length < entries.length) {
          await writeEntries(fp, filtered);
          return { deleted: true, id };
        }
      }
    } catch {
      // directory doesn't exist = nothing to delete
    }

    return { deleted: false, id };
  }

  // ── MemoryProvider: list ──

  /**
   * @param {{ project?: string, limit?: number }} [listOptions]
   * @returns {Promise<MemoryEntry[]>}
   */
  async function list(listOptions = {}) {
    await ensureMigration();
    const limit = Math.max(1, Math.trunc(listOptions.limit ?? 50));

    const entries = listOptions.project
      ? await readEntries(projectFilePath(baseDir, listOptions.project))
      : await readAllEntries(baseDir);

    return entries
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // ── MemoryProvider: health ──

  /**
   * @returns {Promise<MemoryHealthResult>}
   */
  async function health() {
    try {
      await mkdir(baseDir, { recursive: true });
      const testFile = path.join(baseDir, ".health-check");
      await writeFile(testFile, "ok", "utf8");
      await unlink(testFile);

      return {
        healthy: true,
        provider: "local",
        detail: `Local memory store at ${baseDir}`
      };
    } catch (error) {
      return {
        healthy: false,
        provider: "local",
        detail: `Cannot write to ${baseDir}: ${error}`
      };
    }
  }

  // ── Legacy compatibility methods ──

  /**
   * @param {string} [project]
   */
  async function recallContext(project) {
    await ensureMigration();
    const entries = project
      ? await readEntries(projectFilePath(baseDir, project))
      : await readAllEntries(baseDir);

    const filtered = entries
      .filter((entry) => !project || !entry.project || entry.project === project)
      .slice(0, 5);

    return {
      mode: "context",
      project: project ?? "",
      query: "",
      scope: "",
      type: "",
      limit: 5,
      stdout: toContextStdout(filtered, project),
      stderr: "",
      dataDir,
      filePath: legacyFilePath,
      provider: "local"
    };
  }

  /**
   * @param {string} query
   * @param {MemorySearchOptions} [searchOptions]
   */
  async function searchMemories(query, searchOptions = {}) {
    const result = await search(query, searchOptions);

    return {
      mode: "search",
      query,
      project: searchOptions.project ?? "",
      scope: searchOptions.scope ?? "",
      type: searchOptions.type ?? "",
      limit: searchOptions.limit ?? 5,
      stdout: result.stdout,
      stderr: "",
      dataDir,
      filePath: legacyFilePath,
      provider: "local"
    };
  }

  /**
   * @param {MemorySaveInput} input
   */
  async function saveMemory(input) {
    const result = await save(input);

    return {
      action: "save",
      title: input.title,
      content: input.content,
      type: input.type ?? "learning",
      project: input.project ?? "",
      scope: input.scope ?? "project",
      topic: input.topic ?? "",
      stdout: result.stdout,
      stderr: "",
      dataDir,
      filePath: legacyFilePath,
      provider: "local"
    };
  }

  /**
   * @param {MemoryCloseInput} input
   */
  async function closeSession(input) {
    const closedAt = new Date().toISOString();
    const title = input.title ?? `Session close - ${closedAt.slice(0, 10)}`;
    const content = buildCloseSummaryContent({
      summary: input.summary,
      learned: input.learned,
      next: input.next,
      workspace: cwd,
      closedAt
    });
    const saved = await saveMemory({
      title,
      content,
      type: input.type ?? "learning",
      project: input.project,
      scope: input.scope ?? "project",
      ...extractHygieneMetadata(asRecord(input))
    });

    return {
      ...saved,
      action: "close",
      title,
      summary: input.summary,
      learned: input.learned ?? "",
      next: input.next ?? "",
      content
    };
  }

  return {
    name: "local",
    config: {
      cwd,
      filePath: legacyFilePath,
      dataDir,
      baseDir
    },
    // MemoryProvider interface
    search,
    save,
    delete: deleteMemory,
    list,
    health,
    // Legacy compatibility
    recallContext,
    searchMemories,
    saveMemory,
    closeSession
  };
}
