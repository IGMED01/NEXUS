// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{
 *   id: string,
 *   source?: string,
 *   kind?: string,
 *   content: string,
 *   metadata?: Record<string, unknown>
 * }} StoredChunk
 */

/**
 * @typedef {{
 *   filePath?: string
 * }} ChunkRepositoryOptions
 */

/**
 * @param {ChunkRepositoryOptions} [options]
 */
export function createChunkRepository(options = {}) {
  const filePath = path.resolve(options.filePath ?? ".lcs/chunk-repository.jsonl");

  async function ensureFile() {
    await mkdir(path.dirname(filePath), { recursive: true });

    try {
      await readFile(filePath, "utf8");
    } catch {
      await writeFile(filePath, "", "utf8");
    }
  }

  /**
   * @returns {Promise<StoredChunk[]>}
   */
  async function readAll() {
    await ensureFile();
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  /**
   * @param {StoredChunk[]} chunks
   */
  async function writeAll(chunks) {
    await ensureFile();
    const serialized = chunks.map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(filePath, serialized ? `${serialized}\n` : "", "utf8");
  }

  return {
    filePath,
    /**
     * @param {StoredChunk} chunk
     */
    async upsertChunk(chunk) {
      if (!chunk?.id || !chunk?.content) {
        throw new Error("chunk id and content are required");
      }

      const current = await readAll();
      const index = current.findIndex((entry) => entry.id === chunk.id);
      const normalized = {
        id: chunk.id,
        source: chunk.source ?? chunk.id,
        kind: chunk.kind ?? "doc",
        content: chunk.content,
        metadata: chunk.metadata ?? {}
      };

      if (index >= 0) {
        current[index] = normalized;
      } else {
        current.push(normalized);
      }

      await writeAll(current);
      return normalized;
    },

    /**
     * @param {string[]} ids
     */
    async getChunksById(ids) {
      const current = await readAll();
      const wanted = new Set(ids);
      return current.filter((entry) => wanted.has(entry.id));
    },

    /**
     * @param {{ kind?: string, sourceIncludes?: string, limit?: number }} [filters]
     */
    async listChunks(filters = {}) {
      const current = await readAll();
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
  };
}
