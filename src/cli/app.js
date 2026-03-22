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
import { createEngramClient, searchOutputToChunks } from "../memory/engram-client.js";
import { createLocalMemoryStore } from "../memory/local-memory-store.js";
import {
  classifyMemoryFailure,
  createResilientMemoryClient,
  memoryFailureFixHint
} from "../memory/resilient-memory-client.js";
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
  formatMemoryRecallAsText,
  formatMemoryWriteAsText,
  formatNotionSyncAsText,
  formatSecurityIngestAsText,
  formatSelectionAsText,
  usageText
} from "./formatters.js";
import { runTeachCommand } from "./teach-command.js";
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
 * @typedef {"resilient" | "engram-only" | "local-only"} MemoryBackendMode
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
 *   recallContext: (project?: string) => Promise<Record<string, unknown> & { stdout?: string }>,
 *   searchMemories: (
 *     query: string,
 *     options?: { project?: string, scope?: string, type?: string, limit?: number }
 *   ) => Promise<Record<string, unknown> & { stdout: string }>,
 *   saveMemory: (input: {
 *     title: string,
 *     content: string,
 *     type?: string,
   *     project?: string,
   *     scope?: string,
   *     topic?: string
 *   }) => Promise<Record<string, unknown>>,
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
 * @typedef {{
 *   engramClient?: MemoryClientLike,
 *   localMemoryClient?: MemoryClientLike,
 *   notionClient?: ReturnType<typeof createNotionSyncClient>
 * }} AppDependencies
 */

/**
 * @typedef {"select" | "teach" | "readme" | "recall" | "remember" | "close" | "doctor" | "init" | "sync-knowledge" | "ingest-security" | "version"} CliCommand
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

  if (value === "resilient" || value === "engram-only" || value === "local-only") {
    return value;
  }

  throw new Error(
    "Option --memory-backend must be one of: resilient, engram-only, local-only."
  );
}

/**
 * @param {CliOptions} options
 * @param {AppDependencies} dependencies
 * @returns {MemoryClientLike}
 */
function getEngramClient(options, dependencies) {
  if (dependencies.engramClient) {
    return dependencies.engramClient;
  }

  return createEngramClient({
    binaryPath: options["engram-bin"],
    dataDir: options["engram-data-dir"]
  });
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
    filePath: options["memory-fallback-file"]
  });
}

/**
 * @param {CliOptions} options
 * @param {AppDependencies} dependencies
 */
function getMemoryClient(options, dependencies) {
  const backendMode = parseMemoryBackendMode(options["memory-backend"]);

  if (backendMode !== "local-only" && dependencies.engramClient && !dependencies.localMemoryClient) {
    return dependencies.engramClient;
  }

  if (backendMode === "local-only") {
    return getLocalMemoryClient(options, dependencies);
  }

  const primary = getEngramClient(options, dependencies);

  if (backendMode === "engram-only") {
    return primary;
  }

  const fallback = getLocalMemoryClient(options, dependencies);
  const fallbackEnabled = booleanOption(options, "local-memory-fallback", true);

  if (!fallbackEnabled) {
    return primary;
  }

  return createResilientMemoryClient({
    primary,
    fallback,
    enabled: true
  });
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
    command === "init" ||
    command === "sync-knowledge" ||
    command === "ingest-security" ||
    command === "version"
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
    if (command === "select" || command === "teach" || command === "readme") {
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

  if (!options["engram-bin"] && config.engram.binaryPath) {
    options["engram-bin"] = config.engram.binaryPath;
  }

  if (!options["engram-data-dir"] && config.engram.dataDir) {
    options["engram-data-dir"] = config.engram.dataDir;
  }

  if (!options["memory-fallback-file"]) {
    options["memory-fallback-file"] = ".lcs/local-memory-store.jsonl";
  }

  if (!options["local-memory-fallback"]) {
    options["local-memory-fallback"] = "true";
  }

  if (!options["memory-backend"]) {
    options["memory-backend"] = config.memory.backend || "resilient";
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
 *   provider?: "engram" | "local"
 * }} input
 * @param {unknown} error
 * @returns {RecallCommandResult}
 */
function buildDegradedRecallResult(memoryClient, input, error) {
  const message = error instanceof Error ? error.message : String(error);
  const failureKind = classifyMemoryFailure(error);
  const fixHint = memoryFailureFixHint(failureKind);
  const provider = input.provider ?? "engram";
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
    command === "sync-knowledge" ||
    command === "ingest-security"
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
    const memoryClient = getMemoryClient(options, dependencies);
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
          ? await memoryClient.searchMemories(query, {
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
          provider: memoryBackend === "local-only" ? "local" : "engram"
        },
        error
      );
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    const recoveredChunks =
      query && result.stdout
        ? searchOutputToChunks(result.stdout, { query, project }).length
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
    const memoryClient = getMemoryClient(options, dependencies);
    const result = /** @type {MemoryWriteCommandResult} */ (
      await memoryClient.saveMemory({
        title: requireOption(options, "title"),
        content: getContentOption(options),
        type: options.type ?? "learning",
        project: options.project,
        scope: options.scope ?? "project",
        topic: options.topic
      })
    );
    const degraded = result?.degraded === true;
    /** @type {string[]} */
    const warnings = [];

    if (result?.warning) {
      warnings.push(result.warning);
    }

    const metric = buildCommandMetric("remember", startedAt, { degraded });
    await safeRecordCommandMetric(metric);

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryWriteAsText(result, "Memory saved")
          : serializeCommandResult(
              "remember",
              {
                ...result,
                observability: buildObservabilityEvent(metric)
              },
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
    const memoryClient = getMemoryClient(options, dependencies);
    const result = /** @type {MemoryWriteCommandResult} */ (
      await memoryClient.closeSession({
        summary: requireOption(options, "summary"),
        learned: options.learned,
        next: options.next,
        title: options.title,
        project: options.project,
        scope: options.scope ?? "project",
        type: options.type ?? "learning"
      })
    );
    const degraded = result?.degraded === true;
    /** @type {string[]} */
    const warnings = [];

    if (result?.warning) {
      warnings.push(result.warning);
    }

    const metric = buildCommandMetric("close", startedAt, { degraded });
    await safeRecordCommandMetric(metric);

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryWriteAsText(result, "Session close note saved")
          : serializeCommandResult(
              "close",
              {
                ...result,
                observability: buildObservabilityEvent(metric)
              },
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

  const teachMemoryClient = getMemoryClient(options, dependencies);
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
      engramClient: teachMemoryClient
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
