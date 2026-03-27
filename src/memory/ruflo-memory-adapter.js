// @ts-check

import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { buildCloseSummaryContent } from "./memory-utils.js";

const execFile = promisify(execFileCallback);
const RUFLO_TIMEOUT_MS = 7000;
const RUFLO_SAVE_TIMEOUT_MS = 5000;
const RUFLO_INIT_TIMEOUT_MS = 30000;

/** @typedef {import("../types/core-contracts.d.ts").MemoryEntry} MemoryEntry */
/** @typedef {import("../types/core-contracts.d.ts").MemorySearchOptions} MemorySearchOptions */
/** @typedef {import("../types/core-contracts.d.ts").MemorySaveInput} MemorySaveInput */
/** @typedef {import("../types/core-contracts.d.ts").MemoryCloseInput} MemoryCloseInput */
/** @typedef {import("../types/core-contracts.d.ts").MemorySearchResult} MemorySearchResult */
/** @typedef {import("../types/core-contracts.d.ts").MemorySaveResult} MemorySaveResult */
/** @typedef {import("../types/core-contracts.d.ts").MemoryHealthResult} MemoryHealthResult */
/** @typedef {{ namespace?: string, project?: string }} RufloAdapterConfig */
/** @typedef {Record<string, unknown>} UnknownRecord */

/** @type {boolean | undefined} */
let cachedAvailability;
/** @type {Promise<void> | null} */
let initializationPromise = null;

/**
 * @param {unknown} error
 */
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} value
 * @returns {UnknownRecord}
 */
function asRecord(value) {
  return value && typeof value === "object" ? /** @type {UnknownRecord} */ (value) : {};
}

/**
 * @param {string} value
 */
function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 24);
}

function rufloDbCandidates() {
  const cwd = process.cwd();
  return [
    path.join(cwd, ".swarm", "memory.db"),
    path.join(cwd, ".claude", "memory.db"),
    path.join(cwd, ".claude-flow", "memory.db"),
    path.join(cwd, "data", "memory.db")
  ];
}

function hasRufloDatabase() {
  return rufloDbCandidates().some((candidate) => existsSync(candidate));
}

async function ensureRufloMemoryInitialized() {
  if (hasRufloDatabase()) {
    return;
  }

  if (!initializationPromise) {
    initializationPromise = (async () => {
      await execRufloCli(["memory", "init", "--verify", "false"], RUFLO_INIT_TIMEOUT_MS);
    })().finally(() => {
      initializationPromise = null;
    });
  }

  await initializationPromise;
}

/**
 * @param {string} rawValue
 */
function parseStructuredValue(rawValue) {
  const text = String(rawValue ?? "");

  try {
    const parsed = JSON.parse(text);
    const record = asRecord(parsed);
    const metadata = asRecord(record.metadata);
    return {
      title: String(record.title ?? metadata.title ?? ""),
      content: String(record.content ?? metadata.content ?? text),
      type: String(record.type ?? metadata.type ?? ""),
      project: String(record.project ?? metadata.project ?? ""),
      scope: String(record.scope ?? metadata.scope ?? ""),
      topic: String(record.topic ?? metadata.topic ?? ""),
      createdAt: String(record.createdAt ?? metadata.createdAt ?? "")
    };
  } catch {
    return {
      title: "",
      content: text,
      type: "",
      project: "",
      scope: "",
      topic: "",
      createdAt: ""
    };
  }
}

/**
 * @param {string[]} args
 * @param {number} timeout
 * @returns {Promise<{ stdout: string }>}
 */
