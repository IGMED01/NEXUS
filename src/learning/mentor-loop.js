import { selectContextWindow } from "../context/noise-canceler.js";

export function buildLearningPacket(input) {
  const {
    task,
    focus,
    objective,
    changedFiles = [],
    chunks = [],
    tokenBudget = 350,
    maxChunks,
    minScore,
    sentenceBudget
  } = input;

  const context = selectContextWindow(chunks, {
    focus: focus || `${task} ${objective}`.trim(),
    tokenBudget,
    maxChunks,
    minScore,
    sentenceBudget,
    changedFiles
  });

  return {
    objective,
    task,
    changedFiles,
    teachingChecklist: [
      "Explicar primero la intencion del cambio.",
      "Relacionar cada fragmento con un concepto tecnico.",
      "Mostrar el trade-off principal de la solucion.",
      "Cerrar con una practica corta o siguiente paso."
    ],
    selectedContext: context.selected.map((chunk) => ({
      id: chunk.id,
      source: chunk.source,
      kind: chunk.kind,
      score: Number(chunk.score.toFixed(3)),
      content: chunk.content
    })),
    suppressedContext: context.suppressed,
    diagnostics: {
      focus: context.focus,
      tokenBudget: context.tokenBudget,
      usedTokens: context.usedTokens
    }
  };
}
