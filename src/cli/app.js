// @ts-check

import { readFileSync } from "node:fs";
import path from "node:path";
import { buildCliJsonContract } from "../contracts/cli-contracts.js";
import { defaultProjectConfig } from "../contracts/config-contracts.js";
import { selectContextWindow } from "../context/noise-canceler.js";
import { createNotionSyncClient } from "../integrations/notion-sync.js";
import { loadProjectConfig } from "../io/config-file.js";
import { loadChunkFile } from "../io/json-file.js";
import { writeTextFile } from "../io/text-file.js";
import { loadWorkspaceChunks } from "../io/workspace-chunks.js";
import { createEngramClient as createEngramBatteryClient } from "../memory/engram-client.js";
import { createExternalBatteryMemoryClient } from "../memory/external-battery-memory-client.js";
import { createLocalMemoryStore } from "../memory/local-memory-store.js";
import {
  buildAcceptedMemoryMetadata,
  evaluateMemoryWrite,
  quarantineMemoryWrite,
  runMemoryCompact,
  runMemoryDoctor,
  runMemoryPrune,
  runMemoryStats
} from "../memory/memory-hygiene.js";
import {
  buildCloseSummaryContent,
  legacySearchStdoutToEntries
} from "../memory/memory-utils.js";
import {
  classifyMemoryFailure,
  memoryFailureFixHint
} from "../memory/resilient-memory-client.js";
import { createRufloResilientClient } from "../memory/ruflo-resilient-client.js";
import {
  getObservabilityReport,
  recordCommandMetric
} from "../observability/metrics-store.js";
import {
  DEFAULT_PROWLER_MAX_FINDINGS,
  DEFAULT_PROWLER_STATUS_FILTER,
  ingestProwlerFile,
  normalizeProwlerStatusFilter
} from "../security/prowler-ingest.js";
import { initProjectConfig, runProjectDoctor } from "../system/project-ops.js";
import {
  formatDoctorResultAsText,
  formatInitResultAsText,
  formatMemoryCompactAsText,
  formatMemoryDoctorAsText,
  formatMemoryPruneAsText,
  formatMemoryRecallAsText,
  formatMemoryStatsAsText,
  formatMemoryWriteAsText,
  formatNotionSyncAsText,
  formatSecurityIngestAsText,
  formatSelectionAsText,
  usageText
} from "./formatters.js";
import { runTeachCommand } from "./teach-command.js";
import { runIngestCommand, formatIngestResultAsText } from "./ingest-command.js";
import { runShellCommand } from "./shell-command.js";
import { evaluateGuard, formatGuardResultAsText } from "../guard/guard-engine.js";
import {
  assertNumberRules,
  listOption,
  numberOption,
  parseArgv,
  requireOption
} from "./arg-parser.js";

/** @typedef {import("../types/core-contracts.d.ts").ScanStats} ScanStats */
/** @typedef {import("../types/core-contracts.d.ts").RuntimeMeta} RuntimeMeta */
/** @typedef {import("../types/core-contracts.d.ts").DoctorResult} DoctorResult */
/** @typedef {import("../types/core-contracts.d.ts").LearningPacket} LearningPacket */
/** @typedef {import("../types/core-contracts.d.ts").MemoryRecallState} MemoryRecallState */
/** @typedef {import("../contracts/context-contracts.js").ChunkFile} ChunkFile */

/**
 * @typedef {Record<string, string>} CliOptions
 */

/**
 * @typedef {"resilient" | "local-only"} MemoryBackendMode
 */

/**
 * @typedef {Awaited<ReturnType<typeof loadProjectConfig>>} LoadedConfigInfo
 */

/**
 * @typedef {{
 *   loadedConfig: LoadedConfigInfo,
 *   configLoadError: string
 * }} SafeLoadConfigResult
 */

/**
 * @typedef {{
 *   path: string,
 *   payload: ChunkFile,
 *   stats?: ScanStats
 * }} ChunkSourceResult
 */

/**
 * @typedef {{
 *   debug?: boolean,
 *   scanStats?: ScanStats | null
 * }} RuntimeMetaOptions
 */

/**
 * @typedef {{
 *   config?: { dataDir?: string, filePath?: string },
 *   search?: (
 *     query: string,
 *     options?: { project?: string, scope?: string, type?: string, limit?: number }
 *   ) => Promise<import("../types/core-contracts.d.ts").MemorySearchResult>,
 *   searchMemories?: (
 *     query: string,
 *     options?: { project?: string, scope?: string, type?: string, limit?: number }
 *   ) => Promise<Record<string, unknown> & { stdout?: string }>,
 *   save?: (input: {
 *     title: string,
 *     content: string,
 *     type?: string,
 *     project?: string,
 *     scope?: string,
 *     topic?: string
 *   }) => Promise<Record<string, unknown>>,
 *   saveMemory?: (input: {
 *     title: string,
 *     content: string,
 *     type?: string,
 *     project?: string,
 *     scope?: string,
 *     topic?: string
 *   }) => Promise<Record<string, unknown>>,
 *   recallContext: (project?: string) => Promise<Record<string, unknown> & { stdout?: string }>,
 *   closeSession: (input: {
 *     summary: string,
 *     learned?: string,
 *     next?: string,
 *     title?: string,
 *     project?: string,
 *     scope?: string,
 *     type?: string
 *   }) => Promise<Record<string, unknown>>
 * }} MemoryClientLike
 */

/**
 * Legacy note: engramClient remains only for test/compat injection.
 * @typedef {{
 *   memoryClient?: MemoryClientLike,
 *   engramClient?: MemoryClientLike,
 *   externalBatteryClient?: MemoryClientLike,
 *   localMemoryClient?: MemoryClientLike,
 *   notionClient?: ReturnType<typeof createNotionSyncClient>
 * }} AppDependencies
 */

/**
 * @typedef {"select" | "teach" | "readme" | "recall" | "remember" | "close" | "doctor" | "doctor-memory" | "memory-stats" | "prune-memory" | "compact-memory" | "init" | "sync-knowledge" | "ingest-security" | "ingest" | "version" | "shell"} CliCommand
 */

/**
 * @typedef {MemoryRecallState & {
 *   selectedChunkIds?: string[],
 *   suppressedChunkIds?: string[]
 * }} RenderMemoryRecallState
 */

/**
 * @typedef {LearningPacket & {
 *   scanStats?: ScanStats,
 *   memoryRecall: RenderMemoryRecallState,
 *   autoMemory?: {
 *     autoRecallEnabled: boolean,
 *     autoRememberEnabled: boolean,
 *     rememberAttempted: boolean,
 *     rememberSaved: boolean,
 *     rememberTitle: string,
 *     rememberError: string,
 *     rememberRedactionCount: number,
 *     rememberSensitivePathCount: number
 *   },
 *   debug?: {
 *     selectedOrigins: Record<string, number>,
 *     suppressedOrigins: Record<string, number>,
 *     suppressionReasons: Record<string, number>
 *   }
 * }} LearningPacketWithMemory
 */

/**
 * @typedef {{
 *   action: string,
 *   status: string,
 *   created: boolean,
 *   path: string,
 *   message: string,
 *   project?: string
 * }} InitCommandResult
 */

/**
 * @typedef {{
 *   mode: string,
 *   project?: string,
 *   query?: string,
 *   type?: string,
 *   scope?: string,
 *   limit?: number | null,
 *   entries?: import("../types/core-contracts.d.ts").MemoryEntry[],
 *   stdout?: string,
 *   stderr?: string,
 *   dataDir?: string,
 *   filePath?: string,
 *   provider?: string,
 *   degraded?: boolean,
 *   warning?: string,
 *   error?: string,
 *   failureKind?: string,
 *   fixHint?: string
 * }} RecallCommandResult
 */

