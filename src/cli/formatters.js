// @ts-check

/** @typedef {import("../types/core-contracts.d.ts").ScanStats} ScanStats */
/** @typedef {import("../types/core-contracts.d.ts").DoctorResult} DoctorResult */
/** @typedef {import("../types/core-contracts.d.ts").PacketChunk} PacketChunk */
/** @typedef {import("../types/core-contracts.d.ts").PacketSuppressedChunk} PacketSuppressedChunk */
/** @typedef {import("../types/core-contracts.d.ts").ContextSelectionResult} ContextSelectionResult */
/** @typedef {import("../types/core-contracts.d.ts").LearningPacket} LearningPacket */
/** @typedef {import("../types/core-contracts.d.ts").MemoryRecallState} MemoryRecallState */

/**
 * @typedef {ContextSelectionResult & {
 *   scanStats?: ScanStats | null
 * }} SelectionRenderResult
 */

/**
 * @typedef {MemoryRecallState & {
 *   selectedChunkIds?: string[],
 *   suppressedChunkIds?: string[]
 * }} RenderMemoryRecallState
 */

/**
 * @typedef {LearningPacket & {
 *   scanStats?: ScanStats | null,
 *   memoryRecall?: RenderMemoryRecallState,
 *   autoMemory?: {
 *     autoRecallEnabled: boolean,
 *     autoRememberEnabled: boolean,
 *     rememberAttempted: boolean,
 *     rememberSaved: boolean,
 *     rememberTitle: string,
 *     rememberError: string,
 *     rememberRedactionCount: number,
 *     rememberSensitivePathCount: number
 *   }
 * }} LearningPacketRenderResult
 */

function originFromSource(source = "") {
  const normalized = String(source);
  return normalized.startsWith("engram://") || normalized.startsWith("memory://")
    ? "memory"
    : "workspace";
}

/**
 * @param {Record<string, number>} [counts]
 */
function formatCountMap(counts = {}) {
  const entries = Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0]));
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}

/**
 * @param {unknown} value
 */
function metric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

/**
 * @param {PacketChunk | PacketSuppressedChunk} chunk
 * @param {string} [indent]
 */
function chunkDebugLines(chunk, indent = "  ") {
  const diagnostics = chunk.diagnostics;

  if (!diagnostics) {
    return [];
  }

  return [
    `${indent}debug: origin=${chunk.origin ?? originFromSource(chunk.source)} tokens=${chunk.tokenCount ?? "n/a"} overlap=${metric(diagnostics.overlap)} affinity=${metric(diagnostics.sourceAffinity)} fit=${metric(diagnostics.implementationFit)} redundancy=${metric(diagnostics.redundancy)} penalty=${metric(diagnostics.penalty)}`,
    `${indent}signals: kind=${metric(diagnostics.kindPrior)} certainty=${metric(diagnostics.certainty)} recency=${metric(diagnostics.recency)} teaching=${metric(diagnostics.teachingValue)} priority=${metric(diagnostics.priority)}`
  ];
}

/**
 * @param {ScanStats | null | undefined} scanStats
 */
function formatScanStats(scanStats) {
  if (!scanStats) {
    return [];
  }

  return [
    "Workspace scan:",
    `- root: ${scanStats.rootPath}`,
    `- discovered: ${scanStats.discoveredFiles}`,
    `- included: ${scanStats.includedFiles}`,
    `- ignored: ${scanStats.ignoredFiles}`,
    `- truncated: ${scanStats.truncatedFiles}`,
    `- redacted files: ${scanStats.redactedFiles}`,
    `- redactions: ${scanStats.redactionCount}`,
    `- ignored sensitive files: ${scanStats.security.ignoredSensitiveFiles}`,
    `- private key blocks: ${scanStats.security.privateBlocks}`,
    `- inline secrets: ${scanStats.security.inlineSecrets}`,
    `- token patterns: ${scanStats.security.tokenPatterns}`,
    `- jwt-like tokens: ${scanStats.security.jwtLike}`,
    `- connection strings: ${scanStats.security.connectionStrings}`
  ];
}

/**
 * @param {PacketChunk | null | undefined} chunk
 */
function formatSectionChunk(chunk) {
  if (!chunk) {
    return "- none";
  }

  return `- [${chunk.kind}] ${chunk.source}${chunk.memoryType ? ` (${chunk.memoryType})` : ""}`;
}

/**
 * @param {SelectionRenderResult} result
 * @param {{ debug?: boolean }} [options]
 */
