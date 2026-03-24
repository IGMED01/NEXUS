// @ts-check

import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { chunkDocument } from "../processing/chunker.js";
import { extractEntities } from "../processing/entity-extractor.js";
import { tagChunkMetadata } from "../processing/metadata-tagger.js";

import {
  createSecurityScanStats,
  isSensitivePathAllowlisted,
  redactSensitiveContent,
  resolveSecurityPolicy,
  shouldIgnoreSensitiveFile
} from "../security/secret-redaction.js";

/** @typedef {import("../types/core-contracts.d.ts").ChunkKind} ChunkKind */
/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */
/** @typedef {import("../types/core-contracts.d.ts").ScanStats} ScanStats */
/**
 * @typedef {{
 *   absolutePath: string,
 *   source: string
 * }} WorkspaceFile
 */

/**
 * @typedef {{
 *   ignoreSensitiveFiles?: boolean,
 *   redactSensitiveContent?: boolean,
 *   ignoreGeneratedFiles?: boolean,
 *   allowSensitivePaths?: string[],
 *   extraSensitivePathFragments?: string[]
 * }} WorkspaceSecurityOptions
 */

/**
 * @typedef {{
 *   ignoreDirs?: string[]
 * }} WorkspaceScanOptions
 */

/**
 * @typedef {{
 *   chunkBySection?: boolean,
 *   maxCharsPerChunk?: number,
 *   extractEntities?: boolean
 * }} WorkspaceProcessingOptions
 */

/**
 * @typedef {{
 *   security?: WorkspaceSecurityOptions
 *   scan?: WorkspaceScanOptions
 *   processing?: WorkspaceProcessingOptions
 * }} LoadWorkspaceChunksOptions
 */

const DEFAULT_IGNORED_DIRS = [
  ".git",
  ".codex",
  ".lcs",
  ".tmp",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "test-output"
];

const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".go",
  ".py",
  ".json",
  ".log",
  ".md",
  ".txt",
  ".toml",
  ".yaml",
  ".yml"
]);

const MAX_FILE_CHARS = 32000;

/**
 * @param {WorkspaceScanOptions | undefined} scan
 */
function resolveIgnoredDirs(scan) {
  const configured = Array.isArray(scan?.ignoreDirs)
    ? scan.ignoreDirs.map((entry) => entry.trim()).filter(Boolean)
    : [];

  return new Set([...DEFAULT_IGNORED_DIRS, ...configured]);
}

/**
 * @param {string} value
 */
function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {string} source
 */
function shouldIgnoreGeneratedFile(source) {
  return toPosixPath(source).endsWith("README.LEARN.md");
}

/**
 * @param {string} source
 * @returns {ChunkKind}
 */
function classifyKind(source) {
  const normalized = toPosixPath(source);
  const extension = extname(normalized);

  if (normalized.includes("/logs/") || normalized.endsWith(".log")) {
    return "log";
  }

  if (normalized.includes("/chat/")) {
    return "chat";
  }

  if (
    normalized.startsWith("test/") ||
    normalized.includes(".test.") ||
    normalized.includes(".spec.")
  ) {
    return "test";
  }

  if (
    normalized.startsWith("docs/") ||
    normalized === "README.md" ||
    normalized === "AGENTS.md" ||
    normalized === "agents.md" ||
    normalized === "package.json"
  ) {
    return "spec";
  }

  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".go", ".py"].includes(extension)) {
    return "code";
  }

  return "doc";
}

/**
 * @param {ChunkKind} kind
 */
function defaultSignals(kind) {
  switch (kind) {
    case "code":
      return { certainty: 0.92, recency: 0.75, teachingValue: 0.72, priority: 0.86 };
    case "test":
      return { certainty: 0.93, recency: 0.74, teachingValue: 0.8, priority: 0.84 };
    case "spec":
      return { certainty: 0.88, recency: 0.7, teachingValue: 0.82, priority: 0.78 };
    case "log":
      return { certainty: 0.35, recency: 0.6, teachingValue: 0.1, priority: 0.15 };
    case "chat":
      return { certainty: 0.45, recency: 0.5, teachingValue: 0.25, priority: 0.2 };
    default:
      return { certainty: 0.7, recency: 0.65, teachingValue: 0.6, priority: 0.55 };
  }
}

/**
 * @param {string} rootPath
 * @returns {ScanStats}
 */
function createScanStats(rootPath) {
  return {
    rootPath,
    discoveredFiles: 0,
    includedFiles: 0,
    ignoredFiles: 0,
    truncatedFiles: 0,
    redactedFiles: 0,
    redactionCount: 0,
    security: createSecurityScanStats(),
    kinds: {
      code: 0,
      test: 0,
      spec: 0,
      memory: 0,
      doc: 0,
      chat: 0,
      log: 0
    }
  };
}

