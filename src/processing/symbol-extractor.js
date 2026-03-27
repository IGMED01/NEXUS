// @ts-check

/**
 * Symbol Extractor — NEXUS:1 PROCESSING
 *
 * Extracts structural symbols from code chunks without requiring a full AST parser.
 * Uses regex-based heuristics that cover >90% of TypeScript/JavaScript patterns.
 *
 * Extracted symbols populate `chunk.processing.symbols`, which the noise-canceler
 * (NEXUS:3) uses as structural signal to improve chunk ranking.
 *
 * Symbols extracted:
 *   - imports: module paths this file imports from
 *   - exports: names this file exports
 *   - functions: function/method/arrow names declared
 *   - classes: class names declared
 *   - interfaces: TypeScript interface names
 *   - types: TypeScript type alias names
 *   - dependencies: module paths referenced (union of imports + require calls)
 */

/** @typedef {import("../types/core-contracts.d.ts").ChunkSymbols} ChunkSymbols */

// ── Regex patterns ───────────────────────────────────────────────────────────

const IMPORT_RE = /import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const EXPORT_NAMED_RE = /export\s+(?:const|let|var|function\*?|async\s+function\*?|class)\s+(\w+)/g;
const EXPORT_DEFAULT_RE = /export\s+default\s+(?:class|function\*?|async\s+function\*?)?\s*(\w+)?/g;
const EXPORT_BRACE_RE = /export\s*\{([^}]+)\}/g;

const FUNCTION_RE =
  /(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
const METHOD_RE = /(?:public|private|protected|static|async|override)?\s+(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g;

const CLASS_RE = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+(\w+)/g;
const TYPE_ALIAS_RE = /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/g;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {RegExp} re
 * @param {string} text
 * @param {number} captureGroup
 * @returns {string[]}
 */
function extractAll(re, text, captureGroup = 1) {
  const results = /** @type {string[]} */ ([]);
  let match;
  const cloned = new RegExp(re.source, re.flags.includes("g") ? re.flags : `g${re.flags}`);

  while ((match = cloned.exec(text)) !== null) {
    const value = match[captureGroup]?.trim();
    if (value) {
      results.push(value);
    }
  }

  return results;
}

/**
 * Deduplicate and sort an array of strings.
 * @param {string[]} arr
 * @returns {string[]}
 */
function dedup(arr) {
  return [...new Set(arr)].sort();
}

// ── Extractor ────────────────────────────────────────────────────────────────

/**
 * Extract structural symbols from a code string.
 *
 * @param {string} content  Raw source code (TypeScript or JavaScript)
 * @param {string} [source] File path hint — used to detect if content is code
 * @returns {ChunkSymbols}
 */
export function extractSymbols(content, source = "") {
  const text = String(content ?? "");
  const src = String(source ?? "").toLowerCase().replace(/\\/g, "/");

  // Skip non-code files
  const isCode =
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(src) ||
    /^\s*(import|export|const|let|var|function|class|interface|type)\s/.test(text);

  if (!isCode && src) {
    return emptySymbols();
  }

  // Imports
  const imports = dedup([...extractAll(IMPORT_RE, text, 1), ...extractAll(REQUIRE_RE, text, 1)]);

  // Exports
  const namedExports = extractAll(EXPORT_NAMED_RE, text, 1);
  const defaultExport = extractAll(EXPORT_DEFAULT_RE, text, 1);
  const braceExports = extractAll(EXPORT_BRACE_RE, text, 1).flatMap((group) =>
    group.split(",").map((s) => s.trim().split(" as ").pop()?.trim() ?? "")
  );
  const exports = dedup([...namedExports, ...defaultExport, ...braceExports].filter(Boolean));

  // Functions
  const fnNames = extractAll(FUNCTION_RE, text, 1).concat(extractAll(FUNCTION_RE, text, 2));
  const methodNames = extractAll(METHOD_RE, text, 1).filter(
    (n) => !["if", "for", "while", "switch", "catch", "constructor"].includes(n)
  );
  const functions = dedup([...fnNames, ...methodNames].filter(Boolean));

  // Types
  const classes = dedup(extractAll(CLASS_RE, text, 1));
  const interfaces = dedup(extractAll(INTERFACE_RE, text, 1));
  const types = dedup(extractAll(TYPE_ALIAS_RE, text, 1));

  // Dependencies = all module paths (imports + requires)
  const dependencies = imports;

  return { imports, exports, functions, classes, interfaces, types, dependencies };
}

/**
 * @returns {ChunkSymbols}
 */
export function emptySymbols() {
  return {
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    interfaces: [],
    types: [],
    dependencies: []
  };
}

/**
 * Score how structurally related a chunk is to a set of target symbols.
 *
 * Used by the noise-canceler to add a `structuralSignal` dimension to scoring.
 *
 * @param {ChunkSymbols} chunkSymbols
 * @param {{
 *   targetImports?: string[],
 *   targetExports?: string[],
 *   targetFiles?: string[],
 *   focusTerms?: string[]
 * }} [targets]
 * @returns {number}  Score in [0, 1]
 */
export function structuralMatchScore(chunkSymbols, targets = {}) {
  if (!chunkSymbols || !targets) {
    return 0;
  }

  const { targetImports = [], targetExports = [], targetFiles = [], focusTerms = [] } = targets;
  let hits = 0;
  let checks = 0;

  // Import match: chunk imports something the target exports (or vice versa)
  if (targetImports.length && chunkSymbols.exports.length) {
    checks++;
    const exported = new Set(chunkSymbols.exports.map((e) => e.toLowerCase()));
    const importHits = targetImports.filter((imp) =>
      exported.has(imp.toLowerCase()) ||
      imp.split("/").pop()?.toLowerCase() === chunkSymbols.dependencies.join(",").toLowerCase()
    ).length;
    if (importHits > 0) {
      hits += Math.min(1, importHits / targetImports.length);
    }
  }

  // Export match: chunk exports something referenced in focus
  if (focusTerms.length && chunkSymbols.exports.length) {
    checks++;
    const focusSet = new Set(focusTerms.map((t) => t.toLowerCase()));
    const exportHits = chunkSymbols.exports.filter((e) => focusSet.has(e.toLowerCase())).length;
    if (exportHits > 0) {
      hits += Math.min(1, exportHits / chunkSymbols.exports.length);
    }
  }

  // Dependency hint match: chunk depends on the target files
  if (targetFiles.length && chunkSymbols.dependencies.length) {
    checks++;
    const depHits = chunkSymbols.dependencies.filter((dep) =>
      targetFiles.some((f) => f.includes(dep) || dep.includes(f.replace(/\.[^.]+$/, "")))
    ).length;
    if (depHits > 0) {
      hits += Math.min(1, depHits / targetFiles.length);
    }
  }

  // Public surface match: chunk declares functions/classes relevant to focus
  if (focusTerms.length) {
    const surface = [
      ...chunkSymbols.functions,
      ...chunkSymbols.classes,
      ...chunkSymbols.interfaces
    ].map((s) => s.toLowerCase());

    if (surface.length) {
      checks++;
      const focusSet = new Set(focusTerms.map((t) => t.toLowerCase()));
      const surfaceHits = surface.filter((s) => focusSet.has(s)).length;
      if (surfaceHits > 0) {
        hits += Math.min(1, surfaceHits / surface.length);
      }
    }
  }

  if (!checks) {
    return 0;
  }

  return Math.min(1, hits / checks);
}
