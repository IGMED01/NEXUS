// @ts-check

/**
 * Axiom Store — NEXUS:2 STORAGE / NEXUS:9 VERSIONING
 *
 * Stores reusable code knowledge (axioms) that improve codegen quality.
 *
 * Axiom types:
 *   code-axiom      — fundamental patterns that must always hold
 *   library-gotcha  — known quirks/pitfalls of a library
 *   security-rule   — mandatory security constraints
 *   testing-pattern — required test structure or coverage rules
 *   api-contract    — stable API shape that code must respect
 *
 * Each axiom has:
 *   - language scope: "typescript" | "python" | "*"
 *   - path scope: "src/auth" | "*"
 *   - framework scope: "express" | "react" | "*"
 *   - optional TTL (expiresAt)
 *   - deduplication by content fingerprint
 *
 * Persistence: .lcs/axioms/{project}.jsonl
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** @typedef {import("../types/core-contracts.d.ts").Axiom} Axiom */
/** @typedef {import("../types/core-contracts.d.ts").AxiomType} AxiomType */

const AXIOM_DIR = ".lcs/axioms";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {string} content
 * @returns {string}
 */
function fingerprint(content) {
  return createHash("sha256").update(content.trim().toLowerCase()).digest("hex").slice(0, 12);
}

/**
 * @param {string} project
 * @param {string} [dataDir]
 * @returns {string}
 */
function axiomFilePath(project, dataDir = ".") {
  return path.join(dataDir, AXIOM_DIR, `${project}.jsonl`);
}

/**
 * @param {string} filePath
 * @returns {Promise<Axiom[]>}
 */
async function loadAxioms(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return /** @type {Axiom} */ (JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter(/** @param {unknown} a @returns {a is Axiom} */ (a) => a !== null);
  } catch {
    return [];
  }
}

/**
 * @param {string} filePath
 * @param {Axiom[]} axioms
 */
async function saveAxioms(filePath, axioms) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const lines = axioms.map((a) => JSON.stringify(a)).join("\n");
  await writeFile(filePath, lines + "\n", "utf8");
}

/**
 * Check if an axiom has expired.
 * @param {Axiom} axiom
 * @returns {boolean}
 */
function isExpired(axiom) {
  if (!axiom.expiresAt) {
    return false;
  }

  try {
    return new Date(axiom.expiresAt) < new Date();
  } catch {
    return false;
  }
}

/**
 * Score how well an axiom matches the given context.
 *
 * @param {Axiom} axiom
 * @param {{
 *   language?: string,
 *   pathScope?: string,
 *   framework?: string,
 *   focusTerms?: string[]
 * }} context
 * @returns {number}  Score in [0, 1]
 */
function matchScore(axiom, context) {
  let score = 0;
  let checks = 0;

  // Language match
  checks++;
  if (axiom.language === "*" || !axiom.language) {
    score += 0.5;
  } else if (axiom.language === context.language) {
    score += 1;
  }

  // Path scope match
  checks++;
  if (axiom.pathScope === "*" || !axiom.pathScope) {
    score += 0.5;
  } else if (context.pathScope && context.pathScope.startsWith(axiom.pathScope)) {
    score += 1;
  }

  // Framework match
  checks++;
  if (axiom.framework === "*" || !axiom.framework) {
    score += 0.5;
  } else if (axiom.framework === context.framework) {
    score += 1;
  }

  // Focus terms match (title + body)
  if (context.focusTerms?.length) {
    checks++;
    const axiomText = `${axiom.title} ${axiom.body}`.toLowerCase();
    const hits = context.focusTerms.filter((term) => axiomText.includes(term.toLowerCase())).length;
    score += Math.min(1, hits / context.focusTerms.length);
  }

  return score / checks;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create an axiom store for a project.
 *
 * @param {{
 *   project: string,
 *   dataDir?: string,
 *   minMatchScore?: number
 * }} opts
 */
export function createAxiomStore(opts) {
  const { project, dataDir = ".", minMatchScore = 0.5 } = opts;
  const filePath = axiomFilePath(project, dataDir);

  return {
    /**
     * Save a new axiom. Deduplicates by content fingerprint.
     *
     * @param {{
     *   type: AxiomType,
     *   title: string,
     *   body: string,
     *   language?: string,
     *   pathScope?: string,
     *   framework?: string,
     *   version?: string,
     *   ttlDays?: number,
     *   tags?: string[]
     * }} input
     * @returns {Promise<{ saved: boolean, id: string, duplicate: boolean }>}
     */
    async save(input) {
      const axioms = await loadAxioms(filePath);
      const fp = fingerprint(input.body);
      const id = `axiom-${fp}`;

      // Deduplication
      if (axioms.some((a) => a.id === id)) {
        return { saved: false, id, duplicate: true };
      }

      const now = new Date().toISOString();

      /** @type {Axiom} */
      const axiom = {
        id,
        type: input.type,
        title: input.title,
        body: input.body,
        language: input.language ?? "*",
        pathScope: input.pathScope ?? "*",
        framework: input.framework ?? "*",
        version: input.version,
        createdAt: now,
        expiresAt: input.ttlDays
          ? new Date(Date.now() + input.ttlDays * 86400_000).toISOString()
          : undefined,
        tags: input.tags ?? []
      };

      axioms.push(axiom);
      await saveAxioms(filePath, axioms);

      return { saved: true, id, duplicate: false };
    },

    /**
     * Query axioms relevant to the given context.
     *
     * @param {{
     *   language?: string,
     *   pathScope?: string,
     *   framework?: string,
     *   focusTerms?: string[],
     *   types?: AxiomType[],
     *   limit?: number
     * }} [context]
     * @returns {Promise<Axiom[]>}
     */
    async query(context = {}) {
      const axioms = await loadAxioms(filePath);
      const now = new Date();

      const active = axioms.filter((a) => !isExpired(a));

      const scored = active
        .filter((a) => !context.types?.length || context.types.includes(a.type))
        .map((a) => ({ axiom: a, score: matchScore(a, context) }))
        .filter((entry) => entry.score >= minMatchScore)
        .sort((a, b) => b.score - a.score);

      return scored.slice(0, context.limit ?? 5).map((entry) => entry.axiom);
    },

    /**
     * List all axioms (active, not expired).
     *
     * @returns {Promise<Axiom[]>}
     */
    async list() {
      const axioms = await loadAxioms(filePath);
      return axioms.filter((a) => !isExpired(a));
    },

    /**
     * Delete an axiom by ID.
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
      const axioms = await loadAxioms(filePath);
      const before = axioms.length;
      const filtered = axioms.filter((a) => a.id !== id);
      await saveAxioms(filePath, filtered);
      return filtered.length < before;
    },

    /**
     * Purge expired axioms.
     *
     * @returns {Promise<number>}
     */
    async purgeExpired() {
      const axioms = await loadAxioms(filePath);
      const active = axioms.filter((a) => !isExpired(a));
      const removed = axioms.length - active.length;
      if (removed > 0) {
        await saveAxioms(filePath, active);
      }
      return removed;
    }
  };
}
