// @ts-check

/**
 * Axiom Injector — NEXUS:3 LCS CORE
 *
 * Retrieves relevant axioms from the store and injects them into prompts
 * when they are contextually relevant — without polluting every prompt.
 *
 * Injection rules:
 *   - Only inject when axiom match score >= threshold
 *   - Cap at maxAxioms to avoid context bloat
 *   - Group by type for readability
 *   - Deduplicate by content fingerprint across injections
 *
 * Used by: LLM prompt builder, teach command, codegen pipeline.
 */

import { createAxiomStore } from "./axiom-store.js";

/** @typedef {import("../types/core-contracts.d.ts").Axiom} Axiom */
/** @typedef {import("../types/core-contracts.d.ts").AxiomType} AxiomType */

const TYPE_LABELS = /** @type {Record<AxiomType, string>} */ ({
  "code-axiom": "Code Axiom",
  "library-gotcha": "Library Gotcha",
  "security-rule": "Security Rule",
  "testing-pattern": "Testing Pattern",
  "api-contract": "API Contract"
});

const TYPE_ORDER = /** @type {AxiomType[]} */ ([
  "security-rule",
  "api-contract",
  "code-axiom",
  "library-gotcha",
  "testing-pattern"
]);

/**
 * Format a set of axioms as an injection block for LLM prompts.
 *
 * @param {Axiom[]} axioms
 * @returns {string}
 */
export function formatAxiomBlock(axioms) {
  if (!axioms.length) {
    return "";
  }

  /** @type {Map<AxiomType, Axiom[]>} */
  const grouped = new Map();

  for (const axiom of axioms) {
    const list = grouped.get(axiom.type) ?? [];
    list.push(axiom);
    grouped.set(axiom.type, list);
  }

  const lines = ["## Relevant Knowledge (Axioms)", ""];

  for (const type of TYPE_ORDER) {
    const group = grouped.get(type);
    if (!group?.length) {
      continue;
    }

    lines.push(`### ${TYPE_LABELS[type] ?? type}`);

    for (const axiom of group) {
      lines.push(`**${axiom.title}**`);
      lines.push(axiom.body);
      if (axiom.tags?.length) {
        lines.push(`_tags: ${axiom.tags.join(", ")}_`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

/**
 * Create an axiom injector bound to a project's axiom store.
 *
 * @param {{
 *   project: string,
 *   dataDir?: string,
 *   maxAxioms?: number,
 *   minMatchScore?: number
 * }} opts
 */
export function createAxiomInjector(opts) {
  const { project, dataDir, maxAxioms = 4, minMatchScore = 0.5 } = opts;

  const store = createAxiomStore({ project, dataDir, minMatchScore });

  return {
    /**
     * Retrieve axioms relevant to the given context.
     *
     * @param {{
     *   language?: string,
     *   pathScope?: string,
     *   framework?: string,
     *   focusTerms?: string[],
     *   types?: AxiomType[]
     * }} [context]
     * @returns {Promise<Axiom[]>}
     */
    async retrieve(context = {}) {
      return store.query({ ...context, limit: maxAxioms });
    },

    /**
     * Retrieve axioms and format them as a prompt injection block.
     * Returns empty string when no relevant axioms exist.
     *
     * @param {{
     *   language?: string,
     *   pathScope?: string,
     *   framework?: string,
     *   focusTerms?: string[],
     *   types?: AxiomType[]
     * }} [context]
     * @returns {Promise<string>}
     */
    async inject(context = {}) {
      const axioms = await this.retrieve(context);
      return formatAxiomBlock(axioms);
    },

    /**
     * Save a new axiom to the store.
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
     * }} axiom
     */
    async save(axiom) {
      return store.save(axiom);
    },

    /**
     * List all active axioms.
     * @returns {Promise<Axiom[]>}
     */
    async list() {
      return store.list();
    }
  };
}
