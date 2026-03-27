// @ts-check

import { tokenize } from "../context/noise-canceler.js";
import { loadWorkspaceChunks } from "../io/workspace-chunks.js";
import { buildLearningPacket } from "../learning/mentor-loop.js";
import { resolveAutoTeachRecall } from "../memory/memory-auto-orchestrator.js";

/**
 * @typedef {import("../contracts/vertical-benchmark-contracts.js").parseVerticalBenchmarkFile extends (...args: any[]) => infer R ? R["cases"][number] : never} VerticalComparisonCase
 */

function toPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function ratio(part, total) {
  if (!total) {
    return 1;
  }

  return part / total;
}

/**
 * @param {string} text
 */
function estimateTokens(text) {
  return tokenize(String(text ?? "")).length;
}

/**
 * @param {Array<{ kind?: string }>} chunks
 */
function summarizeKinds(chunks) {
  /** @type {Record<string, number>} */
  const counts = {};

  for (const chunk of chunks) {
    const key = String(chunk.kind ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

/**
 * @param {Array<{ source?: string, kind?: string }>} chunks
 */
function summarizeOrigins(chunks) {
  let workspace = 0;
  let memory = 0;

  for (const chunk of chunks) {
    if (chunk.kind === "memory") {
      memory += 1;
      continue;
    }

    workspace += 1;
  }

  return {
    workspace,
    memory
  };
}

/**
 * @param {string[]} values
 */
function normalizeList(values) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

/**
 * @param {string} project
 * @param {Array<{ query: string, observationId: string, type: string, title: string, body: string, timestamp: string }>} memories
 */
function createBenchmarkSearch(project, memories) {
  return async (query, options = {}) => {
    const normalizedQuery = String(query ?? "").trim();
    const matches = memories.filter((entry) => entry.query === normalizedQuery);

    if (!matches.length) {
      return {
        entries: [],
        stdout: "No memories found for that query.",
        provider: "benchmark-memory"
      };
    }

    return {
      entries: matches.map((memory) => ({
        id: memory.observationId,
        title: memory.title,
        content: memory.body,
        type: memory.type,
        project: options.project ?? project,
        scope: options.scope ?? "project",
        topic: "",
        createdAt: new Date(memory.timestamp.replace(" ", "T")).toISOString()
      })),
      stdout: `Found ${matches.length} memories:`,
      provider: "benchmark-memory"
    };
  };
}

/**
 * @param {VerticalComparisonCase} entry
 */
export async function runNexusComparisonCase(entry) {
  const workspace = await loadWorkspaceChunks(entry.input.workspace);
  const search = createBenchmarkSearch(
    entry.input.project,
    entry.provider.memories
  );
  const recall = await resolveAutoTeachRecall({
    task: entry.input.task,
    objective: entry.input.objective,
    focus: `${entry.input.task} ${entry.input.objective}`.trim(),
    changedFiles: entry.input.changedFiles,
    project: entry.input.project,
    explicitQuery: entry.input.recallQuery,
    noRecall: entry.input.noRecall,
    autoRecall: true,
    limit: 3,
    scope: "project",
    strictRecall: false,
    baseChunks: workspace.payload.chunks,
    search
  });
  const packet = buildLearningPacket({
    task: entry.input.task,
    objective: entry.input.objective,
    focus: `${entry.input.task} ${entry.input.objective}`.trim(),
    changedFiles: entry.input.changedFiles,
    chunks: recall.chunks,
    tokenBudget: entry.input.tokenBudget,
    maxChunks: entry.input.maxChunks,
    debug: true
  });

  const rawChunks = recall.chunks;
  const rawTokens = rawChunks.reduce((total, chunk) => total + estimateTokens(chunk.content), 0);
  const selectedChunks = packet.selectedContext.length;
  const selectedTokens = packet.diagnostics.usedTokens;
  const suppressedChunks = packet.suppressedContext.length;
  const suppressedTokens = Math.max(0, rawTokens - selectedTokens);
  const selectedSources = packet.selectedContext.map((chunk) => chunk.source);
  const structuralSelectedChunks = packet.selectedContext.filter(
    (chunk) => (chunk.diagnostics?.structuralSignalCount ?? 0) > 0
  ).length;
  const structuralFocusedChunks = packet.selectedContext.filter(
    (chunk) =>
      (chunk.diagnostics?.structuralOverlap ?? 0) > 0 ||
      (chunk.diagnostics?.structuralPublicSurface ?? 0) > 0 ||
      (chunk.diagnostics?.structuralDependency ?? 0) > 0
  ).length;
  const selectedMemoryChunks = packet.selectedContext.filter((chunk) => chunk.kind === "memory").length;
  const suppressedMemoryChunks = packet.suppressedContext.filter((chunk) => chunk.kind === "memory").length;
  const recoveredMemoryChunks = recall.memoryRecall.recoveredChunks;
  const memoryRetentionRate =
    recoveredMemoryChunks > 0 ? selectedMemoryChunks / recoveredMemoryChunks : 1;
  const codeFocusPass = packet.teachingSections.codeFocus?.source === entry.expectations.codeFocus;
  const relatedTestPass =
    packet.teachingSections.relatedTests?.[0]?.source === entry.expectations.relatedTest;
  const noiseExclusionPass = entry.expectations.excludedSources.every(
    (source) => !selectedSources.includes(source)
  );
  const memoryBehaviorPass =
    recall.memoryRecall.status === entry.expectations.memoryRecallStatus &&
    selectedMemoryChunks === entry.expectations.selectedMemoryChunks &&
    suppressedMemoryChunks === entry.expectations.suppressedMemoryChunks;
  const qualityPass =
    codeFocusPass && relatedTestPass && noiseExclusionPass && memoryBehaviorPass;

  return {
    name: entry.name,
    workspace: entry.input.workspace,
    task: entry.input.task,
    objective: entry.input.objective,
    tokenBudget: entry.input.tokenBudget,
    maxChunks: entry.input.maxChunks,
    withoutNexus: {
      chunks: rawChunks.length,
      tokens: rawTokens,
      origins: summarizeOrigins(rawChunks),
      kinds: summarizeKinds(rawChunks),
      overTokenBudget: rawTokens > entry.input.tokenBudget,
      overChunkBudget: rawChunks.length > entry.input.maxChunks
    },
    withNexus: {
      chunks: selectedChunks,
      tokens: selectedTokens,
      suppressedChunks,
      suppressedTokens,
      origins: summarizeOrigins(packet.selectedContext),
      kinds: summarizeKinds(packet.selectedContext),
      selectedSources,
      structuralSelectedChunks,
      structuralFocusedChunks,
      structuralHitRate:
        selectedChunks > 0 ? round(structuralFocusedChunks / selectedChunks) : 0
    },
    savings: {
      chunks: Math.max(0, rawChunks.length - selectedChunks),
      tokens: suppressedTokens,
      percent: rawTokens > 0 ? round((suppressedTokens / rawTokens) * 100) : 0
    },
    memory: {
      status: recall.memoryRecall.status,
      provider: recall.memoryRecall.provider ?? "",
      providerChain: Array.isArray(recall.memoryRecall.providerChain)
        ? recall.memoryRecall.providerChain
        : [],
      degraded: recall.memoryRecall.degraded === true,
      recoveredChunks: recoveredMemoryChunks,
      selectedChunks: selectedMemoryChunks,
      suppressedChunks: suppressedMemoryChunks,
      retentionRate: round(memoryRetentionRate * 100) / 100
    },
    quality: {
      pass: qualityPass,
      codeFocusPass,
      relatedTestPass,
      noiseExclusionPass,
      memoryBehaviorPass
    }
  };
}

/**
 * @param {VerticalComparisonCase[]} cases
 */
export async function runNexusComparisonSuite(cases) {
  const results = [];

  for (const entry of cases) {
    results.push(await runNexusComparisonCase(entry));
  }

  const avgRawChunks = average(results.map((result) => result.withoutNexus.chunks));
  const avgSelectedChunks = average(results.map((result) => result.withNexus.chunks));
  const avgRawTokens = average(results.map((result) => result.withoutNexus.tokens));
  const avgSelectedTokens = average(results.map((result) => result.withNexus.tokens));
  const avgTokenSavingsPercent = average(results.map((result) => result.savings.percent));
  const avgChunkSavingsPercent = average(
    results.map((result) =>
      result.withoutNexus.chunks > 0
        ? ((result.withoutNexus.chunks - result.withNexus.chunks) / result.withoutNexus.chunks) * 100
        : 0
    )
  );
  const overflowWithoutNexusRate = ratio(
    results.filter((result) => result.withoutNexus.overTokenBudget || result.withoutNexus.overChunkBudget)
      .length,
    results.length
  );
  const memoryCases = results.filter((result) => result.memory.recoveredChunks > 0);
  const avgMemoryRetentionRate = memoryCases.length
    ? average(memoryCases.map((result) => result.memory.retentionRate))
    : 1;
  const avgStructuralHitRate = average(
    results.map((result) => result.withNexus.structuralHitRate)
  );
  const degradedRecallRate = ratio(
    results.filter((result) => result.memory.degraded).length,
    results.length
  );
  const qualityPassRate = ratio(
    results.filter((result) => result.quality.pass).length,
    results.length
  );
  /** @type {Record<string, number>} */
  const providerBreakdown = {};

  for (const result of results) {
    const key = result.memory.provider || "unknown";
    providerBreakdown[key] = (providerBreakdown[key] ?? 0) + 1;
  }

  /** @type {string[]} */
  const improvements = [];

  if (overflowWithoutNexusRate >= 0.5) {
    improvements.push(
      "Priorizar visibilidad operativa de `impact` en UI/API: la mayoría de los casos sin NEXUS exceden presupuesto."
    );
  }

  if (avgSelectedTokens >= average(results.map((result) => result.tokenBudget)) * 0.9) {
    improvements.push(
      "Evaluar compresión jerárquica adicional: el contexto seleccionado queda demasiado cerca del presupuesto."
    );
  }

  if (avgMemoryRetentionRate < 0.8) {
    improvements.push(
      "Revisar `recallReserveRatio` y `recallBoost`: la memoria útil no está reteniéndose lo suficiente."
    );
  }

  if (results.length < 4) {
    improvements.push(
      "Ampliar el corpus comparativo: agregar casos del repo NEXUS real y del sitio del hackathon para medir valor fuera del vertical TypeScript."
    );
  }

  return {
    status: qualityPassRate === 1 ? "ok" : "warn",
    summary: {
      cases: results.length,
      avgRawChunks: round(avgRawChunks),
      avgSelectedChunks: round(avgSelectedChunks),
      avgRawTokens: round(avgRawTokens),
      avgSelectedTokens: round(avgSelectedTokens),
      avgChunkSavingsPercent: round(avgChunkSavingsPercent),
      avgTokenSavingsPercent: round(avgTokenSavingsPercent),
      overflowWithoutNexusRate: round(overflowWithoutNexusRate * 100) / 100,
      avgMemoryRetentionRate: round(avgMemoryRetentionRate * 100) / 100,
      avgStructuralHitRate: round(avgStructuralHitRate * 100) / 100,
      degradedRecallRate: round(degradedRecallRate * 100) / 100,
      providerBreakdown,
      qualityPassRate: round(qualityPassRate * 100) / 100
    },
    improvements,
    results
  };
}

/**
 * @param {Awaited<ReturnType<typeof runNexusComparisonSuite>>} report
 */
export function formatNexusComparisonReport(report) {
  const lines = ["# NEXUS vs raw-context benchmark", ""];

  for (const result of report.results) {
    lines.push(`- ${result.quality.pass ? "PASS" : "WARN"} ${result.name}`);
    lines.push(`  workspace: ${result.workspace}`);
    lines.push(
      `  withoutNexus: ${result.withoutNexus.chunks} chunks / ${result.withoutNexus.tokens} tokens / memory=${result.withoutNexus.origins.memory}`
    );
    lines.push(
      `  withNexus: ${result.withNexus.chunks} chunks / ${result.withNexus.tokens} tokens / memory=${result.withNexus.origins.memory}`
    );
    lines.push(
      `  savings: ${result.savings.chunks} chunks / ${result.savings.tokens} tokens / ${result.savings.percent}%`
    );
    lines.push(
      `  memory: status=${result.memory.status} provider=${result.memory.provider || "unknown"} degraded=${result.memory.degraded ? "yes" : "no"} recovered=${result.memory.recoveredChunks} selected=${result.memory.selectedChunks} suppressed=${result.memory.suppressedChunks}`
    );
    lines.push(
      `  structural: selected=${result.withNexus.structuralSelectedChunks} focused=${result.withNexus.structuralFocusedChunks} hitRate=${result.withNexus.structuralHitRate}`
    );
    lines.push(
      `  quality: code=${result.quality.codeFocusPass ? "yes" : "no"} test=${result.quality.relatedTestPass ? "yes" : "no"} noise=${result.quality.noiseExclusionPass ? "yes" : "no"} memory=${result.quality.memoryBehaviorPass ? "yes" : "no"}`
    );
    lines.push("");
  }

  lines.push("## Summary");
  lines.push(`- Cases: ${report.summary.cases}`);
  lines.push(`- Avg raw chunks: ${report.summary.avgRawChunks}`);
  lines.push(`- Avg NEXUS chunks: ${report.summary.avgSelectedChunks}`);
  lines.push(`- Avg raw tokens: ${report.summary.avgRawTokens}`);
  lines.push(`- Avg NEXUS tokens: ${report.summary.avgSelectedTokens}`);
  lines.push(`- Avg chunk savings: ${toPercent(report.summary.avgChunkSavingsPercent / 100)}`);
  lines.push(`- Avg token savings: ${toPercent(report.summary.avgTokenSavingsPercent / 100)}`);
  lines.push(
    `- Cases overflowing without NEXUS: ${toPercent(report.summary.overflowWithoutNexusRate)}`
  );
  lines.push(
    `- Avg memory retention: ${toPercent(report.summary.avgMemoryRetentionRate)}`
  );
  lines.push(
    `- Avg structural hit rate: ${toPercent(report.summary.avgStructuralHitRate)}`
  );
  lines.push(
    `- Degraded recall rate: ${toPercent(report.summary.degradedRecallRate)}`
  );
  lines.push(`- Quality pass rate: ${toPercent(report.summary.qualityPassRate)}`);
  lines.push(`- Memory providers: ${normalizeList(Object.entries(report.summary.providerBreakdown).map(([provider, count]) => `${provider}=${count}`)).join(", ") || "none"}`);

  if (report.improvements.length > 0) {
    lines.push("");
    lines.push("## Improvement signals");
    for (const improvement of normalizeList(report.improvements)) {
      lines.push(`- ${improvement}`);
    }
  }

  return lines.join("\n");
}
