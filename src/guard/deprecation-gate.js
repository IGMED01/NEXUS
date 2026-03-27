// @ts-check

/**
 * Deprecation / Version Gate — NEXUS:4 GUARD
 *
 * Detects usage of:
 *   - Deprecated APIs (configured list per project)
 *   - Incompatible library versions (reads package.json + lockfile)
 *   - Forbidden packages (e.g., unmaintained libraries)
 *
 * Configuration: nexus-architecture.json → "deprecations" section:
 * {
 *   "deprecations": [
 *     { "pattern": "require('request')", "message": "Use 'node-fetch' or native fetch instead", "severity": "error" },
 *     { "pattern": "app.use(bodyParser)", "message": "Express 4.16+ has built-in JSON parsing", "severity": "warning" }
 *   ],
 *   "forbiddenPackages": ["request", "node-uuid", "lodash"],
 *   "requiredVersions": { "node": ">=18.0.0", "typescript": ">=5.0.0" }
 * }
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{
 *   file: string,
 *   line?: number,
 *   pattern: string,
 *   message: string,
 *   severity: "error" | "warning"
 * }} DeprecationViolation
 */

/**
 * @typedef {{
 *   passed: boolean,
 *   violations: DeprecationViolation[],
 *   forbiddenPackages: string[],
 *   versionWarnings: string[],
 *   checkedFiles: number,
 *   durationMs: number
 * }} DeprecationGateResult
 */

/**
 * @typedef {{
 *   pattern: string,
 *   message: string,
 *   severity?: "error" | "warning"
 * }} DeprecationRule
 */

const CONFIG_FILE = "nexus-architecture.json";

// ── Known deprecated patterns (built-in defaults) ────────────────────────────

const BUILTIN_DEPRECATIONS = /** @type {DeprecationRule[]} */ ([
  {
    pattern: "require('request')",
    message: "Package 'request' is deprecated. Use native fetch or 'node-fetch' instead.",
    severity: "error"
  },
  {
    pattern: 'require("request")',
    message: "Package 'request' is deprecated. Use native fetch or 'node-fetch' instead.",
    severity: "error"
  },
  {
    pattern: "new Buffer(",
    message: "new Buffer() is deprecated. Use Buffer.from() or Buffer.alloc() instead.",
    severity: "error"
  },
  {
    pattern: "process.binding(",
    message: "process.binding() is internal and deprecated. Use documented Node.js APIs.",
    severity: "warning"
  }
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @param {string} cwd
 * @returns {Promise<{ deprecations: DeprecationRule[], forbiddenPackages: string[], requiredVersions: Record<string, string> }>}
 */
async function loadDeprecationConfig(cwd) {
  try {
    const raw = await readFile(path.join(cwd, CONFIG_FILE), "utf8");
    const config = JSON.parse(raw);
    return {
      deprecations: Array.isArray(config.deprecations) ? config.deprecations : [],
      forbiddenPackages: Array.isArray(config.forbiddenPackages) ? config.forbiddenPackages : [],
      requiredVersions:
        config.requiredVersions && typeof config.requiredVersions === "object"
          ? config.requiredVersions
          : {}
    };
  } catch {
    return { deprecations: [], forbiddenPackages: [], requiredVersions: {} };
  }
}

/**
 * @param {string} cwd
 * @returns {Promise<Record<string, string>>}
 */
async function readInstalledVersions(cwd) {
  try {
    const raw = await readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    /** @type {Record<string, string>} */
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };

    // Strip semver range characters
    /** @type {Record<string, string>} */
    const clean = {};
    for (const [name, version] of Object.entries(deps)) {
      clean[name] = String(version).replace(/^[^0-9]*/, "");
    }

    return clean;
  } catch {
    return {};
  }
}

/**
 * Simple semver "at least" check.
 * @param {string} installed  "18.2.1"
 * @param {string} required   ">=18.0.0"
 * @returns {boolean}
 */
function satisfiesVersion(installed, required) {
  const match = required.match(/^([><=!]+)\s*(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return true; // Can't parse — skip
  }

  const [, op, major, minor, patch] = match;
  const reqParts = [parseInt(major, 10), parseInt(minor, 10), parseInt(patch, 10)];
  const instParts = installed.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const req = reqParts[i] ?? 0;
    const inst = instParts[i] ?? 0;
    if (op === ">=" || op === ">") {
      if (inst > req) return true;
      if (inst < req) return false;
    } else if (op === "<=") {
      if (inst < req) return true;
      if (inst > req) return false;
    }
  }

  return op === ">=" || op === "<=";
}

/**
 * Check a single file for deprecated patterns.
 *
 * @param {string} filePath
 * @param {string} content
 * @param {DeprecationRule[]} rules
 * @returns {DeprecationViolation[]}
 */
function checkFileDeprecations(filePath, content, rules) {
  /** @type {DeprecationViolation[]} */
  const violations = [];
  const lines = content.split("\n");

  for (const rule of rules) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(rule.pattern)) {
        violations.push({
          file: filePath.replace(/\\/g, "/"),
          line: i + 1,
          pattern: rule.pattern,
          message: rule.message,
          severity: rule.severity ?? "warning"
        });
      }
    }
  }

  return violations;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the deprecation gate against a set of files.
 *
 * @param {{
 *   files: Map<string, string>,
 *   cwd?: string,
 *   includeBuiltins?: boolean
 * }} opts
 * @returns {Promise<DeprecationGateResult>}
 */
