// @ts-check

import { buildCliJsonContract } from "../contracts/cli-contracts.js";
import { defaultProjectConfig } from "../contracts/config-contracts.js";
import { selectContextWindow } from "../context/noise-canceler.js";
import { loadProjectConfig } from "../io/config-file.js";
import { loadChunkFile } from "../io/json-file.js";
import { writeTextFile } from "../io/text-file.js";
import { loadWorkspaceChunks } from "../io/workspace-chunks.js";
import { buildLearningPacket } from "../learning/mentor-loop.js";
import { createEngramClient } from "../memory/engram-client.js";
import { resolveTeachRecall } from "../memory/teach-recall.js";
import { initProjectConfig, runProjectDoctor } from "../system/project-ops.js";
import {
  formatDoctorResultAsText,
  formatInitResultAsText,
  formatLearningPacketAsText,
  formatMemoryRecallAsText,
  formatMemoryWriteAsText,
  formatSelectionAsText,
  usageText
} from "./formatters.js";
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
 *   engramClient?: ReturnType<typeof createEngramClient>
 * }} AppDependencies
 */

/**
 * @typedef {"select" | "teach" | "readme" | "recall" | "remember" | "close" | "doctor" | "init"} CliCommand
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
 *   degraded?: boolean,
 *   warning?: string,
 *   error?: string
 * }} RecallCommandResult
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
      security: loadedConfig?.config.security
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
 * @param {CliOptions} options
 * @param {AppDependencies} dependencies
 * @returns {ReturnType<typeof createEngramClient>}
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
    command === "init"
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

  if (!options["engram-bin"] && config.engram.binaryPath) {
    options["engram-bin"] = config.engram.binaryPath;
  }

  if (!options["engram-data-dir"] && config.engram.dataDir) {
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
 * @param {ReturnType<typeof createEngramClient>} engram
 * @param {{ query?: string, project?: string, type?: string, scope?: string, limit?: number }} input
 * @param {unknown} error
 * @returns {RecallCommandResult}
 */
