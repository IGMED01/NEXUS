import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import {
  createSecurityScanStats,
  isSensitivePathAllowlisted,
  redactSensitiveContent,
  resolveSecurityPolicy,
  shouldIgnoreSensitiveFile
} from "../security/secret-redaction.js";
import type { Chunk, ChunkKind, ScanStats } from "../types/core-contracts.d.ts";

interface WorkspaceFile {
  absolutePath: string;
  source: string;
}

export interface WorkspaceSecurityOptions {
  ignoreSensitiveFiles?: boolean;
  redactSensitiveContent?: boolean;
  ignoreGeneratedFiles?: boolean;
  allowSensitivePaths?: string[];
  extraSensitivePathFragments?: string[];
}

export interface WorkspaceScanOptions {
  ignoreDirs?: string[];
}

export interface LoadWorkspaceChunksOptions {
  security?: WorkspaceSecurityOptions;
  scan?: WorkspaceScanOptions;
}

interface ChunkSignals {
  certainty: number;
  recency: number;
  teachingValue: number;
  priority: number;
}

type SecurityPolicy = ReturnType<typeof resolveSecurityPolicy>;

const DEFAULT_IGNORED_DIRS = [
  ".git",
  ".codex",
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

function resolveIgnoredDirs(scan: WorkspaceScanOptions | undefined): Set<string> {
  const configured = Array.isArray(scan?.ignoreDirs)
    ? scan.ignoreDirs.map((entry) => entry.trim()).filter(Boolean)
    : [];

  return new Set([...DEFAULT_IGNORED_DIRS, ...configured]);
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function shouldIgnoreGeneratedFile(source: string): boolean {
  return toPosixPath(source).endsWith("README.LEARN.md");
}

function classifyKind(source: string): ChunkKind {
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

function defaultSignals(kind: ChunkKind): ChunkSignals {
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

function createScanStats(rootPath: string): ScanStats {
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

async function walk(
  rootPath: string,
  currentPath: string,
  files: WorkspaceFile[],
  stats: ScanStats,
  securityPolicy: SecurityPolicy,
  ignoredDirs: Set<string>
): Promise<void> {
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

export async function loadWorkspaceChunks(
  rootPath: string,
  options: LoadWorkspaceChunksOptions = {}
): Promise<{ path: string; payload: { chunks: Chunk[] }; stats: ScanStats }> {
  const resolvedRoot = resolve(rootPath);
  const files: WorkspaceFile[] = [];
  const stats = createScanStats(resolvedRoot);
  const securityPolicy = resolveSecurityPolicy(options.security);
  const ignoredDirs = resolveIgnoredDirs(options.scan);

  await walk(resolvedRoot, resolvedRoot, files, stats, securityPolicy, ignoredDirs);

  const chunks: Chunk[] = [];

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

    const chunk: Chunk = {
      id: file.source,
      source: file.source,
      kind,
      content,
      ...defaultSignals(kind)
    };

    chunks.push(chunk);
  }

  return {
    path: resolvedRoot,
    payload: {
      chunks
    },
    stats
  };
}
