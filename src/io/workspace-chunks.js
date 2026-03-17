// @ts-check

import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

/** @typedef {import("../types/core-contracts.d.ts").ChunkKind} ChunkKind */
/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */
/** @typedef {import("../types/core-contracts.d.ts").ScanStats} ScanStats */
/**
 * @typedef {{
 *   absolutePath: string,
 *   source: string
 * }} WorkspaceFile
 */

const IGNORED_DIRS = new Set([
  ".git",
  ".codex",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "test-output"
]);

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

const INLINE_SECRET_PATTERNS = [
  /(api[_-]?key\s*[:=]\s*["'`])([^"'`\r\n]+)(["'`])/giu,
  /(access[_-]?token\s*[:=]\s*["'`])([^"'`\r\n]+)(["'`])/giu,
  /(refresh[_-]?token\s*[:=]\s*["'`])([^"'`\r\n]+)(["'`])/giu,
  /(client[_-]?secret\s*[:=]\s*["'`])([^"'`\r\n]+)(["'`])/giu,
  /(password\s*[:=]\s*["'`])([^"'`\r\n]+)(["'`])/giu,
  /(secret\s*[:=]\s*["'`])([^"'`\r\n]+)(["'`])/giu
];

const TOKEN_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/gu,
  /github_pat_[A-Za-z0-9_]{20,}/gu,
  /sk-[A-Za-z0-9]{20,}/gu,
  /Bearer\s+[A-Za-z0-9._-]{10,}/gu
];

/**
 * @param {string} value
 */
function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

/**
 * @param {string} source
 */
function shouldIgnoreFile(source) {
  const normalized = toPosixPath(source);
  const lower = normalized.toLowerCase();

  return (
    normalized.endsWith("README.LEARN.md") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".pfx") ||
    lower.endsWith(".crt") ||
    lower.endsWith(".cer") ||
    lower.endsWith(".env") ||
    lower.includes("/.env") ||
    lower.endsWith("/id_rsa") ||
    lower.endsWith("/id_dsa")
  );
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
 * @param {string} content
 */
function redactPrivateBlocks(content) {
  let redactionCount = 0;
  const redacted = content.replace(
    /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gu,
    () => {
      redactionCount += 1;
      return "[REDACTED_PRIVATE_KEY_BLOCK]";
    }
  );

  return {
    content: redacted,
    redactionCount
  };
}

/**
 * @param {string} content
 */
function redactInlineSecrets(content) {
  let redactionCount = 0;
  let redacted = content;

  for (const pattern of INLINE_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (_match, prefix, _value, suffix) => {
      redactionCount += 1;
      return `${prefix}[REDACTED]${suffix}`;
    });
  }

  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      redactionCount += 1;

      if (match.startsWith("Bearer ")) {
        return "Bearer [REDACTED]";
      }

      return "[REDACTED_TOKEN]";
    });
  }

  return {
    content: redacted,
    redactionCount
  };
}

/**
 * @param {string} raw
 */
function redactSensitiveContent(raw) {
  const privateBlocks = redactPrivateBlocks(raw);
  const inlineSecrets = redactInlineSecrets(privateBlocks.content);
  const redactionCount = privateBlocks.redactionCount + inlineSecrets.redactionCount;

  if (!redactionCount) {
    return {
      content: raw,
      redactionCount: 0,
      redacted: false
    };
  }

  return {
    content: `${inlineSecrets.content}\n\n/* redacted secrets: ${redactionCount} */`,
    redactionCount,
    redacted: true
  };
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
 */
async function walk(rootPath, currentPath, files, stats) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(rootPath, resolve(currentPath, entry.name), files, stats);
      }

      continue;
    }

    stats.discoveredFiles += 1;
    const extension = extname(entry.name);

    if (
      !ALLOWED_EXTENSIONS.has(extension) &&
      !["README.md", "AGENTS.md", "agents.md", "package.json"].includes(entry.name)
    ) {
      stats.ignoredFiles += 1;
      continue;
    }

    const absolutePath = resolve(currentPath, entry.name);
    const source = toPosixPath(relative(rootPath, absolutePath));

    if (shouldIgnoreFile(source)) {
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
 */
export async function loadWorkspaceChunks(rootPath) {
  const resolvedRoot = resolve(rootPath);
  /** @type {WorkspaceFile[]} */
  const files = [];
  const stats = createScanStats(resolvedRoot);

  await walk(resolvedRoot, resolvedRoot, files, stats);

  /** @type {Chunk[]} */
  const chunks = [];

  for (const file of files) {
    const raw = await readFile(file.absolutePath, "utf8");
    const redaction = redactSensitiveContent(raw);
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
    }

    /** @type {Chunk} */
    const chunk = {
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
