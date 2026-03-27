// @ts-check

import { getAdapter, listAdapters } from "../io/source-adapter.js";

// Import adapters to trigger auto-registration
import "../io/pdf-adapter.js";
import "../io/markdown-adapter.js";

/**
 * @typedef {{
 *   source: string,
 *   path: string,
 *   project?: string,
 *   maxContentChars?: number,
 *   dryRun?: boolean,
 *   security?: {
 *     redactSensitiveContent?: boolean,
 *     allowSensitivePaths?: string[]
 *   }
 * }} IngestOptions
 */

/**
 * @typedef {{
 *   source: string,
 *   inputPath: string,
 *   project: string,
 *   adapter: string,
 *   totalChunks: number,
 *   savedChunks: number,
 *   failedSaves: number,
 *   dryRun: boolean,
 *   stats: import("../types/core-contracts.d.ts").ScanStats,
 *   chunks: import("../types/core-contracts.d.ts").Chunk[],
 *   errors: string[]
 * }} IngestResult
 */

/**
 * @param {IngestOptions} options
 * @param {{
 *   save: (input: import("../types/core-contracts.d.ts").MemorySaveInput) => Promise<Record<string, unknown>>
 * }} memoryClient
 * @returns {Promise<IngestResult>}
 */
export async function runIngestCommand(options, memoryClient) {
  const { source, path: sourcePath, project = "" } = options;

  const adapter = getAdapter(source);

  if (!adapter) {
    const available = listAdapters();
    throw new Error(
      `Unknown source adapter: '${source}'. Available: ${available.length ? available.join(", ") : "none (import adapters first)"}`
    );
  }

  const readResult = await adapter.read(sourcePath, {
    project,
    maxContentChars: options.maxContentChars,
    security: options.security
  });

  /** @type {IngestResult} */
  const result = {
    source,
    inputPath: sourcePath,
    project,
    adapter: adapter.name,
    totalChunks: readResult.chunks.length,
    savedChunks: 0,
    failedSaves: 0,
    dryRun: options.dryRun ?? false,
    stats: readResult.stats,
    chunks: readResult.chunks,
    errors: []
  };

  if (options.dryRun) {
    return result;
  }

  for (const chunk of readResult.chunks) {
    try {
      await memoryClient.save({
        title: `[${adapter.name}] ${chunk.id}`,
        content: chunk.content,
        type: "ingested",
        project,
        scope: "project",
        topic: adapter.name
      });
      result.savedChunks += 1;
    } catch (error) {
      result.failedSaves += 1;
      result.errors.push(
        `Failed to save chunk ${chunk.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return result;
}

/**
 * @param {IngestResult} result
 * @returns {string}
 */
export function formatIngestResultAsText(result) {
  /** @type {string[]} */
  const lines = [];

  lines.push(`Ingest complete: ${result.adapter} adapter`);
  lines.push(`  Source: ${result.inputPath}`);
  lines.push(`  Project: ${result.project || "(default)"}`);
  lines.push(`  Files scanned: ${result.stats.discoveredFiles}`);
  lines.push(`  Files included: ${result.stats.includedFiles}`);
  lines.push(`  Chunks created: ${result.totalChunks}`);

  if (!result.dryRun) {
    lines.push(`  Chunks saved to memory: ${result.savedChunks}`);

    if (result.failedSaves > 0) {
      lines.push(`  Failed saves: ${result.failedSaves}`);
    }
  } else {
    lines.push("  (dry-run — no chunks saved)");
  }

  if (result.stats.redactionCount > 0) {
    lines.push(`  Redacted: ${result.stats.redactionCount} sensitive fragment(s)`);
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");

    for (const error of result.errors.slice(0, 10)) {
      lines.push(`  - ${error}`);
    }

    if (result.errors.length > 10) {
      lines.push(`  ... and ${result.errors.length - 10} more`);
    }
  }

  if (result.totalChunks > 0 && !result.dryRun) {
    lines.push("");
    lines.push(`Chunks are now available via: node src/cli.js recall --project ${result.project || "default"} --query "<your question>"`);
  }

  return lines.join("\n");
}