export function formatSelectionAsText(result, options = {}) {
  const debug = options.debug === true;
  const lines = [
    `Focus: ${result.focus}`,
    `Token budget: ${result.usedTokens}/${result.tokenBudget}`,
    ""
  ];

  if (result.scanStats) {
    lines.push(...formatScanStats(result.scanStats));
    lines.push("");
  }

  lines.push("Selected chunks:");

  if (!result.selected.length) {
    lines.push("- none");
  } else {
    for (const chunk of result.selected) {
      lines.push(
        `- [${chunk.kind}] ${chunk.id} from ${chunk.source} | score=${chunk.score.toFixed(3)}`
      );
      lines.push(`  ${chunk.content}`);

      if (debug) {
        lines.push(...chunkDebugLines(chunk));
      }
    }
  }

  if (debug) {
    lines.push("");
    lines.push("Selection diagnostics:");
    lines.push(`- Selected origins: ${formatCountMap(result.summary?.selectedOrigins)}`);
    lines.push(`- Suppressed origins: ${formatCountMap(result.summary?.suppressedOrigins)}`);
    lines.push(`- Suppression reasons: ${formatCountMap(result.summary?.suppressionReasons)}`);
  }

  lines.push("");
  lines.push("Suppressed chunks:");

  if (!result.suppressed.length) {
    lines.push("- none");
  } else {
    for (const chunk of result.suppressed) {
      if (debug) {
        lines.push(
          `- [${chunk.kind ?? "unknown"}] ${chunk.id} from ${chunk.source ?? "unknown"} | ${chunk.reason} | score=${chunk.score.toFixed(3)}`
        );
        lines.push(...chunkDebugLines(chunk));
      } else {
        lines.push(`- ${chunk.id} | ${chunk.reason} | score=${chunk.score.toFixed(3)}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {LearningPacketRenderResult} packet
 * @param {{ debug?: boolean }} [options]
 */
export function formatLearningPacketAsText(packet, options = {}) {
  const debug = options.debug === true;
  const lines = [
    `Task: ${packet.task}`,
    `Objective: ${packet.objective}`,
    `Changed files: ${packet.changedFiles.join(", ") || "none"}`,
    `Token budget used: ${packet.diagnostics.usedTokens}/${packet.diagnostics.tokenBudget}`,
    ""
  ];

  if (packet.scanStats) {
    lines.push(...formatScanStats(packet.scanStats));
    lines.push("");
  }

  lines.push(
    "Memory recall:",
    `- Enabled: ${packet.memoryRecall?.enabled ? "yes" : "no"}`,
    `- Status: ${packet.memoryRecall?.status || "none"}`,
    `- Primary query: ${packet.memoryRecall?.query || "none"}`,
    `- Queries tried: ${packet.memoryRecall?.queriesTried?.join(" | ") || "none"}`,
    `- Matched queries: ${packet.memoryRecall?.matchedQueries?.join(" | ") || "none"}`,
    `- Project: ${packet.memoryRecall?.project || "none"}`,
    `- Recovered chunks: ${packet.memoryRecall?.recoveredChunks ?? 0}`,
    `- Degraded: ${packet.memoryRecall?.degraded ? "yes" : "no"}`
  );

  if (packet.memoryRecall?.error) {
    lines.push(`- Error: ${packet.memoryRecall.error}`);
  }

  lines.push(`- Selected recalled chunks: ${packet.memoryRecall?.selectedChunks ?? 0}`);
  lines.push(`- Suppressed recalled chunks: ${packet.memoryRecall?.suppressedChunks ?? 0}`);
  lines.push("");
  lines.push("Auto memory:");
  lines.push(`- Auto recall enabled: ${packet.autoMemory?.autoRecallEnabled ? "yes" : "no"}`);
  lines.push(`- Auto remember enabled: ${packet.autoMemory?.autoRememberEnabled ? "yes" : "no"}`);
  lines.push(`- Remember attempted: ${packet.autoMemory?.rememberAttempted ? "yes" : "no"}`);
  lines.push(`- Remember saved: ${packet.autoMemory?.rememberSaved ? "yes" : "no"}`);
  lines.push(`- Remember redactions: ${packet.autoMemory?.rememberRedactionCount ?? 0}`);
  lines.push(`- Sensitive paths sanitized: ${packet.autoMemory?.rememberSensitivePathCount ?? 0}`);

  if (packet.autoMemory?.rememberTitle) {
    lines.push(`- Remember title: ${packet.autoMemory.rememberTitle}`);
  }

  if (packet.autoMemory?.rememberError) {
    lines.push(`- Remember error: ${packet.autoMemory.rememberError}`);
  }

  if (debug) {
    lines.push("");
    lines.push("Recall debug:");
    lines.push(`- First match index: ${packet.memoryRecall?.firstMatchIndex ?? -1}`);
    lines.push(
      `- Recovered memory ids: ${packet.memoryRecall?.recoveredMemoryIds?.join(" | ") || "none"}`
    );
    lines.push(
      `- Selected recalled ids: ${packet.memoryRecall?.selectedChunkIds?.join(" | ") || "none"}`
    );
    lines.push(
      `- Suppressed recalled ids: ${packet.memoryRecall?.suppressedChunkIds?.join(" | ") || "none"}`
    );
    lines.push("");
    lines.push("Selection diagnostics:");
    lines.push(
      `- Selected origins: ${formatCountMap(packet.diagnostics.summary?.selectedOrigins)}`
    );
    lines.push(
      `- Suppressed origins: ${formatCountMap(packet.diagnostics.summary?.suppressedOrigins)}`
    );
    lines.push(
      `- Suppression reasons: ${formatCountMap(packet.diagnostics.summary?.suppressionReasons)}`
    );
  }

  lines.push("");
  lines.push("Teaching checklist:");

  for (const item of packet.teachingChecklist) {
    lines.push(`- ${item}`);
  }

  lines.push("");
  lines.push("Teaching map:");
  lines.push(`- Codigo principal: ${packet.teachingSections?.codeFocus ? `${packet.teachingSections.codeFocus.source}` : "none"}`);
  lines.push(
    `- Test relacionado: ${packet.teachingSections?.relatedTests?.[0] ? `${packet.teachingSections.relatedTests[0].source}` : "none"}`
  );
  lines.push(
    `- Memoria historica util: ${packet.teachingSections?.historicalMemory?.[0] ? `${packet.teachingSections.historicalMemory[0].source}${packet.teachingSections.historicalMemory[0].memoryType ? ` (${packet.teachingSections.historicalMemory[0].memoryType})` : ""}` : "none"}`
  );
  lines.push(
    `- Soporte principal: ${packet.teachingSections?.supportingContext?.[0] ? `${packet.teachingSections.supportingContext[0].source}` : "none"}`
  );

  if (packet.teachingSections?.flow?.length) {
    lines.push("");
    lines.push("Teaching flow:");

    for (const step of packet.teachingSections.flow) {
      lines.push(`- ${step}`);
    }
  }

  lines.push("");
  lines.push("Pedagogical sections:");
  lines.push("Codigo principal:");
  lines.push(formatSectionChunk(packet.teachingSections?.codeFocus));
  lines.push("Test relacionado:");

  if (!packet.teachingSections?.relatedTests?.length) {
    lines.push("- none");
  } else {
    for (const chunk of packet.teachingSections.relatedTests) {
      lines.push(formatSectionChunk(chunk));
    }
  }

  lines.push("Memoria historica util:");

  if (!packet.teachingSections?.historicalMemory?.length) {
    lines.push("- none");
  } else {
    for (const chunk of packet.teachingSections.historicalMemory) {
      lines.push(formatSectionChunk(chunk));
    }
  }

  lines.push("Contexto de soporte:");

  if (!packet.teachingSections?.supportingContext?.length) {
    lines.push("- none");
  } else {
    for (const chunk of packet.teachingSections.supportingContext) {
      lines.push(formatSectionChunk(chunk));
    }
  }

  lines.push("");
  lines.push("Selected context:");

  for (const chunk of packet.selectedContext) {
    lines.push(
      `- [${chunk.kind}] ${chunk.id} from ${chunk.source} | score=${chunk.score.toFixed(3)}`
    );
    lines.push(`  ${chunk.content}`);

    if (debug) {
      lines.push(...chunkDebugLines(chunk));
    }
  }

  lines.push("");
  lines.push("Suppressed context:");

  if (!packet.suppressedContext.length) {
    lines.push("- none");
  } else {
    for (const chunk of packet.suppressedContext) {
      if (debug) {
        lines.push(
          `- [${chunk.kind ?? "unknown"}] ${chunk.id} from ${chunk.source ?? "unknown"} | ${chunk.reason} | score=${chunk.score.toFixed(3)}`
        );
        lines.push(...chunkDebugLines(chunk));
      } else {
        lines.push(`- ${chunk.id} | ${chunk.reason} | score=${chunk.score.toFixed(3)}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   mode: string,
 *   project?: string,
 *   query?: string,
 *   type?: string,
 *   scope?: string,
 *   limit?: number | null,
 *   stdout?: string,
 *   dataDir?: string,
 *   filePath?: string,
 *   provider?: string,
 *   degraded?: boolean,
 *   warning?: string,
 *   error?: string,
 *   failureKind?: string,
 *   fixHint?: string
 * }} result
 * @param {{ debug?: boolean }} [options]
 */
export function formatMemoryRecallAsText(result, options = {}) {
  const debug = options.debug === true;
  const lines = [
    `Recall mode: ${result.mode}`,
    `Project: ${result.project || "none"}`,
    `Query: ${result.query || "none"}`,
    `Type filter: ${result.type || "none"}`,
    `Scope: ${result.scope || "none"}`,
    `Limit: ${result.limit ?? "default"}`,
    `Provider: ${result.provider || "memory"}`,
    `Data dir: ${result.dataDir || "unknown"}`,
    `Fallback file: ${result.filePath || "none"}`,
    `Degraded: ${result.degraded ? "yes" : "no"}`,
    "",
    "Recovered memory:"
  ];

  lines.push(result.stdout || "- none");

  if (result.warning) {
    lines.push("");
    lines.push(`Warning: ${result.warning}`);
  }

  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  if (result.failureKind) {
    lines.push(`Failure kind: ${result.failureKind}`);
  }

  if (result.fixHint) {
    lines.push(`Fix hint: ${result.fixHint}`);
  }

  if (debug) {
    lines.push("");
    lines.push("Recall debug:");
    lines.push(`- Query provided: ${result.query ? "yes" : "no"}`);
    lines.push(`- Scope filter active: ${result.scope ? "yes" : "no"}`);
    lines.push(`- Type filter active: ${result.type ? "yes" : "no"}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   title: string,
 *   type?: string,
 *   project?: string,
 *   scope?: string,
 *   topic?: string,
 *   stdout?: string,
 *   dataDir?: string,
 *   filePath?: string,
 *   provider?: string,
 *   memoryStatus?: string,
 *   reviewStatus?: string,
 *   reasons?: string[],
 *   warning?: string,
 *   error?: string
 * }} result
 * @param {string} heading
 */
export function formatMemoryWriteAsText(result, heading) {
  const provider = result.provider || "memory";
  const lines = [
    heading,
    `Title: ${result.title}`,
    `Project: ${result.project || "none"}`,
    `Type: ${result.type || "none"}`,
    `Scope: ${result.scope || "none"}`,
    `Topic: ${result.topic || "none"}`,
    `Memory status: ${result.memoryStatus || "accepted"}`,
    `Review status: ${result.reviewStatus || "accepted"}`,
    `Provider: ${provider}`,
    `Data dir: ${result.dataDir || "unknown"}`,
    `Fallback file: ${result.filePath || "none"}`,
    "",
    provider === "local"
      ? "Local memory response:"
      : provider === "quarantine"
        ? "Quarantine response:"
        : provider === "engram-battery"
          ? "External battery response:"
          : "Memory runtime response:"
  ];

  lines.push(result.stdout || "- no output");

  if (result.warning) {
    lines.push("");
    lines.push(`Warning: ${result.warning}`);
  }

  if (Array.isArray(result.reasons) && result.reasons.length) {
    lines.push(`Reasons: ${result.reasons.join(", ")}`);
  }

  if (result.error) {
    lines.push(`Primary error: ${result.error}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   cwd: string,
 *   summary: { pass: number, warn: number, fail: number },
 *   checks: Array<{
 *     id: string,
 *     label: string,
 *     status: "pass" | "warn" | "fail",
 *     detail: string,
 *     fix?: string
 *   }>
 * }} result
 */
export function formatDoctorResultAsText(result) {
  const lines = [
    "Doctor summary:",
    `- pass: ${result.summary.pass}`,
    `- warn: ${result.summary.warn}`,
    `- fail: ${result.summary.fail}`,
    `- cwd: ${result.cwd}`,
    "",
    "Checks:"
  ];

  for (const check of result.checks) {
    lines.push(`- [${check.status}] ${check.label}: ${check.detail}`);

    if (check.fix) {
      lines.push(`  fix: ${check.fix}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   project?: string,
 *   baseDir: string,
 *   summary: {
 *     total: number,
 *     accepted: number,
 *     candidate: number,
 *     healthy: number,
 *     protected: number,
 *     duplicates: number,
 *     testNoise: number,
 *     lowSignal: number,
 *     quarantineCandidates: number
 *   },
 *   entries: Array<{
 *     id: string,
 *     title: string,
 *     type: string,
 *     reviewStatus: string,
 *     protected: boolean,
 *     healthScore: number,
 *     reasons: string[]
 *   }>
 * }} result
 */
export function formatMemoryDoctorAsText(result) {
  const lines = [
    "Memory doctor summary:",
    `- project: ${result.project || "all"}`,
    `- base dir: ${result.baseDir}`,
    `- total: ${result.summary.total}`,
    `- accepted: ${result.summary.accepted}`,
    `- candidates: ${result.summary.candidate}`,
    `- quarantine candidates: ${result.summary.quarantineCandidates}`,
    `- protected: ${result.summary.protected}`,
    `- duplicates: ${result.summary.duplicates}`,
    `- test noise: ${result.summary.testNoise}`,
    `- low signal: ${result.summary.lowSignal}`,
    "",
    "Entries:"
  ];

  if (!result.entries.length) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const entry of result.entries.slice(0, 12)) {
    lines.push(
      `- [${entry.reviewStatus}] ${entry.title} (${entry.type || "memory"}) | health=${entry.healthScore.toFixed(3)}${entry.protected ? " | protected" : ""}`
    );

    if (entry.reasons.length) {
      lines.push(`  reasons: ${entry.reasons.join(", ")}`);
    }
  }

  if (result.entries.length > 12) {
    lines.push(`- ... ${result.entries.length - 12} more entries`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   project?: string,
 *   baseDir: string,
 *   quarantineBaseDir: string,
 *   dryRun: boolean,
 *   applied: boolean,
 *   quarantinePaths?: string[],
 *   summary: {
 *     totalBefore: number,
 *     candidates: number,
 *     moved: number,
 *     kept: number,
 *     protectedSkipped: number
 *   },
 *   candidates: Array<{
 *     title: string,
 *     type: string,
 *     reasons: string[],
 *     filePath: string
 *   }>
 * }} result
 */
export function formatMemoryPruneAsText(result) {
  const lines = [
    result.applied ? "Memory prune applied:" : "Memory prune dry-run:",
    `- project: ${result.project || "all"}`,
    `- base dir: ${result.baseDir}`,
    `- quarantine dir: ${result.quarantineBaseDir}`,
    `- total before: ${result.summary.totalBefore}`,
    `- candidates: ${result.summary.candidates}`,
    `- moved: ${result.summary.moved}`,
    `- kept: ${result.summary.kept}`,
    `- protected skipped: ${result.summary.protectedSkipped}`,
    "",
    "Candidates:"
  ];

  if (!result.candidates.length) {
    lines.push("- none");
  } else {
    for (const candidate of result.candidates.slice(0, 12)) {
      lines.push(`- ${candidate.title} (${candidate.type || "memory"})`);
      lines.push(`  reasons: ${candidate.reasons.join(", ") || "none"}`);
      lines.push(`  file: ${candidate.filePath}`);
    }
  }

  if (Array.isArray(result.quarantinePaths) && result.quarantinePaths.length) {
    lines.push("");
    lines.push("Quarantine paths:");
    for (const target of result.quarantinePaths) {
      lines.push(`- ${target}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   project?: string,
 *   baseDir: string,
 *   summary: {
 *     total: number,
 *     accepted: number,
 *     candidate: number,
 *     healthy: number,
 *     protected: number,
 *     duplicates: number,
 *     testNoise: number,
 *     lowSignal: number,
 *     quarantineCandidates: number
 *   },
 *   metrics: {
 *     averageHealthScore: number,
 *     averageSignalScore: number,
 *     averageDuplicateScore: number,
 *     durableCount: number,
 *     reviewableCount: number,
 *     disposableCount: number,
 *     recallableDurableCount: number,
 *     candidateRate: number,
 *     noiseRate: number,
 *     duplicateRate: number,
 *     healthyRate: number,
 *     quarantineRate: number
 *   }
 * }} result
 */
export function formatMemoryStatsAsText(result) {
  return [
    "Memory stats:",
    `- project: ${result.project || "all"}`,
    `- base dir: ${result.baseDir}`,
    `- total: ${result.summary.total}`,
    `- durable: ${result.metrics.durableCount}`,
    `- reviewable: ${result.metrics.reviewableCount}`,
    `- disposable: ${result.metrics.disposableCount}`,
    `- recallable durable: ${result.metrics.recallableDurableCount}`,
    `- avg health: ${result.metrics.averageHealthScore.toFixed(3)}`,
    `- avg signal: ${result.metrics.averageSignalScore.toFixed(3)}`,
    `- avg duplicate: ${result.metrics.averageDuplicateScore.toFixed(3)}`,
    `- candidate rate: ${result.metrics.candidateRate.toFixed(3)}`,
    `- noise rate: ${result.metrics.noiseRate.toFixed(3)}`,
    `- duplicate rate: ${result.metrics.duplicateRate.toFixed(3)}`,
    `- healthy rate: ${result.metrics.healthyRate.toFixed(3)}`,
    `- quarantine rate: ${result.metrics.quarantineRate.toFixed(3)}`
  ].join("\n");
}

/**
 * @param {{
 *   project?: string,
 *   topic?: string,
 *   baseDir: string,
 *   quarantineBaseDir: string,
 *   dryRun: boolean,
 *   applied: boolean,
 *   quarantinePaths?: string[],
 *   writtenFiles?: string[],
 *   summary: {
 *     groups: number,
 *     entriesToCompact: number,
 *     created: number,
 *     moved: number,
 *     kept: number,
 *     topicFilterApplied: boolean
 *   },
 *   groups: Array<{
 *     title: string,
 *     topic: string,
 *     compactedType: string,
 *     count: number,
 *     sourceTitles: string[],
 *     filePath: string
 *   }>
 * }} result
 */
export function formatMemoryCompactAsText(result) {
  const lines = [
    result.applied ? "Memory compaction applied:" : "Memory compaction dry-run:",
    `- project: ${result.project || "all"}`,
    `- topic: ${result.topic || "all"}`,
    `- base dir: ${result.baseDir}`,
    `- quarantine dir: ${result.quarantineBaseDir}`,
    `- groups: ${result.summary.groups}`,
    `- entries to compact: ${result.summary.entriesToCompact}`,
    `- created: ${result.summary.created}`,
    `- moved: ${result.summary.moved}`,
    `- kept: ${result.summary.kept}`,
    "",
    "Groups:"
  ];

  if (!result.groups.length) {
    lines.push("- none");
  } else {
    for (const group of result.groups.slice(0, 12)) {
      lines.push(`- ${group.title} (${group.compactedType}) | count=${group.count}`);
      lines.push(`  topic: ${group.topic || "none"}`);
      lines.push(`  sources: ${group.sourceTitles.join(" | ") || "none"}`);
      lines.push(`  file: ${group.filePath}`);
    }
  }

  if (Array.isArray(result.writtenFiles) && result.writtenFiles.length) {
    lines.push("");
    lines.push("Written files:");
    for (const file of result.writtenFiles) {
      lines.push(`- ${file}`);
    }
  }

  if (Array.isArray(result.quarantinePaths) && result.quarantinePaths.length) {
    lines.push("");
    lines.push("Quarantine paths:");
    for (const target of result.quarantinePaths) {
      lines.push(`- ${target}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   action: string,
 *   status: string,
 *   created: boolean,
 *   path: string,
 *   message: string,
 *   project?: string
 * }} result
 */
export function formatInitResultAsText(result) {
  const lines = [
    "Config initialization:",
    `- action: ${result.action}`,
    `- status: ${result.status}`,
    `- created: ${result.created ? "yes" : "no"}`,
    `- path: ${result.path}`
  ];

  if (result.project) {
    lines.push(`- project: ${result.project}`);
  }

  lines.push(`- message: ${result.message}`);
  return lines.join("\n");
}

/**
 * @param {{
 *   input: string,
 *   output?: string,
 *   detectedFormat: string,
 *   statusFilter: string,
 *   maxFindings: number,
 *   totalFindings: number,
 *   includedFindings: number,
 *   discardedFindings?: number,
 *   skippedFindings: number,
 *   redactedFindings?: number,
 *   redactionCountTotal?: number
 * }} result
 */
export function formatSecurityIngestAsText(result) {
  const lines = [
    "Security ingest summary:",
    `- input: ${result.input}`,
    `- output: ${result.output || "(stdout json only)"}`,
    `- detected format: ${result.detectedFormat}`,
    `- status filter: ${result.statusFilter}`,
    `- max findings: ${result.maxFindings}`,
    `- total findings: ${result.totalFindings}`,
    `- included findings: ${result.includedFindings}`,
    `- discarded findings: ${result.discardedFindings ?? 0}`,
    `- skipped findings: ${result.skippedFindings}`
  ];

  if ((result.redactedFindings ?? 0) > 0 || (result.redactionCountTotal ?? 0) > 0) {
    lines.push(`- redacted findings: ${result.redactedFindings ?? 0}`);
    lines.push(`- redaction count: ${result.redactionCountTotal ?? 0}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   action: string,
 *   title: string,
 *   project?: string,
 *   source?: string,
 *   tags?: string[],
 *   parentPageId?: string,
 *   appendedBlocks?: number,
 *   createdAt?: string
 * }} result
 */
export function formatNotionSyncAsText(result) {
  return [
    "Notion sync summary:",
    `- action: ${result.action}`,
    `- title: ${result.title}`,
    `- project: ${result.project || "none"}`,
    `- source: ${result.source || "lcs-cli"}`,
    `- tags: ${(result.tags || []).join(", ") || "none"}`,
    `- parent page id: ${result.parentPageId || "none"}`,
    `- appended blocks: ${result.appendedBlocks ?? 0}`,
    `- created at: ${result.createdAt || "unknown"}`
  ].join("\n");
}

export function usageText() {
  const commandCatalog = [
    "  version  -> prints CLI version",
    "  doctor   -> checks runtime, config, workspace, semantic tier, and external battery health",
    "  doctor-memory -> audits local memory quality and quarantine candidates",
    "  memory-stats -> reports memory health, noise, duplicate, and durable recall metrics",
    "  prune-memory -> moves suspicious local memories into quarantine",
    "  compact-memory -> consolidates reviewable memory clusters into compact entries",
    "  init     -> creates learning-context.config.json with safe defaults",
    "  sync-knowledge -> appends a durable learning note into a Notion page",
    "  ingest-security -> converts Prowler findings JSON into LCS chunk JSON",
    "  select   -> ranks and selects high-value context chunks",
    "  teach    -> builds a teaching packet (with automatic recall by default)",
    "  readme   -> generates a learning README from selected context",
    "  recall   -> reads project memory through the memory runtime",
    "  remember -> stores a durable memory note through the memory runtime",
    "  close    -> stores session-close learnings through the memory runtime",
    "  shell    -> opens interactive tabbed Bash-like console"
  ];

  return [
    "Commands:",
    ...commandCatalog,
    "",
    "Usage:",
    "  node src/cli.js version [--format json|text]",
    "  node src/cli.js doctor [--config <file>] [--format json|text]",
    "  node src/cli.js doctor-memory [--config <file>] [--project <name>] [--memory-base-dir <dir>] [--format json|text]",
    "  node src/cli.js memory-stats [--config <file>] [--project <name>] [--memory-base-dir <dir>] [--format json|text]",
    "  node src/cli.js prune-memory [--config <file>] [--project <name>] [--memory-base-dir <dir>] [--memory-quarantine-dir <dir>] [--apply true|false] [--plan-approved true] [--format json|text]",
    "  node src/cli.js compact-memory [--config <file>] [--project <name>] [--topic <key>] [--memory-base-dir <dir>] [--memory-quarantine-dir <dir>] [--apply true|false] [--plan-approved true] [--format json|text]",
    "  node src/cli.js init [--config <file>] [--force true|false] [--format json|text]",
    "  node src/cli.js sync-knowledge [--config <file>] --title <text> (--content <text> | --message <text>) [--project <name>] [--source <text>] [--tags a,b] [--notion-token <token>] [--notion-page-id <id>] [--plan-approved true] [--format json|text]",
    "  node src/cli.js ingest-security --input <prowler.json> [--status-filter all|non-pass|fail] [--max-findings 200] [--output <file>] [--plan-approved true] [--format json|text]",
    "  node src/cli.js select [--config <file>] (--input <file> | --workspace <dir>) --focus <text> [--token-budget 350] [--max-chunks 6] [--min-score 0.25] [--debug] [--format json|text]",
    "  node src/cli.js teach [--config <file>] (--input <file> | --workspace <dir>) --task <text> --objective <text> [--changed-files a,b] [--project <name>] [--recall-query <text>] [--memory-limit 3] [--memory-type <name>] [--memory-scope <name>] [--memory-backend resilient|local-only] [--auto-recall true|false] [--no-recall] [--strict-recall true|false] [--auto-remember true|false] [--external-battery true|false] [--engram-bin <file>] [--engram-data-dir <dir>] [--local-memory-fallback true|false] [--memory-fallback-file <file>] [--token-budget 350] [--max-chunks 6] [--min-score 0.25] [--debug] [--format json|text]",
    "  node src/cli.js readme [--config <file>] [--workspace <dir>] [--input <file>] [--focus <text>] [--task <text>] [--objective <text>] [--title <text>] [--output <file>] [--plan-approved true] [--format json|text]",
    "  node src/cli.js recall [--config <file>] [--project <name>] [--query <text>] [--type <name>] [--scope <name>] [--limit 5] [--memory-backend resilient|local-only] [--degraded-recall true|false] [--external-battery true|false] [--engram-bin <file>] [--engram-data-dir <dir>] [--local-memory-fallback true|false] [--memory-fallback-file <file>] [--debug] [--format json|text]",
    "  node src/cli.js remember [--config <file>] --title <text> (--content <text> | --message <text>) [--project <name>] [--type <name>] [--scope <name>] [--topic <key>] [--memory-backend resilient|local-only] [--external-battery true|false] [--engram-bin <file>] [--engram-data-dir <dir>] [--local-memory-fallback true|false] [--memory-fallback-file <file>] [--plan-approved true] [--format json|text]",
    "  node src/cli.js close [--config <file>] --summary <text> [--learned <text>] [--next <text>] [--title <text>] [--project <name>] [--type <name>] [--scope <name>] [--memory-backend resilient|local-only] [--external-battery true|false] [--engram-bin <file>] [--engram-data-dir <dir>] [--local-memory-fallback true|false] [--memory-fallback-file <file>] [--plan-approved true] [--format json|text]",
    "  node src/cli.js shell [--project <name>] [--workspace <dir>] [--memory-backend resilient|local-only] [--format text|json]",
    "",
    "Input file format:",
    '  { "chunks": [ { "id": "x", "source": "src/file.ts", "kind": "code", "content": "..." } ] }',
    "",
    "Notes:",
    "  --version and -v also print the CLI version.",
    "  doctor validates Node.js, Git, config, workspace, Ruflo semantic tier, local memory, and optional external battery availability.",
    "  doctor-memory audits local durable memory, flags duplicates/test noise, and suggests quarantine.",
    "  memory-stats computes health/noise/duplicate metrics for the active memory store.",
    "  prune-memory defaults to dry-run and never deletes silently; --apply moves candidates into .lcs/memory-quarantine.",
    "  compact-memory defaults to dry-run and moves superseded source memories into quarantine when applied.",
    "  init creates learning-context.config.json with stable defaults for this repo.",
    "  sync-knowledge appends heading + metadata + markdown content blocks (headings/lists/paragraphs) into your Notion page.",
    "  sync-knowledge can read NOTION_TOKEN / NOTION_API_KEY and NOTION_PARENT_PAGE_ID from env if flags are omitted.",
    "  ingest-security converts Prowler report JSON into chunk JSON compatible with select/teach/readme input.",
    "  --workspace scans the local repository and builds chunks automatically.",
    "  learning-context.config.json is loaded automatically when present.",
    "  readme defaults to --workspace . when no input source is provided.",
    "  teach recalls durable memory automatically unless you pass --no-recall.",
    "  auto recall can be disabled globally with memory.autoRecall or per command with --auto-recall false.",
    "  auto remember can be enabled with --auto-remember true or memory.autoRemember=true.",
    "  memory backend defaults to resilient (Ruflo semantic tier + local fallback), configurable with memory.backend or --memory-backend.",
    "  Engram is treated as an optional external battery only; use --external-battery false to disable that contingency tier.",
    "  auto remember always sanitizes sensitive paths and redacts secret-like fragments before save.",
    "  teach now tries multiple smarter recall queries before giving up.",
    "  safety gate can enforce write-plan approval (--plan-approved true) and scope limits from config.safety.",
    "  safety gate can also block oversized token budgets above config.safety.maxTokenBudget.",
    "  safety gate can require explicit focus for workspace scans and block weak-focus debug traces.",
    "  recall can return a degraded result when semantic/external memory tiers are unavailable and degraded mode is enabled.",
    "  --debug exposes score signals, suppression reasons, and recall details for playground debugging.",
    "  recall without --query asks the memory runtime for recent context.",
    "  remember and close write durable memories through the configured memory runtime.",
    "  shell supports tabs (TAB key), slash commands, persistent history, and command autocompletion."
  ].join("\n");
}
