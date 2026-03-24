// @ts-check

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{
 *   id: string,
 *   promptKey: string,
 *   version: number,
 *   content: string,
 *   checksum: string,
 *   createdAt: string,
 *   metadata: Record<string, unknown>
 * }} PromptVersion
 */

/**
 * @param {string} text
 */
function checksum(text) {
  return createHash("sha256").update(text).digest("hex");
}

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
 * @param {PromptVersion[]} entries
 */
async function writeEntries(filePath, entries) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, payload ? `${payload}\n` : "", "utf8");
}

/**
 * NEXUS:9 — persist prompt versions for rollback and diff.
 * @param {{ filePath?: string }} [options]
 */
export function createPromptVersionStore(options = {}) {
  const filePath = path.resolve(options.filePath ?? ".lcs/prompt-versions.jsonl");

  return {
    filePath,

    /**
     * @param {{ promptKey: string, content: string, metadata?: Record<string, unknown> }} input
     */
    async saveVersion(input) {
      if (!input.promptKey.trim()) {
        throw new Error("promptKey is required.");
      }

      if (!input.content.trim()) {
        throw new Error("content is required.");
      }

      const entries = /** @type {PromptVersion[]} */ (await readEntries(filePath));
      const latest = entries
        .filter((entry) => entry.promptKey === input.promptKey)
        .sort((left, right) => right.version - left.version)[0];
      const version = (latest?.version ?? 0) + 1;
      const createdAt = new Date().toISOString();
      const id = `${input.promptKey}@v${version}`;

      const entry = {
        id,
        promptKey: input.promptKey,
        version,
        content: input.content,
        checksum: checksum(input.content),
        createdAt,
        metadata: input.metadata ?? {}
      };

      entries.push(entry);
      await writeEntries(filePath, entries);

      return entry;
    },

    /**
     * @param {string} promptKey
     */
    async listVersions(promptKey) {
      const entries = /** @type {PromptVersion[]} */ (await readEntries(filePath));
      return entries
        .filter((entry) => entry.promptKey === promptKey)
        .sort((left, right) => right.version - left.version);
    },

    /**
     * @param {string} id
     */
    async getVersion(id) {
      const entries = /** @type {PromptVersion[]} */ (await readEntries(filePath));
      return entries.find((entry) => entry.id === id) ?? null;
    },

    /**
     * @param {string} leftId
     * @param {string} rightId
     */
    async diffVersions(leftId, rightId) {
      const entries = /** @type {PromptVersion[]} */ (await readEntries(filePath));
      const left = entries.find((entry) => entry.id === leftId) ?? null;
      const right = entries.find((entry) => entry.id === rightId) ?? null;

      if (!left || !right) {
        throw new Error("Both prompt versions must exist to compute diff.");
      }

      const leftLines = left.content.split(/\r?\n/u);
      const rightLines = right.content.split(/\r?\n/u);
      const maxLines = Math.max(leftLines.length, rightLines.length);
      /** @type {Array<{ line: number, left: string, right: string }>} */
      const changes = [];

      for (let index = 0; index < maxLines; index += 1) {
        const leftLine = leftLines[index] ?? "";
        const rightLine = rightLines[index] ?? "";

        if (leftLine !== rightLine) {
          changes.push({
            line: index + 1,
            left: leftLine,
            right: rightLine
          });
        }
      }

      return {
        left,
        right,
        changedLines: changes.length,
        changes
      };
    }
  };
}
