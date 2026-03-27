// @ts-check

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{
 *   id: string,
 *   statement: string,
 *   type: string,
 *   topic: string,
 *   protected: boolean,
 *   source: string,
 *   domain: string[],
 *   priority: number,
 *   sourcePaths: string[]
 * }} ApiAxiom
 */

const DEFAULT_PROJECT = "learning-context-system";
const DEFAULT_VAULT_PATH = ".lcs/obsidian-vault/NEXUS/Axioms/10-axiomas-fundacionales.md";
const DEFAULT_AGENT_PATHS = [
  ".lcs/agents/axioms-arquitectura.md",
  ".lcs/agents/axioms-decisiones.md",
  ".lcs/agents/axioms-patrones.md",
  ".lcs/agents/axioms-lecciones.md"
];

/** @type {Record<string, { id: string, topic: string, domain: string[], priority: number, type: string }>} */
const FOUNDATION_AXIOM_MAP = {
  "el guard evalua antes de que el llm vea el prompt": {
    id: "guard-before-llm",
    topic: "architecture/guard-order",
    domain: ["typescript-node-cli", "guard-gates"],
    priority: 1,
    type: "architecture"
  },
  "el contexto llega filtrado al agente nunca raw": {
    id: "filtered-context-only",
    topic: "architecture/context-filtering",
    domain: ["typescript-node-cli", "memory-architecture"],
    priority: 2,
    type: "architecture"
  },
  "las interfaces de memoria retornan tipos estructurados entries provider providerchain nunca stdout para parsear": {
    id: "structured-memory-contracts",
    topic: "contracts/memory-structured-results",
    domain: ["memory-architecture"],
    priority: 3,
    type: "contract"
  },
  "el runtime canonico de memoria es local-first con tier semantico separado engram es bateria externa no nucleo": {
    id: "local-first-memory-runtime",
    topic: "architecture/memory-runtime",
    domain: ["memory-architecture"],
    priority: 4,
    type: "architecture"
  },
  "todo fallback o degradacion se expone explicitamente con provider fallbackprovider warnings y estado": {
    id: "explicit-degradation-reporting",
    topic: "observability/degraded-reporting",
    domain: ["memory-architecture", "guard-gates"],
    priority: 5,
    type: "operability"
  },
  "un bloque no se considera cerrado hasta que typecheck tests y build pasan juntos": {
    id: "green-triad-before-close",
    topic: "quality/green-triad",
    domain: ["typescript-node-cli", "guard-gates"],
    priority: 6,
    type: "quality"
  },
  "nexus prefiere el cambio minimo valido y elimina duplicacion antes de agregar nuevas abstracciones": {
    id: "smallest-valid-change",
    topic: "architecture/minimal-change",
    domain: ["typescript-node-cli"],
    priority: 7,
    type: "pattern"
  },
  "cuando hay foco de codigo las senales estructurales ast imports exports surface pesan mas que la similitud textual suelta": {
    id: "structural-signals-over-text",
    topic: "selection/structural-grounding",
    domain: ["typescript-node-cli", "memory-architecture"],
    priority: 8,
    type: "selection"
  },
  "la memoria durable no acepta ruido de test primero se cuarentena luego se decide": {
    id: "quarantine-test-noise",
    topic: "memory/quarantine-before-durable",
    domain: ["memory-architecture"],
    priority: 9,
    type: "hygiene"
  },
  "la compatibilidad legacy se encapsula en adapters o wrappers la verdad del sistema permanece provider agnostic": {
    id: "legacy-behind-adapters",
    topic: "architecture/provider-agnostic",
    domain: ["memory-architecture", "typescript-node-cli"],
    priority: 10,
    type: "architecture"
  }
};

/**
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/(^-|-$)/gu, "") || "axiom";
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeStatement(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[()`,.:;!?¿¡"'*_\-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
async function safeRead(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * @param {string} raw
 * @param {string} sourcePath
 * @returns {ApiAxiom[]}
 */