export async function runDeprecationGate({ files, cwd = ".", includeBuiltins = true }) {
  const start = Date.now();
  const config = await loadDeprecationConfig(cwd);
  const installedVersions = await readInstalledVersions(cwd);

  const rules = [
    ...(includeBuiltins ? BUILTIN_DEPRECATIONS : []),
    ...config.deprecations
  ];

  /** @type {DeprecationViolation[]} */
  const violations = [];

  for (const [filePath, content] of files) {
    const fileViolations = checkFileDeprecations(filePath, content, rules);
    violations.push(...fileViolations);
  }

  // Check forbidden packages usage
  const forbiddenFound = /** @type {string[]} */ ([]);
  for (const pkg of config.forbiddenPackages) {
    if (pkg in installedVersions) {
      forbiddenFound.push(pkg);
    }
  }

  // Check version constraints
  const versionWarnings = /** @type {string[]} */ ([]);
  for (const [depName, constraint] of Object.entries(config.requiredVersions)) {
    const installed = installedVersions[depName];
    if (installed && !satisfiesVersion(installed, constraint)) {
      versionWarnings.push(
        `${depName}@${installed} does not satisfy required ${constraint}`
      );
    }
  }

  const hasErrors = violations.some((v) => v.severity === "error") || forbiddenFound.length > 0;

  return {
    passed: !hasErrors,
    violations,
    forbiddenPackages: forbiddenFound,
    versionWarnings,
    checkedFiles: files.size,
    durationMs: Date.now() - start
  };
}

/**
 * Format deprecation gate result for CLI/API output.
 *
 * @param {DeprecationGateResult} result
 * @returns {string}
 */
export function formatDeprecationResult(result) {
  if (result.passed && !result.versionWarnings.length) {
    return `Deprecation gate: PASS (${result.checkedFiles} files, ${result.durationMs}ms)`;
  }

  const lines = [
    `Deprecation gate: ${result.passed ? "WARN" : "FAIL"} (${result.violations.length} violations)`,
    ""
  ];

  for (const v of result.violations) {
    const loc = v.line ? `:${v.line}` : "";
    lines.push(`  [${v.severity.toUpperCase()}] ${v.file}${loc}`);
    lines.push(`    ${v.message}`);
  }

  if (result.forbiddenPackages.length) {
    lines.push("");
    lines.push("Forbidden packages installed:");
    for (const pkg of result.forbiddenPackages) {
      lines.push(`  - ${pkg}`);
    }
  }

  if (result.versionWarnings.length) {
    lines.push("");
    lines.push("Version warnings:");
    for (const w of result.versionWarnings) {
      lines.push(`  - ${w}`);
    }
  }

  return lines.join("\n");
}
