// @ts-check

/**
 * Code Gate v1 — NEXUS:4 GUARD
 *
 * Validates generated code by running available toolchain checks:
 *   lint      → eslint / biome (if config exists)
 *   typecheck → tsc --noEmit (if tsconfig.json exists)
 *   build     → npm run build (if build script exists)
 *   test      → npm test (if test script exists, subset only)
 *
 * Returns a structured CodeGateResult with:
 *   - status: "pass" | "fail" | "skipped" | "degraded"
 *   - per-tool results with parsed errors
 *   - total error/warning counts
 *   - duration
 *
 * Used by the repair loop (Sprint 4) to decide whether to re-attempt codegen.
 */

import { execFile as execFileCallback } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/** @typedef {import("../types/core-contracts.d.ts").CodeGateStatus} CodeGateStatus */
/** @typedef {import("../types/core-contracts.d.ts").CodeGateError} CodeGateError */
/** @typedef {import("../types/core-contracts.d.ts").CodeGateToolResult} CodeGateToolResult */
/** @typedef {import("../types/core-contracts.d.ts").CodeGateResult} CodeGateResult */

const GATE_TIMEOUT_MS = 60000;

// ── File existence helpers ────────────────────────────────────────────────────

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
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
 * @param {string} cwd
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readPackageJson(cwd) {
  try {
    const raw = await readFile(path.join(cwd, "package.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Error parsers ────────────────────────────────────────────────────────────

/**
 * Parse tsc output into structured errors.
 * Format: "path/to/file.ts(line,col): error TS1234: message"
 *
 * @param {string} output
 * @param {"typecheck"} tool
 * @returns {CodeGateError[]}
 */
function parseTscErrors(output, tool = "typecheck") {
  /** @type {CodeGateError[]} */
  const errors = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/);
    if (match) {
      errors.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4] === "error" ? "error" : "warning",
        code: `TS${match[5]}`,
        message: match[6].trim(),
        tool
      });
    }
  }

  return errors;
}

/**
 * Parse ESLint JSON output into structured errors.
 *
 * @param {string} output
 * @returns {CodeGateError[]}
 */
function parseEslintErrors(output) {
  /** @type {CodeGateError[]} */
  const errors = [];

  try {
    const results = JSON.parse(output);
    if (!Array.isArray(results)) {
      return errors;
    }

    for (const result of results) {
      const filePath = String(result.filePath ?? "");
      for (const msg of result.messages ?? []) {
        errors.push({
          file: filePath,
          line: msg.line,
          column: msg.column,
          code: msg.ruleId ?? undefined,
          message: String(msg.message ?? ""),
          severity: msg.severity === 2 ? "error" : "warning",
          tool: "lint"
        });
      }
    }
  } catch {
    // Not JSON — try line-by-line parsing
    for (const line of output.split("\n")) {
      const match = line.match(/^(.+?):\s+line\s+(\d+),\s+col\s+(\d+),\s+(Error|Warning)\s+-\s+(.+?)(?:\s+\((.+?)\))?$/i);
      if (match) {
        errors.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          severity: match[4].toLowerCase() === "error" ? "error" : "warning",
          message: match[5].trim(),
          code: match[6]?.trim(),
          tool: "lint"
        });
      }
    }
  }

  return errors;
}

/**
 * Parse generic build errors (npm run build output).
 *
 * @param {string} output
 * @returns {CodeGateError[]}
 */
function parseBuildErrors(output) {
  /** @type {CodeGateError[]} */
  const errors = [];

  for (const line of output.split("\n")) {
    // tsc-style errors in build output
    const tscMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/);
    if (tscMatch) {
      errors.push({
        file: tscMatch[1].trim(),
        line: parseInt(tscMatch[2], 10),
        column: parseInt(tscMatch[3], 10),
        severity: tscMatch[4] === "error" ? "error" : "warning",
        code: `TS${tscMatch[5]}`,
        message: tscMatch[6].trim(),
        tool: "build"
      });
      continue;
    }

    // "error:" prefix
    const errMatch = line.match(/^\s*error:\s+(.+)$/i);
    if (errMatch) {
      errors.push({
        message: errMatch[1].trim(),
        severity: "error",
        tool: "build"
      });
    }
  }

  return errors;
}

/**
 * Parse npm test output into structured errors.
 *
 * @param {string} output
 * @returns {CodeGateError[]}
 */
