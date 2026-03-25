// @ts-check

/**
 * @typedef {import("../types/core-contracts.d.ts").AuditEntry} AuditEntry
 * @typedef {import("../types/core-contracts.d.ts").AuditQueryFilters} AuditQueryFilters
 * @typedef {import("../types/core-contracts.d.ts").AuditStats} AuditStats
 * @typedef {import("../types/core-contracts.d.ts").OutputAuditor} OutputAuditor
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

// ── Auditor Factory ──────────────────────────────────────────────────

/**
 * Create an output auditor instance.
 *
 * @param {{ logDir?: string }} [options]
 * @returns {OutputAuditor}
 */
export function createOutputAuditor(options) {
  const logFile = options?.filePath
    ? join(options.filePath)
    : join(options?.logDir ?? join(process.cwd(), ".lcs", "audit"), "output-guard.jsonl");
  const logDir = dirname(logFile);

  /** @type {AuditEntry[] | null} */
  let cache = null;
  let cacheStale = true;

  function ensureDir() {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * @returns {AuditEntry[]}
   */
  function loadCache() {
    if (cache !== null && !cacheStale) {
      return cache;
    }

    if (!existsSync(logFile)) {
      cache = [];
      cacheStale = false;
      return cache;
    }

    const raw = readFileSync(logFile, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    /** @type {AuditEntry[]} */
    const entries = [];

    for (const line of lines) {
      try {
        entries.push(/** @type {AuditEntry} */ (JSON.parse(line)));
      } catch {
        // Skip malformed lines
      }
    }

    cache = entries;
    cacheStale = false;
    return cache;
  }

  return {
    filePath: logFile,
    /**
     * @param {AuditEntry} entry
     * @returns {Promise<void>}
     */
    async log(entry) {
      ensureDir();
      const line = JSON.stringify(entry) + "\n";
      appendFileSync(logFile, line, "utf-8");
      cacheStale = true;
    },

    /**
     * @param {AuditQueryFilters} [filters]
     * @returns {Promise<AuditEntry[]>}
     */
    async query(filters) {
      let entries = loadCache();

      if (!filters) {
        return [...entries];
      }

      if (filters.project) {
        entries = entries.filter((e) => e.project === filters.project);
      }

      if (typeof filters.blocked === "boolean") {
        entries = entries.filter((e) => e.blocked === filters.blocked);
      }

      if (filters.since) {
        const sinceDate = filters.since;
        entries = entries.filter((e) => e.timestamp >= sinceDate);
      }

      if (typeof filters.limit === "number" && filters.limit > 0) {
        entries = entries.slice(-filters.limit);
      }

      return [...entries];
    },

    /**
     * @returns {Promise<AuditStats>}
     */
    async stats() {
      const entries = loadCache();

      let blocked = 0;
      let modified = 0;
      let passedClean = 0;
      /** @type {Record<string, number>} */
      const byRule = {};

      for (const entry of entries) {
        if (entry.blocked) {
          blocked++;
        } else if (entry.modified) {
          modified++;
        } else {
          passedClean++;
        }

        for (const rule of entry.rules) {
          byRule[rule] = (byRule[rule] ?? 0) + 1;
        }
      }

      return {
        total: entries.length,
        blocked,
        modified,
        passedClean,
        byRule
      };
    },

    /**
     * Legacy API alias: record(event)
     * @param {{ action: "allow" | "redact" | "block", reasons?: string[], outputLength?: number, source?: string, metadata?: Record<string, unknown> }} event
     */
    async record(event) {
      const action = event?.action ?? "allow";
      const blocked = action === "block";
      const modified = action === "redact";
      const rules = Array.isArray(event?.reasons) ? event.reasons : [];

      await this.log({
        timestamp: new Date().toISOString(),
        project: event?.source ?? "nexus",
        blocked,
        modified,
        rules,
        inputTokens: 0,
        outputTokens: Number(event?.outputLength ?? 0),
        durationMs: 0
      });

      return {
        recordedAt: new Date().toISOString(),
        action,
        reasons: rules,
        outputLength: Number(event?.outputLength ?? 0),
        source: event?.source ?? "",
        metadata: event?.metadata ?? {}
      };
    },

    /**
     * Legacy API alias: list(filters)
     * @param {{ action?: string, limit?: number }} [filters]
     */
    async list(filters = {}) {
      const blockedFilter =
        filters.action === "block" ? true : filters.action === "allow" ? false : undefined;
      const entries = await this.query({
        ...(typeof blockedFilter === "boolean" ? { blocked: blockedFilter } : {}),
        limit: filters.limit
      });

      return entries.map((entry) => ({
        recordedAt: entry.timestamp,
        action: entry.blocked ? "block" : entry.modified ? "redact" : "allow",
        reasons: entry.rules,
        outputLength: entry.outputTokens ?? 0,
        source: entry.project,
        metadata: {}
      }));
    }
  };
}
