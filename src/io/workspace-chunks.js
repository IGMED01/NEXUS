// @ts-check

import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

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

function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

function shouldIgnoreFile(source) {
  const normalized = toPosixPath(source);
  return normalized.endsWith("README.LEARN.md");
}

function classifyKind(source) {
  const normalized = toPosixPath(source);
  const extension = extname(normalized);

  if (normalized.includes("/logs/") || normalized.endsWith(".log")) {
    return "log";
  }

  if (normalized.includes("/chat/")) {
    return "chat";
  }

  if (normalized.startsWith("test/") || normalized.includes(".test.") || normalized.includes(".spec.")) {
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

async function walk(rootPath, currentPath, files) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(rootPath, resolve(currentPath, entry.name), files);
      }

      continue;
    }

    const extension = extname(entry.name);

    if (!ALLOWED_EXTENSIONS.has(extension) && !["README.md", "AGENTS.md", "agents.md", "package.json"].includes(entry.name)) {
      continue;
    }

    const absolutePath = resolve(currentPath, entry.name);
    const source = toPosixPath(relative(rootPath, absolutePath));

    if (shouldIgnoreFile(source)) {
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
  /** @type {{absolutePath: string, source: string}[]} */
  const files = [];

  await walk(resolvedRoot, resolvedRoot, files);

  const chunks = [];

  for (const file of files) {
    const raw = await readFile(file.absolutePath, "utf8");
    const content =
      raw.length > MAX_FILE_CHARS
        ? `${raw.slice(0, MAX_FILE_CHARS)}\n/* file truncated for context scan */`
        : raw;
    const kind = classifyKind(file.source);

    chunks.push({
      id: file.source,
      source: file.source,
      kind,
      content,
      ...defaultSignals(kind)
    });
  }

  return {
    path: resolvedRoot,
    payload: {
      chunks
    }
  };
}