/**
 * @typedef {{
 *   action: string,
 *   title: string,
 *   content: string,
 *   type: string,
 *   project: string,
 *   scope: string,
 *   topic: string,
 *   summary?: string,
 *   learned?: string,
 *   next?: string,
 *   stdout: string,
 *   dataDir: string,
 *   filePath?: string,
 *   provider?: string,
 *   degraded?: boolean,
 *   warning?: string,
 *   error?: string
 * }} MemoryWriteCommandResult
 */

/**
 * @typedef {{
 *   tokenBudget: number,
 *   maxChunks: number,
 *   minScore: number,
 *   sentenceBudget: number
 * }} NumericOptions
 */

/**
 * @returns {string}
 */
function readCliVersion() {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed.version === "string" && parsed.version) {
      return parsed.version;
    }
  } catch {
    // no-op: unknown version fallback
  }

  return "unknown";
}

const CLI_VERSION = readCliVersion();

/**
 * @param {unknown} result
 */
function serialize(result) {
  return JSON.stringify(result, null, 2);
}

/**
 * @param {number} startedAt
 * @param {RuntimeMetaOptions} [options]
 * @returns {RuntimeMeta}
 */
function buildRuntimeMeta(startedAt, options = {}) {
  return {
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    durationMs: Date.now() - startedAt,
    debug: options.debug === true,
    scanStats: options.scanStats ?? null
  };
}

/**
 * @param {string} command
 * @param {number} startedAt
 * @param {{
 *   degraded?: boolean,
 *   selection?: { selectedCount?: number, suppressedCount?: number },
 *   recall?: {
 *     attempted?: boolean,
 *     status?: string,
 *     recoveredChunks?: number,
 *     selectedChunks?: number,
 *     suppressedChunks?: number,
 *     hit?: boolean
 *   },
 *   safety?: {
 *     blocked?: boolean,
 *     reason?: string,
 *     preventedError?: boolean
 *   }
 * }} [extras]
 */
function buildCommandMetric(command, startedAt, extras = {}) {
  return {
    command,
    durationMs: Math.max(0, Date.now() - startedAt),
    degraded: extras.degraded === true,
    selection: extras.selection ?? undefined,
    recall: extras.recall ?? undefined,
    safety: extras.safety ?? undefined
  };
}

/**
 * @param {ReturnType<typeof buildCommandMetric>} metric
 */
function buildObservabilityEvent(metric) {
  return {
    metricsVersion: "1.0.0",
    event: {
      command: metric.command,
      durationMs: metric.durationMs,
      degraded: metric.degraded === true
    },
    selection: {
      selectedCount: metric.selection?.selectedCount ?? 0,
      suppressedCount: metric.selection?.suppressedCount ?? 0
    },
    recall: {
      attempted: metric.recall?.attempted === true,
      status: metric.recall?.status ?? "",
      recoveredChunks: metric.recall?.recoveredChunks ?? 0,
      selectedChunks: metric.recall?.selectedChunks ?? 0,
      suppressedChunks: metric.recall?.suppressedChunks ?? 0,
      hit: metric.recall?.hit === true
    },
    safety: {
      blocked: metric.safety?.blocked === true,
      reason: metric.safety?.reason ?? "",
      preventedError: metric.safety?.preventedError === true
    }
  };
}

/**
 * @param {ReturnType<typeof buildCommandMetric>} metric
 */
async function safeRecordCommandMetric(metric) {
  try {
    await recordCommandMetric(metric);
  } catch {
    // observability must never break command execution
  }
}

/**
 * @param {string} command
 * @param {object | string} payload
 * @param {"json" | "text"} format
 * @param {LoadedConfigInfo} configInfo
 * @param {Partial<import("../types/core-contracts.d.ts").CliContractMeta>} [meta]
 */
function serializeCommandResult(command, payload, format, configInfo, meta = {}) {
  if (format === "text") {
    return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  }

  const jsonPayload = typeof payload === "string" ? { value: payload } : payload;

  return serialize(
    buildCliJsonContract(command, jsonPayload, {
      schemaVersion: configInfo.config.output.jsonSchemaVersion,
      configFound: configInfo.found,
      configPath: configInfo.path,
      ...meta
    })
  );
}

/**
 * @param {CliCommand | "help" | ""} command
 * @param {CliOptions} options
 * @param {LoadedConfigInfo} [loadedConfig]
 * @returns {Promise<ChunkSourceResult>}
 */
async function loadChunkSource(command, options, loadedConfig) {
  if (options.input) {
    return loadChunkFile(options.input);
  }

  if (options.workspace || command === "readme") {
    return loadWorkspaceChunks(options.workspace || ".", {
      security: loadedConfig?.config.security,
      scan: loadedConfig?.config.scan
    });
  }

  throw new Error("Provide --input <file> or --workspace <dir>.");
}

/**
 * @param {CliOptions} options
 * @returns {NumericOptions}
 */
function readNumericOptions(options) {
  return {
    tokenBudget: assertNumberRules(numberOption(options, "token-budget", 350), "token-budget", {
      min: 1,
      integer: true
    }),
    maxChunks: assertNumberRules(numberOption(options, "max-chunks", 6), "max-chunks", {
      min: 1,
      integer: true
    }),
    minScore: assertNumberRules(numberOption(options, "min-score", 0.25), "min-score", {
      min: 0,
      max: 1
    }),
    sentenceBudget: assertNumberRules(
      numberOption(options, "sentence-budget", 3),
      "sentence-budget",
      {
        min: 1,
        integer: true
      }
    )
  };
}

/**
 * @param {CliOptions} options
 */
function getContentOption(options) {
  const value = options.content ?? options.message;

  if (!value || value === "true") {
    throw new Error("Missing required option --content <text> (or --message <text>).\n");
  }

  return value;
}

/**
 * @param {string | undefined} value
 * @returns {MemoryBackendMode}
 */
function parseMemoryBackendMode(value) {
  if (!value || value === "true") {
    return "resilient";
  }

  if (value === "engram-only") {
    return "resilient";
  }

  if (value === "resilient" || value === "local-only") {
    return value;
  }

  throw new Error(
    "Option --memory-backend must be one of: resilient, local-only."
  );
}

/**
 * @param {CliOptions} options
 * @param {AppDependencies} dependencies
 */
function getLocalMemoryClient(options, dependencies) {
  if (dependencies.localMemoryClient) {
    return dependencies.localMemoryClient;
  }

  return createLocalMemoryStore({
    filePath: options["memory-fallback-file"],
    baseDir: options["memory-base-dir"]
  });
}

/**
 * @param {CliOptions} options
 * @param {AppDependencies} dependencies
 */
function getExternalBatteryMemoryClient(options, dependencies) {
  if (dependencies.externalBatteryClient) {
    return dependencies.externalBatteryClient;
  }

  return createEngramBatteryClient({
    binaryPath: options["engram-bin"],
    dataDir: options["engram-data-dir"],
    cwd: process.cwd()
  });
}

function defaultMemoryBaseDir() {
  const explicit = process.env.LCS_TEST_MEMORY_BASE_DIR || process.env.LCS_MEMORY_BASE_DIR;
  return explicit && explicit.trim() ? explicit.trim() : "";
}

function defaultMemoryFallbackFile() {
  const explicit =
    process.env.LCS_TEST_MEMORY_FALLBACK_FILE || process.env.LCS_MEMORY_FALLBACK_FILE;
  return explicit && explicit.trim() ? explicit.trim() : ".lcs/local-memory-store.jsonl";
}

