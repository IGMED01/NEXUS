// @ts-check

import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { defaultProjectConfig, parseProjectConfig } from "../contracts/config-contracts.js";

const DEFAULT_CONFIG_FILE = "learning-context.config.json";

/**
 * @param {string} filePath
 */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} startPath
 */
function parentDirectories(startPath) {
  const directories = [];
  let current = path.resolve(startPath);

  while (true) {
    directories.push(current);
    const parent = path.dirname(current);

    if (parent === current) {
      return directories;
    }

    current = parent;
  }
}

/**
 * @param {string[]} values
 */
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * @param {{ cwd?: string, explicitPath?: string, workspaceHint?: string }} [options]
 */
export async function loadProjectConfig(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());

  if (options.explicitPath) {
    const configPath = path.resolve(cwd, options.explicitPath);
    const raw = await readFile(configPath, "utf8");

    return {
      found: true,
      path: configPath,
      config: parseProjectConfig(raw, configPath)
    };
  }

  const searchRoots = unique([
    ...(options.workspaceHint ? parentDirectories(path.resolve(cwd, options.workspaceHint)) : []),
    ...parentDirectories(cwd)
  ]);

  for (const directory of searchRoots) {
    const candidate = path.join(directory, DEFAULT_CONFIG_FILE);

    if (await fileExists(candidate)) {
      const raw = await readFile(candidate, "utf8");

      return {
        found: true,
        path: candidate,
        config: parseProjectConfig(raw, candidate)
      };
    }
  }

  return {
    found: false,
    path: "",
    config: defaultProjectConfig()
  };
}
