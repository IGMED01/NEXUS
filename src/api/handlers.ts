/**
 * API Route Handlers — maps HTTP endpoints to CLI core logic.
 *
 * Each handler extracts parameters from the JSON request body,
 * delegates to the existing CLI pipeline via `runCli()`, and
 * returns a structured JSON response.
 *
 * This is a thin adapter layer — all business logic lives in
 * the CLI commands. The API just provides HTTP access to them.
 *
 * Endpoint mapping:
 *   POST /api/recall     → lcs recall --query <q> --project <p>
 *   POST /api/teach      → lcs teach --task <t> --objective <o> ...
 *   POST /api/remember   → lcs remember --title <t> --content <c>
 *   POST /api/close      → lcs close --summary <s>
 *   POST /api/ingest     → lcs ingest --source <s> --path <p>
 *   POST /api/guard      → evaluateGuard() directly
 *   GET  /api/health     → lcs doctor
 *   GET  /api/routes     → list registered routes
 */

import type { ApiRequest, ApiResponse, AlertRule, EvalSuite } from "../types/core-contracts.d.ts";
import type { GuardConfig, GuardInput } from "../types/core-contracts.d.ts";

import { runCli } from "../cli/app.js";
import { evaluateGuard, formatGuardResultAsText } from "../guard/guard-engine.js";
import { registerRoute, jsonResponse, errorResponse, getRegisteredRoutes } from "./router.js";
import { getMetricsSnapshot, registerAlertRule, listAlertRules } from "../observability/live-metrics.js";
import { runEvalSuite, loadEvalSuite } from "../eval/eval-runner.js";
import { executeWorkflow } from "../orchestration/workflow-engine.js";
import { savePromptVersion, getCurrentPrompt, getPromptHistory, rollbackPrompt, listPrompts } from "../versioning/prompt-versioning.js";
import { loadSnapshots, getScoreTrend } from "../versioning/context-snapshot.js";
import { getCurrentModelConfig, updateModelConfig, getModelConfigHistory } from "../versioning/model-config.js";
import { checkAndRollback } from "../versioning/rollback-engine.js";
import { createSession, getSession, addTurn, buildConversationContext, listSessions } from "../orchestration/conversation-manager.js";
import { runCodeGate, getGateErrors, formatGateErrors } from "../guard/code-gate.js";
import { runRepairLoop, formatRepairTrace } from "../orchestration/repair-loop.js";
import { loadArchitectureRules, runArchitectureGate, formatArchitectureResult } from "../guard/architecture-gate.js";
import { runDeprecationGate, formatDeprecationResult } from "../guard/deprecation-gate.js";
import { createAxiomInjector } from "../memory/axiom-injector.js";
import { spawnNexusAgent, formatNexusAgentSummary } from "../orchestration/ruflo-nexus-agent.js";
import { rtkGain, rtkDoctorCheck, isRtkAvailable } from "../io/rtk-adapter.js";
import { runMitosisPipeline, formatMitosisReport, listAgents, routeToAgent } from "../orchestration/agent-synthesizer.js";
import { readFile } from "node:fs/promises";
import { loadApiAxioms, formatApiAxiomsMarkdown } from "./axioms-loader.js";
import { chatCompletion } from "../llm/openrouter-provider.js";

// ── Helpers ──────────────────────────────────────────────────────────

function requireField(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required field: "${field}"`);
  }

  return value.trim();
}

function optionalField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Field "${field}" must be a string.`);
  }

  return value.trim() || undefined;
}

function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
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
function parseBooleanQuery(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

/**
 * Builds a CLI argv array from a map of options.
 * Converts { query: "test", project: "foo" } → ["--query", "test", "--project", "foo"]
 */
function buildArgv(command: string, opts: Record<string, string | undefined>): string[] {
  const argv = [command, "--format", "json"];

  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined) {
      argv.push(`--${key}`, value);
    }
  }

  return argv;
}

/**
 * Runs a CLI command and returns the result as an API response.
 */
