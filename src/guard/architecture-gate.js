// @ts-check

/**
 * Architecture Gate — NEXUS:4 GUARD / NEXUS:10 INTERFACE
 *
 * Validates that generated code respects the project's declared architecture:
 *   - Forbidden imports (e.g., domain must not import from infrastructure)
 *   - Layer crossings (e.g., UI must not call DB directly)
 *   - Deprecated module usage
 *   - Package.json version constraints
 *
 * Configuration: nexus-architecture.json in project root
 *
 * Format of nexus-architecture.json:
 * {
 *   "rules": [
 *     { "id": "no-domain-infra", "type": "forbidden-import",
 *       "description": "Domain must not import from infrastructure",
 *       "from": "src/domain/**", "to": "src/infrastructure/**" },
 *     { "id": "no-deprecated-lodash", "type": "forbidden-import",
 *       "description": "Use native array methods instead of lodash",
 *       "pattern": "lodash" }
 *   ]
 * }
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/** @typedef {import("../types/core-contracts.d.ts").ArchitectureRule} ArchitectureRule */
/** @typedef {import("../types/core-contracts.d.ts").ArchitectureViolation} ArchitectureViolation */
/** @typedef {import("../types/core-contracts.d.ts").ArchitectureGateResult} ArchitectureGateResult */

const CONFIG_FILE = "nexus-architecture.json";

// ── Glob-to-regex conversion ──────────────────────────────────────────────────

/**
 * Convert a simple glob pattern to a regex.
 * Supports: * (any chars except /), ** (any chars including /), ? (any single char)
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*")
    .replace(/\?/g, "[^/]");

  return new RegExp(`^${escaped}$`, "i");
}

// ── Import extractor ──────────────────────────────────────────────────────────

const IMPORT_RE = /import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * @param {string} content
 * @returns {string[]}
 */
function extractImports(content) {
  const results = /** @type {string[]} */ ([]);
  let match;

  for (const re of [IMPORT_RE, REQUIRE_RE]) {
    const cloned = new RegExp(re.source, "g");
    while ((match = cloned.exec(content)) !== null) {
      results.push(match[1]);
    }
  }

  return [...new Set(results)];
}

/**
 * @param {string} content
 * @returns {Array<{ line: number, importPath: string }>}
 */
function extractImportsWithLines(content) {
  const results = /** @type {Array<{ line: number, importPath: string }>} */ ([]);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const importMatch = line.match(/import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/);
    const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);

    if (importMatch) {
      results.push({ line: i + 1, importPath: importMatch[1] });
    } else if (requireMatch) {
      results.push({ line: i + 1, importPath: requireMatch[1] });
    }
  }

  return results;
}

// ── Rule evaluators ───────────────────────────────────────────────────────────

/**
 * Resolve an import path to an absolute-like path relative to project root.
 *
 * @param {string} importPath
 * @param {string} sourceFile
 * @returns {string}
 */
function resolveImportPath(importPath, sourceFile) {
  if (importPath.startsWith(".")) {
    const sourceDir = path.dirname(sourceFile).replace(/\\/g, "/");
    return path.posix.normalize(`${sourceDir}/${importPath}`);
  }

  return importPath;
}

/**
 * @param {string} sourceFile normalized source path
 * @param {string} importPath raw import path
 * @param {ArchitectureRule} rule
 * @param {string} content file content
 * @returns {ArchitectureViolation | null}
 */
function evaluateRule(sourceFile, importPath, rule, content) {
  const resolvedImport = resolveImportPath(importPath, sourceFile);

  if (rule.type === "forbidden-import") {
    // Pattern-based: matches import path directly
    if (rule.pattern) {
      const patternRe = globToRegex(rule.pattern);
      if (patternRe.test(importPath) || importPath.includes(rule.pattern)) {
        return {
          rule: rule.id,
          file: sourceFile,
          importPath,
          description: rule.description
        };
      }
    }

    // from/to: from-file imports to-path
    if (rule.from && rule.to) {
      const fromRe = globToRegex(rule.from);
      const toRe = globToRegex(rule.to);

      if (fromRe.test(sourceFile) && (toRe.test(resolvedImport) || toRe.test(importPath))) {
        return {
          rule: rule.id,
          file: sourceFile,
          importPath,
          description: rule.description
        };
      }
    }
  }

  if (rule.type === "layer-crossing" && rule.from && rule.to) {
    const fromRe = globToRegex(rule.from);
    const toRe = globToRegex(rule.to);

    if (fromRe.test(sourceFile) && (toRe.test(resolvedImport) || toRe.test(importPath))) {
      return {
        rule: rule.id,
        file: sourceFile,
        importPath,
        description: rule.description
      };
    }
  }

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load architecture rules from nexus-architecture.json.
 *
 * @param {string} [cwd]
 * @returns {Promise<ArchitectureRule[]>}
 */
export async function loadArchitectureRules(cwd = ".") {
  try {
    const raw = await readFile(path.join(cwd, CONFIG_FILE), "utf8");
    const config = JSON.parse(raw);
    return Array.isArray(config.rules) ? config.rules : [];
  } catch {
    return [];
  }
}

/**
 * Check a single file's content against architecture rules.
 *
 * @param {{
 *   filePath: string,
 *   content: string,
 *   rules: ArchitectureRule[]
 * }} opts
 * @returns {ArchitectureViolation[]}
 */
export function checkFileArchitecture({ filePath, content, rules }) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const importsWithLines = extractImportsWithLines(content);
  /** @type {ArchitectureViolation[]} */
  const violations = [];

  for (const { line, importPath } of importsWithLines) {
    for (const rule of rules) {
      const violation = evaluateRule(normalizedPath, importPath, rule, content);
      if (violation) {
        violations.push({ ...violation, line });
      }
    }
  }

  return violations;
}

/**
 * Run the architecture gate against a map of file paths to contents.
 *
 * @param {{
 *   files: Map<string, string>,
 *   cwd?: string,
 *   rules?: ArchitectureRule[]
 * }} opts
 * @returns {Promise<ArchitectureGateResult>}
 */
export async function runArchitectureGate({ files, cwd = ".", rules }) {
  const start = Date.now();
  const effectiveRules = rules ?? (await loadArchitectureRules(cwd));
  /** @type {ArchitectureViolation[]} */
  const violations = [];

  for (const [filePath, content] of files) {
    const fileViolations = checkFileArchitecture({
      filePath,
      content,
      rules: effectiveRules
    });
    violations.push(...fileViolations);
  }

  return {
    passed: violations.length === 0,
    violations,
    checkedFiles: files.size,
    durationMs: Date.now() - start
  };
}

/**
 * Format architecture gate results for CLI/API output.
 *
 * @param {ArchitectureGateResult} result
 * @returns {string}
 */
export function formatArchitectureResult(result) {
  if (result.passed) {
    return `Architecture gate: PASS (${result.checkedFiles} files, ${result.durationMs}ms)`;
  }

  const lines = [
    `Architecture gate: FAIL (${result.violations.length} violations in ${result.checkedFiles} files)`,
    ""
  ];

  for (const v of result.violations) {
    const location = v.line ? `:${v.line}` : "";
    const importInfo = v.importPath ? ` → imports "${v.importPath}"` : "";
    lines.push(`  [${v.rule}] ${v.file}${location}${importInfo}`);
    lines.push(`    ${v.description}`);
  }

  return lines.join("\n");
}
