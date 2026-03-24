// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{
 *   action: "allow" | "redact" | "block",
 *   reasons: string[],
 *   outputLength: number,
 *   source?: string,
 *   metadata?: Record<string, unknown>
 * }} OutputAuditEvent
 */

/**
 * @typedef {{
 *   filePath?: string
 * }} OutputAuditorOptions
 */

/**
 * NEXUS:4 — audit trail for output-guard decisions.
 * @param {OutputAuditorOptions} [options]
 */
export function createOutputAuditor(options = {}) {
  const filePath = path.resolve(options.filePath ?? ".lcs/output-audit.jsonl");

  async function ensureFile() {
    await mkdir(path.dirname(filePath), { recursive: true });

    try {
      await readFile(filePath, "utf8");
    } catch {
      await writeFile(filePath, "", "utf8");
    }
  }

  return {
    filePath,

    /**
     * @param {OutputAuditEvent} event
     */
    async record(event) {
      await ensureFile();
      const entry = {
        recordedAt: new Date().toISOString(),
        action: event.action,
        reasons: Array.isArray(event.reasons) ? event.reasons : [],
        outputLength: Number(event.outputLength ?? 0),
        source: event.source ?? "",
        metadata: event.metadata ?? {}
      };
      await writeFile(filePath, `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        flag: "a"
      });
      return entry;
    },

    /**
     * @param {{ action?: string, limit?: number }} [filters]
     */
    async list(filters = {}) {
      await ensureFile();
      const raw = await readFile(filePath, "utf8");
      let entries = raw
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      if (filters.action) {
        entries = entries.filter((entry) => entry.action === filters.action);
      }

      if (typeof filters.limit === "number") {
        entries = entries.slice(-Math.max(0, filters.limit));
      }

      return entries;
    }
  };
}