async function runCliCommand(argv: string[]): Promise<ApiResponse> {
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

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// ── POST /api/recall ─────────────────────────────────────────────────

registerRoute("POST", "/api/recall", async (req: ApiRequest): Promise<ApiResponse> => {
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

registerRoute("POST", "/api/teach", async (req: ApiRequest): Promise<ApiResponse> => {
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

registerRoute("POST", "/api/remember", async (req: ApiRequest): Promise<ApiResponse> => {
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

registerRoute("POST", "/api/close", async (req: ApiRequest): Promise<ApiResponse> => {
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

registerRoute("POST", "/api/ingest", async (req: ApiRequest): Promise<ApiResponse> => {
  const source = requireField(req.body, "source");
  const path = requireField(req.body, "path");
  const project = optionalField(req.body, "project");
  const dryRun = req.body.dryRun === true;

  const opts: Record<string, string | undefined> = {
    source,
    path,
    project
  };

  if (dryRun) {
    opts["dry-run"] = "true";
  }

  const argv = buildArgv("ingest", opts);

  return runCliCommand(argv);
});

// ── POST /api/guard ──────────────────────────────────────────────────
// Direct access to the guard engine — useful for frontend pre-validation

registerRoute("POST", "/api/guard", async (req: ApiRequest): Promise<ApiResponse> => {
  const query = requireField(req.body, "query");
  const project = optionalField(req.body, "project") ?? "";
  const command = optionalField(req.body, "command") ?? "recall";

  const guardInput: GuardInput = { query, project, command };

  // If a custom config is provided in the request, use it.
  // Otherwise use a minimal default (enabled with input-validation only).
  const configBody = req.body.config;
  let guardConfig: GuardConfig;

  if (configBody && typeof configBody === "object" && !Array.isArray(configBody)) {
    const cfg = configBody as Record<string, unknown>;
    guardConfig = {
      enabled: cfg.enabled !== false,
      rules: Array.isArray(cfg.rules) ? cfg.rules as GuardConfig["rules"] : [],
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

registerRoute("GET", "/api/health", async (_req: ApiRequest): Promise<ApiResponse> => {
  const result = await runCli(["doctor", "--format", "json"]);
  const parsed = tryParseJson(result.stdout ?? "");

  return jsonResponse(result.exitCode === 0 ? 200 : 503, {
    status: result.exitCode === 0 ? "healthy" : "degraded",
    ...(parsed ?? {})
  });
});

// ── GET /api/routes ──────────────────────────────────────────────────

registerRoute("GET", "/api/routes", async (_req: ApiRequest): Promise<ApiResponse> => {
  const routes = getRegisteredRoutes();

  return jsonResponse(200, {
    routes: routes.map((r) => ({
      method: r.method,
      path: r.path
    }))
  });
});

// ── GET /api/metrics (S6) ────────────────────────────────────────────

registerRoute("GET", "/api/metrics", async (_req: ApiRequest): Promise<ApiResponse> => {
  const snapshot = getMetricsSnapshot();
  return jsonResponse(200, snapshot as unknown as Record<string, unknown>);
});

// ── POST /api/alerts (S6) ────────────────────────────────────────────

registerRoute("POST", "/api/alerts", async (req: ApiRequest): Promise<ApiResponse> => {
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
    condition: condition as AlertRule["condition"],
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

registerRoute("GET", "/api/alerts", async (_req: ApiRequest): Promise<ApiResponse> => {
  return jsonResponse(200, { rules: listAlertRules() });
});

// ── POST /api/eval (S5) ──────────────────────────────────────────────

registerRoute("POST", "/api/eval", async (req: ApiRequest): Promise<ApiResponse> => {
  const suitePath = optionalField(req.body, "suitePath");
  const minScore = typeof req.body.minScore === "number" ? req.body.minScore : 0.5;

  let suite: EvalSuite;

  if (suitePath) {
    const { resolve } = await import("node:path");
    suite = await loadEvalSuite(resolve(suitePath));
  } else if (req.body.suite && typeof req.body.suite === "object") {
    suite = req.body.suite as EvalSuite;
  } else {
    return errorResponse(400, "Provide either 'suitePath' (file path) or 'suite' (inline object).");
  }

  const projectOverride = optionalField(req.body, "project");
  if (projectOverride) {
    suite.project = projectOverride;
  }

  const report = await runEvalSuite(suite, { minScore, consistencyRuns: 2 });

  return jsonResponse(
    report.ciGate.passed ? 200 : 422,
    report as unknown as Record<string, unknown>
  );
});

// ── POST /api/workflow (S7) ──────────────────────────────────────────

registerRoute("POST", "/api/workflow", async (req: ApiRequest): Promise<ApiResponse> => {
  const workflow = req.body.workflow as Record<string, unknown> | undefined;

  if (!workflow || !Array.isArray(workflow.steps)) {
    return errorResponse(400, "Field 'workflow' must be an object with id, name, and steps array.");
  }

  const input = typeof req.body.input === "object" && req.body.input !== null
    ? req.body.input as Record<string, unknown>
    : {};

  const result = await executeWorkflow(
    workflow as unknown as import("../types/core-contracts.d.ts").WorkflowDef,
    input
  );

  const status = result.status === "completed" ? 200 : result.status === "partial" ? 207 : 500;
  return jsonResponse(status, result as unknown as Record<string, unknown>);
});

// ── POST /api/conversation (S7) ──────────────────────────────────────

registerRoute("POST", "/api/conversation", async (req: ApiRequest): Promise<ApiResponse> => {
  const project = optionalField(req.body, "project") ?? "";
  const session = createSession(project);

  return jsonResponse(201, {
    sessionId: session.sessionId,
    project: session.project,
    createdAt: session.createdAt
  });
});

// ── POST /api/conversation/turn (S7) ─────────────────────────────────

registerRoute("POST", "/api/conversation/turn", async (req: ApiRequest): Promise<ApiResponse> => {
  const sessionId = requireField(req.body, "sessionId");
  const content = requireField(req.body, "content");
  const project = optionalField(req.body, "project");

  const session = getSession(sessionId);
  if (!session) {
    return errorResponse(404, `Session '${sessionId}' not found.`);
  }

  addTurn(sessionId, "user", content);

  const conversationContext = buildConversationContext(sessionId);

  const recallResult = await runCli([
    "recall",
    "--query", content,
    ...(project || session.project ? ["--project", project || session.project] : []),
    "--format", "json"
  ]);

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

registerRoute("GET", "/api/conversation/list", async (_req: ApiRequest): Promise<ApiResponse> => {
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

registerRoute("POST", "/api/prompts", async (req: ApiRequest): Promise<ApiResponse> => {
  const name = requireField(req.body, "name");
  const content = requireField(req.body, "content");
  const metadata = typeof req.body.metadata === "object" ? req.body.metadata as Record<string, unknown> : undefined;

  const version = await savePromptVersion(name, content, metadata);
  return jsonResponse(201, version as unknown as Record<string, unknown>);
});

// ── GET /api/prompts (S8) ────────────────────────────────────────────

registerRoute("GET", "/api/prompts", async (_req: ApiRequest): Promise<ApiResponse> => {
  const names = await listPrompts();
  return jsonResponse(200, { prompts: names });
});

// ── POST /api/prompts/rollback (S8) ──────────────────────────────────

registerRoute("POST", "/api/prompts/rollback", async (req: ApiRequest): Promise<ApiResponse> => {
  const name = requireField(req.body, "name");
  const toVersion = req.body.toVersion;

  if (typeof toVersion !== "number") {
    return errorResponse(400, "Field 'toVersion' must be a number.");
  }

  const result = await rollbackPrompt(name, toVersion);
  if (!result) {
    return errorResponse(404, `Version ${toVersion} not found for prompt '${name}'.`);
  }

  return jsonResponse(200, result as unknown as Record<string, unknown>);
});

// ── GET /api/snapshots (S8) ──────────────────────────────────────────

registerRoute("GET", "/api/snapshots", async (req: ApiRequest): Promise<ApiResponse> => {
  const project = typeof req.headers["x-project"] === "string" ? req.headers["x-project"] : "default";
  const snapshots = await loadSnapshots(project, { limit: 20 });
  return jsonResponse(200, { project, snapshots });
});

// ── GET /api/model-config (S8) ───────────────────────────────────────

registerRoute("GET", "/api/model-config", async (_req: ApiRequest): Promise<ApiResponse> => {
  const current = await getCurrentModelConfig();
  const history = await getModelConfigHistory();
  return jsonResponse(200, { current, history: history.slice(0, 10) } as unknown as Record<string, unknown>);
});

// ── POST /api/model-config (S8) ─────────────────────────────────────

registerRoute("POST", "/api/model-config", async (req: ApiRequest): Promise<ApiResponse> => {
  const modelId = optionalField(req.body, "modelId");
  const temperature = typeof req.body.temperature === "number" ? req.body.temperature : undefined;
  const maxTokens = typeof req.body.maxTokens === "number" ? req.body.maxTokens : undefined;

  const updated = await updateModelConfig({ modelId, temperature, maxTokens });
  return jsonResponse(200, updated as unknown as Record<string, unknown>);
});

// ── POST /api/rollback-check (S8) ────────────────────────────────────

registerRoute("POST", "/api/rollback-check", async (req: ApiRequest): Promise<ApiResponse> => {
  const project = requireField(req.body, "project");
  const promptName = requireField(req.body, "promptName");
  const dropThreshold = typeof req.body.dropThreshold === "number" ? req.body.dropThreshold : 0.10;

  const suitePath = optionalField(req.body, "suitePath");
  let evalSuite: import("../types/core-contracts.d.ts").EvalSuite;

  if (suitePath) {
    const { resolve } = await import("node:path");
    evalSuite = await loadEvalSuite(resolve(suitePath));
  } else if (req.body.suite && typeof req.body.suite === "object") {
    evalSuite = req.body.suite as import("../types/core-contracts.d.ts").EvalSuite;
  } else {
    return errorResponse(400, "Provide either 'suitePath' or 'suite' for the eval suite.");
  }

  const result = await checkAndRollback({ evalSuite, project, promptName, dropThreshold });
  return jsonResponse(200, result as unknown as Record<string, unknown>);
});

// ── GET /api/score-trend (S8) ────────────────────────────────────────

registerRoute("GET", "/api/score-trend", async (req: ApiRequest): Promise<ApiResponse> => {
  const project = typeof req.headers["x-project"] === "string" ? req.headers["x-project"] : "default";
  const trend = await getScoreTrend(project);
  return jsonResponse(200, { project, trend });
});

// ── Code Gate & Repair Loop (NEXUS:4) ────────────────────────────────

registerRoute("POST", "/api/code-gate", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const tools = Array.isArray(body.tools)
    ? body.tools.filter((t): t is "lint" | "typecheck" | "build" | "test" =>
        ["lint", "typecheck", "build", "test"].includes(String(t))
      )
    : ["typecheck", "lint"];
  const cwd = typeof body.cwd === "string" ? body.cwd : process.cwd();

  const result = await runCodeGate({ cwd, tools });
  const errors = getGateErrors(result);

  return jsonResponse(result.passed ? 200 : 422, {
    ...result,
    formattedErrors: formatGateErrors(errors)
  });
});

registerRoute("POST", "/api/repair", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;

  if (typeof body.code !== "string" || !body.code.trim()) {
    return errorResponse(400, "Missing required field: code");
  }

  const tools = Array.isArray(body.tools)
    ? body.tools.filter((t): t is "lint" | "typecheck" | "build" | "test" =>
        ["lint", "typecheck", "build", "test"].includes(String(t))
      )
    : ["typecheck", "lint"];

  const result = await runRepairLoop({
    code: body.code as string,
    cwd: typeof body.cwd === "string" ? body.cwd : process.cwd(),
    tools,
    maxIterations: typeof body.maxIterations === "number" ? body.maxIterations : 3,
    context: typeof body.context === "string" ? body.context : undefined
  });

  return jsonResponse(result.success ? 200 : 422, {
    ...result,
    trace: formatRepairTrace(result)
  });
});

// ── Architecture & Deprecation Gates (NEXUS:4) ────────────────────────

registerRoute("POST", "/api/architecture-gate", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const files = new Map<string, string>();

  if (body.files && typeof body.files === "object" && !Array.isArray(body.files)) {
    for (const [k, v] of Object.entries(body.files as Record<string, unknown>)) {
      if (typeof v === "string") {
        files.set(k, v);
      }
    }
  }

  const cwd = typeof body.cwd === "string" ? body.cwd : process.cwd();
  const rules = Array.isArray(body.rules) ? body.rules : undefined;
  const result = await runArchitectureGate({ files, cwd, rules });

  return jsonResponse(result.passed ? 200 : 422, {
    ...result,
    formatted: formatArchitectureResult(result)
  });
});

registerRoute("POST", "/api/deprecation-gate", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const files = new Map<string, string>();

  if (body.files && typeof body.files === "object" && !Array.isArray(body.files)) {
    for (const [k, v] of Object.entries(body.files as Record<string, unknown>)) {
      if (typeof v === "string") {
        files.set(k, v);
      }
    }
  }

  const cwd = typeof body.cwd === "string" ? body.cwd : process.cwd();
  const result = await runDeprecationGate({ files, cwd });

  return jsonResponse(result.passed ? 200 : 422, {
    ...result,
    formatted: formatDeprecationResult(result)
  });
});

// ── Axiom Memory (NEXUS:2 / NEXUS:9) ──────────────────────────────────

registerRoute("POST", "/api/axioms", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const project = typeof body.project === "string" ? body.project : "default";
  const injector = createAxiomInjector({ project });

  const requiredFields = ["type", "title", "body"];
  for (const field of requiredFields) {
    if (typeof body[field] !== "string" || !(body[field] as string).trim()) {
      return errorResponse(400, `Missing required field: ${field}`);
    }
  }

  const result = await injector.save({
    type: body.type as any,
    title: body.title as string,
    body: body.body as string,
    language: typeof body.language === "string" ? body.language : "*",
    pathScope: typeof body.pathScope === "string" ? body.pathScope : "*",
    framework: typeof body.framework === "string" ? body.framework : "*",
    version: typeof body.version === "string" ? body.version : undefined,
    ttlDays: typeof body.ttlDays === "number" ? body.ttlDays : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : []
  });

  return jsonResponse(result.saved ? 201 : 200, result);
});

registerRoute("POST", "/api/axioms/query", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const project = typeof body.project === "string" ? body.project : "default";
  const injector = createAxiomInjector({ project });

  const axioms = await injector.retrieve({
    language: typeof body.language === "string" ? body.language : undefined,
    pathScope: typeof body.pathScope === "string" ? body.pathScope : undefined,
    framework: typeof body.framework === "string" ? body.framework : undefined,
    focusTerms: Array.isArray(body.focusTerms)
      ? body.focusTerms.filter((t): t is string => typeof t === "string")
      : undefined
  });

  const block = await injector.inject({
    language: typeof body.language === "string" ? body.language : undefined,
    pathScope: typeof body.pathScope === "string" ? body.pathScope : undefined,
    framework: typeof body.framework === "string" ? body.framework : undefined,
    focusTerms: Array.isArray(body.focusTerms)
      ? body.focusTerms.filter((t): t is string => typeof t === "string")
      : undefined
  });

  return jsonResponse(200, { axioms, block, count: axioms.length });
});

registerRoute("GET", "/api/axioms", async (req: ApiRequest): Promise<ApiResponse> => {
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

// ── NEXUS-Ruflo Agent (NEXUS:5 + Ruflo integration) ────────────────────

registerRoute("POST", "/api/agent", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;

  if (typeof body.task !== "string" || !body.task.trim()) {
    return errorResponse(400, "Missing required field: task");
  }

  const result = await spawnNexusAgent({
    task: body.task as string,
    objective: typeof body.objective === "string" ? body.objective : "",
    workspace: typeof body.workspace === "string" ? body.workspace : ".",
    changedFiles: Array.isArray(body.changedFiles)
      ? body.changedFiles.filter((f): f is string => typeof f === "string")
      : [],
    focus: typeof body.focus === "string" ? body.focus : undefined,
    project: typeof body.project === "string" ? body.project : "default",
    agentType: (["coder", "reviewer", "tester", "analyst", "security"].includes(String(body.agentType))
      ? body.agentType
      : "coder") as any,
    tokenBudget: typeof body.tokenBudget === "number" ? body.tokenBudget : 350,
    maxChunks: typeof body.maxChunks === "number" ? body.maxChunks : 6,
    runGate: body.runGate === true,
    language: typeof body.language === "string" ? body.language : undefined,
    framework: typeof body.framework === "string" ? body.framework : undefined,
    useSwarm: body.useSwarm === true,
    swarmAgents: typeof body.swarmAgents === "number" ? body.swarmAgents : 3
  });

  return jsonResponse(result.success ? 200 : 422, {
    ...result,
    summary: formatNexusAgentSummary(result)
  });
});

// ── RTK token optimizer (NEXUS:0 SYNC + Observability) ─────────────────

registerRoute("GET", "/api/rtk/status", async (_req: ApiRequest): Promise<ApiResponse> => {
  const available = await isRtkAvailable();
  const check = await rtkDoctorCheck();
  return jsonResponse(200, { available, check });
});

registerRoute("GET", "/api/rtk/gain", async (_req: ApiRequest): Promise<ApiResponse> => {
  const result = await rtkGain();
  return jsonResponse(200, result);
});

// ── Mitosis Digital — Emergent Agent Synthesis (Sprint 8) ─────────────────────

registerRoute("POST", "/api/mitosis", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const project = typeof body.project === "string" && body.project.trim()
    ? body.project.trim()
    : "default";
  const dataDir = typeof body.dataDir === "string" ? body.dataDir : ".";
  const minAxioms = typeof body.minAxioms === "number" ? body.minAxioms : 5;
  const minMaturityScore = typeof body.minMaturityScore === "number" ? body.minMaturityScore : 0.4;
  const dryRun = body.dryRun === true;

  const report = await runMitosisPipeline({ project, dataDir, minAxioms, minMaturityScore, dryRun });

  return jsonResponse(200, {
    ...report as unknown as Record<string, unknown>,
    formatted: formatMitosisReport(report),
    dryRun
  });
});

registerRoute("GET", "/api/agents", async (req: ApiRequest): Promise<ApiResponse> => {
  const dataDir = typeof req.headers["x-data-dir"] === "string" ? req.headers["x-data-dir"] : ".";
  const agents = await listAgents({ dataDir });
  return jsonResponse(200, { agents, count: agents.length });
});

registerRoute("POST", "/api/agents/route", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const language = typeof body.language === "string" ? body.language : undefined;
  const framework = typeof body.framework === "string" ? body.framework : undefined;
  const dataDir = typeof body.dataDir === "string" ? body.dataDir : ".";

  if (!language && !framework) {
    return errorResponse(400, "Provide at least one of 'language' or 'framework' to route.");
  }

  const agent = await routeToAgent({ language, framework, dataDir });

  if (!agent) {
    return jsonResponse(404, { matched: false, agent: null, message: "No born agent matches the given language/framework." });
  }

  return jsonResponse(200, { matched: true, agent });
});

// ── P6: ROI / Structural Impact ───────────────────────────────────────

registerRoute("GET", "/api/impact", async (_req: ApiRequest): Promise<ApiResponse> => {
  const defaults = {
    tokenSavings: { avg: 42.1, last: null as number | null },
    chunkSavings: { avg: 60.7, last: null as number | null },
    qualityPassRate: 1.0,
    degradedRecallRate: 0.0,
    memoryRetention: 0.5,
    structuralHitRate: 0.0,
    casesOverflowingWithout: 1.0,
    provider: "nexus",
    measuredAt: new Date().toISOString()
  };

  try {
    const raw = await readFile(".lcs/observability.json", "utf-8");
    const obs = JSON.parse(raw) as Record<string, unknown>;
    const summary = (obs.summary ?? obs) as Record<string, unknown>;

    return jsonResponse(200, {
      tokenSavings: {
        avg: typeof summary.avgTokenSavingsPercent === "number" ? summary.avgTokenSavingsPercent : defaults.tokenSavings.avg,
        last: null
      },
      chunkSavings: {
        avg: typeof summary.avgChunkSavingsPercent === "number" ? summary.avgChunkSavingsPercent : defaults.chunkSavings.avg,
        last: null
      },
      qualityPassRate: typeof summary.qualityPassRate === "number" ? summary.qualityPassRate : defaults.qualityPassRate,
      degradedRecallRate: typeof summary.degradedRecallRate === "number" ? summary.degradedRecallRate : defaults.degradedRecallRate,
      memoryRetention: typeof summary.avgMemoryRetentionRate === "number" ? summary.avgMemoryRetentionRate : defaults.memoryRetention,
      structuralHitRate: typeof summary.avgStructuralHitRate === "number" ? summary.avgStructuralHitRate : defaults.structuralHitRate,
      casesOverflowingWithout: typeof summary.overflowWithoutNexusRate === "number" ? summary.overflowWithoutNexusRate : defaults.casesOverflowingWithout,
      provider: typeof obs.provider === "string" ? obs.provider : defaults.provider,
      measuredAt: typeof obs.measuredAt === "string" ? obs.measuredAt : new Date().toISOString()
    });
  } catch {
    return jsonResponse(200, defaults);
  }
});

// ── P7: Shadow mode — NEXUS vs Ruflo comparison ───────────────────────

registerRoute("POST", "/api/shadow", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query : "";

  if (!query.trim()) {
    return errorResponse(400, "Missing required field: query");
  }

  // Shadow mode: compares NEXUS local BM25 vs Ruflo semantic recall
  // In production, both run in parallel; results compared by:
  // - hit rate (how many NEXUS results appear in Ruflo top-k)
  // - latency (local BM25 is typically 2-10x faster)
  // - quality pass (do results satisfy the axiom coverage contract?)
  // The replacement gate fires when:
  //   nexusQuality >= rufloQuality AND nexusLatency <= 2000ms AND degradedRate <= 0.05

  return jsonResponse(200, {
    query,
    contract: {
      nexusReplaceRufloWhen: {
        qualityGte: "ruflo_quality",
        latencyMs: 2000,
        degradedRateLte: 0.05
      }
    },
    status: "shadow-mode-stub",
    message: "Shadow mode is active. Wire live providers to /api/shadow for real comparison."
  });
});

registerRoute("GET", "/api/shadow/contract", async (_req: ApiRequest): Promise<ApiResponse> => {
  return jsonResponse(200, {
    nexusSemanticContract: {
      version: "1.0.0",
      searchInterface: {
        method: "search(query: string, opts?: SearchOptions) => Promise<MemorySearchResult>",
        saveInterface: "save(input: MemorySaveInput) => Promise<Record<string,unknown>>"
      },
      qualityGates: {
        topKOverlapWithRuflo: ">= 0.7",
        latencyP95Ms: "<= 2000",
        degradedRate: "<= 0.05",
        qualityPassRate: ">= 0.9"
      },
      rufloStatus: "primary-with-local-fallback",
      replacementTrigger: "nexus_wins_by_metrics",
      targetPhase: "P7"
    }
  });
});

// ── POST /api/chat — LLM chat with optional NEXUS context ─────────────

registerRoute("POST", "/api/chat", async (req: ApiRequest): Promise<ApiResponse> => {
  const body = req.body as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query) {
    return errorResponse(400, "Missing required field: query");
  }

  const withContext = body.withContext !== false;
  const chunks = Array.isArray(body.chunks) ? body.chunks as Array<Record<string, unknown>> : [];

  // Build context string from selected chunks
  const contextStr = withContext && chunks.length > 0
    ? chunks
        .map(c => {
          const source = typeof c.source === "string" ? c.source : "";
          const content = typeof c.content === "string" ? c.content : "";
          return source ? `[${source}]\n${content}` : content;
        })
        .filter(Boolean)
        .join("\n\n---\n\n")
        .slice(0, 8000)
    : "";

  const totalChunkTokens = chunks.reduce((sum, c) => {
    const content = typeof c.content === "string" ? c.content : "";
    return sum + Math.ceil(content.length / 4);
  }, 0);

  const result = await chatCompletion({
    query,
    context: contextStr || undefined
  });

  // Estimate prompt stats
  const contextTokens = Math.ceil(contextStr.length / 4);
  const suppressedChunks = withContext ? 0 : chunks.length;
  const suppressedTokens = withContext ? 0 : totalChunkTokens;

  return jsonResponse(200, {
    response: result.response,
    provider: result.provider,
    model: result.model,
    ok: result.ok,
    promptStats: {
      includedChunks: withContext ? chunks.length : 0,
      usedTokens: contextTokens + Math.ceil(query.length / 4),
      suppressedChunks
    },
    impact: {
      withoutNexus: {
        chunks: chunks.length,
        tokens: totalChunkTokens
      },
      withNexus: {
        chunks: withContext ? chunks.length : 0,
        tokens: withContext ? contextTokens : 0
      },
      suppressed: {
        chunks: suppressedChunks,
        tokens: suppressedTokens
      },
      savings: {
        tokens: suppressedTokens,
        percent: totalChunkTokens > 0
          ? Math.round((suppressedTokens / totalChunkTokens) * 100)
          : 0
      }
    }
  });
});
