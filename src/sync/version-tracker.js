// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{
 *   documentId: string,
 *   source: string,
 *   version: number,
 *   checksum: string,
 *   updatedAt: string,
 *   metadata: Record<string, unknown>
 * }} VersionEntry
 */

/**
 * @param {string} filePath
 */
async function readEntries(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");

    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * @param {string} filePath
 * @param {VersionEntry[]} entries
 */
async function writeEntries(filePath, entries) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, payload ? `${payload}\n` : "", "utf8");
}

/**
 * NEXUS:0 — track versions of ingested documents for delta sync.
 * @param {{ filePath?: string }} [options]
 */
export function createVersionTracker(options = {}) {
  const filePath = path.resolve(options.filePath ?? ".lcs/sync-version-tracker.jsonl");

  return {
    filePath,

    /**
     * @param {{ documentId: string, source: string, checksum: string, metadata?: Record<string, unknown> }} input
     */
    async recordVersion(input) {
      if (!input.documentId || !input.source || !input.checksum) {
        throw new Error("recordVersion requires documentId, source and checksum.");
      }

      const entries = /** @type {VersionEntry[]} */ (await readEntries(filePath));
      const existing = entries
        .filter((entry) => entry.documentId === input.documentId)
        .sort((left, right) => right.version - left.version)[0];
      const nextVersion = (existing?.version ?? 0) + 1;

      const entry = {
        documentId: input.documentId,
        source: input.source,
        version: nextVersion,
        checksum: input.checksum,
        updatedAt: new Date().toISOString(),
        metadata: input.metadata ?? {}
      };

      entries.push(entry);
      await writeEntries(filePath, entries);
      return entry;
    },

    /**
     * @param {string} documentId
     */
    async getLatest(documentId) {
      const entries = /** @type {VersionEntry[]} */ (await readEntries(filePath));
      return entries
        .filter((entry) => entry.documentId === documentId)
        .sort((left, right) => right.version - left.version)[0] ?? null;
    },

    /**
     * @param {{ source?: string, limit?: number }} [filters]
     */
    async list(filters = {}) {
      const entries = /** @type {VersionEntry[]} */ (await readEntries(filePath));
      let output = entries;

      if (filters.source) {
        output = output.filter((entry) => entry.source === filters.source);
      }

      output = output.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      if (typeof filters.limit === "number") {
        output = output.slice(0, Math.max(0, Math.trunc(filters.limit)));
      }

      return output;
    }
  };
}
