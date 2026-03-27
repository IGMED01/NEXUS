/**
 * CLI ingest command.
 *
 * Reads documents from a source (pdf, markdown, filesystem) using SourceAdapters,
 * converts them to Chunk[], and saves each chunk to the MemoryProvider so they
 * are available via LCS recall/teach.
 *
 * Usage:
 *   node src/cli.js ingest --source pdf --path ./docs-legales --project salta
 *   node src/cli.js ingest --source markdown --path ./normativa --project salta
 */

import type { Chunk, ScanStats } from "../types/core-contracts.d.ts";
import type { MemorySaveInput } from "../types/core-contracts.d.ts";
import type { SourceAdapter, SourceAdapterReadResult } from "../io/source-adapter.js";
import { getAdapter, listAdapters } from "../io/source-adapter.js";

// Import adapters to trigger auto-registration
import "../io/pdf-adapter.js";
import "../io/markdown-adapter.js";

export interface IngestOptions {
  source: string;
  path: string;
  project?: string;
  maxContentChars?: number;
  dryRun?: boolean;
  security?: {
    redactSensitiveContent?: boolean;
    allowSensitivePaths?: string[];
  };
}

export interface IngestResult {
  source: string;
  inputPath: string;
  project: string;
  adapter: string;
  totalChunks: number;
  savedChunks: number;
  failedSaves: number;
  dryRun: boolean;
  stats: ScanStats;
  chunks: Chunk[];
  errors: string[];
}

interface MemoryClientLike {
  save: (input: MemorySaveInput) => Promise<Record<string, unknown>>;
}

export async function runIngestCommand(
  options: IngestOptions,
  memoryClient: MemoryClientLike
): Promise<IngestResult> {
  const { source, path: sourcePath, project = "" } = options;

  // Resolve adapter
  const adapter = getAdapter(source);

  if (!adapter) {
    const available = listAdapters();
    throw new Error(
      `Unknown source adapter: '${source}'. Available: ${available.length ? available.join(", ") : "none (import adapters first)"}`
    );
  }

  // Read chunks from source
  const readResult: SourceAdapterReadResult = await adapter.read(sourcePath, {
    project,
    maxContentChars: options.maxContentChars,
    security: options.security
  });

  const result: IngestResult = {
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

  // Save each chunk to memory
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

export function formatIngestResultAsText(result: IngestResult): string {
  const lines: string[] = [];

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
