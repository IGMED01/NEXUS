import { extname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @typedef {typeof import("typescript")} TypeScriptApi */
/**
 * @typedef {"class" | "function" | "interface" | "type" | "enum" | "method" | "variable"} CodeDeclarationKind
 */
/**
 * @typedef {"public" | "protected" | "private" | "module"} CodeVisibility
 */
/**
 * @typedef {{
 *   source: string,
 *   bindings: string[],
 *   typeOnly: boolean
 * }} CodeImportSummary
 */
/**
 * @typedef {{
 *   name: string,
 *   kind: CodeDeclarationKind,
 *   exported: boolean,
 *   visibility: CodeVisibility,
 *   startLine: number,
 *   endLine: number,
 *   parent?: string,
 *   async?: boolean,
 *   extends?: string[],
 *   implements?: string[]
 * }} CodeDeclarationSummary
 */
/**
 * @typedef {{
 *   parser: "typescript-ast" | "unsupported" | "unavailable",
 *   language: string,
 *   imports: CodeImportSummary[],
 *   exports: string[],
 *   publicSurface: string[],
 *   dependencyHints: string[],
 *   declarations: CodeDeclarationSummary[],
 *   symbolCount: number,
 *   reason?: string
 * }} CodeSymbolGraph
 */
/**
 * @typedef {{
 *   parser: CodeSymbolGraph["parser"],
 *   language: string,
 *   imports: CodeImportSummary[],
 *   exports: string[],
 *   publicSurface: string[],
 *   dependencyHints: string[],
 *   declarations: CodeDeclarationSummary[]
 * }} ChunkSymbolSummary
 */

const SUPPORTED_CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const MAX_IMPORTS = 12;
const MAX_EXPORTS = 12;
const MAX_PUBLIC_SURFACE = 12;
const MAX_DEPENDENCY_HINTS = 16;
const MAX_DECLARATIONS = 24;
const MAX_CHUNK_DECLARATIONS = 8;

/** @type {TypeScriptApi | null | undefined} */
let cachedTypeScript;

/**
 * @param {string} source
 */
function getCodeExtension(source) {
  return extname(String(source ?? "").toLowerCase());
}

/**
 * @param {string} source
 */
export function supportsCodeSymbolExtraction(source) {
  return SUPPORTED_CODE_EXTENSIONS.has(getCodeExtension(source));
}

/**
 * @param {string} source
 */
function inferLanguage(source) {
  const extension = getCodeExtension(source);

  if ([".ts", ".tsx"].includes(extension)) {
    return "typescript";
  }

  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return "javascript";
  }

  return "text";
}

function getTypeScriptCompiler() {
  if (cachedTypeScript !== undefined) {
    return cachedTypeScript;
  }

  try {
    cachedTypeScript = require("typescript");
  } catch {
    cachedTypeScript = null;
  }

  return cachedTypeScript;
}

/**
 * @param {TypeScriptApi} ts
 * @param {string} source
 */
function resolveScriptKind(ts, source) {
  const extension = getCodeExtension(source);

  switch (extension) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.Unknown;
  }
}

/**
 * @param {readonly unknown[] | undefined} modifiers
 * @param {number} kind
 */
function hasModifier(modifiers, kind) {
  return Array.isArray(modifiers)
    ? modifiers.some((modifier) => Boolean(modifier) && /** @type {{ kind?: number }} */ (modifier).kind === kind)
    : false;
}

/**
 * @param {readonly unknown[] | undefined} modifiers
 * @param {TypeScriptApi} ts
 * @returns {CodeVisibility}
 */
function resolveVisibility(modifiers, ts) {
  if (hasModifier(modifiers, ts.SyntaxKind.PrivateKeyword)) {
    return "private";
  }

  if (hasModifier(modifiers, ts.SyntaxKind.ProtectedKeyword)) {
    return "protected";
  }

  if (hasModifier(modifiers, ts.SyntaxKind.PublicKeyword)) {
    return "public";
  }

  return "module";
}

/**
 * @param {TypeScriptApi} ts
 * @param {import("typescript").SourceFile} sourceFile
 * @param {number} position
 */
function lineAtPosition(ts, sourceFile, position) {
  return ts.getLineAndCharacterOfPosition(sourceFile, position).line + 1;
}

/**
 * @param {unknown} value
 */
