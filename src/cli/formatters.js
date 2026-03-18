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
  return String(source).startsWith("engram://") ? "engram" : "workspace";
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
    `Data dir: ${result.dataDir || "unknown"}`,
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
 *   dataDir?: string
 * }} result
 * @param {string} heading
 */
export function formatMemoryWriteAsText(result, heading) {
  const lines = [
    heading,
    `Title: ${result.title}`,
    `Project: ${result.project || "none"}`,
    `Type: ${result.type || "none"}`,
    `Scope: ${result.scope || "none"}`,
    `Topic: ${result.topic || "none"}`,
    `Data dir: ${result.dataDir || "unknown"}`,
    "",
    "Engram response:"
  ];

  lines.push(result.stdout || "- no output");
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

export function usageText() {
  const commandCatalog = [
    "  doctor   -> checks runtime, config, workspace, and Engram health",
    "  init     -> creates learning-context.config.json with safe defaults",
    "  select   -> ranks and selects high-value context chunks",
    "  teach    -> builds a teaching packet (with automatic recall by default)",
    "  readme   -> generates a learning README from selected context",
    "  recall   -> reads project memory from Engram",
    "  remember -> stores a durable memory note in Engram",
    "  close    -> stores session-close learnings in Engram"
  ];

  return [
    "Commands:",
    ...commandCatalog,
    "",
    "Usage:",
    "  node src/cli.js doctor [--config <file>] [--format json|text]",
    "  node src/cli.js init [--config <file>] [--force true|false] [--format json|text]",
    "  node src/cli.js select [--config <file>] (--input <file> | --workspace <dir>) --focus <text> [--token-budget 350] [--max-chunks 6] [--min-score 0.25] [--debug] [--format json|text]",
    "  node src/cli.js teach [--config <file>] (--input <file> | --workspace <dir>) --task <text> --objective <text> [--changed-files a,b] [--project <name>] [--recall-query <text>] [--memory-limit 3] [--memory-type <name>] [--memory-scope <name>] [--auto-recall true|false] [--no-recall] [--strict-recall true|false] [--auto-remember true|false] [--engram-bin <file>] [--engram-data-dir <dir>] [--token-budget 350] [--max-chunks 6] [--min-score 0.25] [--debug] [--format json|text]",
    "  node src/cli.js readme [--config <file>] [--workspace <dir>] [--input <file>] [--focus <text>] [--task <text>] [--objective <text>] [--title <text>] [--output <file>] [--format json|text]",
    "  node src/cli.js recall [--config <file>] [--project <name>] [--query <text>] [--type <name>] [--scope <name>] [--limit 5] [--degraded-recall true|false] [--engram-bin <file>] [--engram-data-dir <dir>] [--debug] [--format json|text]",
    "  node src/cli.js remember [--config <file>] --title <text> (--content <text> | --message <text>) [--project <name>] [--type <name>] [--scope <name>] [--topic <key>] [--engram-bin <file>] [--engram-data-dir <dir>] [--format json|text]",
    "  node src/cli.js close [--config <file>] --summary <text> [--learned <text>] [--next <text>] [--title <text>] [--project <name>] [--type <name>] [--scope <name>] [--engram-bin <file>] [--engram-data-dir <dir>] [--format json|text]",
    "",
    "Input file format:",
    '  { "chunks": [ { "id": "x", "source": "src/file.ts", "kind": "code", "content": "..." } ] }',
    "",
    "Notes:",
    "  doctor validates Node.js, Git, config, workspace, and Engram availability.",
    "  init creates learning-context.config.json with stable defaults for this repo.",
    "  --workspace scans the local repository and builds chunks automatically.",
    "  learning-context.config.json is loaded automatically when present.",
    "  readme defaults to --workspace . when no input source is provided.",
    "  teach recalls Engram memories automatically unless you pass --no-recall.",
    "  auto recall can be disabled globally with memory.autoRecall or per command with --auto-recall false.",
    "  auto remember can be enabled with --auto-remember true or memory.autoRemember=true.",
    "  auto remember always sanitizes sensitive paths and redacts secret-like fragments before save.",
    "  teach now tries multiple smarter recall queries before giving up.",
    "  recall can return a degraded empty result when Engram is unavailable and degraded mode is enabled.",
    "  --debug exposes score signals, suppression reasons, and recall details for playground debugging.",
    "  recall without --query asks Engram for recent context.",
    "  remember and close write durable memories into Engram."
  ].join("\n");
}