function defaultMemoryQuarantineDir() {
  const explicit =
    process.env.LCS_TEST_MEMORY_QUARANTINE_DIR || process.env.LCS_MEMORY_QUARANTINE_DIR;
  return explicit && explicit.trim() ? explicit.trim() : "";
}

/**
 * @param {AppDependencies} dependencies
 * @returns {MemoryClientLike | null}
 */
function getInjectedMemoryClient(dependencies) {
  if (dependencies.memoryClient) {
    return dependencies.memoryClient;
  }

  if (dependencies.engramClient) {
    return dependencies.engramClient;
  }

  return null;
}

/**
 * @param {CliOptions} options
 * @param {AppDependencies} dependencies
 */
function getMemoryClient(options, dependencies) {
  const injectedMemoryClient = getInjectedMemoryClient(dependencies);
  if (injectedMemoryClient) {
    return injectedMemoryClient;
  }

  const backendMode = parseMemoryBackendMode(options["memory-backend"]);

  if (backendMode === "local-only") {
    return getLocalMemoryClient(options, dependencies);
  }

  const local = getLocalMemoryClient(options, dependencies);
  const fallbackEnabled = booleanOption(options, "local-memory-fallback", true);
  const batteryEnabled = booleanOption(options, "external-battery", true);
  const primaryChain = createRufloResilientClient({
    local,
    project: options.project,
    enabled: fallbackEnabled,
    skipRuflo: booleanOption(options, "skip-ruflo", false)
  });

  if (!batteryEnabled) {
    return primaryChain;
  }

  return createExternalBatteryMemoryClient({
    primary: /** @type {any} */ (primaryChain),
    battery: /** @type {any} */ (getExternalBatteryMemoryClient(options, dependencies)),
    enabled: true
  });
}

/**
 * @param {MemoryClientLike} memoryClient
 * @param {string} query
 * @param {{ project?: string, scope?: string, type?: string, limit?: number }} [options]
 * @returns {Promise<RecallCommandResult>}
 */
async function searchMemoryClient(memoryClient, query, options = {}) {
  if (typeof memoryClient.search === "function") {
    return /** @type {RecallCommandResult} */ (await memoryClient.search(query, options));
  }

  if (typeof memoryClient.searchMemories !== "function") {
    throw new Error("Legacy searchMemories() is not supported by the configured memory client.");
  }

  const legacyResult = /** @type {Record<string, unknown>} */ (
    await memoryClient.searchMemories(query, options)
  );
  const legacyStdout =
    typeof legacyResult.stdout === "string" ? legacyResult.stdout : "";

  return {
    mode: "search",
    query,
    project: options.project ?? "",
    scope: options.scope ?? "",
    type: options.type ?? "",
    limit: options.limit ?? 5,
    entries:
      Array.isArray(legacyResult.entries) && legacyResult.entries.length
        ? legacyResult.entries
        : legacySearchStdoutToEntries(legacyStdout, { project: options.project }),
    stdout: legacyStdout,
    stderr: typeof legacyResult.stderr === "string" ? legacyResult.stderr : "",
    dataDir: typeof legacyResult.dataDir === "string" ? legacyResult.dataDir : "",
    filePath: typeof legacyResult.filePath === "string" ? legacyResult.filePath : "",
    provider:
      typeof legacyResult.provider === "string" && legacyResult.provider.trim()
        ? legacyResult.provider
        : "memory",
    degraded: legacyResult.degraded === true,
    warning: typeof legacyResult.warning === "string" ? legacyResult.warning : undefined,
    error: typeof legacyResult.error === "string" ? legacyResult.error : undefined,
    failureKind:
      typeof legacyResult.failureKind === "string" ? legacyResult.failureKind : undefined,
    fixHint: typeof legacyResult.fixHint === "string" ? legacyResult.fixHint : undefined
  };
}

/**
 * @param {MemoryClientLike} memoryClient
 * @param {import("../types/core-contracts.d.ts").MemorySaveInput} input
 * @returns {Promise<MemoryWriteCommandResult>}
 */
async function saveMemoryClient(memoryClient, input) {
  if (typeof memoryClient.save === "function") {
    const saved = /** @type {Record<string, unknown>} */ (await memoryClient.save(input));
    return {
      action: "save",
      title: input.title,
      content: input.content,
      type: input.type ?? "learning",
      project: input.project ?? "",
      scope: input.scope ?? "project",
      topic: input.topic ?? "",
      stdout: typeof saved.stdout === "string" ? saved.stdout : "",
      dataDir: memoryClient.config?.dataDir ?? "",
      filePath: memoryClient.config?.filePath,
      provider: typeof saved.provider === "string" ? saved.provider : "memory",
      degraded: saved.degraded === true,
      warning: typeof saved.warning === "string" ? saved.warning : undefined
    };
  }

  if (typeof memoryClient.saveMemory !== "function") {
    throw new Error("saveMemory() not supported by the configured memory client.");
  }

  const legacy = /** @type {Record<string, unknown>} */ (await memoryClient.saveMemory(input));
  return {
    action: typeof legacy.action === "string" ? legacy.action : "save",
    title: input.title,
    content: input.content,
    type: input.type ?? "learning",
    project: input.project ?? "",
    scope: input.scope ?? "project",
    topic: input.topic ?? "",
    stdout: typeof legacy.stdout === "string" ? legacy.stdout : "",
    dataDir:
      typeof legacy.dataDir === "string"
        ? legacy.dataDir
        : memoryClient.config?.dataDir ?? "",
    filePath:
      typeof legacy.filePath === "string" ? legacy.filePath : memoryClient.config?.filePath,
    provider:
      typeof legacy.provider === "string" && legacy.provider.trim()
        ? legacy.provider
        : "memory",
    degraded: legacy.degraded === true,
    warning: typeof legacy.warning === "string" ? legacy.warning : undefined,
    error: typeof legacy.error === "string" ? legacy.error : undefined
  };
}

/**
 * @param {MemoryClientLike} memoryClient
 * @param {import("../types/core-contracts.d.ts").MemoryCloseInput} input
 * @returns {Promise<MemoryWriteCommandResult>}
 */
async function closeMemoryClient(memoryClient, input) {
  const closedAt = new Date().toISOString();
  const title = input.title ?? `Session close - ${closedAt.slice(0, 10)}`;
  const content = buildCloseSummaryContent({
    summary: input.summary,
    learned: input.learned,
    next: input.next,
    workspace: process.cwd(),
    closedAt
  });
  const result = /** @type {Record<string, unknown>} */ (await memoryClient.closeSession(input));

  return {
    action: typeof result.action === "string" ? result.action : "close",
    title: typeof result.title === "string" && result.title ? result.title : title,
    summary: input.summary,
    learned: input.learned ?? "",
    next: input.next ?? "",
    content: typeof result.content === "string" && result.content ? result.content : content,
    type: input.type ?? "learning",
    project: input.project ?? "",
    scope: input.scope ?? "project",
    topic: typeof result.topic === "string" ? result.topic : "",
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    dataDir:
      typeof result.dataDir === "string"
        ? result.dataDir
        : memoryClient.config?.dataDir ?? "",
    filePath:
      typeof result.filePath === "string" ? result.filePath : memoryClient.config?.filePath,
    provider:
      typeof result.provider === "string" && result.provider.trim()
        ? result.provider
        : "memory",
    degraded: result.degraded === true,
    warning: typeof result.warning === "string" ? result.warning : undefined,
    error: typeof result.error === "string" ? result.error : undefined
  };
}

/**
 * @param {CliOptions} options
 * @param {AppDependencies} dependencies
 */
