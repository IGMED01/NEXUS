import { extname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type TypeScriptApi = typeof import("typescript");

const CODE_DECLARATION_KIND = {
  CLASS: "class",
  FUNCTION: "function",
  INTERFACE: "interface",
  TYPE: "type",
  ENUM: "enum",
  METHOD: "method",
  VARIABLE: "variable"
} as const;

const CODE_VISIBILITY = {
  PUBLIC: "public",
  PROTECTED: "protected",
  PRIVATE: "private",
  MODULE: "module"
} as const;

export type CodeDeclarationKind = (typeof CODE_DECLARATION_KIND)[keyof typeof CODE_DECLARATION_KIND];
export type CodeVisibility = (typeof CODE_VISIBILITY)[keyof typeof CODE_VISIBILITY];

export interface CodeImportSummary {
  source: string;
  bindings: string[];
  typeOnly: boolean;
}

export interface CodeDeclarationSummary {
  name: string;
  kind: CodeDeclarationKind;
  exported: boolean;
  visibility: CodeVisibility;
  startLine: number;
  endLine: number;
  parent?: string;
  async?: boolean;
  extends?: string[];
  implements?: string[];
}

export interface CodeSymbolGraph {
  parser: "typescript-ast" | "unsupported" | "unavailable";
  language: string;
  imports: CodeImportSummary[];
  exports: string[];
  publicSurface: string[];
  dependencyHints: string[];
  declarations: CodeDeclarationSummary[];
  symbolCount: number;
  reason?: string;
}

export interface ChunkSymbolSummary {
  parser: CodeSymbolGraph["parser"];
  language: string;
  imports: CodeImportSummary[];
  exports: string[];
  publicSurface: string[];
  dependencyHints: string[];
  declarations: CodeDeclarationSummary[];
}

const SUPPORTED_CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const MAX_IMPORTS = 12;
const MAX_EXPORTS = 12;
const MAX_PUBLIC_SURFACE = 12;
const MAX_DEPENDENCY_HINTS = 16;
const MAX_DECLARATIONS = 24;
const MAX_CHUNK_DECLARATIONS = 8;

let cachedTypeScript: TypeScriptApi | null | undefined;

function getCodeExtension(source: string): string {
  return extname(String(source ?? "").toLowerCase());
}

export function supportsCodeSymbolExtraction(source: string): boolean {
  return SUPPORTED_CODE_EXTENSIONS.has(getCodeExtension(source));
}

function inferLanguage(source: string): string {
  const extension = getCodeExtension(source);

  if ([".ts", ".tsx"].includes(extension)) {
    return "typescript";
  }

  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return "javascript";
  }

  return "text";
}

function getTypeScriptCompiler(): TypeScriptApi | null {
  if (cachedTypeScript !== undefined) {
    return cachedTypeScript;
  }

  try {
    cachedTypeScript = require("typescript") as TypeScriptApi;
  } catch {
    cachedTypeScript = null;
  }

  return cachedTypeScript;
}

