// @ts-check

/**
 * @typedef {import("../types/core-contracts.d.ts").ApiRequest} ApiRequest
 * @typedef {import("../types/core-contracts.d.ts").ApiResponse} ApiResponse
 * @typedef {import("../types/core-contracts.d.ts").GuardConfig} GuardConfig
 * @typedef {import("../types/core-contracts.d.ts").GuardInput} GuardInput
 */

import { runCli } from "../cli/app.js";
import { evaluateGuard } from "../guard/guard-engine.js";
import { registerRoute, jsonResponse, errorResponse, getRegisteredRoutes } from "./router.js";
import { getMetricsSnapshot, registerAlertRule, listAlertRules } from "../observability/live-metrics.js";
import { runEvalSuite, loadEvalSuite } from "../eval/eval-runner.js";
import { executeWorkflow } from "../orchestration/workflow-engine.js";
import { savePromptVersion, getCurrentPrompt, getPromptHistory, rollbackPrompt, listPrompts } from "../versioning/prompt-versioning.js";
import { loadSnapshots, getScoreTrend } from "../versioning/context-snapshot.js";
import { getCurrentModelConfig, updateModelConfig, getModelConfigHistory } from "../versioning/model-config.js";
import { checkAndRollback } from "../versioning/rollback-engine.js";
import { createSession, getSession, addTurn, buildConversationContext, listSessions, deleteSession } from "../orchestration/conversation-manager.js";
import { chatCompletion } from "../llm/openrouter-provider.js";
import { loadApiAxioms, formatApiAxiomsMarkdown } from "./axioms-loader.js";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * @param {Record<string, unknown>} body
 * @param {string} field
 * @returns {string}
 */
function requireField(body, field) {
  const value = body[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required field: "${field}"`);
  }

  return value.trim();
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} field
 * @returns {string | undefined}
 */
function optionalField(body, field) {
  const value = body[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Field "${field}" must be a string.`);
  }

  return value.trim() || undefined;
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} field
 * @returns {number | undefined}
 */
