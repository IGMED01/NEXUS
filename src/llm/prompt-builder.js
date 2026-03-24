// @ts-check

import { injectContextIntoPrompt } from "./context-injector.js";

/**
 * NEXUS:6 — build deterministic prompts with teaching-oriented response contract.
 * @param {{
 *   question: string,
 *   task?: string,
 *   objective?: string,
 *   language?: "es" | "en",
 *   chunks?: import("../types/core-contracts.d.ts").Chunk[],
 *   tokenBudget?: number,
 *   maxChunks?: number,
 *   systemPrompt?: string
 * }} input
 */
export function buildLlmPrompt(input) {
  const language = input.language === "en" ? "en" : "es";

  const responseContract =
    language === "en"
      ? [
          "Return the answer with these sections:",
          "1) Change",
          "2) Reason",
          "3) Concepts (max 3 bullets)",
          "4) Practice (one short exercise)",
          "Keep it concise and execution-oriented."
        ].join("\n")
      : [
          "Devuelve la respuesta con estas secciones:",
          "1) Change",
          "2) Reason",
          "3) Concepts (max 3 bullets)",
          "4) Practice (un ejercicio corto)",
          "Mantén el resultado conciso y accionable."
        ].join("\n");

  const baseInstruction = [
    input.systemPrompt ||
      (language === "en"
        ? "You are NEXUS assistant. Solve the task with strict context grounding."
        : "Eres el asistente de NEXUS. Resuelve la tarea con grounding estricto en el contexto."),
    responseContract
  ]
    .filter(Boolean)
    .join("\n\n");

  const injected = injectContextIntoPrompt({
    instruction: baseInstruction,
    task: input.task,
    objective: input.objective,
    userInput: input.question,
    chunks: input.chunks,
    tokenBudget: input.tokenBudget,
    maxChunks: input.maxChunks
  });

  return {
    prompt: injected.prompt,
    context: {
      includedChunks: injected.includedChunks,
      suppressedChunks: injected.suppressedChunks,
      stats: injected.stats
    },
    language
  };
}