function asNonEmptyString(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

/**
 * @param {string[]} target
 * @param {string | null | undefined} value
 * @param {number} limit
 */
function pushUnique(target, value, limit) {
  const normalized = asNonEmptyString(value);

  if (!normalized || target.includes(normalized) || target.length >= limit) {
    return;
  }

  target.push(normalized);
}

/**
 * @param {TypeScriptApi} ts
 * @param {import("typescript").SourceFile} sourceFile
 * @param {import("typescript").NodeArray<import("typescript").HeritageClause> | undefined} clauses
 */
function summarizeHeritage(ts, sourceFile, clauses) {
  const extendsTypes = [];
  const implementsTypes = [];

  for (const clause of clauses ?? []) {
    const names = clause.types
      .map((entry) => asNonEmptyString(entry.expression.getText(sourceFile)))
      .filter(Boolean);

    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      for (const name of names) {
        pushUnique(extendsTypes, name, MAX_DEPENDENCY_HINTS);
      }
    }

    if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
      for (const name of names) {
        pushUnique(implementsTypes, name, MAX_DEPENDENCY_HINTS);
      }
    }
  }

  return {
    extendsTypes,
    implementsTypes
  };
}

/**
 * @param {{ source: string, content: string }} input
 * @returns {CodeSymbolGraph}
 */