function parseTestErrors(output) {
  /** @type {CodeGateError[]} */
  const errors = [];

  for (const line of output.split("\n")) {
    // Node.js test runner "not ok" TAP format
    const tapMatch = line.match(/^not ok\s+\d+\s+-\s+(.+)$/);
    if (tapMatch) {
      errors.push({
        message: tapMatch[1].trim(),
        severity: "error",
        tool: "test"
      });
      continue;
    }

    // "Error:" lines
    if (/^\s*(Error:|AssertionError:)/i.test(line)) {
      errors.push({
        message: line.trim(),
        severity: "error",
        tool: "test"
      });
    }
  }

  return errors;
}

// ── Gate runners ─────────────────────────────────────────────────────────────

/**
 * @param {string} cwd
 * @param {Record<string, unknown>} pkg
 * @returns {Promise<CodeGateToolResult>}
 */
async function runTypecheck(cwd, pkg) {
  const start = Date.now();
  const tsconfigExists = await fileExists(path.join(cwd, "tsconfig.json"));

  if (!tsconfigExists) {
    return {
      tool: "typecheck",
      status: "skipped",
      errors: [],
      durationMs: 0,
      raw: "No tsconfig.json found"
    };
  }

  try {
    const { stdout, stderr } = await execFile(
      "npx",
      ["tsc", "--noEmit", "--pretty", "false"],
      { cwd, timeout: GATE_TIMEOUT_MS, shell: false }
    );

    const combined = [String(stdout ?? ""), String(stderr ?? "")].join("\n");
    const errors = parseTscErrors(combined);
    const hasErrors = errors.some((e) => e.severity === "error");

    return {
      tool: "typecheck",
      status: hasErrors ? "fail" : "pass",
      errors,
      durationMs: Date.now() - start,
      raw: combined.trim()
    };
  } catch (/** @type {any} */ error) {
    const raw = [String(error?.stdout ?? ""), String(error?.stderr ?? "")].join("\n");
    const errors = parseTscErrors(raw);

    return {
      tool: "typecheck",
      status: errors.length ? "fail" : "degraded",
      errors,
      durationMs: Date.now() - start,
      raw: raw.trim()
    };
  }
}

/**
 * @param {string} cwd
 * @param {Record<string, unknown>} pkg
 * @returns {Promise<CodeGateToolResult>}
 */
async function runLint(cwd, pkg) {
  const start = Date.now();
  const scripts = /** @type {Record<string, string>} */ (pkg.scripts ?? {});
  const hasLintScript = "lint" in scripts;
  const eslintConfigExists =
    (await fileExists(path.join(cwd, ".eslintrc.js"))) ||
    (await fileExists(path.join(cwd, ".eslintrc.json"))) ||
    (await fileExists(path.join(cwd, "eslint.config.js"))) ||
    (await fileExists(path.join(cwd, ".eslintrc.cjs")));

  if (!hasLintScript && !eslintConfigExists) {
    return {
      tool: "lint",
      status: "skipped",
      errors: [],
      durationMs: 0,
      raw: "No lint script or ESLint config found"
    };
  }

  try {
    const args = hasLintScript ? ["run", "lint"] : ["eslint", "--format", "json", "."];
    const { stdout, stderr } = await execFile("npm", args, {
      cwd,
      timeout: GATE_TIMEOUT_MS,
      shell: false
    });

    const combined = String(stdout ?? "");
    const errors = parseEslintErrors(combined);
    const hasErrors = errors.some((e) => e.severity === "error");

    return {
      tool: "lint",
      status: hasErrors ? "fail" : "pass",
      errors,
      durationMs: Date.now() - start,
      raw: combined.trim()
    };
  } catch (/** @type {any} */ error) {
    const raw = [String(error?.stdout ?? ""), String(error?.stderr ?? "")].join("\n");
    const errors = parseEslintErrors(raw);

    return {
      tool: "lint",
      status: errors.length ? "fail" : "degraded",
      errors,
      durationMs: Date.now() - start,
      raw: raw.trim()
    };
  }
}

/**
 * @param {string} cwd
 * @param {Record<string, unknown>} pkg
 * @returns {Promise<CodeGateToolResult>}
 */
async function runBuild(cwd, pkg) {
  const start = Date.now();
  const scripts = /** @type {Record<string, string>} */ (pkg.scripts ?? {});

  if (!scripts.build) {
    return {
      tool: "build",
      status: "skipped",
      errors: [],
      durationMs: 0,
      raw: "No build script in package.json"
    };
  }

  try {
    const { stdout, stderr } = await execFile("npm", ["run", "build"], {
      cwd,
      timeout: GATE_TIMEOUT_MS * 2,
      shell: false
    });

    const combined = [String(stdout ?? ""), String(stderr ?? "")].join("\n");
    const errors = parseBuildErrors(combined);
    const hasErrors = errors.some((e) => e.severity === "error");

    return {
      tool: "build",
      status: hasErrors ? "fail" : "pass",
      errors,
      durationMs: Date.now() - start,
      raw: combined.trim()
    };
  } catch (/** @type {any} */ error) {
    const raw = [String(error?.stdout ?? ""), String(error?.stderr ?? "")].join("\n");
    const errors = parseBuildErrors(raw);

    return {
      tool: "build",
      status: errors.length ? "fail" : "degraded",
      errors,
      durationMs: Date.now() - start,
      raw: raw.trim()
    };
  }
}