async function execRufloCli(args, timeout) {
  if (process.platform === "win32") {
    const result = await execFile(
      "cmd.exe",
      ["/d", "/s", "/c", "npx.cmd", "--no-install", "ruflo", ...args],
      {
        timeout,
        shell: false,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    );
    return {
      stdout: result.stdout?.toString?.() ?? String(result.stdout ?? "")
    };
  }

  const result = await execFile("npx", ["--no-install", "ruflo", ...args], {
    timeout,
    shell: false,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return {
    stdout: result.stdout?.toString?.() ?? String(result.stdout ?? "")
  };
}

/**
 * @param {string[]} args
 * @param {number} [timeout]
 */
async function runRuflo(args, timeout = RUFLO_TIMEOUT_MS) {
  const result = await execRufloCli(args, timeout);
  const raw = result.stdout?.toString?.() ?? String(result.stdout ?? "");
  const text = raw.trim();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function isRufloAvailable() {
  if (cachedAvailability !== undefined) {
    return cachedAvailability;
  }

  try {
    await execRufloCli(["--version"], 3000);
    cachedAvailability = true;
  } catch {
    cachedAvailability = false;
  }

  return cachedAvailability;
}

/**
 * @param {MemoryEntry[]} entries
 */
function toSearchStdout(entries) {
  if (!entries.length) {
    return "No memories found for that query.";
  }

  const lines = [`Found ${entries.length} memories:`, ""];

  for (const [index, entry] of entries.entries()) {
    lines.push(`[${index + 1}] #${entry.id} (${entry.type}) - ${entry.title}`);
    lines.push(`    ${String(entry.content ?? "").trim().slice(0, 220)}`);
    lines.push(`    ${entry.createdAt} | project: ${entry.project || "local"} | scope: ${entry.scope}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * @param {unknown} raw
 * @returns {MemoryEntry[]}
 */
function toEntries(raw) {
  const rawRecord = asRecord(raw);
  const resultsValue = rawRecord.results;
  const entriesValue = rawRecord.entries;
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(resultsValue)
      ? resultsValue
      : Array.isArray(entriesValue)
        ? entriesValue
        : [];

  return items.map((item, index) => {
    const record = asRecord(item);
    const metadata = asRecord(record.metadata);
    const parsedValue = parseStructuredValue(
      String(record.content ?? record.body ?? metadata.content ?? "")
    );

    return {
      id: String(record.id ?? record.key ?? record.observationId ?? `ruflo-${index + 1}`),
      title: String(
        metadata.title ?? record.title ?? parsedValue.title ?? record.key ?? "Untitled memory"
      ),
      content: String(parsedValue.content || record.content || record.body || metadata.content || ""),
      type: String(parsedValue.type || metadata.type || record.type || "learning"),
      project: String(parsedValue.project || metadata.project || record.project || ""),
      scope: String(parsedValue.scope || metadata.scope || record.scope || "project"),
      topic: String(parsedValue.topic || metadata.topic || record.topic || ""),
      createdAt: String(
        parsedValue.createdAt ||
          metadata.createdAt ||
          metadata.timestamp ||
          record.createdAt ||
          record.timestamp ||
          new Date().toISOString()
      )
    };
  });
}

/**
 * @param {RufloAdapterConfig} [config]
 */
export function createRufloMemoryAdapter(config = {}) {
  const namespace = String(config.namespace ?? config.project ?? "nexus");

  return {
    name: "ruflo",
    config: { namespace },

    /**
     * @param {string} query
     * @param {MemorySearchOptions} [options]
     * @returns {Promise<MemorySearchResult>}
     */
    async search(query, options = {}) {
      await ensureRufloMemoryInitialized();
      const raw = await runRuflo([
        "memory",
        "search",
        "--query",
        query,
        "--namespace",
        namespace,
        "--limit",
        String(Math.max(1, Math.trunc(options.limit ?? 5))),
        "--format",
        "json"
      ]);
      const entries = toEntries(raw);

      return {
        entries,
        stdout: toSearchStdout(entries),
        provider: "ruflo"
      };
    },

    /**
     * @param {MemorySaveInput} input
     * @returns {Promise<MemorySaveResult>}
     */
    async save(input) {
      await ensureRufloMemoryInitialized();
      const createdAt = new Date().toISOString();
      const id = `${createdAt.replace(/[-:.TZ]/gu, "")}-${slugify(input.title || "memory") || "ruflo"}`;
      const payload = JSON.stringify({
        content: input.content,
        title: input.title,
        type: input.type ?? "learning",
        project: input.project ?? namespace,
        scope: input.scope ?? "project",
        topic: input.topic ?? "",
        createdAt
      });

      await runRuflo([
        "memory",
        "store",
        "--key",
        id,
        "--value",
        payload,
        "--namespace",
        namespace,
        "--upsert"
      ], RUFLO_SAVE_TIMEOUT_MS);

      return {
        id,
        stdout: `Saved Ruflo memory #${id}`,
        provider: "ruflo"
      };
    },

    /**
     * @param {string} id
     * @returns {Promise<{ deleted: boolean, id: string }>}
     */
    async delete(id) {
      await ensureRufloMemoryInitialized();
      await runRuflo(["memory", "delete", "--key", id, "--namespace", namespace]);
      return { deleted: true, id };
    },

    /**
     * @param {{ limit?: number }} [options]
     * @returns {Promise<MemoryEntry[]>}
     */
    async list(options = {}) {
      await ensureRufloMemoryInitialized();
      const raw = await runRuflo([
        "memory",
        "list",
        "--namespace",
        namespace,
        "--limit",
        String(Math.max(1, Math.trunc(options.limit ?? 20))),
        "--format",
        "json"
      ]);
      return toEntries(raw);
    },

    /**
     * @returns {Promise<MemoryHealthResult>}
     */
    async health() {
      try {
        const available = await isRufloAvailable();
        const databaseReady = hasRufloDatabase();
        return {
          healthy: available && databaseReady,
          provider: "ruflo",
          detail: available
            ? databaseReady
              ? "Ruflo CLI available with local memory database initialized."
              : "Ruflo CLI available, but memory database is not initialized yet."
            : "Ruflo CLI not available in PATH/npm cache."
        };
      } catch (error) {
        return {
          healthy: false,
          provider: "ruflo",
          detail: `Ruflo health check failed: ${toErrorMessage(error)}`
        };
      }
    },

    /**
     * @param {string} [project]
     */
    async recallContext(project) {
      const entries = await this.list({ limit: 10 });
      const filtered = project ? entries.filter((entry) => !entry.project || entry.project === project) : entries;
      return {
        mode: "context",
        project: project ?? "",
        stdout: toSearchStdout(filtered.slice(0, 10)),
        provider: "ruflo"
      };
    },

    /**
     * @param {string} query
     * @param {MemorySearchOptions} [options]
     */
    async searchMemories(query, options = {}) {
      const result = await this.search(query, options);
      return {
        mode: "search",
        query,
        project: options.project ?? "",
        scope: options.scope ?? "",
        type: options.type ?? "",
        limit: options.limit ?? 5,
        stdout: result.stdout,
        provider: result.provider
      };
    },

    /**
     * @param {MemorySaveInput} input
     */
    async saveMemory(input) {
      const result = await this.save(input);
      return {
        action: "save",
        title: input.title,
        content: input.content,
        type: input.type ?? "learning",
        project: input.project ?? "",
        scope: input.scope ?? "project",
        topic: input.topic ?? "",
        stdout: result.stdout,
        provider: result.provider
      };
    },

    /**
     * @param {MemoryCloseInput} input
     */
    async closeSession(input) {
      const closedAt = new Date().toISOString();
      const title = input.title ?? `Session close - ${closedAt.slice(0, 10)}`;
      const content = buildCloseSummaryContent({
        summary: input.summary,
        learned: input.learned,
        next: input.next,
        closedAt
      });
      const saved = await this.saveMemory({
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
  };
}