function getNotionClient(options, dependencies) {
  if (dependencies.notionClient) {
    return dependencies.notionClient;
  }

  return createNotionSyncClient({
    token: options["notion-token"],
    parentPageId: options["notion-page-id"],
    apiBaseUrl: options["notion-api-base-url"]
  });
}

/**
 * @param {CliOptions} options
 * @param {string} key
 * @param {boolean} [fallback]
 */
function booleanOption(options, key, fallback = false) {
  const value = options[key];

  if (value === undefined) {
    return fallback;
  }

  if (value !== "true" && value !== "false") {
    throw new Error(`Option --${key} must be true or false.`);
  }

  return value === "true";
}

/**
 * @param {string} value
 */
function normalizeScopePath(value) {
  return value
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} value
 */
function compactSignal(value) {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * @param {CliCommand} command
 * @param {CliOptions} options
 */
function resolveWorkspaceFocusSignal(command, options) {
  if (command === "select") {
    const signal = compactSignal(options.focus ?? "");
    return {
      signal,
      explicit: signal.length > 0
    };
  }

  if (command === "teach") {
    const signal = compactSignal(
      [options.focus, options.task, options.objective].filter(Boolean).join(" ")
    );

    return {
      signal,
      explicit: signal.length > 0
    };
  }

  if (command === "readme") {
    const signal = compactSignal(
      [options.focus, options.task, options.objective].filter(Boolean).join(" ")
    );

    return {
      signal,
      explicit: signal.length > 0
    };
  }

  return {
    signal: "",
    explicit: false
  };
}

/**
 * @param {string} candidatePath
 * @param {string[]} allowedScopePaths
 */
function isPathInScope(candidatePath, allowedScopePaths) {
  if (!allowedScopePaths.length) {
    return true;
  }

  const normalizedCandidate = normalizeScopePath(candidatePath);

  if (!normalizedCandidate || normalizedCandidate.startsWith("..")) {
    return false;
  }

  return allowedScopePaths.some((scopePath) => {
    const normalizedScope = normalizeScopePath(scopePath);

    if (!normalizedScope) {
      return false;
    }

    return (
      normalizedCandidate === normalizedScope ||
      normalizedCandidate.startsWith(`${normalizedScope}/`)
    );
  });
}

/**
 * @param {CliCommand} command
 * @param {CliOptions} options
 */
function isWriteModeCommand(command, options) {
  if (command === "sync-knowledge" || command === "remember" || command === "close") {
    return true;
  }

  if (command === "prune-memory") {
    return booleanOption(options, "apply", false);
  }

  if (command === "compact-memory") {
    return booleanOption(options, "apply", false);
  }

  if (command === "readme" || command === "ingest-security") {
    return Boolean(options.output);
  }

  return false;
}

/**
 * @param {CliCommand} command
 * @param {CliOptions} options
 * @param {NumericOptions | null} numeric
 * @param {LoadedConfigInfo} loadedConfig
 * @returns {{ blocked: boolean, reason: string, details: string[] }}
 */
function evaluateSafetyGate(command, options, numeric, loadedConfig) {
  const safety = loadedConfig.config.safety;
  const details = [];
  const maxTokenBudget = Math.max(1, Number(safety.maxTokenBudget || 0));

  if (numeric && numeric.tokenBudget > maxTokenBudget) {
    details.push(
      `token-budget ${numeric.tokenBudget} exceeds safety.maxTokenBudget ${maxTokenBudget}.`
    );
  }

  const writeMode = isWriteModeCommand(command, options);

  if (writeMode && safety.requirePlanForWrite && options["plan-approved"] !== "true") {
    details.push(
      "write-mode is blocked: add --plan-approved true or disable safety.requirePlanForWrite."
    );
  }

  const allowedScopePaths = Array.isArray(safety.allowedScopePaths)
    ? safety.allowedScopePaths.filter(Boolean)
    : [];

  if (allowedScopePaths.length > 0) {
    const changedFiles = listOption(options, "changed-files");
    const outputPath = options.output ? path.relative(process.cwd(), path.resolve(options.output)) : "";

    for (const changedFile of changedFiles) {
      if (!isPathInScope(changedFile, allowedScopePaths)) {
        details.push(`changed-file '${changedFile}' is outside safety.allowedScopePaths.`);
        break;
      }
    }

    if (outputPath && !isPathInScope(outputPath, allowedScopePaths)) {
      details.push(`output path '${outputPath}' is outside safety.allowedScopePaths.`);
    }
  }

  const workspaceScanMode =
    !options.input &&
    (Boolean(options.workspace) ||
      command === "readme" ||
      command === "teach" ||
      command === "select");
  const focusSignal = resolveWorkspaceFocusSignal(command, options);
  const minWorkspaceFocusLength = Math.max(1, Number(safety.minWorkspaceFocusLength || 1));
  const requireExplicitFocusForWorkspaceScan =
    safety.requireExplicitFocusForWorkspaceScan !== false;

  if (
    workspaceScanMode &&
    (command === "select" || command === "readme" || command === "teach")
  ) {
    if (requireExplicitFocusForWorkspaceScan && !focusSignal.explicit) {
      details.push(
        "workspace scan is blocked: add explicit --focus (or --task/--objective) to avoid low-signal full-repo scans."
      );
    } else if (focusSignal.signal.length > 0 && focusSignal.signal.length < minWorkspaceFocusLength) {
      details.push(
        `workspace scan focus is too short (${focusSignal.signal.length}); require at least ${minWorkspaceFocusLength} characters for stable selection.`
      );
    }
  }

  const debugEnabled = options.debug === "true";
  const debugFocusFloor = Math.max(minWorkspaceFocusLength, 30);

  if (
    debugEnabled &&
    workspaceScanMode &&
    safety.blockDebugWithoutStrongFocus !== false &&
    focusSignal.signal.length < debugFocusFloor
  ) {
    details.push(
      `debug run requires stronger focus (${debugFocusFloor}+ chars) to avoid high-cost noisy traces.`
    );
  }

  return {
    blocked: details.length > 0,
    reason: details.length > 0 ? "safety-gate" : "",
    details
  };
}

/**
 * @param {string} command
 * @returns {command is CliCommand}
 */
function isSupportedCommand(command) {
  return (
    command === "select" ||
    command === "teach" ||
    command === "readme" ||
    command === "recall" ||
    command === "remember" ||
    command === "close" ||
    command === "doctor" ||
    command === "doctor-memory" ||
    command === "memory-stats" ||
    command === "prune-memory" ||
    command === "compact-memory" ||
    command === "init" ||
    command === "sync-knowledge" ||
    command === "ingest-security" ||
    command === "ingest" ||
    command === "version" ||
    command === "shell"
  );
}

/**
 * @param {CliCommand} command
 * @param {CliOptions} rawOptions
 * @param {LoadedConfigInfo} loadedConfig
 * @returns {CliOptions}
 */
function applyConfigDefaults(command, rawOptions, loadedConfig) {
  const options = { ...rawOptions };
  const config = loadedConfig.config;

  if (!options.project) {
    options.project = config.memory.project || config.project || "";
  }

  if (!options.workspace && !options.input && config.workspace) {
    if (command === "select" || command === "teach" || command === "readme" || command === "shell") {
      options.workspace = config.workspace;
    }
  }

  if (!options["token-budget"]) {
    options["token-budget"] = String(config.selection.tokenBudget);
  }

  if (!options["max-chunks"]) {
    options["max-chunks"] = String(config.selection.maxChunks);
  }

  if (!options["min-score"]) {
    options["min-score"] = String(config.selection.minScore);
  }

  if (!options["sentence-budget"]) {
    options["sentence-budget"] = String(config.selection.sentenceBudget);
  }

  if (!options["memory-limit"]) {
    options["memory-limit"] = String(config.memory.limit);
  }

  if (!options["memory-scope"] && config.memory.scope) {
    options["memory-scope"] = config.memory.scope;
  }

  if (!options["memory-type"] && config.memory.type) {
    options["memory-type"] = config.memory.type;
  }

  if (!options["strict-recall"]) {
    options["strict-recall"] = String(config.memory.strictRecall);
  }

  if (!options["degraded-recall"]) {
    options["degraded-recall"] = String(config.memory.degradedRecall);
  }

  if (!options["auto-recall"]) {
    options["auto-recall"] = String(config.memory.autoRecall);
  }

  if (!options["auto-remember"]) {
    options["auto-remember"] = String(config.memory.autoRemember);
  }

  if (!options["memory-base-dir"]) {
    const fallbackBaseDir = defaultMemoryBaseDir();
    if (fallbackBaseDir) {
      options["memory-base-dir"] = fallbackBaseDir;
    }
  }

  if (!options["memory-fallback-file"]) {
    options["memory-fallback-file"] = defaultMemoryFallbackFile();
  }

  if (!options["memory-quarantine-dir"]) {
    const fallbackQuarantineDir = defaultMemoryQuarantineDir();
    if (fallbackQuarantineDir) {
      options["memory-quarantine-dir"] = fallbackQuarantineDir;
    }
  }

  if (!options["local-memory-fallback"]) {
    options["local-memory-fallback"] = "true";
  }

  if (!options["external-battery"]) {
    options["external-battery"] = "true";
  }

  if (!options["memory-backend"]) {
    options["memory-backend"] = config.memory.backend || "resilient";
  }

  if (!options["engram-bin"] && config.engram?.binaryPath) {
    options["engram-bin"] = config.engram.binaryPath;
  }

  if (!options["engram-data-dir"] && config.engram?.dataDir) {
    options["engram-data-dir"] = config.engram.dataDir;
  }

  if (!options.format && config.output.defaultFormat) {
    options.format = config.output.defaultFormat;
  }

  if (
    command === "teach" &&
    config.memory.enabled === false &&
    options["no-recall"] === undefined &&
    options["recall-query"] === undefined
  ) {
    options["no-recall"] = "true";
  }

  return options;
}

/**
 * @param {MemoryClientLike} memoryClient
 * @param {{
 *   query?: string,
 *   project?: string,
 *   type?: string,
 *   scope?: string,
 *   limit?: number,
 *   provider?: "memory" | "local"
 * }} input
 * @param {unknown} error
 * @returns {RecallCommandResult}
 */
function buildDegradedRecallResult(memoryClient, input, error) {
  const message = error instanceof Error ? error.message : String(error);
  const failureKind = classifyMemoryFailure(error);
  const fixHint = memoryFailureFixHint(failureKind);
  const provider = input.provider ?? "memory";
  const warning = `Memory backend '${provider}' unavailable; returning an empty recall result in degraded mode (${failureKind}).`;

  return {
    mode: input.query ? "search" : "context",
    project: input.project ?? "",
    query: input.query ?? "",
    type: input.type ?? "",
    scope: input.scope ?? "",
    limit: input.limit ?? null,
    stdout: "",
    stderr: "",
    dataDir: memoryClient.config?.dataDir ?? "",
    filePath: memoryClient.config?.filePath,
    provider,
    degraded: true,
    warning,
    error: message,
    failureKind,
    fixHint
  };
}

/**
 * @param {CliCommand | "help" | ""} command
 * @param {CliOptions} rawOptions
 * @returns {Promise<SafeLoadConfigResult>}
 */
async function safeLoadConfig(command, rawOptions) {
  try {
    return {
      loadedConfig: await loadProjectConfig({
        cwd: process.cwd(),
        explicitPath: rawOptions.config,
        workspaceHint: rawOptions.workspace
      }),
      configLoadError: ""
    };
  } catch (error) {
    if (command !== "doctor") {
      throw error;
    }

    return {
      loadedConfig: {
        found: false,
        path: rawOptions.config ?? "",
        config: defaultProjectConfig()
      },
      configLoadError: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {string[]} argv
 * @param {AppDependencies} [dependencies]
 */
export async function runCli(argv, dependencies = {}) {
  const startedAt = Date.now();
  const { command, options: rawOptions } = parseArgv(argv);

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    rawOptions.help === "true"
  ) {
    return {
      exitCode: 0,
      stdout: usageText()
    };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    const format = rawOptions.format === "json" ? "json" : "text";
    const metric = buildCommandMetric("version", startedAt);
    await safeRecordCommandMetric(metric);

    return {
      exitCode: 0,
      stdout:
        format === "json"
          ? serialize(
              buildCliJsonContract(
                "version",
                {
                  version: CLI_VERSION,
                  observability: buildObservabilityEvent(metric)
                },
                buildRuntimeMeta(startedAt)
              )
            )
          : `learning-context-system ${CLI_VERSION}`
    };
  }

  if (!isSupportedCommand(command)) {
    return {
      exitCode: 1,
      stderr: `Unknown command '${command}'.\n\n${usageText()}`
    };
  }

  if (command === "init") {
    const result = await initProjectConfig({
      cwd: process.cwd(),
      configPath: rawOptions.config,
      force: rawOptions.force === "true"
    });
    const format = rawOptions.format === "json" ? "json" : "text";
    const metric = buildCommandMetric("init", startedAt);
    await safeRecordCommandMetric(metric);

    return {
      exitCode: 0,
      stdout:
        format === "json"
          ? serialize(
              buildCliJsonContract(
                "init",
                {
                  ...result,
                  observability: buildObservabilityEvent(metric)
                },
                buildRuntimeMeta(startedAt)
              )
            )
          : formatInitResultAsText(result)
    };
  }

  const { loadedConfig, configLoadError } = await safeLoadConfig(command, rawOptions);

  if (command === "doctor") {
    const result = await runProjectDoctor({
      cwd: process.cwd(),
      configInfo: loadedConfig,
      configError: configLoadError
    });
    const format = rawOptions.format === "json" ? "json" : "text";
    const metric = buildCommandMetric("doctor", startedAt, {
      degraded: result.summary.fail > 0
    });
    await safeRecordCommandMetric(metric);
    const observabilityReport = await getObservabilityReport();

    return {
      exitCode: result.summary.fail ? 1 : 0,
      stdout:
        format === "json"
          ? serialize(
              buildCliJsonContract("doctor", { ...result, observability: observabilityReport }, {
                status: result.summary.fail ? "error" : "ok",
                configFound: loadedConfig.found,
                configPath: loadedConfig.path,
                ...buildRuntimeMeta(startedAt)
              })
            )
          : formatDoctorResultAsText(result)
    };
  }

  const options = applyConfigDefaults(command, rawOptions, loadedConfig);
  const debugEnabled = options.debug === "true";
  const defaultFormat =
    command === "readme" ||
    command === "recall" ||
    command === "remember" ||
    command === "close" ||
    command === "doctor-memory" ||
    command === "prune-memory" ||
    command === "sync-knowledge" ||
    command === "ingest-security" ||
    command === "ingest" ||
    command === "shell"
      ? "text"
      : "json";
  const format =
    options.format === "json" ? "json" : options.format === "text" ? "text" : defaultFormat;
  const numericForSafety =
    command === "select" || command === "readme" || command === "teach"
      ? readNumericOptions(options)
      : null;
  const safetyGate = evaluateSafetyGate(command, options, numericForSafety, loadedConfig);

  if (safetyGate.blocked) {
    const metric = buildCommandMetric(command, startedAt, {
      degraded: true,
      safety: {
        blocked: true,
        reason: safetyGate.reason,
        preventedError: true
      }
    });
    await safeRecordCommandMetric(metric);
    const lines = [
      `Safety gate blocked command '${command}'.`,
      ...safetyGate.details.map((detail) => `- ${detail}`)
    ];

    if (format === "json") {
      return {
        exitCode: 1,
        stdout: serializeCommandResult(
          command,
          {
            action: "blocked",
            reason: safetyGate.reason,
            details: safetyGate.details,
            observability: buildObservabilityEvent(metric)
          },
          format,
          loadedConfig,
          {
            status: "error",
            degraded: true,
            warnings: safetyGate.details,
            ...buildRuntimeMeta(startedAt)
          }
        )
      };
    }

    return {
      exitCode: 1,
      stderr: lines.join("\n")
    };
  }

  // ── Guard Gate ──────────────────────────────────────────────────────
  // Evaluates configurable guard rules BEFORE any command touches memory
  // or the recall pipeline. The guard is the second gate after safety —
  // safety checks structural limits (token budget, focus length), while
  // the guard checks semantic content (injection, domain scope, rate).
  //
  // Only commands that accept user-provided queries need guarding:
  //   - recall (--query)
  //   - teach (--task / --objective / --focus)
  //   - ingest (document content flows through, but the command itself
  //            doesn't take a user query — skip for now)
  //
  // The guard config comes from learning-context.config.json → guard {}
  // If guard.enabled is false (default), this is a no-op pass-through.

  const guardApplicableCommands = ["recall", "teach"];

  if (guardApplicableCommands.includes(command)) {
    const guardQuery =
      command === "recall"
        ? options.query || ""
        : [options.task, options.objective, options.focus].filter(Boolean).join(" ");

    if (guardQuery.length > 0) {
      /** @type {import("../types/core-contracts.d.ts").GuardInput} */
      const guardInput = {
        query: guardQuery,
        project: options.project || loadedConfig.config.project || "",
        command
      };

      /** @type {import("../types/core-contracts.d.ts").GuardConfig} */
      const guardConfig = {
        enabled: loadedConfig.config.guard?.enabled ?? false,
        rules: loadedConfig.config.guard?.rules ?? [],
        defaultBlockMessage:
          loadedConfig.config.guard?.defaultBlockMessage ??
          "This query is outside the scope of this project."
      };

      const guardResult = evaluateGuard(guardInput, guardConfig);

      if (guardResult.blocked) {
        const metric = buildCommandMetric(command, startedAt, {
          degraded: true,
          safety: {
            blocked: true,
            reason: `guard:${guardResult.blockedBy}`,
            preventedError: true
          }
        });
        await safeRecordCommandMetric(metric);

        if (format === "json") {
          return {
            exitCode: 1,
            stdout: serializeCommandResult(
              command,
              {
                action: "blocked",
                reason: `guard:${guardResult.blockedBy}`,
                message: guardResult.userMessage,
                guard: {
                  blocked: guardResult.blocked,
                  blockedBy: guardResult.blockedBy,
                  results: guardResult.results,
                  durationMs: guardResult.durationMs
                }
              },
              format,
              loadedConfig,
              {
                status: "error",
                degraded: true,
                warnings: [guardResult.userMessage],
                ...buildRuntimeMeta(startedAt)
              }
            )
          };
        }

        return {
          exitCode: 1,
          stderr: formatGuardResultAsText(guardResult)
        };
      }
    }
  }

  if (command === "sync-knowledge") {
    const notion = getNotionClient(options, dependencies);
    const result = await notion.appendKnowledgeEntry({
      title: requireOption(options, "title"),
      content: getContentOption(options),
      project: options.project,
      source: options.source,
      tags: listOption(options, "tags")
    });
    const metric = buildCommandMetric("sync-knowledge", startedAt);
    await safeRecordCommandMetric(metric);
    const payload = {
      ...result,
      observability: buildObservabilityEvent(metric)
    };

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatNotionSyncAsText(payload)
          : serializeCommandResult(
              "sync-knowledge",
              payload,
              format,
              loadedConfig,
              buildRuntimeMeta(startedAt)
            )
    };
  }

  if (command === "doctor-memory") {
    const result = await runMemoryDoctor({
      cwd: process.cwd(),
      project: options.project,
      baseDir: options["memory-base-dir"]
    });
    const degraded = result.summary.quarantineCandidates > 0;
    const metric = buildCommandMetric("doctor-memory", startedAt, { degraded });
    await safeRecordCommandMetric(metric);
    const payload = {
      ...result,
      observability: buildObservabilityEvent(metric)
    };

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryDoctorAsText(result)
          : serializeCommandResult(
              "doctor-memory",
              payload,
              format,
              loadedConfig,
              {
                degraded,
                warnings:
                  degraded && result.summary.quarantineCandidates > 0
                    ? [`${result.summary.quarantineCandidates} memory entries need quarantine review.`]
                    : [],
                ...buildRuntimeMeta(startedAt)
              }
            )
    };
  }

  if (command === "memory-stats") {
    const result = await runMemoryStats({
      cwd: process.cwd(),
      project: options.project,
      baseDir: options["memory-base-dir"]
    });
    const degraded =
      result.metrics.noiseRate > 0 || result.metrics.candidateRate > 0 || result.metrics.quarantineRate > 0;
    const metric = buildCommandMetric("memory-stats", startedAt, { degraded });
    await safeRecordCommandMetric(metric);
    const payload = {
      ...result,
      observability: buildObservabilityEvent(metric)
    };

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryStatsAsText(result)
          : serializeCommandResult(
              "memory-stats",
              payload,
              format,
              loadedConfig,
              {
                degraded,
                warnings:
                  degraded
                    ? [
                        `Memory health avg=${result.metrics.averageHealthScore}, candidateRate=${result.metrics.candidateRate}, noiseRate=${result.metrics.noiseRate}.`
                      ]
                    : [],
                ...buildRuntimeMeta(startedAt)
              }
            )
    };
  }

  if (command === "prune-memory") {
    const apply = booleanOption(options, "apply", false);
    const pruneResult = await runMemoryPrune({
      cwd: process.cwd(),
      project: options.project,
      baseDir: options["memory-base-dir"],
      quarantineDir: options["memory-quarantine-dir"],
      apply
    });
    const degraded = pruneResult.summary.candidates > 0;
    const metric = buildCommandMetric("prune-memory", startedAt, { degraded });
    await safeRecordCommandMetric(metric);
    const payload = {
      ...pruneResult,
      observability: buildObservabilityEvent(metric)
    };

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryPruneAsText(pruneResult)
          : serializeCommandResult(
              "prune-memory",
              payload,
              format,
              loadedConfig,
              {
                degraded,
                warnings:
                  pruneResult.summary.candidates > 0
                    ? apply
                      ? [`${pruneResult.summary.moved} memory entries moved to quarantine.`]
                      : [`${pruneResult.summary.candidates} memory entries would move to quarantine.`]
                    : [],
                ...buildRuntimeMeta(startedAt)
              }
            )
    };
  }

  if (command === "compact-memory") {
    const apply = booleanOption(options, "apply", false);
    const compactResult = await runMemoryCompact({
      cwd: process.cwd(),
      project: options.project,
      topic: options.topic,
      baseDir: options["memory-base-dir"],
      quarantineDir: options["memory-quarantine-dir"],
      apply
    });
    const degraded = compactResult.summary.groups > 0;
    const metric = buildCommandMetric("compact-memory", startedAt, { degraded });
    await safeRecordCommandMetric(metric);
    const payload = {
      ...compactResult,
      observability: buildObservabilityEvent(metric)
    };

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryCompactAsText(compactResult)
          : serializeCommandResult(
              "compact-memory",
              payload,
              format,
              loadedConfig,
              {
                degraded,
                warnings:
                  compactResult.summary.groups > 0
                    ? apply
                      ? [`${compactResult.summary.created} compacted memory entries created.`]
                      : [`${compactResult.summary.groups} compaction group(s) available.`]
                    : [],
                ...buildRuntimeMeta(startedAt)
              }
            )
    };
  }

  if (command === "ingest") {
    const source = requireOption(options, "source");
    const sourcePath = requireOption(options, "path");
    const project = options.project || "";
    const dryRun = booleanOption(options, "dry-run", false);
    const memoryClient = /** @type {MemoryClientLike} */ (getMemoryClient(options, dependencies));

    const ingestResult = await runIngestCommand(
      {
        source,
        path: sourcePath,
        project,
        dryRun,
        security: loadedConfig.config.security
      },
      /** @type {any} */ (memoryClient)
    );

    const metric = buildCommandMetric("ingest", startedAt, {
      selection: {
        selectedCount: ingestResult.savedChunks,
        suppressedCount: ingestResult.failedSaves
      }
    });
    await safeRecordCommandMetric(metric);
    const payload = {
      ...ingestResult,
      observability: buildObservabilityEvent(metric)
    };

    return {
      exitCode: ingestResult.failedSaves > 0 && ingestResult.savedChunks === 0 ? 1 : 0,
      stdout:
        format === "text"
          ? formatIngestResultAsText(ingestResult)
          : serializeCommandResult(
              "ingest",
              payload,
              format,
              loadedConfig,
              buildRuntimeMeta(startedAt)
            )
    };
  }

  if (command === "ingest-security") {
    const statusFilter = normalizeProwlerStatusFilter(
      options["status-filter"] ?? DEFAULT_PROWLER_STATUS_FILTER
    );
    const maxFindings = assertNumberRules(
      numberOption(options, "max-findings", DEFAULT_PROWLER_MAX_FINDINGS),
      "max-findings",
      {
        min: 1,
        integer: true
      }
    );
    const ingest = await ingestProwlerFile(requireOption(options, "input"), {
      statusFilter,
      maxFindings
    });
    const chunkFile = {
      chunks: ingest.chunks
    };
    const outputPath = options.output
      ? await writeTextFile(options.output, `${serialize(chunkFile)}\n`)
      : "";
    const metric = buildCommandMetric("ingest-security", startedAt, {
      selection: {
        selectedCount: ingest.includedFindings,
        suppressedCount: ingest.skippedFindings
      }
    });
    await safeRecordCommandMetric(metric);
    const payload = {
      input: ingest.inputPath,
      output: outputPath,
      detectedFormat: ingest.detectedFormat,
      statusFilter: ingest.statusFilter,
      maxFindings: ingest.maxFindings,
      totalFindings: ingest.totalFindings,
      includedFindings: ingest.includedFindings,
      discardedFindings: ingest.discardedFindings,
      skippedFindings: ingest.skippedFindings,
      redactedFindings: ingest.redactedFindings,
      redactionCountTotal: ingest.redactionCountTotal,
      chunkFile,
      observability: buildObservabilityEvent(metric)
    };

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatSecurityIngestAsText(payload)
          : serializeCommandResult(
              "ingest-security",
              payload,
              format,
              loadedConfig,
              buildRuntimeMeta(startedAt)
            )
    };
  }

  if (command === "recall") {
    const memoryBackend = parseMemoryBackendMode(options["memory-backend"]);
    const memoryClient = /** @type {MemoryClientLike} */ (getMemoryClient(options, dependencies));
    const project = options.project;
    const query = options.query;
    const type = options.type;
    const scope = options.scope;
    const limit =
      query !== undefined
        ? assertNumberRules(numberOption(options, "limit", 5), "limit", {
            min: 1,
            integer: true
          })
        : undefined;
    const allowDegradedRecall = booleanOption(
      options,
      "degraded-recall",
      loadedConfig.config.memory.degradedRecall
    );
    let result;
    let degraded = false;
    /** @type {string[]} */
    const warnings = [];

    try {
      result = /** @type {RecallCommandResult} */ (
        query
          ? await searchMemoryClient(memoryClient, query, {
              project,
              type,
              scope,
              limit
            })
          : await memoryClient.recallContext(project)
      );
      degraded = result?.degraded === true;

      if (result?.warning) {
        warnings.push(result.warning);
      }
    } catch (error) {
      if (!allowDegradedRecall) {
        throw error;
      }

      degraded = true;
      result = buildDegradedRecallResult(
        memoryClient,
        {
          query,
          project,
          type,
          scope,
          limit,
          provider: memoryBackend === "local-only" ? "local" : "memory"
        },
        error
      );
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    const recoveredChunks =
      query && result.entries
        ? result.entries.length
        : query && result.stdout?.trim()
          ? 1
          : 0;
    const recallStatus = degraded
      ? result?.provider === "local"
        ? query
          ? recoveredChunks > 0
            ? "recalled-fallback"
            : "empty-fallback"
          : "context-fallback"
        : "failed-degraded"
      : query
        ? recoveredChunks > 0
          ? "recalled"
          : "empty"
        : "context";
    const metric = buildCommandMetric("recall", startedAt, {
      degraded,
      recall: {
        attempted: true,
        status: recallStatus,
        recoveredChunks,
        selectedChunks: 0,
        suppressedChunks: 0,
        hit: query ? recoveredChunks > 0 : Boolean(result.stdout?.trim())
      }
    });
    await safeRecordCommandMetric(metric);

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryRecallAsText(result, { debug: debugEnabled })
          : serializeCommandResult(
              "recall",
              {
                ...result,
                observability: buildObservabilityEvent(metric)
              },
              format,
              loadedConfig,
              {
                degraded,
                warnings,
                ...buildRuntimeMeta(startedAt, { debug: debugEnabled })
              }
            )
    };
  }

  if (command === "remember") {
    const memoryClient = /** @type {MemoryClientLike} */ (getMemoryClient(options, dependencies));
    const writeInput = {
      title: requireOption(options, "title"),
      content: getContentOption(options),
      type: options.type ?? "learning",
      project: options.project,
      scope: options.scope ?? "project",
      topic: options.topic
    };
    const hygiene = evaluateMemoryWrite({
      ...writeInput,
      sourceKind: "manual"
    });
    const result = /** @type {MemoryWriteCommandResult & Record<string, unknown>} */ (
      hygiene.action === "quarantine"
        ? await quarantineMemoryWrite({
            cwd: process.cwd(),
            quarantineDir: options["memory-quarantine-dir"],
            ...writeInput,
            sourceKind: "manual",
            reasons: hygiene.reasons
          })
        : await saveMemoryClient(memoryClient, {
            ...writeInput,
            ...buildAcceptedMemoryMetadata(hygiene, { sourceKind: "manual" })
          })
    );
    const degraded = result?.degraded === true;
    /** @type {string[]} */
    const warnings = [];

    if (result?.warning) {
      warnings.push(result.warning);
    }

    if (hygiene.action === "quarantine") {
      warnings.push(`Memory write quarantined by hygiene gate (${hygiene.reasons.join(", ")}).`);
      result.memoryStatus = "quarantined";
      result.reviewStatus = "quarantined";
      result.reasons = hygiene.reasons;
    } else {
      Object.assign(result, buildAcceptedMemoryMetadata(hygiene, { sourceKind: "manual" }));
      result.memoryStatus = "accepted";
      result.reviewStatus = hygiene.reviewStatus;
      result.reasons = hygiene.reasons;
    }

    const metric = buildCommandMetric("remember", startedAt, { degraded });
    await safeRecordCommandMetric(metric);
    const rememberPayload = /** @type {Record<string, unknown>} */ ({
      ...result,
      observability: buildObservabilityEvent(metric)
    });
    delete rememberPayload.warnings;

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryWriteAsText(result, "Memory saved")
          : serializeCommandResult(
              "remember",
              rememberPayload,
              format,
              loadedConfig,
              {
                degraded,
                warnings,
                ...buildRuntimeMeta(startedAt)
              }
            )
    };
  }

  if (command === "close") {
    const memoryClient = /** @type {MemoryClientLike} */ (getMemoryClient(options, dependencies));
    const closeInput = {
      summary: requireOption(options, "summary"),
      learned: options.learned,
      next: options.next,
      title: options.title,
      project: options.project,
      scope: options.scope ?? "project",
      type: options.type ?? "learning"
    };
    const closePreviewTitle = closeInput.title ?? `Session close - ${new Date().toISOString().slice(0, 10)}`;
    const closePreviewContent = buildCloseSummaryContent({
      summary: closeInput.summary,
      learned: closeInput.learned,
      next: closeInput.next,
      workspace: process.cwd(),
      closedAt: new Date().toISOString()
    });
    const hygiene = evaluateMemoryWrite({
      title: closePreviewTitle,
      content: closePreviewContent,
      type: closeInput.type,
      project: closeInput.project,
      scope: closeInput.scope,
      topic: "",
      sourceKind: "close"
    });
    const result = /** @type {MemoryWriteCommandResult & Record<string, unknown>} */ (
      hygiene.action === "quarantine"
        ? await quarantineMemoryWrite({
            cwd: process.cwd(),
            quarantineDir: options["memory-quarantine-dir"],
            title: closePreviewTitle,
            content: closePreviewContent,
            type: closeInput.type,
            project: closeInput.project,
            scope: closeInput.scope,
            sourceKind: "close",
            reasons: hygiene.reasons
          })
        : await closeMemoryClient(memoryClient, {
            ...closeInput,
            ...buildAcceptedMemoryMetadata(hygiene, { sourceKind: "close" })
          })
    );
    const degraded = result?.degraded === true;
    /** @type {string[]} */
    const warnings = [];

    if (result?.warning) {
      warnings.push(result.warning);
    }

    if (hygiene.action === "quarantine") {
      warnings.push(`Session close quarantined by hygiene gate (${hygiene.reasons.join(", ")}).`);
      result.summary = closeInput.summary;
      result.learned = closeInput.learned ?? "";
      result.next = closeInput.next ?? "";
      result.memoryStatus = "quarantined";
      result.reviewStatus = "quarantined";
      result.reasons = hygiene.reasons;
    } else {
      Object.assign(result, buildAcceptedMemoryMetadata(hygiene, { sourceKind: "close" }));
      result.memoryStatus = "accepted";
      result.reviewStatus = hygiene.reviewStatus;
      result.reasons = hygiene.reasons;
    }

    const metric = buildCommandMetric("close", startedAt, { degraded });
    await safeRecordCommandMetric(metric);
    const closePayload = /** @type {Record<string, unknown>} */ ({
      ...result,
      observability: buildObservabilityEvent(metric)
    });
    delete closePayload.warnings;

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryWriteAsText(result, "Session close note saved")
          : serializeCommandResult(
              "close",
              closePayload,
              format,
              loadedConfig,
              {
                degraded,
                warnings,
                ...buildRuntimeMeta(startedAt)
              }
            )
    };
  }

  if (command === "shell") {
    const shellResult = await runShellCommand({
      options,
      runCli: async (childArgv) => runCli(childArgv, dependencies),
      usageText,
      cwd: process.cwd()
    });
    const metric = buildCommandMetric("shell", startedAt);
    await safeRecordCommandMetric(metric);

    return shellResult;
  }

  const source = await loadChunkSource(command, options, loadedConfig);
  const { payload, path, stats } = source;
  const numeric = numericForSafety ?? readNumericOptions(options);

  if (command === "select") {
    const focus = requireOption(options, "focus");
    const result = selectContextWindow(payload.chunks, {
      focus,
      tokenBudget: numeric.tokenBudget,
      maxChunks: numeric.maxChunks,
      sentenceBudget: numeric.sentenceBudget,
      minScore: numeric.minScore
    });
    const selectionResult = {
      ...result,
      ...(stats ? { scanStats: stats } : {})
    };
    const metric = buildCommandMetric("select", startedAt, {
      selection: {
        selectedCount: result.summary.selectedCount,
        suppressedCount: result.summary.suppressedCount
      }
    });
    await safeRecordCommandMetric(metric);

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatSelectionAsText(selectionResult, { debug: debugEnabled })
          : serializeCommandResult(
              "select",
              {
                input: path,
                observability: buildObservabilityEvent(metric),
                ...selectionResult
              },
              format,
              loadedConfig,
              buildRuntimeMeta(startedAt, { debug: debugEnabled, scanStats: stats ?? null })
            )
    };
  }

  if (command === "readme") {
    const { buildLearningReadme } = await import("../analysis/readme-generator.js");
    const task = options.task;
    const objective = options.objective;
    const focus =
      options.focus ?? `${task ?? ""} ${objective ?? ""} understand code dependencies concepts`.trim();
    const result = await buildLearningReadme({
      title: options.title || "README.LEARN",
      task,
      objective,
      focus,
      projectRoot: options.workspace || ".",
      chunks: payload.chunks,
      tokenBudget: numeric.tokenBudget,
      maxChunks: numeric.maxChunks,
      minScore: numeric.minScore,
      sentenceBudget: numeric.sentenceBudget
    });
    const metric = buildCommandMetric("readme", startedAt, {
      selection: {
        selectedCount: result.packet?.diagnostics?.summary?.selectedCount ?? 0,
        suppressedCount: result.packet?.diagnostics?.summary?.suppressedCount ?? 0
      }
    });
    await safeRecordCommandMetric(metric);

    if (options.output) {
      const writtenPath = await writeTextFile(options.output, result.markdown);
      return {
        exitCode: 0,
        stdout:
          format === "json"
            ? serializeCommandResult(
                "readme",
                {
                  input: path,
                  output: writtenPath,
                  scanStats: stats ?? null,
                  observability: buildObservabilityEvent(metric),
                  ...result
                },
                format,
                loadedConfig,
                buildRuntimeMeta(startedAt, { scanStats: stats ?? null })
              )
            : `README generated at ${writtenPath}`
      };
    }

    return {
      exitCode: 0,
      stdout:
        format === "json"
          ? serializeCommandResult(
            "readme",
            {
              input: path,
              scanStats: stats ?? null,
              observability: buildObservabilityEvent(metric),
              ...result
            },
            format,
              loadedConfig,
              buildRuntimeMeta(startedAt, { scanStats: stats ?? null })
            )
          : result.markdown
    };
  }

  const teachMemoryClient = /** @type {MemoryClientLike} */ (getMemoryClient(options, dependencies));
  const teachResult = await runTeachCommand({
    options,
    loadedConfig,
    source: {
      path,
      payload,
      stats
    },
    numeric,
    format,
    debugEnabled,
    startedAt,
    dependencies: {
      ...dependencies,
      memoryClient: /** @type {any} */ (teachMemoryClient)
    },
    serializeCommandResult,
    buildRuntimeMeta
  });

  const teachMetric = buildCommandMetric("teach", startedAt, teachResult.metrics ?? {});
  await safeRecordCommandMetric(teachMetric);

  return {
    exitCode: teachResult.exitCode,
    stdout: teachResult.stdout
  };
}
