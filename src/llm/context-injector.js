// @ts-check

import { tokenize } from "../context/noise-canceler.js";

/**
 * @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk
 */

/**
 * @typedef {{
 *   chunk: Chunk,
 *   tokenCount: number
 * }} InjectedChunk
 */

/**
 * @typedef {{
 *   id: string,
 *   source: string,
 *   reason: string,
 *   tokenCount: number
 * }} SuppressedInjectedChunk
 */

/**
 * @param {string} text
 */
function tokenCount(text) {
  return tokenize(text).length;
}

/**
 * @param {Chunk} chunk
 */
function renderChunk(chunk) {
  return [`[source=${chunk.source} kind=${chunk.kind}]`, chunk.content.trim()].join("\n");
}

/**
 * @param {Chunk[]} chunks
 * @param {{ tokenBudget?: number, maxChunks?: number }} [options]
 */
export function prepareInjectedContext(chunks, options = {}) {
  const tokenBudget = Math.max(80, Number(options.tokenBudget ?? 520));
  const maxChunks = Math.max(1, Number(options.maxChunks ?? 8));

  /** @type {InjectedChunk[]} */
  const included = [];
  /** @type {SuppressedInjectedChunk[]} */
  const suppressed = [];
  const seen = new Set();
  let usedTokens = 0;

  for (const chunk of chunks ?? []) {
    const signature = `${chunk.source}::${chunk.content}`;

    if (seen.has(signature)) {
      suppressed.push({
        id: chunk.id,
        source: chunk.source,
        reason: "duplicate",
        tokenCount: 0
      });
      continue;
    }

    seen.add(signature);

    const rendered = renderChunk(chunk);
    const chunkTokens = tokenCount(rendered);

    if (included.length >= maxChunks) {
      suppressed.push({
        id: chunk.id,
        source: chunk.source,
        reason: "max-chunks-reached",
        tokenCount: chunkTokens
      });
      continue;
    }

    if (usedTokens + chunkTokens > tokenBudget) {
      suppressed.push({
        id: chunk.id,
        source: chunk.source,
        reason: "token-budget-exceeded",
        tokenCount: chunkTokens
      });
      continue;
    }

    included.push({
      chunk,
      tokenCount: chunkTokens
    });
    usedTokens += chunkTokens;
  }

  return {
    tokenBudget,
    maxChunks,
    usedTokens,
    included,
    suppressed
  };
}

/**
 * NEXUS:6 — inject selected chunks into an LLM-ready prompt envelope.
 * @param {{
 *   instruction: string,
 *   task?: string,
 *   objective?: string,
 *   userInput: string,
 *   chunks?: Chunk[],
 *   tokenBudget?: number,
 *   maxChunks?: number
 * }} input
 */
export function injectContextIntoPrompt(input) {
  const prepared = prepareInjectedContext(input.chunks ?? [], {
    tokenBudget: input.tokenBudget,
    maxChunks: input.maxChunks
  });

  const contextLines = prepared.included.map((entry, index) => {
    return `(${index + 1}) ${renderChunk(entry.chunk)}`;
  });

  const prompt = [
    input.instruction.trim(),
    input.task ? `Task: ${input.task.trim()}` : "",
    input.objective ? `Objective: ${input.objective.trim()}` : "",
    "",
    "Context chunks:",
    contextLines.length ? contextLines.join("\n\n") : "(no context selected)",
    "",
    "User input:",
    input.userInput.trim()
  ]
    .filter(Boolean)
    .join("\n");

  return {
    prompt,
    stats: {
      tokenBudget: prepared.tokenBudget,
      usedTokens: prepared.usedTokens,
      includedChunks: prepared.included.length,
      suppressedChunks: prepared.suppressed.length
    },
    includedChunks: prepared.included.map((entry) => entry.chunk),
    suppressedChunks: prepared.suppressed
  };
}