function resolveScriptKind(ts: TypeScriptApi, source: string): number {
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

function hasModifier(modifiers: readonly { kind: number }[] | undefined, kind: number): boolean {
  return Array.isArray(modifiers) ? modifiers.some((modifier) => modifier.kind === kind) : false;
}

function resolveVisibility(
  modifiers: readonly { kind: number }[] | undefined,
  ts: TypeScriptApi
): CodeVisibility {
  if (hasModifier(modifiers, ts.SyntaxKind.PrivateKeyword)) {
    return CODE_VISIBILITY.PRIVATE;
  }

  if (hasModifier(modifiers, ts.SyntaxKind.ProtectedKeyword)) {
    return CODE_VISIBILITY.PROTECTED;
  }

  if (hasModifier(modifiers, ts.SyntaxKind.PublicKeyword)) {
    return CODE_VISIBILITY.PUBLIC;
  }

  return CODE_VISIBILITY.MODULE;
}

function lineAtPosition(ts: TypeScriptApi, sourceFile: import("typescript").SourceFile, position: number): number {
  return ts.getLineAndCharacterOfPosition(sourceFile, position).line + 1;
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function pushUnique(target: string[], value: string | null | undefined, limit: number): void {
  const normalized = asNonEmptyString(value);

  if (!normalized || target.includes(normalized) || target.length >= limit) {
    return;
  }

  target.push(normalized);
}

function summarizeHeritage(
  ts: TypeScriptApi,
  sourceFile: import("typescript").SourceFile,
  clauses: import("typescript").NodeArray<import("typescript").HeritageClause> | undefined
): { extendsTypes: string[]; implementsTypes: string[] } {
  const extendsTypes: string[] = [];
  const implementsTypes: string[] = [];

  for (const clause of clauses ?? []) {
    const names = clause.types
      .map((entry) => asNonEmptyString(entry.expression.getText(sourceFile)))
      .filter((value): value is string => Boolean(value));

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

export function extractCodeSymbols(input: { source: string; content: string }): CodeSymbolGraph {
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

  const imports: CodeImportSummary[] = [];
  const exports: string[] = [];
  const publicSurface: string[] = [];
  const dependencyHints: string[] = [];
  const declarations: CodeDeclarationSummary[] = [];

  const pushDeclaration = (declaration: CodeDeclarationSummary): void => {
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
  };

  const visitTopLevel = (node: import("typescript").Node): void => {
    if (ts.isImportDeclaration(node)) {
      const importSource = asNonEmptyString(
        node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/gu, "")
      );
      const bindings: string[] = [];
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
        kind: CODE_DECLARATION_KIND.FUNCTION,
        exported: hasModifier(node.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.ExportKeyword),
        visibility: CODE_VISIBILITY.MODULE,
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end),
        async: hasModifier(node.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.AsyncKeyword)
      });
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      pushDeclaration({
        name: node.name.getText(sourceFile),
        kind: CODE_DECLARATION_KIND.INTERFACE,
        exported: hasModifier(node.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.ExportKeyword),
        visibility: CODE_VISIBILITY.MODULE,
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end)
      });
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      pushDeclaration({
        name: node.name.getText(sourceFile),
        kind: CODE_DECLARATION_KIND.TYPE,
        exported: hasModifier(node.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.ExportKeyword),
        visibility: CODE_VISIBILITY.MODULE,
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end)
      });
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      pushDeclaration({
        name: node.name.getText(sourceFile),
        kind: CODE_DECLARATION_KIND.ENUM,
        exported: hasModifier(node.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.ExportKeyword),
        visibility: CODE_VISIBILITY.MODULE,
        startLine: lineAtPosition(ts, sourceFile, node.getStart(sourceFile)),
        endLine: lineAtPosition(ts, sourceFile, node.end)
      });
      return;
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasModifier(node.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.ExportKeyword);
      for (const declaration of node.declarationList.declarations) {
        const name = asNonEmptyString(declaration.name.getText(sourceFile));

        if (!name) {
          continue;
        }

        pushDeclaration({
          name,
          kind: CODE_DECLARATION_KIND.VARIABLE,
          exported,
          visibility: CODE_VISIBILITY.MODULE,
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
        kind: CODE_DECLARATION_KIND.CLASS,
        exported: hasModifier(node.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.ExportKeyword),
        visibility: CODE_VISIBILITY.MODULE,
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
        const visibility = resolveVisibility(member.modifiers as readonly { kind: number }[] | undefined, ts);
        const exported = visibility === CODE_VISIBILITY.PUBLIC || visibility === CODE_VISIBILITY.MODULE;

        pushDeclaration({
          name: methodName,
          kind: CODE_DECLARATION_KIND.METHOD,
          exported,
          visibility,
          parent: className,
          startLine: lineAtPosition(ts, sourceFile, member.getStart(sourceFile)),
          endLine: lineAtPosition(ts, sourceFile, member.end),
          async: hasModifier(member.modifiers as readonly { kind: number }[] | undefined, ts.SyntaxKind.AsyncKeyword)
        });

        if (exported) {
          pushUnique(publicSurface, `${className}.${methodName}`, MAX_PUBLIC_SURFACE);
        }
      }
    }
  };

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

export function summarizeCodeSymbolsForChunk(
  graph: CodeSymbolGraph | undefined,
  section: { startLine?: number; endLine?: number } | undefined
): ChunkSymbolSummary | undefined {
  if (!graph || graph.parser === "unsupported") {
    return undefined;
  }

  const startLine = Number(section?.startLine ?? 0);
  const endLine = Number(section?.endLine ?? 0);
  const declarations =
    startLine > 0 && endLine >= startLine
      ? graph.declarations.filter((entry) => entry.startLine <= endLine && entry.endLine >= startLine)
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
