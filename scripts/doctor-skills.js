import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import {
  scoreSkillSimilarity,
  parseSkillFrontmatterMetadata,
  toSkillSlug
} from "../src/skills/auto-generator.js";

/**
 * @param {string[]} argv
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function option(argv, key, fallback) {
  const index = argv.indexOf(`--${key}`);

  if (index === -1) {
    return fallback;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return fallback;
  }

  return value;
}

/**
 * @param {string[]} argv
 * @param {string} key
 * @returns {boolean}
 */
function hasFlag(argv, key) {
  return argv.includes(`--${key}`);
}

/**
 * @param {string[]} argv
 * @param {string} key
 * @returns {string[]}
 */
function options(argv, key) {
  /** @type {string[]} */
  const values = [];

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== `--${key}`) {
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }

    values.push(value);
  }

  return values;
}

/**
 * @param {string} value
 * @returns {string}
 */
function compact(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

/**
 * @param {string} value
 * @param {string} key
 * @param {{ min?: number, max?: number, integer?: boolean }} [rules]
 * @returns {number}
 */
function parseNumberOption(value, key, rules = {}) {
  const parsed = Number(value);

  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    throw new Error(`Option --${key} must be a valid number.`);
  }

  if (rules.integer && !Number.isInteger(parsed)) {
    throw new Error(`Option --${key} must be an integer.`);
  }

  if (rules.min !== undefined && parsed < rules.min) {
    throw new Error(`Option --${key} must be >= ${rules.min}.`);
  }

  if (rules.max !== undefined && parsed > rules.max) {
    throw new Error(`Option --${key} must be <= ${rules.max}.`);
  }

  return parsed;
}

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
async function readFileIfPresent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function displayPath(filePath) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolute);

  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }

  return absolute.replaceAll("\\", "/");
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniquePaths(values) {
  const seen = new Set();
  /** @type {string[]} */
  const output = [];

  for (const value of values) {
    const absolute = path.resolve(value).trim();
    if (!absolute || seen.has(absolute.toLowerCase())) {
      continue;
    }

    seen.add(absolute.toLowerCase());
    output.push(absolute);
  }

  return output;
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function inferSkillDescription(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/gu);
  const heading = lines.find((line) => line.trim().startsWith("# "));

  if (!heading) {
    return "";
  }

  return compact(heading.replace(/^#\s+/u, ""));
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function hashSkillContent(markdown) {
  return createHash("sha256")
    .update(String(markdown ?? "").replace(/\r\n/gu, "\n"), "utf8")
    .digest("hex");
}

/**
 * @param {string} rootDir
 * @param {number} maxDepth
 * @param {number} depth
 * @returns {Promise<string[]>}
 */
async function discoverSkillFiles(rootDir, maxDepth, depth = 0) {
  if (depth > maxDepth) {
    return [];
  }

  /** @type {import("node:fs").Dirent[]} */
  let entries = [];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw error;
  }

  /** @type {string[]} */
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await discoverSkillFiles(fullPath, maxDepth, depth + 1);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * @param {Array<{ rootDir: string, source: string }>} roots
 * @param {number} maxDepth
 * @returns {Promise<Array<{ name: string, description: string, source: string, filePath: string, contentHash: string }>>}
 */
async function loadInstalledSkillCatalog(roots, maxDepth) {
  /** @type {Array<{ name: string, description: string, source: string, filePath: string, contentHash: string }>} */
  const catalog = [];

  for (const root of roots) {
    const skillFiles = await discoverSkillFiles(root.rootDir, maxDepth);

    for (const skillFile of skillFiles) {
      const markdown = await readFileIfPresent(skillFile);

      if (!markdown) {
        continue;
      }

      const meta = parseSkillFrontmatterMetadata(markdown);
      const fallbackName = compact(path.basename(path.dirname(skillFile)));
      const name = compact(meta.name || fallbackName);
      const description = compact(meta.description || inferSkillDescription(markdown));

      if (!name) {
        continue;
      }

      catalog.push({
        name,
        description,
        source: root.source,
        filePath: displayPath(skillFile),
        contentHash: hashSkillContent(markdown)
      });
    }
  }

  const seen = new Set();
  return catalog.filter((entry) => {
    const key = `${entry.name.toLowerCase()}::${entry.filePath.toLowerCase()}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * @returns {string[]}
 */
function resolveDefaultSystemSkillDirs() {
  const codeHome = compact(process.env.CODEX_HOME ?? "");
  const home = compact(process.env.HOME ?? process.env.USERPROFILE ?? "");
  const appData = compact(process.env.APPDATA ?? "");
  const envDirs = compact(process.env.NEXUS_SKILLS_DIRS ?? process.env.CODEX_SKILLS_DIRS ?? "");
  const envList = envDirs ? envDirs.split(path.delimiter).map((item) => compact(item)) : [];
  const unixDefaults =
    process.platform === "win32" ? [] : ["/usr/local/share/codex/skills", "/etc/codex/skills"];

  const defaults = [
    ...(codeHome ? [path.join(codeHome, "skills")] : []),
    ...(home ? [path.join(home, ".codex", "skills")] : []),
    ...(appData ? [path.join(appData, "Codex", "skills")] : []),
    ...unixDefaults,
    ...envList
  ];

  return uniquePaths(defaults);
}

/**
 * @param {Array<{ name: string, description: string, source: string, filePath: string, contentHash: string }>} catalog
 * @returns {Array<{ key: string, skills: Array<{ name: string, source: string, filePath: string, contentHash: string }> }>}
 */
function buildExactDuplicateGroups(catalog) {
  /** @type {Map<string, Array<{ name: string, source: string, filePath: string, contentHash: string }>>} */
  const map = new Map();

  for (const entry of catalog) {
    const key = toSkillSlug(entry.name) || entry.name.toLowerCase();
    const current = map.get(key) ?? [];
    current.push({
      name: entry.name,
      source: entry.source,
      filePath: entry.filePath,
      contentHash: entry.contentHash
    });
    map.set(key, current);
  }

  return [...map.entries()]
    .filter(([, entries]) => entries.length > 1)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([key, skills]) => ({ key, skills }));
}

/**
 * @param {{ key: string, skills: Array<{ name: string, source: string, filePath: string, contentHash: string }> }} group
 * @returns {boolean}
 */
function isMirrorExactGroup(group) {
  const sources = new Set(group.skills.map((skill) => skill.source));
  const hashes = new Set(group.skills.map((skill) => skill.contentHash).filter(Boolean));

  return sources.size > 1 && hashes.size === 1;
}

/**
 * @param {{ key: string, skills: Array<{ name: string, source: string, filePath: string, contentHash: string }> }} group
 * @returns {{ key: string, skills: Array<{ name: string, source: string, filePath: string }> }}
 */
function sanitizeDuplicateGroup(group) {
  return {
    key: group.key,
    skills: group.skills.map((skill) => ({
      name: skill.name,
      source: skill.source,
      filePath: skill.filePath
    }))
  };
}

/**
 * @param {Array<{ name: string, description: string, source: string, filePath: string, contentHash: string }>} catalog
 * @param {number} threshold
 * @returns {Array<{
 *   score: number,
 *   left: { name: string, source: string, filePath: string },
 *   right: { name: string, source: string, filePath: string }
 * }>}
 */
function buildSimilarPairs(catalog, threshold) {
  /** @type {Array<{
 *   score: number,
 *   left: { name: string, source: string, filePath: string },
 *   right: { name: string, source: string, filePath: string }
 * }>} */
  const pairs = [];

  for (let leftIndex = 0; leftIndex < catalog.length; leftIndex += 1) {
    const left = catalog[leftIndex];
    const leftSlug = toSkillSlug(left.name);
    const leftNameLower = left.name.toLowerCase();

    for (let rightIndex = leftIndex + 1; rightIndex < catalog.length; rightIndex += 1) {
      const right = catalog[rightIndex];
      const rightSlug = toSkillSlug(right.name);
      const rightNameLower = right.name.toLowerCase();

      if ((leftSlug && rightSlug && leftSlug === rightSlug) || leftNameLower === rightNameLower) {
        continue;
      }

      const score = scoreSkillSimilarity(
        `${left.name} ${left.description}`,
        `${right.name} ${right.description}`
      );

      if (score < threshold) {
        continue;
      }

      pairs.push({
        score,
        left: {
          name: left.name,
          source: left.source,
          filePath: left.filePath
        },
        right: {
          name: right.name,
          source: right.source,
          filePath: right.filePath
        }
      });
    }
  }

  return pairs.sort((left, right) => right.score - left.score);
}

const argv = process.argv.slice(2);
const repoSkillsRoot = path.resolve(option(argv, "skills-dir", "skills"));
const noSystemScan = hasFlag(argv, "no-system-scan");
const cliSystemSkillDirs = options(argv, "system-skills-dir");
const envSystemSkillDirs = compact(option(argv, "system-skills-dirs", ""));
const splitEnvSystemSkillDirs = envSystemSkillDirs
  ? envSystemSkillDirs.split(path.delimiter).map((item) => compact(item))
  : [];
const defaultSystemSkillRoots = resolveDefaultSystemSkillDirs();
const explicitSystemSkillRoots = uniquePaths([...cliSystemSkillDirs, ...splitEnvSystemSkillDirs]);
const systemSkillRoots = uniquePaths([
  ...(!noSystemScan ? defaultSystemSkillRoots : []),
  ...explicitSystemSkillRoots
]);
const catalogDepth = parseNumberOption(option(argv, "catalog-depth", "5"), "catalog-depth", {
  integer: true,
  min: 1,
  max: 8
});
const similarityThreshold = parseNumberOption(
  option(argv, "similarity-threshold", "0.72"),
  "similarity-threshold",
  { min: 0, max: 1 }
);
const maxSimilarPairs = parseNumberOption(option(argv, "max-similar", "30"), "max-similar", {
  integer: true,
  min: 1,
  max: 200
});
const format = compact(option(argv, "format", hasFlag(argv, "json") ? "json" : "text")).toLowerCase();
const failOnConflicts = hasFlag(argv, "fail-on-conflicts") || hasFlag(argv, "strict");
const includeMirrorDuplicates = hasFlag(argv, "include-mirror-duplicates");

if (format !== "text" && format !== "json") {
  console.error("Option --format must be 'text' or 'json'.");
  process.exitCode = 1;
} else {
  const catalogRoots = [
    { rootDir: repoSkillsRoot, source: "repo" },
    ...systemSkillRoots.map((rootDir) => ({
      rootDir,
      source: "system"
    }))
  ];

  const catalog = await loadInstalledSkillCatalog(catalogRoots, catalogDepth);
  const exactDuplicateAll = buildExactDuplicateGroups(catalog);
  const exactDuplicateMirrorsResolved = includeMirrorDuplicates
    ? []
    : exactDuplicateAll.filter(isMirrorExactGroup);
  const exactDuplicateGroups = includeMirrorDuplicates
    ? exactDuplicateAll
    : exactDuplicateAll.filter((group) => !isMirrorExactGroup(group));
  const similarPairs = buildSimilarPairs(catalog, similarityThreshold);
  const hasConflicts = exactDuplicateGroups.length > 0 || similarPairs.length > 0;
  const status = hasConflicts ? "warn" : "ok";

  const payload = {
    command: "skills-doctor",
    status,
    scannedAt: new Date().toISOString(),
    config: {
      repoSkillsRoot: displayPath(repoSkillsRoot),
      defaultSystemScan: !noSystemScan,
      explicitSystemRoots: explicitSystemSkillRoots.map((entry) => displayPath(entry)),
      catalogDepth,
      similarityThreshold,
      maxSimilarPairs,
      failOnConflicts,
      includeMirrorDuplicates
    },
    catalog: {
      roots: catalogRoots.map((root) => ({
        source: root.source,
        path: displayPath(root.rootDir)
      })),
      totalSkills: catalog.length
    },
    exactDuplicateGroups: exactDuplicateGroups.map(sanitizeDuplicateGroup),
    exactDuplicateMirrorsResolved: exactDuplicateMirrorsResolved.map(sanitizeDuplicateGroup),
    similarPairs: similarPairs.slice(0, maxSimilarPairs)
  };

  if (format === "json") {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("NEXUS Skills Doctor");
    console.log(`- repo skills root: ${displayPath(repoSkillsRoot)}`);
    console.log(`- default system scan: ${noSystemScan ? "off" : "on"}`);
    console.log(`- explicit system roots: ${explicitSystemSkillRoots.length}`);
    console.log(`- catalog roots: ${catalogRoots.length}`);
    console.log(`- skills discovered: ${catalog.length}`);
    console.log(`- exact duplicate groups: ${exactDuplicateGroups.length}`);
    console.log(`- exact mirrors auto-resolved: ${exactDuplicateMirrorsResolved.length}`);
    console.log(`- similar pairs >= ${similarityThreshold}: ${similarPairs.length}`);
    console.log(`- status: ${status}`);

    if (exactDuplicateMirrorsResolved.length > 0) {
      console.log("");
      console.log("Exact mirrors auto-resolved:");
      for (const group of exactDuplicateMirrorsResolved.slice(0, 10)) {
        console.log(`- ${group.key} (${group.skills.length})`);
        for (const skill of group.skills) {
          console.log(`  - ${skill.name} [${skill.source}] ${skill.filePath}`);
        }
      }
    }

    if (exactDuplicateGroups.length > 0) {
      console.log("");
      console.log("Exact duplicate groups:");
      for (const group of exactDuplicateGroups.slice(0, 10)) {
        console.log(`- ${group.key} (${group.skills.length})`);
        for (const skill of group.skills) {
          console.log(`  - ${skill.name} [${skill.source}] ${skill.filePath}`);
        }
      }
    }

    if (similarPairs.length > 0) {
      console.log("");
      console.log("Similar pairs:");
      for (const pair of similarPairs.slice(0, maxSimilarPairs)) {
        const scoreLabel = `${Math.round(pair.score * 100)}%`;
        console.log(
          `- ${pair.left.name} [${pair.left.source}] <-> ${pair.right.name} [${pair.right.source}] (${scoreLabel})`
        );
      }
    }

    if (!hasConflicts) {
      console.log("");
      console.log("No duplicate/similarity conflicts detected.");
    }
  }

  if (hasConflicts && failOnConflicts) {
    process.exitCode = 2;
  }
}