function parseFoundationalVault(raw, sourcePath) {
  /** @type {ApiAxiom[]} */
  const axioms = [];
  const lines = raw.split(/\r?\n/u);

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+\*\*(.+?)\*\*$/u);
    if (!match) {
      continue;
    }

    const statement = match[1].trim();
    const normalized = normalizeStatement(statement);
    const mapped = FOUNDATION_AXIOM_MAP[normalized];
    axioms.push({
      id: mapped?.id ?? slugify(statement),
      statement,
      type: mapped?.type ?? "axiom",
      topic: mapped?.topic ?? `axioms/${slugify(statement)}`,
      protected: true,
      source: "obsidian",
      domain: mapped?.domain ?? [],
      priority: mapped?.priority ?? 100,
      sourcePaths: [sourcePath]
    });
  }

  return axioms;
}

/**
 * @param {string} raw
 * @param {string} sourcePath
 * @param {string} type
 * @param {string[]} domain
 * @returns {ApiAxiom[]}
 */
function parseBulletFile(raw, sourcePath, type, domain) {
  /** @type {ApiAxiom[]} */
  const axioms = [];

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.+)$/u) ?? trimmed.match(/^\d+\.\s+(.+)$/u);
    if (!bullet) {
      continue;
    }

    const statement = bullet[1].trim();
    if (!statement || statement.startsWith("**")) {
      continue;
    }

    axioms.push({
      id: slugify(statement),
      statement,
      type,
      topic: `${type}/${slugify(statement)}`,
      protected: type !== "lesson",
      source: "agents",
      domain,
      priority: 200,
      sourcePaths: [sourcePath]
    });
  }

  return axioms;
}

/**
 * @param {string} raw
 * @param {string} sourcePath
 * @returns {ApiAxiom[]}
 */
function parseDecisionFile(raw, sourcePath) {
  /** @type {ApiAxiom[]} */
  const axioms = [];
  const sections = raw.split(/^##\s+/mu).slice(1);

  for (const section of sections) {
    const titleLine = section.split(/\r?\n/u)[0] ?? "";
    const title = titleLine.replace(/^Decisión:\s*/u, "").trim();
    const chosenMatch = section.match(/\*\*Elegido:\*\*\s*(.+)/u);
    const statement = chosenMatch?.[1]?.trim() || title;
    if (!statement) {
      continue;
    }

    axioms.push({
      id: slugify(title || statement),
      statement,
      type: "decision",
      topic: `decision/${slugify(title || statement)}`,
      protected: true,
      source: "agents",
      domain: [],
      priority: 300,
      sourcePaths: [sourcePath]
    });
  }

  return axioms;
}

/**
 * @param {string} raw
 * @param {string} sourcePath
 * @returns {ApiAxiom[]}
 */
function parseLessonFile(raw, sourcePath) {
  /** @type {ApiAxiom[]} */
  const axioms = [];
  const sections = raw.split(/^##\s+/mu).slice(1);

  for (const section of sections) {
    const titleLine = section.split(/\r?\n/u)[0] ?? "";
    const title = titleLine.replace(/^Lección:\s*/u, "").trim();
    const ruleMatch = section.match(/\*\*Regla:\*\*\s*(.+)/u);
    const statement = ruleMatch?.[1]?.trim();
    if (!statement) {
      continue;
    }

    axioms.push({
      id: slugify(title || statement),
      statement,
      type: "lesson",
      topic: `lesson/${slugify(title || statement)}`,
      protected: false,
      source: "agents",
      domain: ["memory-architecture"],
      priority: 400,
      sourcePaths: [sourcePath]
    });
  }

  return axioms;
}

/**
 * @param {ApiAxiom[]} axioms
 * @returns {ApiAxiom[]}
 */
function dedupeAxioms(axioms) {
  /** @type {Map<string, ApiAxiom>} */
  const deduped = new Map();

  for (const axiom of axioms) {
    const key = axiom.topic || normalizeStatement(axiom.statement);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, axiom);
      continue;
    }

    const preferred =
      existing.source === "obsidian" && axiom.source !== "obsidian"
        ? existing
        : axiom.source === "obsidian" && existing.source !== "obsidian"
          ? axiom
          : existing.priority <= axiom.priority
            ? existing
            : axiom;

    preferred.domain = [...new Set([...(existing.domain ?? []), ...(axiom.domain ?? [])])];
    preferred.sourcePaths = [...new Set([...(existing.sourcePaths ?? []), ...(axiom.sourcePaths ?? [])])];
    deduped.set(key, preferred);
  }

  return [...deduped.values()].sort((a, b) => a.priority - b.priority || a.statement.localeCompare(b.statement));
}