export function extractCodeSymbols(input) {
  const source = String(input?.source ?? "inline.ts");
  const content = String(input?.content ?? "");
  const language = inferLanguage(source);

  if (!supportsCodeSymbolExtraction(source)) {
    return {
      parser: "unsupported",
      language,
      imports: [],
      exports: [],
      publicSurface: [],
      dependencyHints: [],
      declarations: [],
      symbolCount: 0,
      reason: "unsupported_extension"
    };
  }

  const ts = getTypeScriptCompiler();

  if (!ts) {
    return {
      parser: "unavailable",
      language,
      imports: [],
      exports: [],
      publicSurface: [],
      dependencyHints: [],
      declarations: [],
      symbolCount: 0,
      reason: "typescript_dependency_not_available"
    };
  }

  const sourceFile = ts.createSourceFile(
    source,
    content,
    ts.ScriptTarget.Latest,
    true,
    resolveScriptKind(ts, source)
  );

  /** @type {CodeImportSummary[]} */
  const imports = [];
  /** @type {string[]} */
  const exports = [];
  /** @type {string[]} */
  const publicSurface = [];
  /** @type {string[]} */
  const dependencyHints = [];
  /** @type {CodeDeclarationSummary[]} */
  const declarations = [];

  /**
   * @param {CodeDeclarationSummary} declaration
   */
  function pushDeclaration(declaration) {
    if (declarations.length >= MAX_DECLARATIONS) {
      return;
    }

    declarations.push(declaration);
    if (declaration.exported) {
      pushUnique(exports, declaration.name, MAX_EXPORTS);
      pushUnique(publicSurface, declaration.name, MAX_PUBLIC_SURFACE);
    }

    if (declaration.parent) {
      pushUnique(dependencyHints, declaration.parent, MAX_DEPENDENCY_HINTS);
    }

    for (const heritage of declaration.extends ?? []) {
      pushUnique(dependencyHints, heritage, MAX_DEPENDENCY_HINTS);
    }

    for (const heritage of declaration.implements ?? []) {
      pushUnique(dependencyHints, heritage, MAX_DEPENDENCY_HINTS);
    }
  }

  /**
   * @param {import("typescript").Node} node
   */
  function visitTopLevel(node) {
    if (ts.isImportDeclaration(node)) {
      const importSource = asNonEmptyString(node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/gu, ""));
      /** @type {string[]} */
      const bindings = [];
      const clause = node.importClause;

      if (clause?.name) {
        pushUnique(bindings, clause.name.getText(sourceFile), MAX_IMPORTS);
        pushUnique(dependencyHints, clause.name.getText(sourceFile), MAX_DEPENDENCY_HINTS);
      }

      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          pushUnique(bindings, `* as ${clause.namedBindings.name.getText(sourceFile)}`, MAX_IMPORTS);
          pushUnique(dependencyHints, clause.namedBindings.name.getText(sourceFile), MAX_DEPENDENCY_HINTS);
        }

        if (ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const localName = element.name.getText(sourceFile);
            const importedName = element.propertyName?.getText(sourceFile) ?? localName;
            const binding = importedName === localName ? localName : `${importedName} as ${localName}`;
            pushUnique(bindings, binding, MAX_IMPORTS);
            pushUnique(dependencyHints, localName, MAX_DEPENDENCY_HINTS);
          }
        }
      }

      if (importSource && imports.length < MAX_IMPORTS) {
        imports.push({
          source: importSource,
          bindings,
          typeOnly: Boolean(clause?.isTypeOnly)
        });
        pushUnique(dependencyHints, importSource, MAX_DEPENDENCY_HINTS);
      }

      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const exportedName = element.name.getText(sourceFile);
          pushUnique(exports, exportedName, MAX_EXPORTS);
          pushUnique(publicSurface, exportedName, MAX_PUBLIC_SURFACE);
        }
      }

      const reExportSource = node.moduleSpecifier
        ? node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/gu, "")
        : "";
      pushUnique(dependencyHints, reExportSource, MAX_DEPENDENCY_HINTS);
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      pushDeclaration({
        name: node.name.getText(sourceFile),
        kind: "function",
        exported: hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword),
        visibility: "module",
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end),
        async: hasModifier(node.modifiers, ts.SyntaxKind.AsyncKeyword)
      });
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      pushDeclaration({
        name: node.name.getText(sourceFile),
        kind: "interface",
        exported: hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword),
        visibility: "module",
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end)
      });
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      pushDeclaration({
        name: node.name.getText(sourceFile),
        kind: "type",
        exported: hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword),
        visibility: "module",
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end)
      });
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      pushDeclaration({
        name: node.name.getText(sourceFile),
        kind: "enum",
        exported: hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword),
        visibility: "module",
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end)
      });
      return;
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword);
      for (const declaration of node.declarationList.declarations) {
        const name = asNonEmptyString(declaration.name.getText(sourceFile));

        if (!name) {
          continue;
        }

        pushDeclaration({
          name,
          kind: "variable",
          exported,
          visibility: "module",
          startLine: lineAtPosition(ts, sourceFile, declaration.getStart(sourceFile)),
          endLine: lineAtPosition(ts, sourceFile, declaration.end)
        });
      }
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const heritage = summarizeHeritage(ts, sourceFile, node.heritageClauses);
      const className = node.name.getText(sourceFile);

      pushDeclaration({
        name: className,
        kind: "class",
        exported: hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword),
        visibility: "module",
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end),
        extends: heritage.extendsTypes,
        implements: heritage.implementsTypes
      });

      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) {
          continue;
        }

        const methodName = member.name.getText(sourceFile);
        const visibility = resolveVisibility(member.modifiers, ts);
        const exported = visibility === "public" || visibility === "module";

        pushDeclaration({
          name: methodName,
          kind: "method",
          exported,
          visibility,
          parent: className,
          startLine: lineAtPosition(ts, sourceFile, member.getStart(sourceFile)),
          endLine: lineAtPosition(ts, sourceFile, member.end),
          async: hasModifier(member.modifiers, ts.SyntaxKind.AsyncKeyword)
        });

        if (exported) {
          pushUnique(publicSurface, `${className}.${methodName}`, MAX_PUBLIC_SURFACE);
        }
      }
    }
  }

  sourceFile.forEachChild(visitTopLevel);

  return {
    parser: "typescript-ast",
    language,
    imports,
    exports,
    publicSurface,
    dependencyHints,
    declarations,
    symbolCount: imports.length + exports.length + declarations.length
  };
}

/**
 * @param {CodeSymbolGraph | undefined} graph
 * @param {{ startLine?: number, endLine?: number } | undefined} section
 * @returns {ChunkSymbolSummary | undefined}
 */
export function summarizeCodeSymbolsForChunk(graph, section) {
  if (!graph || graph.parser === "unsupported") {
    return undefined;
  }

  const startLine = Number(section?.startLine ?? 0);
  const endLine = Number(section?.endLine ?? 0);
  const declarations =
    startLine > 0 && endLine >= startLine
      ? graph.declarations.filter(
          (entry) => entry.startLine <= endLine && entry.endLine >= startLine
        )
      : graph.declarations;

  return {
    parser: graph.parser,
    language: graph.language,
    imports: graph.imports.slice(0, MAX_IMPORTS),
    exports: graph.exports.slice(0, MAX_EXPORTS),
    publicSurface: graph.publicSurface.slice(0, MAX_PUBLIC_SURFACE),
    dependencyHints: graph.dependencyHints.slice(0, MAX_DEPENDENCY_HINTS),
    declarations: declarations.slice(0, MAX_CHUNK_DECLARATIONS)
  };
}
