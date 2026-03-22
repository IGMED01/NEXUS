// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCloseSummaryContent } from "./engram-client.js";

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   content: string,
 *   type: string,
 *   project: string,
 *   scope: string,
 *   topic: string,
 *   createdAt: string
 * }} LocalMemoryEntry
 */

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

/**
 * @param {string} filePath
 * @returns {Promise<LocalMemoryEntry[]>}
 */
async function readEntries(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    /** @type {LocalMemoryEntry[]} */
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
          createdAt
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
 * @param {string} filePath
 * @param {LocalMemoryEntry[]} entries
 */
async function writeEntries(filePath, entries) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, payload ? `${payload}\n` : "", "utf8");
}

/**
 * @param {LocalMemoryEntry[]} entries
 * @param {{
 *   query: string,
 *   project?: string,
 *   scope?: string,
 *   type?: string,
 *   limit?: number
 * }} options
 * @returns {LocalMemoryEntry[]}
 */
function filterEntries(entries, options) {
  const queryTokens = compactLine(options.query)
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  const limit = Math.max(1, Math.trunc(options.limit ?? 5));

  const filtered = entries.filter((entry) => {
    if (options.project && entry.project && entry.project !== options.project) {
      return false;
    }

    if (options.scope && entry.scope !== options.scope) {
      return false;
    }

    if (options.type && entry.type !== options.type) {
      return false;
    }

    if (!queryTokens.length) {
      return true;
    }

    const haystack = `${entry.title} ${entry.content} ${entry.type} ${entry.topic}`.toLowerCase();
    return queryTokens.every((token) => haystack.includes(token));
  });

  return filtered
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

/**
 * @param {LocalMemoryEntry[]} entries
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
 * @param {LocalMemoryEntry[]} entries
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

/**
 * @param {{
 *   cwd?: string,
 *   filePath?: string
 * }} [options]
 */
export function createLocalMemoryStore(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const filePath = path.resolve(cwd, options.filePath ?? ".lcs/local-memory-store.jsonl");
  const dataDir = path.dirname(filePath);

  /**
   * @param {string} [project]
   */
  async function recallContext(project) {
    const entries = await readEntries(filePath);
    const filtered = entries
      .filter((entry) => !project || !entry.project || entry.project === project)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
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
      filePath,
      provider: "local"
    };
  }

  /**
   * @param {string} query
   * @param {{ project?: string, scope?: string, type?: string, limit?: number }} [options]
   */
  async function searchMemories(query, options = {}) {
    const entries = await readEntries(filePath);
    const filtered = filterEntries(entries, {
      query,
      project: options.project,
      scope: options.scope,
      type: options.type,
      limit: options.limit
    });

    return {
      mode: "search",
      query,
      project: options.project ?? "",
      scope: options.scope ?? "",
      type: options.type ?? "",
      limit: options.limit ?? 5,
      stdout: toSearchStdout(filtered),
      stderr: "",
      dataDir,
      filePath,
      provider: "local"
    };
  }

  /**
   * @param {{
   *   title: string,
   *   content: string,
   *   type?: string,
   *   project?: string,
   *   scope?: string,
   *   topic?: string
   * }} input
   */
  async function saveMemory(input) {
    const entries = await readEntries(filePath);
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[-:.TZ]/gu, "")}-${slugify(input.title).slice(0, 20)}`;
    const entry = {
      id,
      title: input.title,
      content: input.content,
      type: input.type ?? "learning",
      project: input.project ?? "",
      scope: input.scope ?? "project",
      topic: input.topic ?? "",
      createdAt
    };
    entries.push(entry);
    await writeEntries(filePath, entries);

    return {
      action: "save",
      title: entry.title,
      content: entry.content,
      type: entry.type,
      project: entry.project,
      scope: entry.scope,
      topic: entry.topic,
      stdout: `Saved local memory #${entry.id}`,
      stderr: "",
      dataDir,
      filePath,
      provider: "local"
    };
  }

  /**
   * @param {{
   *   summary: string,
   *   learned?: string,
   *   next?: string,
   *   title?: string,
   *   project?: string,
   *   scope?: string,
   *   type?: string
   * }} input
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
      scope: input.scope ?? "project"
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
    config: {
      cwd,
      filePath,
      dataDir
    },
    recallContext,
    searchMemories,
    saveMemory,
    closeSession
  };
}