/**
 * @param {{
 *   project?: string,
 *   dataDir?: string,
 *   domain?: string,
 *   protectedOnly?: boolean
 * }} [options]
 */
export async function loadApiAxioms(options = {}) {
  const project = options.project?.trim() || DEFAULT_PROJECT;
  const dataDir = path.resolve(options.dataDir ?? process.cwd());
  const vaultPath = path.resolve(dataDir, DEFAULT_VAULT_PATH);
  const agentPaths = DEFAULT_AGENT_PATHS.map((entry) => path.resolve(dataDir, entry));

  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const loadedPaths = [];
  /** @type {string[]} */
  const missingPaths = [];
  /** @type {ApiAxiom[]} */
  const allAxioms = [];

  const vaultRaw = await safeRead(vaultPath);
  if (vaultRaw) {
    loadedPaths.push(vaultPath);
    allAxioms.push(...parseFoundationalVault(vaultRaw, vaultPath));
  } else {
    missingPaths.push(vaultPath);
    warnings.push("Obsidian axiom vault not found; using agent sources only.");
  }

  for (const agentPath of agentPaths) {
    const raw = await safeRead(agentPath);
    if (!raw) {
      missingPaths.push(agentPath);
      continue;
    }

    loadedPaths.push(agentPath);
    if (agentPath.endsWith("axioms-arquitectura.md")) {
      allAxioms.push(...parseBulletFile(raw, agentPath, "architecture", ["typescript-node-cli", "memory-architecture", "guard-gates"]));
    } else if (agentPath.endsWith("axioms-patrones.md")) {
      allAxioms.push(...parseBulletFile(raw, agentPath, "pattern", ["typescript-node-cli", "memory-architecture"]));
    } else if (agentPath.endsWith("axioms-decisiones.md")) {
      allAxioms.push(...parseDecisionFile(raw, agentPath));
    } else if (agentPath.endsWith("axioms-lecciones.md")) {
      allAxioms.push(...parseLessonFile(raw, agentPath));
    }
  }

  if (missingPaths.length) {
    warnings.push(`${missingPaths.length} axiom source files were unavailable and were skipped.`);
  }

  let axioms = dedupeAxioms(allAxioms);
  if (options.protectedOnly) {
    axioms = axioms.filter((axiom) => axiom.protected);
  }
  if (options.domain) {
    axioms = axioms.filter((axiom) => axiom.domain.includes(options.domain ?? ""));
  }

  return {
    schemaVersion: "1.0.0",
    status: "ok",
    project,
    count: axioms.length,
    axioms,
    warnings,
    sources: {
      vault: vaultPath,
      agents: agentPaths,
      loaded: loadedPaths,
      missing: missingPaths
    }
  };
}

/**
 * @param {Awaited<ReturnType<typeof loadApiAxioms>>} payload
 */
export function formatApiAxiomsMarkdown(payload) {
  const lines = [
    "# NEXUS axioms",
    "",
    `Project: ${payload.project}`,
    `Count: ${payload.count}`,
    ""
  ];

  for (const axiom of payload.axioms) {
    lines.push(`- [${axiom.id}] ${axiom.statement}`);
    lines.push(`  - type: ${axiom.type}`);
    lines.push(`  - topic: ${axiom.topic}`);
    lines.push(`  - protected: ${axiom.protected ? "true" : "false"}`);
    if (axiom.domain.length) {
      lines.push(`  - domain: ${axiom.domain.join(", ")}`);
    }
  }

  if (payload.warnings.length) {
    lines.push("", "Warnings:");
    for (const warning of payload.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}