/**
 * @param {string} rootPath
 * @param {string} currentPath
 * @param {WorkspaceFile[]} files
 * @param {ScanStats} stats
 * @param {ReturnType<typeof resolveSecurityPolicy>} securityPolicy
 * @param {Set<string>} ignoredDirs
 */
async function walk(rootPath, currentPath, files, stats, securityPolicy, ignoredDirs) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        await walk(
          rootPath,
          resolve(currentPath, entry.name),
          files,
          stats,
          securityPolicy,
          ignoredDirs
        );
      }

      continue;
    }

    stats.discoveredFiles += 1;
    const absolutePath = resolve(currentPath, entry.name);
    const source = toPosixPath(relative(rootPath, absolutePath));
    const extension = extname(entry.name);
    const allowlistedSensitivePath = isSensitivePathAllowlisted(source, securityPolicy);

    if (securityPolicy.ignoreGeneratedFiles && shouldIgnoreGeneratedFile(source)) {
      stats.ignoredFiles += 1;
      continue;
    }

    if (!allowlistedSensitivePath && shouldIgnoreSensitiveFile(source, securityPolicy)) {
      stats.ignoredFiles += 1;
      stats.security.ignoredSensitiveFiles += 1;
      continue;
    }

    if (
      !allowlistedSensitivePath &&
      !ALLOWED_EXTENSIONS.has(extension) &&
      !["README.md", "AGENTS.md", "agents.md", "package.json"].includes(entry.name)
    ) {
      stats.ignoredFiles += 1;
      continue;
    }

    files.push({
      absolutePath,
      source
    });
  }
}

/**
 * @param {string} rootPath
 * @param {LoadWorkspaceChunksOptions} [options]
 */
export async function loadWorkspaceChunks(rootPath, options = {}) {
  const resolvedRoot = resolve(rootPath);
  /** @type {WorkspaceFile[]} */
  const files = [];
  const stats = createScanStats(resolvedRoot);
  const securityPolicy = resolveSecurityPolicy(options.security);
  const ignoredDirs = resolveIgnoredDirs(options.scan);

  await walk(resolvedRoot, resolvedRoot, files, stats, securityPolicy, ignoredDirs);

  /** @type {Chunk[]} */
  const chunks = [];

  for (const file of files) {
    const raw = await readFile(file.absolutePath, "utf8");
    const redaction = redactSensitiveContent(raw, securityPolicy);
    const wasTruncated = redaction.content.length > MAX_FILE_CHARS;
    const content = wasTruncated
      ? `${redaction.content.slice(0, MAX_FILE_CHARS)}\n/* file truncated for context scan */`
      : redaction.content;
    const kind = classifyKind(file.source);

    stats.includedFiles += 1;
    stats.kinds[kind] += 1;

    if (wasTruncated) {
      stats.truncatedFiles += 1;
    }

    if (redaction.redacted) {
      stats.redactedFiles += 1;
      stats.redactionCount += redaction.redactionCount;
      stats.security.privateBlocks += redaction.breakdown.privateBlocks;
      stats.security.inlineSecrets += redaction.breakdown.inlineSecrets;
      stats.security.tokenPatterns += redaction.breakdown.tokenPatterns;
      stats.security.jwtLike += redaction.breakdown.jwtLike;
      stats.security.connectionStrings += redaction.breakdown.connectionStrings;
    }

    const processingEnabled = options.processing?.chunkBySection !== false;
    const processedChunks = processingEnabled
      ? chunkDocument(content, {
          source: file.source,
          maxCharsPerChunk: Math.max(500, Number(options.processing?.maxCharsPerChunk ?? 1800))
        })
      : [
          {
            id: file.source,
            content,
            metadata: {
              source: file.source,
              sectionTitle: "document",
              sectionLevel: 1,
              startLine: 0,
              endLine: 0,
              index: 0
            }
          }
        ];

    for (const processed of processedChunks) {
      const tags = tagChunkMetadata({
        source: file.source,
        kind,
        content: processed.content
      });
      const entities = options.processing?.extractEntities === false ? [] : extractEntities(processed.content);
      /** @type {Chunk} */
      const chunk = {
        id: processed.id || file.source,
        source: file.source,
        kind,
        content: processed.content,
        ...defaultSignals(kind)
      };

      // non-contract metadata for downstream adapters (NEXUS:1)
      /** @type {Record<string, unknown>} */ (chunk).processing = {
        section: processed.metadata,
        tags,
        entities
      };

      chunks.push(chunk);
    }
  }

  return {
    path: resolvedRoot,
    payload: {
      chunks
    },
    stats
  };
}
