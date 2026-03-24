// @ts-check

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  ".codex",
  ".lcs",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "test-output"
]);

/**
 * @param {string} value
 */
function toPosixPath(value) {
  return value.replace(/\\/gu, "/");
}

/**
 * @param {string} filePath
 */
async function readJson(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/u, ""));
  } catch {
    return {};
  }
}

/**
 * @param {string} filePath
 * @param {unknown} payload
 */
async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * @param {string} rootPath
 * @param {string} currentPath
 * @param {Set<string>} ignoreDirs
 * @param {Array<{ absolutePath: string, relativePath: string }>} files
 */
async function walk(rootPath, currentPath, ignoreDirs, files) {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        await walk(rootPath, path.resolve(currentPath, entry.name), ignoreDirs, files);
      }
      continue;
    }

    const absolutePath = path.resolve(currentPath, entry.name);
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));

    files.push({
      absolutePath,
      relativePath
    });
  }
}

/**
 * @param {string} absolutePath
 */
async function hashFile(absolutePath) {
  const raw = await readFile(absolutePath);
  return createHash("sha1").update(raw).digest("hex");
}

/**
 * NEXUS:0 — detect workspace file changes using hash + mtime snapshot.
 * @param {{ stateFilePath?: string, ignoreDirs?: string[] }} [options]
 */
export function createChangeDetector(options = {}) {
  const stateFilePath = path.resolve(options.stateFilePath ?? ".lcs/sync-change-detector.json");
  const ignoreDirs = new Set([
    ...DEFAULT_IGNORE_DIRS,
    ...(Array.isArray(options.ignoreDirs)
      ? options.ignoreDirs.map((entry) => String(entry).trim()).filter(Boolean)
      : [])
  ]);

  return {
    stateFilePath,

    /**
     * @param {string} rootPath
     */
    async detectChanges(rootPath) {
      const resolvedRoot = path.resolve(rootPath);
      const previous = /** @type {{ files?: Record<string, { hash: string, mtimeMs: number, size: number }> }} */ (
        await readJson(stateFilePath)
      );
      const previousFiles = previous.files ?? {};
      /** @type {Array<{ absolutePath: string, relativePath: string }>} */
      const discoveredFiles = [];

      await walk(resolvedRoot, resolvedRoot, ignoreDirs, discoveredFiles);

      /** @type {Record<string, { hash: string, mtimeMs: number, size: number }>} */
      const currentFiles = {};
      /** @type {string[]} */
      const changed = [];
      /** @type {string[]} */
      const created = [];
      /** @type {string[]} */
      const unchanged = [];

      for (const file of discoveredFiles) {
        const fileStat = await stat(file.absolutePath);
        const snapshot = {
          hash: await hashFile(file.absolutePath),
          mtimeMs: Number(fileStat.mtimeMs),
          size: Number(fileStat.size)
        };
        currentFiles[file.relativePath] = snapshot;

        const prev = previousFiles[file.relativePath];

        if (!prev) {
          created.push(file.relativePath);
          continue;
        }

        if (prev.hash !== snapshot.hash || prev.size !== snapshot.size) {
          changed.push(file.relativePath);
        } else {
          unchanged.push(file.relativePath);
        }
      }

      const deleted = Object.keys(previousFiles)
        .filter((relativePath) => !(relativePath in currentFiles))
        .sort((left, right) => left.localeCompare(right));

      await writeJson(stateFilePath, {
        generatedAt: new Date().toISOString(),
        rootPath: resolvedRoot,
        files: currentFiles
      });

      return {
        rootPath: resolvedRoot,
        stateFilePath,
        summary: {
          discovered: discoveredFiles.length,
          created: created.length,
          changed: changed.length,
          deleted: deleted.length,
          unchanged: unchanged.length
        },
        created: created.sort((left, right) => left.localeCompare(right)),
        changed: changed.sort((left, right) => left.localeCompare(right)),
        deleted,
        unchanged: unchanged.sort((left, right) => left.localeCompare(right))
      };
    }
  };
}