function buildDegradedRecallResult(engram, input, error) {
  const message = error instanceof Error ? error.message : String(error);
  const warning = "Engram unavailable; returning an empty recall result in degraded mode.";

  return {
    mode: input.query ? "search" : "context",
    project: input.project ?? "",
    query: input.query ?? "",
    type: input.type ?? "",
    scope: input.scope ?? "",
    limit: input.limit ?? null,
    stdout: "",
    stderr: "",
    dataDir: engram.config?.dataDir ?? "",
    degraded: true,
    warning,
    error: message
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

  if (!command || command === "help" || rawOptions.help === "true") {
    return {
      exitCode: 0,
      stdout: usageText()
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

    return {
      exitCode: 0,
      stdout:
        format === "json"
          ? serialize(
              buildCliJsonContract("init", result, buildRuntimeMeta(startedAt))
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

    return {
      exitCode: result.summary.fail ? 1 : 0,
      stdout:
        format === "json"
          ? serialize(
              buildCliJsonContract("doctor", result, {
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
    command === "close"
      ? "text"
      : "json";
  const format =
    options.format === "json" ? "json" : options.format === "text" ? "text" : defaultFormat;

  if (command === "recall") {
    const engram = getEngramClient(options, dependencies);
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
      result = query
        ? await engram.searchMemories(query, {
            project,
            type,
            scope,
            limit
          })
        : await engram.recallContext(project);
    } catch (error) {
      if (!allowDegradedRecall) {
        throw error;
      }

      degraded = true;
      result = buildDegradedRecallResult(
        engram,
        {
          query,
          project,
          type,
          scope,
          limit
        },
        error
      );
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryRecallAsText(result, { debug: debugEnabled })
          : serializeCommandResult("recall", result, format, loadedConfig, {
              degraded,
              warnings,
              ...buildRuntimeMeta(startedAt, { debug: debugEnabled })
            })
    };
  }

  if (command === "remember") {
    const engram = getEngramClient(options, dependencies);
    const result = await engram.saveMemory({
      title: requireOption(options, "title"),
      content: getContentOption(options),
      type: options.type ?? "learning",
      project: options.project,
      scope: options.scope ?? "project",
      topic: options.topic
    });

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryWriteAsText(result, "Memory saved")
          : serializeCommandResult("remember", result, format, loadedConfig, buildRuntimeMeta(startedAt))
    };
  }

  if (command === "close") {
    const engram = getEngramClient(options, dependencies);
    const result = await engram.closeSession({
      summary: requireOption(options, "summary"),
      learned: options.learned,
      next: options.next,
      title: options.title,
      project: options.project,
      scope: options.scope ?? "project",
      type: options.type ?? "learning"
    });

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatMemoryWriteAsText(result, "Session close note saved")
          : serializeCommandResult("close", result, format, loadedConfig, buildRuntimeMeta(startedAt))
    };
  }

  const source = await loadChunkSource(command, options, loadedConfig);
  const { payload, path, stats } = source;
  const numeric = readNumericOptions(options);

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

    return {
      exitCode: 0,
      stdout:
        format === "text"
          ? formatSelectionAsText(selectionResult, { debug: debugEnabled })
          : serializeCommandResult(
              "select",
              {
                input: path,
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
                ...result
              },
              format,
              loadedConfig,
              buildRuntimeMeta(startedAt, { scanStats: stats ?? null })
            )
          : result.markdown
    };
  }

  const task = requireOption(options, "task");
  const objective = requireOption(options, "objective");
  const changedFiles = listOption(options, "changed-files");
  const focus = options.focus ?? `${task} ${objective}`;
  const engram = getEngramClient(options, dependencies);
  const memoryLimit = assertNumberRules(numberOption(options, "memory-limit", 3), "memory-limit", {
    min: 1,
    integer: true
  });
  const teachChunks = await resolveTeachRecall({
    task,
    objective,
    focus,
    changedFiles,
    project: options.project,
    explicitQuery: options["no-recall"] === "true" ? "__disabled__" : options["recall-query"],
    limit: memoryLimit,
    scope: options["memory-scope"] ?? "project",
    type: options["memory-type"],
    strictRecall: booleanOption(options, "strict-recall", loadedConfig.config.memory.strictRecall),
    baseChunks: payload.chunks,
    searchMemories: engram.searchMemories
  });
  const packet = buildLearningPacket({
    task,
    objective,
    focus,
    changedFiles,
    chunks: teachChunks.chunks,
    tokenBudget: numeric.tokenBudget,
    maxChunks: numeric.maxChunks,
    sentenceBudget: numeric.sentenceBudget,
    minScore: numeric.minScore,
    debug: debugEnabled
  });
  const selectedMemoryChunkIds = packet.selectedContext
    .filter((chunk) => chunk.source.startsWith("engram://"))
    .map((chunk) => chunk.id);
  const suppressedMemoryChunkIds = packet.suppressedContext
    .filter((chunk) => String(chunk.id).startsWith("engram-memory-"))
    .map((chunk) => chunk.id);
  const packetWithMemory = /** @type {LearningPacketWithMemory} */ ({
    ...packet,
    ...(stats ? { scanStats: stats } : {}),
    memoryRecall: {
      ...teachChunks.memoryRecall,
      degraded: teachChunks.memoryRecall.degraded === true,
      selectedChunks: selectedMemoryChunkIds.length,
      suppressedChunks: suppressedMemoryChunkIds.length,
      ...(debugEnabled
        ? {
            selectedChunkIds: selectedMemoryChunkIds,
            suppressedChunkIds: suppressedMemoryChunkIds
          }
        : {})
    }
  });

  if (debugEnabled) {
    packetWithMemory.debug = {
      selectedOrigins: packet.diagnostics.summary?.selectedOrigins ?? {},
      suppressedOrigins: packet.diagnostics.summary?.suppressedOrigins ?? {},
      suppressionReasons: packet.diagnostics.summary?.suppressionReasons ?? {}
    };
  }

  return {
    exitCode: 0,
    stdout:
      format === "text"
        ? formatLearningPacketAsText(packetWithMemory, { debug: debugEnabled })
        : serializeCommandResult(
            "teach",
            {
              input: path,
              ...packetWithMemory
            },
            format,
            loadedConfig,
            {
              degraded: packetWithMemory.memoryRecall.degraded === true,
              warnings:
                packetWithMemory.memoryRecall.degraded && packetWithMemory.memoryRecall.error
                  ? [packetWithMemory.memoryRecall.error]
                  : [],
              ...buildRuntimeMeta(startedAt, { debug: debugEnabled, scanStats: stats ?? null })
            }
          )
  };
}