/**
 * @param {string} cwd
 * @param {Record<string, unknown>} pkg
 * @returns {Promise<CodeGateToolResult>}
 */
async function runTests(cwd, pkg) {
  const start = Date.now();
  const scripts = /** @type {Record<string, string>} */ (pkg.scripts ?? {});

  if (!scripts.test) {
    return {
      tool: "test",
      status: "skipped",
      errors: [],
      durationMs: 0,
      raw: "No test script in package.json"
    };
  }

  try {
    const { stdout, stderr } = await execFile("npm", ["test"], {
      cwd,
      timeout: GATE_TIMEOUT_MS * 3,
      shell: false,
      env: { ...process.env, NODE_ENV: "test" }
    });

    const combined = [String(stdout ?? ""), String(stderr ?? "")].join("\n");
    const errors = parseTestErrors(combined);
    const hasErrors = errors.some((e) => e.severity === "error");

    return {
      tool: "test",
      status: hasErrors ? "fail" : "pass",
      errors,
      durationMs: Date.now() - start,
      raw: combined.trim()
    };
  } catch (/** @type {any} */ error) {
    const raw = [String(error?.stdout ?? ""), String(error?.stderr ?? "")].join("\n");
    const errors = parseTestErrors(raw);

    return {
      tool: "test",
      status: errors.length ? "fail" : "degraded",
      errors,
      durationMs: Date.now() - start,
      raw: raw.trim()
    };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the Code Gate for a given workspace.
 *
 * @param {{
 *   cwd?: string,
 *   tools?: Array<"lint" | "typecheck" | "build" | "test">,
 *   skipOnMissing?: boolean
 * }} [opts]
 * @returns {Promise<CodeGateResult>}
 */
export async function runCodeGate(opts = {}) {
  const start = Date.now();
  const cwd = opts.cwd ?? process.cwd();
  const tools = opts.tools ?? ["typecheck", "lint", "build"];

  const pkg = (await readPackageJson(cwd)) ?? {};

  /** @type {CodeGateToolResult[]} */
  const results = [];

  for (const tool of tools) {
    if (tool === "typecheck") {
      results.push(await runTypecheck(cwd, pkg));
    } else if (tool === "lint") {
      results.push(await runLint(cwd, pkg));
    } else if (tool === "build") {
      results.push(await runBuild(cwd, pkg));
    } else if (tool === "test") {
      results.push(await runTests(cwd, pkg));
    }
  }

  const errorCount = results.flatMap((r) => r.errors).filter((e) => e.severity === "error").length;
  const warningCount = results.flatMap((r) => r.errors).filter((e) => e.severity === "warning").length;
  const hasFail = results.some((r) => r.status === "fail");
  const allSkipped = results.every((r) => r.status === "skipped");
  const hasDegraded = results.some((r) => r.status === "degraded");

  /** @type {CodeGateStatus} */
  const status = hasFail
    ? "fail"
    : allSkipped
      ? "skipped"
      : hasDegraded
        ? "degraded"
        : "pass";

  return {
    status,
    tools: results,
    errorCount,
    warningCount,
    durationMs: Date.now() - start,
    passed: status === "pass" || status === "skipped"
  };
}

/**
 * Get only failing errors from a gate result, suitable for the repair loop.
 *
 * @param {CodeGateResult} result
 * @returns {CodeGateError[]}
 */
export function getGateErrors(result) {
  return result.tools.flatMap((tool) => tool.errors).filter((e) => e.severity === "error");
}

/**
 * Format gate errors as a compact string for LLM repair prompts.
 *
 * @param {CodeGateError[]} errors
 * @param {number} [maxErrors]
 * @returns {string}
 */
export function formatGateErrors(errors, maxErrors = 10) {
  const slice = errors.slice(0, maxErrors);
  const lines = slice.map((e) => {
    const location = e.file
      ? `${e.file}${e.line ? `:${e.line}` : ""}${e.column ? `:${e.column}` : ""}`
      : "";
    const code = e.code ? ` [${e.code}]` : "";
    return `${e.tool.toUpperCase()}${code} ${location ? `(${location})` : ""}: ${e.message}`;
  });

  if (errors.length > maxErrors) {
    lines.push(`... and ${errors.length - maxErrors} more errors`);
  }

  return lines.join("\n");
}