function optionalNumber(body, field) {
  const value = body[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Field "${field}" must be a number.`);
  }

  return value;
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function parseBooleanQuery(value) {
  return value === "true" || value === "1" || value === "yes";
}

/**
 * @param {string} command
 * @param {Record<string, string | undefined>} opts
 * @returns {string[]}
 */
function buildArgv(command, opts) {
  const argv = [command, "--format", "json"];

  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined) {
      argv.push(`--${key}`, value);
    }
  }

  return argv;
}

/**
 * @param {string[]} argv
 * @returns {Promise<ApiResponse>}
 */
async function runCliCommand(argv) {
  const result = await runCli(argv);

  if (result.exitCode !== 0) {
    const errorBody = tryParseJson(result.stderr || result.stdout || "");

    return errorResponse(
      result.exitCode === 1 ? 400 : 500,
      errorBody?.message ?? result.stderr ?? "Command failed",
      errorBody ?? { stdout: result.stdout, stderr: result.stderr }
    );
  }

  const parsed = tryParseJson(result.stdout ?? "");

  return jsonResponse(200, parsed ?? { output: result.stdout });
}

/**
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
function tryParseJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// ── POST /api/recall ─────────────────────────────────────────────────

registerRoute("POST", "/api/recall", async (/** @type {ApiRequest} */ req) => {
  const query = optionalField(req.body, "query");
  const project = optionalField(req.body, "project");
  const scope = optionalField(req.body, "scope");
  const type = optionalField(req.body, "type");
  const limit = optionalNumber(req.body, "limit");

  const argv = buildArgv("recall", {
    query,
    project,
    scope,
    type,
    limit: limit !== undefined ? String(limit) : undefined
  });

  return runCliCommand(argv);
});

// ── POST /api/teach ──────────────────────────────────────────────────

registerRoute("POST", "/api/teach", async (/** @type {ApiRequest} */ req) => {
  const task = optionalField(req.body, "task");
  const objective = optionalField(req.body, "objective");
  const focus = optionalField(req.body, "focus");
  const workspace = optionalField(req.body, "workspace");
  const input = optionalField(req.body, "input");
  const project = optionalField(req.body, "project");
  const changedFiles = optionalField(req.body, "changedFiles");
  const tokenBudget = optionalNumber(req.body, "tokenBudget");
  const maxChunks = optionalNumber(req.body, "maxChunks");

  if (!task && !objective) {
    return errorResponse(400, "At least one of 'task' or 'objective' is required.");
  }

  if (!workspace && !input) {
    return errorResponse(400, "Either 'workspace' or 'input' is required.");
  }

  const argv = buildArgv("teach", {
    task,
    objective,
    focus,
    workspace,
    input,
    project,
    "changed-files": changedFiles,
    "token-budget": tokenBudget !== undefined ? String(tokenBudget) : undefined,
    "max-chunks": maxChunks !== undefined ? String(maxChunks) : undefined
  });

  return runCliCommand(argv);
});

// ── POST /api/remember ───────────────────────────────────────────────

registerRoute("POST", "/api/remember", async (/** @type {ApiRequest} */ req) => {
  const title = requireField(req.body, "title");
  const content = requireField(req.body, "content");
  const project = optionalField(req.body, "project");
  const type = optionalField(req.body, "type");
  const scope = optionalField(req.body, "scope");

  const argv = buildArgv("remember", {
    title,
    content,
    project,
    type,
    scope
  });

  return runCliCommand(argv);
});

// ── POST /api/close ──────────────────────────────────────────────────

registerRoute("POST", "/api/close", async (/** @type {ApiRequest} */ req) => {
  const summary = requireField(req.body, "summary");
  const learned = optionalField(req.body, "learned");
  const next = optionalField(req.body, "next");
  const title = optionalField(req.body, "title");
  const project = optionalField(req.body, "project");

  const argv = buildArgv("close", {
    summary,
    learned,
    next,
    title,
    project
  });

  return runCliCommand(argv);
});

// ── POST /api/ingest ─────────────────────────────────────────────────

registerRoute("POST", "/api/ingest", async (/** @type {ApiRequest} */ req) => {
  const source = requireField(req.body, "source");
  const path = requireField(req.body, "path");
  const project = optionalField(req.body, "project");
  const dryRun = req.body.dryRun === true;

  /** @type {Record<string, string | undefined>} */
  const opts = { source, path, project };

  if (dryRun) {
    opts["dry-run"] = "true";
  }

  const argv = buildArgv("ingest", opts);

  return runCliCommand(argv);
});

// ── POST /api/guard ──────────────────────────────────────────────────

registerRoute("POST", "/api/guard", async (/** @type {ApiRequest} */ req) => {
  const query = requireField(req.body, "query");
  const project = optionalField(req.body, "project") ?? "";
  const command = optionalField(req.body, "command") ?? "recall";

  /** @type {GuardInput} */
  const guardInput = { query, project, command };

  const configBody = req.body.config;
  /** @type {GuardConfig} */
  let guardConfig;

  if (configBody && typeof configBody === "object" && !Array.isArray(configBody)) {
    const cfg = /** @type {Record<string, unknown>} */ (configBody);
    guardConfig = {
      enabled: cfg.enabled !== false,
      rules: Array.isArray(cfg.rules) ? /** @type {GuardConfig["rules"]} */ (cfg.rules) : [],
      defaultBlockMessage: typeof cfg.defaultBlockMessage === "string"
        ? cfg.defaultBlockMessage
        : "This query is outside the scope of this project."
    };
  } else {
    guardConfig = {
      enabled: true,
      rules: [{ type: "input-validation", enabled: true, params: { blockInjection: true } }],
      defaultBlockMessage: "This query is outside the scope of this project."
    };
  }

  const result = evaluateGuard(guardInput, guardConfig);

  return jsonResponse(result.blocked ? 403 : 200, {
    blocked: result.blocked,
    warned: result.warned,
    blockedBy: result.blockedBy,
    userMessage: result.userMessage,
    results: result.results,
    durationMs: result.durationMs
  });
});

// ── GET /api/health ──────────────────────────────────────────────────

registerRoute("GET", "/api/health", async () => {
  const result = await runCli(["doctor", "--format", "json"]);
  const parsed = tryParseJson(result.stdout ?? "");

  return jsonResponse(result.exitCode === 0 ? 200 : 503, {
    status: result.exitCode === 0 ? "healthy" : "degraded",
    ...(parsed ?? {})
  });
});

// ── GET /api/routes ──────────────────────────────────────────────────

registerRoute("GET", "/api/routes", async () => {
  const registered = getRegisteredRoutes();

  return jsonResponse(200, {
    routes: registered.map((r) => ({
      method: r.method,
      path: r.path
    }))
  });
});

// ── GET /api/metrics (S6) ────────────────────────────────────────────

registerRoute("GET", "/api/metrics", async () => {
  const snapshot = getMetricsSnapshot();
  return jsonResponse(200, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (snapshot)));
});

// ── POST /api/alerts (S6) ────────────────────────────────────────────

registerRoute("POST", "/api/alerts", async (/** @type {ApiRequest} */ req) => {
  const name = requireField(req.body, "name");
  const condition = requireField(req.body, "condition");
  const threshold = req.body.threshold;

  if (typeof threshold !== "number" || Number.isNaN(threshold)) {
    return errorResponse(400, "Field 'threshold' must be a number.");
  }

  const validConditions = ["error_rate_above", "latency_above", "block_rate_above"];
  if (!validConditions.includes(condition)) {
    return errorResponse(400, `Invalid condition. Must be one of: ${validConditions.join(", ")}`);
  }

  const webhookUrl = optionalField(req.body, "webhookUrl");

  registerAlertRule({
    name,
    condition: /** @type {import("../types/core-contracts.d.ts").AlertRule["condition"]} */ (condition),
    threshold,
    webhookUrl
  });

  return jsonResponse(201, {
    created: true,
    rule: { name, condition, threshold, webhookUrl },
    totalRules: listAlertRules().length
  });
});

// ── GET /api/alerts (S6) ─────────────────────────────────────────────

registerRoute("GET", "/api/alerts", async () => {
  return jsonResponse(200, { rules: listAlertRules() });
});

// ── POST /api/eval (S5) ──────────────────────────────────────────────

registerRoute("POST", "/api/eval", async (/** @type {ApiRequest} */ req) => {
  const suitePath = optionalField(req.body, "suitePath");
  const minScore = typeof req.body.minScore === "number" ? req.body.minScore : 0.5;

  /** @type {import("../types/core-contracts.d.ts").EvalSuite} */
  let suite;

  if (suitePath) {
    const { resolve } = await import("node:path");
    suite = await loadEvalSuite(resolve(suitePath));
  } else if (req.body.suite && typeof req.body.suite === "object") {
    suite = /** @type {import("../types/core-contracts.d.ts").EvalSuite} */ (req.body.suite);
  } else {
    return errorResponse(400, "Provide either 'suitePath' (file path) or 'suite' (inline object).");
  }

  const projectOverride = optionalField(req.body, "project");
  if (projectOverride) {
    suite.project = projectOverride;
  }

  const report = await runEvalSuite(suite, { minScore, consistencyRuns: 2 });

  return jsonResponse(report.ciGate.passed ? 200 : 422, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (report)));
});

// ── POST /api/workflow (S7) ──────────────────────────────────────────

registerRoute("POST", "/api/workflow", async (/** @type {ApiRequest} */ req) => {
  const workflow = req.body.workflow;

  if (!workflow || typeof workflow !== "object" || !Array.isArray(/** @type {any} */(workflow).steps)) {
    return errorResponse(400, "Field 'workflow' must be an object with id, name, and steps array.");
  }

  const input = typeof req.body.input === "object" && req.body.input !== null
    ? /** @type {Record<string, unknown>} */ (req.body.input)
    : {};

  const result = await executeWorkflow(
    /** @type {import("../types/core-contracts.d.ts").WorkflowDef} */ (workflow),
    input
  );

  const status = result.status === "completed" ? 200 : result.status === "partial" ? 207 : 500;
  return jsonResponse(status, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (result)));
});

// ── POST /api/conversation (S7) ──────────────────────────────────────

registerRoute("POST", "/api/conversation", async (/** @type {ApiRequest} */ req) => {
  const project = optionalField(req.body, "project") ?? "";
  const session = createSession(project);

  return jsonResponse(201, {
    sessionId: session.sessionId,
    project: session.project,
    createdAt: session.createdAt
  });
});

// ── POST /api/conversation/turn (S7) ─────────────────────────────────

registerRoute("POST", "/api/conversation/turn", async (/** @type {ApiRequest} */ req) => {
  const sessionId = requireField(req.body, "sessionId");
  const content = requireField(req.body, "content");
  const project = optionalField(req.body, "project");

  const session = getSession(sessionId);
  if (!session) {
    return errorResponse(404, `Session '${sessionId}' not found.`);
  }

  // Record the user turn
  addTurn(sessionId, "user", content);

  // Build accumulated conversation context
  const conversationContext = buildConversationContext(sessionId);

  // Run recall with conversation-augmented query
  const recallResult = await runCli([
    "recall",
    "--query", content,
    ...(project || session.project ? ["--project", project || session.project] : []),
    "--format", "json"
  ]);

  // Record system response
  const systemContent = recallResult.stdout ?? "";
  addTurn(sessionId, "system", systemContent, {
    exitCode: recallResult.exitCode,
    turnCount: session.turns.length
  });

  return jsonResponse(200, {
    sessionId,
    turnCount: session.turns.length,
    response: systemContent,
    conversationContext: conversationContext.slice(-2000)
  });
});

// ── GET /api/conversation/list (S7) ──────────────────────────────────

registerRoute("GET", "/api/conversation/list", async () => {
  const sessions = listSessions();

  return jsonResponse(200, {
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      project: s.project,
      turnCount: s.turns.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }))
  });
});

// ── POST /api/prompts (S8) ───────────────────────────────────────────

registerRoute("POST", "/api/prompts", async (/** @type {ApiRequest} */ req) => {
  const name = requireField(req.body, "name");
  const content = requireField(req.body, "content");
  const metadata = typeof req.body.metadata === "object" ? /** @type {Record<string, unknown>} */ (req.body.metadata) : undefined;

  const version = await savePromptVersion(name, content, metadata);

  return jsonResponse(201, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (version)));
});

// ── GET /api/prompts (S8) ────────────────────────────────────────────

registerRoute("GET", "/api/prompts", async () => {
  const names = await listPrompts();
  return jsonResponse(200, { prompts: names });
});

// ── POST /api/prompts/rollback (S8) ──────────────────────────────────

registerRoute("POST", "/api/prompts/rollback", async (/** @type {ApiRequest} */ req) => {
  const name = requireField(req.body, "name");
  const toVersion = req.body.toVersion;

  if (typeof toVersion !== "number") {
    return errorResponse(400, "Field 'toVersion' must be a number.");
  }

  const result = await rollbackPrompt(name, toVersion);

  if (!result) {
    return errorResponse(404, `Version ${toVersion} not found for prompt '${name}'.`);
  }

  return jsonResponse(200, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (result)));
});

// ── GET /api/snapshots (S8) ──────────────────────────────────────────

registerRoute("GET", "/api/snapshots", async (/** @type {ApiRequest} */ req) => {
  const project = typeof req.headers["x-project"] === "string" ? req.headers["x-project"] : "default";
  const snapshots = await loadSnapshots(project, { limit: 20 });

  return jsonResponse(200, { project, snapshots });
});

// ── GET /api/model-config (S8) ───────────────────────────────────────

registerRoute("GET", "/api/model-config", async () => {
  const current = await getCurrentModelConfig();
  const history = await getModelConfigHistory();

  return jsonResponse(200, {
    current: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (current)),
    history: history.slice(0, 10)
  });
});

// ── POST /api/model-config (S8) ─────────────────────────────────────

registerRoute("POST", "/api/model-config", async (/** @type {ApiRequest} */ req) => {
  const modelId = optionalField(req.body, "modelId");
  const temperature = typeof req.body.temperature === "number" ? req.body.temperature : undefined;
  const maxTokens = typeof req.body.maxTokens === "number" ? req.body.maxTokens : undefined;

  const updated = await updateModelConfig({ modelId, temperature, maxTokens });

  return jsonResponse(200, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (updated)));
});

// ── POST /api/rollback-check (S8) ────────────────────────────────────

registerRoute("POST", "/api/rollback-check", async (/** @type {ApiRequest} */ req) => {
  const project = requireField(req.body, "project");
  const promptName = requireField(req.body, "promptName");
  const dropThreshold = typeof req.body.dropThreshold === "number" ? req.body.dropThreshold : 0.10;

  const suitePath = optionalField(req.body, "suitePath");
  /** @type {import("../types/core-contracts.d.ts").EvalSuite} */
  let evalSuite;

  if (suitePath) {
    const { resolve } = await import("node:path");
    evalSuite = await loadEvalSuite(resolve(suitePath));
  } else if (req.body.suite && typeof req.body.suite === "object") {
    evalSuite = /** @type {import("../types/core-contracts.d.ts").EvalSuite} */ (req.body.suite);
  } else {
    return errorResponse(400, "Provide either 'suitePath' or 'suite' for the eval suite.");
  }

  const result = await checkAndRollback({ evalSuite, project, promptName, dropThreshold });

  return jsonResponse(result.shouldRollback ? 200 : 200, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (result)));
});

// ── GET /api/score-trend (S8) ────────────────────────────────────────

registerRoute("GET", "/api/score-trend", async (/** @type {ApiRequest} */ req) => {
  const project = typeof req.headers["x-project"] === "string" ? req.headers["x-project"] : "default";
  const trend = await getScoreTrend(project);

  return jsonResponse(200, { project, trend });
});

// ── GET /api/axioms ──────────────────────────────────────────────────

registerRoute("GET", "/api/axioms", async (/** @type {ApiRequest} */ req) => {
  const project =
    typeof req.query.project === "string" && req.query.project.trim()
      ? req.query.project.trim()
      : typeof req.headers["x-project"] === "string" && req.headers["x-project"].trim()
        ? req.headers["x-project"].trim()
        : "learning-context-system";
  const domain =
    typeof req.query.domain === "string" && req.query.domain.trim()
      ? req.query.domain.trim()
      : undefined;
  const protectedOnly = parseBooleanQuery(req.query.protectedOnly);
  const format =
    typeof req.query.format === "string" && req.query.format.trim()
      ? req.query.format.trim().toLowerCase()
      : "json";
  const dataDir =
    typeof req.headers["x-data-dir"] === "string" && req.headers["x-data-dir"].trim()
      ? req.headers["x-data-dir"].trim()
      : process.cwd();

  const payload = await loadApiAxioms({ project, dataDir, domain, protectedOnly });

  if (format === "markdown") {
    return jsonResponse(200, {
      ...payload,
      markdown: formatApiAxiomsMarkdown(payload)
    });
  }

  return jsonResponse(200, payload);
});

// ── POST /api/chat (LLM completion with optional context) ────────────

registerRoute("POST", "/api/chat", async (/** @type {ApiRequest} */ req) => {
  const query = requireField(req.body, "query");
  const chunks = Array.isArray(req.body.chunks) ? req.body.chunks : [];
  const withContext = req.body.withContext !== false;
  const model = optionalField(req.body, "model");

  // Build context from chunks
  let context = undefined;
  if (withContext && chunks.length > 0) {
    context = chunks.map((c, i) => {
      const source = typeof c === "string" ? `chunk-${i}` : (c.source ?? c.id ?? `chunk-${i}`);
      const content = typeof c === "string" ? c : (c.content ?? "");
      const score = typeof c === "object" ? (c.priority ?? c.score ?? 0) : 0;
      return `[${source} | score:${(score * 100).toFixed(0)}%]\n${content}`;
    }).join("\n\n");
  }

  const result = await chatCompletion({ query, context, model });

  return jsonResponse(result.ok ? 200 : 503, {
    response: result.response,
    model: result.model,
    tokens: result.tokens,
    provider: result.provider,
    withContext,
    chunksUsed: chunks.length
  });
});
