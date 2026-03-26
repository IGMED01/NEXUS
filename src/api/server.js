// @ts-check

import http from "node:http";
import path from "node:path";
import { createAuthMiddleware } from "./auth-middleware.js";
import { enforceOutputGuard } from "../guard/output-guard.js";
import { checkOutputCompliance } from "../guard/compliance-checker.js";
import { createOutputAuditor } from "../guard/output-auditor.js";
import {
  listDomainGuardPolicyProfiles,
  resolveDomainGuardPolicy
} from "../guard/domain-policy-profiles.js";
import { buildLlmPrompt } from "../llm/prompt-builder.js";
import { parseLlmResponse } from "../llm/response-parser.js";
import { createLlmProviderRegistry } from "../llm/provider.js";
import { createClaudeProvider } from "../llm/claude-provider.js";
import { createSyncScheduler } from "../sync/sync-scheduler.js";
import { createSyncDriftMonitor } from "../sync/drift-monitor.js";
import { createSyncRuntime } from "../sync/sync-runtime.js";
import { createPipelineBuilder, buildDefaultNexusPipeline } from "../orchestration/pipeline-builder.js";
import { createDefaultExecutors } from "../orchestration/default-executors.js";
import { loadDomainEvalSuite, runDomainEvalSuite } from "../eval/domain-eval-suite.js";
import { buildDashboardData } from "../observability/dashboard-data.js";
import { evaluateObservabilityAlerts } from "../observability/alert-engine.js";
import { getObservabilityReport, recordCommandMetric } from "../observability/metrics-store.js";
import { createPromptVersionStore } from "../versioning/prompt-version-store.js";
import { createRollbackPolicy } from "../versioning/rollback-policy.js";
import { buildNexusOpenApiSpec } from "../interface/nexus-openapi.js";
import { buildNexusDemoPage } from "../interface/nexus-demo-page.js";

/**
 * @param {http.IncomingMessage} request
 */
async function readJsonBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}

/**
 * @param {http.ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} payload
 */
function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * @param {http.ServerResponse} response
 * @param {number} statusCode
 * @param {string} html
 */
function sendHtml(response, statusCode, html) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
}

/**
 * @param {string} text
 */
function estimateTokenCount(text) {
  const normalized = String(text ?? "").trim();

  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

/**
 * @param {unknown} value
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function createRequestId() {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {{
 *   rawChunks?: number,
 *   rawTokens?: number,
 *   selectedChunks?: number,
 *   selectedTokens?: number,
 *   suppressedChunks?: number,
 *   suppressedTokens?: number
 * }} input
 */
function buildContextImpact(input) {
  const rawChunks = Math.max(0, Math.trunc(Number(input.rawChunks ?? 0)));
  const rawTokens = Math.max(0, Math.trunc(Number(input.rawTokens ?? 0)));
  const selectedChunks = Math.max(0, Math.trunc(Number(input.selectedChunks ?? 0)));
  const selectedTokens = Math.max(0, Math.trunc(Number(input.selectedTokens ?? 0)));
  const inferredSuppressedChunks = Math.max(0, rawChunks - selectedChunks);
  const inferredSuppressedTokens = Math.max(0, rawTokens - selectedTokens);
  const suppressedChunks = Number.isFinite(Number(input.suppressedChunks))
    ? Math.max(0, Math.trunc(Number(input.suppressedChunks)))
    : inferredSuppressedChunks;
  const suppressedTokens = Number.isFinite(Number(input.suppressedTokens))
    ? Math.max(0, Math.trunc(Number(input.suppressedTokens)))
    : inferredSuppressedTokens;
  const savingsPercent =
    rawTokens > 0 ? Number(((suppressedTokens / rawTokens) * 100).toFixed(1)) : 0;

  return {
    withoutNexus: {
      chunks: rawChunks,
      tokens: rawTokens
    },
    withNexus: {
      chunks: selectedChunks,
      tokens: selectedTokens
    },
    suppressed: {
      chunks: suppressedChunks,
      tokens: suppressedTokens
    },
    savings: {
      chunks: suppressedChunks,
      tokens: suppressedTokens,
      percent: savingsPercent
    }
  };
}

/**
 * @param {unknown} entry
 * @param {number} index
 */
function normalizeLegacyChunk(entry, index = 0) {
  const record = asRecord(entry);
  const chunkRecord = asRecord(record.chunk);
  const id =
    String(record.id ?? chunkRecord.id ?? `chunk-${index + 1}`).trim() ||
    `chunk-${index + 1}`;
  const source =
    String(record.source ?? chunkRecord.source ?? id).trim() || id;
  const content = String(record.content ?? chunkRecord.content ?? "");
  const score = Number(record.score ?? record.priority ?? chunkRecord.priority ?? 0);
  const safeScore = Number.isFinite(score) ? Math.max(0, score) : 0;
  const tokens = estimateTokenCount(content);

  return {
    id,
    source,
    kind: String(record.kind ?? chunkRecord.kind ?? "doc"),
    content,
    score: safeScore,
    priority: safeScore,
    tokens
  };
}

/**
 * @param {http.ServerResponse} response
 * @param {number} statusCode
 * @param {{
 *   requestId: string,
 *   code: string,
 *   message: string,
 *   details?: Record<string, unknown>
 * }} input
 */
function sendErrorJson(response, statusCode, input) {
  sendJson(response, statusCode, {
    status: "error",
    error: input.message,
    errorCode: input.code,
    requestId: input.requestId,
    details: input.details ?? {}
  });
}

/**
 * @param {http.IncomingMessage} request
 */
function getRequestUrl(request) {
  return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
}

/**
 * NEXUS:10 — HTTP server exposing ask/guard/sync orchestration endpoints.
 * @param {{
 *   host?: string,
 *   port?: number,
 *   auth?: {
 *     requireAuth?: boolean,
 *     apiKeys?: string[],
 *     jwtSecret?: string
 *   },
 *   llm?: {
 *     defaultProvider?: string,
 *     providers?: Array<import("../llm/provider.js").LlmProvider>,
 *     claude?: Parameters<typeof createClaudeProvider>[0],
 *     attemptTimeoutMs?: number,
 *     tokenBudget?: number,
 *     maxChunks?: number
 *   },
 *   sync?: {
 *     rootPath?: string,
 *     intervalMs?: number,
 *     stateFilePath?: string,
 *     manifestFilePath?: string,
 *     versionFilePath?: string,
 *     repositoryBaseDir?: string,
 *     projectId?: string,
 *     maxCharsPerChunk?: number,
 *     security?: Parameters<import("../security/secret-redaction.js").resolveSecurityPolicy>[0],
 *     autoStart?: boolean,
 *     driftFilePath?: string,
 *     driftMaxHistory?: number
 *   },
 *   repositoryFilePath?: string,
 *   outputAuditFilePath?: string,
 *   observabilityFilePath?: string,
 *   promptVersionFilePath?: string,
 *   openApi?: {
 *     title?: string,
 *     version?: string,
 *     description?: string
 *   },
 *   rollbackPolicy?: {
 *     minScore?: number,
 *     preferPrevious?: boolean,
 *     requireAtLeastVersions?: number
 *   },
 *   evals?: {
 *     defaultDomainSuitePath?: string
 *   }
 * }} [options]
 */
export function createNexusApiServer(options = {}) {
  const auth = createAuthMiddleware(options.auth);
  const outputAuditor = createOutputAuditor({
    filePath: options.outputAuditFilePath
  });

  const registry = createLlmProviderRegistry({
    defaultProvider: options.llm?.defaultProvider,
    providers: options.llm?.providers
  });

  if (!registry.list().length) {
    registry.register(createClaudeProvider(options.llm?.claude));
  }

  const defaultExecutors = createDefaultExecutors({
    repositoryFilePath: options.repositoryFilePath
  });
  const pipelineBuilder = createPipelineBuilder({
    executors: {
      ingest: defaultExecutors.ingest,
      process: defaultExecutors.process,
      store: defaultExecutors.store,
      recall: defaultExecutors.recall
    }
  });

  const syncRootPath = path.resolve(options.sync?.rootPath ?? process.cwd());
  const syncRuntime = createSyncRuntime({
    rootPath: syncRootPath,
    projectId: options.sync?.projectId,
    stateFilePath: options.sync?.stateFilePath,
    manifestFilePath: options.sync?.manifestFilePath,
    versionFilePath: options.sync?.versionFilePath,
    repositoryBaseDir: options.sync?.repositoryBaseDir,
    maxCharsPerChunk: options.sync?.maxCharsPerChunk,
    security: options.sync?.security
  });
  const driftMonitor = createSyncDriftMonitor({
    filePath: options.sync?.driftFilePath,
    maxHistory: options.sync?.driftMaxHistory
  });

  let lastSyncResult = {
    status: "never",
    runId: "",
    summary: {
      discovered: 0,
      created: 0,
      changed: 0,
      deleted: 0,
      unchanged: 0,
      filesChanged: 0,
      filesSkipped: 0,
      chunksProcessed: 0,
      chunksPersisted: 0,
      chunksCreated: 0,
      chunksUpdated: 0,
      chunksUnchanged: 0,
      chunksTombstoned: 0,
      duplicatesDetected: 0,
      redactionsApplied: 0
    },
    startedAt: "",
    finishedAt: "",
    files: {
      created: [],
      changed: [],
      deleted: [],
      unchanged: []
    },
    errors: [],
    warnings: [],
    runtime: {
      engine: "nexus-sync-internal",
      dedupScope: "per-source",
      repositoryBaseDir: syncRuntime.repositoryBaseDir
    }
  };

  const scheduler = createSyncScheduler({
    intervalMs: options.sync?.intervalMs,
    autoStart: options.sync?.autoStart,
    async onTick() {
      const startedAt = new Date().toISOString();
      try {
        const result = await syncRuntime.run();
        lastSyncResult = {
          ...result
        };
        await driftMonitor.record(lastSyncResult);

        if (result.status === "error") {
          throw new Error(result.errors?.[0] || "Sync runtime failed.");
        }
      } catch (error) {
        lastSyncResult = {
          status: "error",
          runId: "",
          startedAt,
          finishedAt: new Date().toISOString(),
          summary: {
            discovered: 0,
            created: 0,
            changed: 0,
            deleted: 0,
            unchanged: 0,
            filesChanged: 0,
            filesSkipped: 0,
            chunksProcessed: 0,
            chunksPersisted: 0,
            chunksCreated: 0,
            chunksUpdated: 0,
            chunksUnchanged: 0,
            chunksTombstoned: 0,
            duplicatesDetected: 0,
            redactionsApplied: 0
          },
          files: {
            created: [],
            changed: [],
            deleted: [],
            unchanged: []
          },
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
          runtime: {
            engine: "nexus-sync-internal",
            dedupScope: "per-source",
            repositoryBaseDir: syncRuntime.repositoryBaseDir
          }
        };
        await driftMonitor.record(lastSyncResult);
        throw error;
      }
    }
  });
  const observabilityFilePath = options.observabilityFilePath;
  const promptVersionStore = createPromptVersionStore({
    filePath: options.promptVersionFilePath
  });
  const rollbackPolicy = createRollbackPolicy(options.rollbackPolicy);
  const defaultDomainSuitePath = path.resolve(
    options.evals?.defaultDomainSuitePath ?? "benchmark/domain-eval-suite.json"
  );
  const openApiSpec = buildNexusOpenApiSpec({
    title: options.openApi?.title,
    version: options.openApi?.version,
    description: options.openApi?.description
  });
  const demoPage = buildNexusDemoPage();
  const compatibilityRoutes = [
    "GET /api/health",
    "GET /api/routes",
    "GET /api/metrics",
    "POST /api/remember",
    "POST /api/recall",
    "POST /api/chat",
    "POST /api/guard",
    "GET /api/openapi.json",
    "GET /api/demo",
    "GET /api/guard/policies",
    "POST /api/guard/output",
    "POST /api/pipeline/run",
    "POST /api/ask",
    "GET /api/sync/status",
    "GET /api/sync/drift",
    "POST /api/sync",
    "GET /api/observability/dashboard",
    "GET /api/observability/alerts",
    "POST /api/evals/domain-suite",
    "GET /api/versioning/prompts",
    "POST /api/versioning/prompts",
    "GET /api/versioning/compare",
    "POST /api/versioning/rollback-plan"
  ];

  const host = options.host ?? "127.0.0.1";
  const port = Math.max(0, Number(options.port ?? 8787));

  /**
   * @param {string} command
   * @param {number} startedAt
   * @param {Parameters<typeof recordCommandMetric>[0]} [metric]
   */
  async function recordApiMetric(command, startedAt, metric = { command, durationMs: 0 }) {
    await recordCommandMetric(
      {
        ...metric,
        command,
        durationMs: Math.max(0, Date.now() - startedAt)
      },
      {
        filePath: observabilityFilePath
      }
    );
  }

  const server = http.createServer(async (request, response) => {
    const requestStartedAt = Date.now();
    const requestId = createRequestId();
    response.setHeader("x-request-id", requestId);

    try {
      const method = request.method ?? "GET";
      const requestUrl = getRequestUrl(request);
      const pathname = requestUrl.pathname || "/";

      if (method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "nexus-api",
          time: new Date().toISOString()
        });
        await recordApiMetric("api.health", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/routes") {
        sendJson(response, 200, {
          status: "ok",
          routes: compatibilityRoutes
        });
        await recordApiMetric("api.routes", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/metrics") {
        const report = await getObservabilityReport({
          filePath: observabilityFilePath
        });
        const totalRequests = report.totals?.runs ?? 0;
        const blocked = report.totals?.blockedRuns ?? 0;
        const errorRate = report.totals?.degradedRate ?? 0;
        const averageDurationMs = report.totals?.averageDurationMs ?? 0;

        sendJson(response, 200, {
          totalRequests,
          p95: averageDurationMs,
          errorRate,
          blocked,
          latency: {
            p95: averageDurationMs
          },
          requests: {
            total: totalRequests
          },
          errors: {
            rate: errorRate
          },
          guard: {
            blocked
          },
          recall: report.recall ?? {},
          selection: report.selection ?? {},
          totals: report.totals ?? {}
        });
        await recordApiMetric("api.metrics", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/openapi.json") {
        sendJson(response, 200, {
          ...openApiSpec,
          servers: [
            {
              url: `http://${request.headers.host ?? `${host}:${port}`}`
            }
          ]
        });
        await recordApiMetric("api.openapi", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/demo") {
        sendHtml(response, 200, demoPage);
        await recordApiMetric("api.demo", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/guard/policies") {
        sendJson(response, 200, {
          status: "ok",
          profiles: listDomainGuardPolicyProfiles()
        });
        await recordApiMetric("api.guard.policies", requestStartedAt);
        return;
      }

      const authResult = auth.authorize({
        headers: request.headers
      });

      if (!authResult.authorized) {
        sendErrorJson(response, authResult.statusCode ?? 401, {
          requestId,
          code: "auth_unauthorized",
          message: authResult.error ?? "Unauthorized request.",
          details: {
            reason: authResult.reason ?? "unauthorized"
          }
        });
        await recordApiMetric("api.auth.blocked", requestStartedAt, {
          command: "api.auth.blocked",
          durationMs: 0,
          degraded: true,
          safety: {
            blocked: true,
            reason: authResult.reason ?? "unauthorized"
          }
        });
        return;
      }

      if (method === "POST" && pathname === "/api/remember") {
        const body = /** @type {{ title?: string, source?: string, content?: string, text?: string, type?: string, kind?: string }} */ (
          await readJsonBody(request)
        );
        const title = String(body.title ?? body.source ?? "document").trim() || "document";
        const content = String(body.content ?? body.text ?? "").trim();
        const kind = String(body.type ?? body.kind ?? "doc").trim() || "doc";

        if (!content) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_content",
            message: "Missing 'content' in request body."
          });
          await recordApiMetric("api.remember", requestStartedAt, {
            command: "api.remember",
            durationMs: 0,
            degraded: true,
            safety: {
              blocked: true,
              reason: "missing-content"
            }
          });
          return;
        }

        const ingestState = await defaultExecutors.ingest({
          input: {
            documents: [
              {
                source: title,
                content,
                kind
              }
            ],
            query: "",
            limit: 1
          }
        });
        const processState = await defaultExecutors.process({
          input: ingestState
        });
        const storeState = await defaultExecutors.store({
          input: processState
        });
        const chunks = asArray(asRecord(processState).chunks);
        const firstChunk = asRecord(chunks[0]);

        sendJson(response, 200, {
          status: "ok",
          id: String(firstChunk.id ?? requestId),
          title,
          kind,
          stored: Number(asRecord(storeState).storedCount ?? 0),
          chunks: chunks.length,
          tokens: estimateTokenCount(content),
          repositoryFilePath: String(asRecord(storeState).repositoryFilePath ?? "")
        });
        await recordApiMetric("api.remember", requestStartedAt);
        return;
      }

      if (method === "POST" && pathname === "/api/recall") {
        const body = /** @type {{ query?: string, limit?: number }} */ (await readJsonBody(request));
        const query = String(body.query ?? "").trim();
        const limit =
          typeof body.limit === "number" && Number.isFinite(body.limit)
            ? Math.max(1, Math.trunc(body.limit))
            : 8;

        if (!query) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_query",
            message: "Missing 'query' in request body."
          });
          await recordApiMetric("api.recall", requestStartedAt, {
            command: "api.recall",
            durationMs: 0,
            degraded: true,
            recall: {
              attempted: true,
              status: "failed",
              recoveredChunks: 0,
              selectedChunks: 0,
              suppressedChunks: 0,
              hit: false
            },
            safety: {
              blocked: true,
              reason: "missing-query"
            }
          });
          return;
        }

        const recallState = await defaultExecutors.recall({
          input: {
            query,
            limit
          }
        });
        const recallResults = asArray(asRecord(recallState).results);
        const chunks = recallResults.map((entry, index) => normalizeLegacyChunk(entry, index));
        const tokenTotal = chunks.reduce((sum, chunk) => sum + estimateTokenCount(chunk.content), 0);

        sendJson(response, 200, {
          status: "ok",
          query,
          chunks,
          total: chunks.length,
          stats: {
            chunks: chunks.length,
            tokens: tokenTotal,
            hit: chunks.length > 0
          }
        });
        await recordApiMetric("api.recall", requestStartedAt, {
          command: "api.recall",
          durationMs: 0,
          recall: {
            attempted: true,
            status: chunks.length ? "recalled" : "empty",
            recoveredChunks: chunks.length,
            selectedChunks: chunks.length,
            suppressedChunks: 0,
            hit: chunks.length > 0
          },
          selection: {
            selectedCount: chunks.length,
            suppressedCount: 0
          }
        });
        return;
      }

      if (method === "POST" && pathname === "/api/chat") {
        const body = /** @type {{
         *   query?: string,
         *   question?: string,
         *   task?: string,
         *   objective?: string,
         *   language?: "es" | "en",
         *   provider?: string,
         *   fallbackProviders?: string[],
         *   attemptTimeoutMs?: number,
         *   model?: string,
         *   chunks?: Array<Record<string, unknown>>,
         *   withContext?: boolean,
         *   tokenBudget?: number,
         *   maxChunks?: number,
         *   guardPolicyProfile?: string,
         *   guard?: object,
         *   compliance?: object
         * }} */ (await readJsonBody(request));

        const query = String(body.query ?? body.question ?? "").trim();

        if (!query) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_query",
            message: "Missing 'query' in request body."
          });
          await recordApiMetric("api.chat", requestStartedAt, {
            command: "api.chat",
            durationMs: 0,
            degraded: true,
            safety: {
              blocked: true,
              reason: "missing-query"
            }
          });
          return;
        }

        const includeContext = body.withContext !== false;
        const sourceChunks = includeContext ? asArray(body.chunks) : [];
        const normalizedChunks = sourceChunks.map((entry, index) => {
          const normalized = normalizeLegacyChunk(entry, index);
          return {
            id: normalized.id,
            source: normalized.source,
            kind: normalized.kind,
            content: normalized.content,
            priority: normalized.priority
          };
        });
        const rawTokens = sourceChunks.reduce((sum, entry) => {
          const record = asRecord(entry);
          const providedTokens = Number(record.tokens ?? 0);

          if (Number.isFinite(providedTokens) && providedTokens > 0) {
            return sum + Math.round(providedTokens);
          }

          return sum + estimateTokenCount(String(record.content ?? ""));
        }, 0);

        const builtPrompt = buildLlmPrompt({
          question: query,
          task: body.task,
          objective: body.objective,
          language: body.language,
          chunks: normalizedChunks,
          tokenBudget: body.tokenBudget ?? options.llm?.tokenBudget,
          maxChunks: body.maxChunks ?? options.llm?.maxChunks
        });
        const contextImpact = buildContextImpact({
          rawChunks: sourceChunks.length,
          rawTokens,
          selectedChunks: builtPrompt.context.includedChunks.length,
          selectedTokens: builtPrompt.context.stats.usedTokens,
          suppressedChunks: builtPrompt.context.suppressedChunks.length
        });

        try {
          const generation = await registry.generateWithFallback(builtPrompt.prompt, {
            provider: body.provider,
            fallbackProviders: Array.isArray(body.fallbackProviders)
              ? body.fallbackProviders
              : [],
            attemptTimeoutMs: Number(
              body.attemptTimeoutMs ?? options.llm?.attemptTimeoutMs ?? 0
            ),
            options: {
              model: body.model
            }
          });
          const generated = generation.generated;
          const parsed = parseLlmResponse(generated.content);
          const compliance = checkOutputCompliance(generated.content, /** @type {any} */ (body.compliance ?? {}));
          const guardPolicy = resolveDomainGuardPolicy(
            body.guardPolicyProfile,
            /** @type {Record<string, unknown>} */ (body.guard ?? {})
          );
          const guard = enforceOutputGuard(generated.content, /** @type {any} */ (guardPolicy));
          const isBlocked = !(guard.allowed && compliance.compliant);

          await outputAuditor.record({
            action: guard.action,
            reasons: [...guard.reasons, ...compliance.violations],
            outputLength: guard.output.length,
            source: "api:chat",
            metadata: {
              provider: generation.provider,
              fallbackAttempts: generation.attempts,
              compliant: compliance.compliant
            }
          });

          sendJson(response, isBlocked ? 422 : 200, {
            status: isBlocked ? "blocked" : "ok",
            response: guard.output,
            provider: generation.provider,
            model: generated.model,
            usage: generated.usage ?? {},
            blocked: isBlocked,
            promptStats: builtPrompt.context.stats,
            prompt: {
              language: builtPrompt.language,
              stats: builtPrompt.context.stats,
              includedChunks: builtPrompt.context.includedChunks.length,
              suppressedChunks: builtPrompt.context.suppressedChunks.length
            },
            context: {
              rawChunks: sourceChunks.length,
              rawTokens,
              selectedChunks: builtPrompt.context.includedChunks.length,
              selectedTokens: builtPrompt.context.stats.usedTokens,
              suppressedChunks: builtPrompt.context.suppressedChunks.length
            },
            impact: contextImpact,
            fallback: {
              attempts: generation.attempts,
              summary: generation.summary
            },
            parsed,
            guard,
            compliance
          });
          await recordApiMetric("api.chat", requestStartedAt, {
            command: "api.chat",
            durationMs: 0,
            degraded: generation.summary.failedAttempts > 0,
            selection: {
              selectedCount: builtPrompt.context.includedChunks.length,
              suppressedCount: builtPrompt.context.suppressedChunks.length
            },
            safety: {
              blocked: isBlocked,
              reason: guard.reasons[0] ?? compliance.violations[0] ?? ""
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const preview = normalizedChunks
            .slice(0, 2)
            .map((chunk, index) => {
              const source = String(chunk.source ?? `chunk-${index + 1}`);
              const excerpt = String(chunk.content ?? "").trim().slice(0, 220);
              return `${index + 1}) [${source}] ${excerpt}`;
            });
          const fallbackResponse = [
            "⚠ NEXUS está en modo degradado (sin proveedor LLM disponible).",
            "",
            normalizedChunks.length
              ? "Resumen de contexto recuperado:"
              : "No hay chunks recuperados para esta consulta.",
            ...preview
          ]
            .filter(Boolean)
            .join("\n");

          sendJson(response, 200, {
            status: "degraded",
            degraded: true,
            response: fallbackResponse,
            provider: "offline-fallback",
            model: "none",
            usage: {
              inputTokens: builtPrompt.context.stats.usedTokens,
              outputTokens: estimateTokenCount(fallbackResponse)
            },
            blocked: false,
            promptStats: builtPrompt.context.stats,
            context: {
              rawChunks: sourceChunks.length,
              rawTokens,
              selectedChunks: builtPrompt.context.includedChunks.length,
              selectedTokens: builtPrompt.context.stats.usedTokens,
              suppressedChunks: builtPrompt.context.suppressedChunks.length
            },
            impact: contextImpact,
            fallback: {
              attempts: 0,
              summary: {
                attemptedProviders: 0,
                failedAttempts: 0,
                succeededAfterRetries: false
              }
            },
            error: message
          });
          await recordApiMetric("api.chat", requestStartedAt, {
            command: "api.chat",
            durationMs: 0,
            degraded: true,
            selection: {
              selectedCount: builtPrompt.context.includedChunks.length,
              suppressedCount: builtPrompt.context.suppressedChunks.length
            },
            safety: {
              blocked: false,
              reason: "llm-provider-unavailable"
            }
          });
        }
        return;
      }

      if (method === "POST" && pathname === "/api/guard") {
        const guardStartedAt = Date.now();
        const body = /** @type {{ query?: string, output?: string, guardPolicyProfile?: string, guard?: object, compliance?: object }} */ (
          await readJsonBody(request)
        );
        const output = String(body.query ?? body.output ?? "");
        const compliance = checkOutputCompliance(output, /** @type {any} */ (body.compliance ?? {}));
        const guardPolicy = resolveDomainGuardPolicy(
          body.guardPolicyProfile,
          /** @type {Record<string, unknown>} */ (body.guard ?? {})
        );
        const guard = enforceOutputGuard(output, /** @type {any} */ (guardPolicy));
        const blocked = !(guard.allowed && compliance.compliant);
        const reason = guard.reasons[0] ?? compliance.violations[0] ?? "";

        sendJson(response, blocked ? 403 : 200, {
          status: blocked ? "blocked" : "ok",
          blocked,
          warned: !blocked && (guard.reasons.length > 0 || compliance.violations.length > 0),
          blockedBy: reason,
          userMessage: blocked ? reason || "Request blocked by guard policy." : "Allowed by guard policy.",
          results: [
            ...guard.reasons.map((entry) => ({
              type: "guard",
              message: entry
            })),
            ...compliance.violations.map((entry) => ({
              type: "compliance",
              message: entry
            }))
          ],
          durationMs: Math.max(0, Date.now() - guardStartedAt),
          guard,
          compliance
        });
        await recordApiMetric("api.guard", requestStartedAt, {
          command: "api.guard",
          durationMs: 0,
          safety: {
            blocked,
            reason
          }
        });
        return;
      }

      if (method === "GET" && pathname === "/api/sync/status") {
        sendJson(response, 200, {
          status: "ok",
          scheduler: scheduler.getStatus(),
          lastSync: lastSyncResult
        });
        await recordApiMetric("api.sync.status", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/sync/drift") {
        const report = await driftMonitor.getReport({
          warningRatio: Number(requestUrl.searchParams.get("warningRatio") ?? 0),
          criticalRatio: Number(requestUrl.searchParams.get("criticalRatio") ?? 0),
          spikeMultiplier: Number(requestUrl.searchParams.get("spikeMultiplier") ?? 0),
          baselineWindow: Number(requestUrl.searchParams.get("baselineWindow") ?? 0)
        });
        sendJson(response, 200, {
          status: "ok",
          drift: report
        });
        await recordApiMetric("api.sync.drift", requestStartedAt);
        return;
      }

      if (method === "POST" && pathname === "/api/sync") {
        await scheduler.runNow();
        sendJson(response, 200, {
          status: "ok",
          scheduler: scheduler.getStatus(),
          lastSync: lastSyncResult
        });
        await recordApiMetric("api.sync.run", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/observability/dashboard") {
        const topCommands = Math.max(
          1,
          Math.trunc(Number(requestUrl.searchParams.get("topCommands") ?? 8))
        );
        const report = await getObservabilityReport({
          filePath: observabilityFilePath
        });
        const dashboard = await buildDashboardData({
          metrics: report,
          topCommands
        });

        sendJson(response, 200, {
          status: "ok",
          dashboard
        });
        await recordApiMetric("api.observability.dashboard", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/observability/alerts") {
        const thresholds = {
          blockedRateMax: Number(requestUrl.searchParams.get("blockedRateMax") ?? 0.25),
          degradedRateMax: Number(requestUrl.searchParams.get("degradedRateMax") ?? 0.35),
          recallHitRateMin: Number(requestUrl.searchParams.get("recallHitRateMin") ?? 0.15),
          averageDurationMsMax: Number(requestUrl.searchParams.get("averageDurationMsMax") ?? 1500),
          minRuns: Number(requestUrl.searchParams.get("minRuns") ?? 20)
        };
        const report = await getObservabilityReport({
          filePath: observabilityFilePath
        });
        const alerts = evaluateObservabilityAlerts(report.totals ? report : {}, thresholds);

        sendJson(response, 200, {
          status: "ok",
          alerts
        });
        await recordApiMetric("api.observability.alerts", requestStartedAt);
        return;
      }

      if (method === "POST" && pathname === "/api/evals/domain-suite") {
        const body = /** @type {{ suitePath?: string, suite?: Record<string, unknown> }} */ (
          await readJsonBody(request)
        );
        const suitePath = String(body.suitePath ?? defaultDomainSuitePath).trim();
        const sourceSuite =
          body.suite && typeof body.suite === "object"
            ? body.suite
            : await loadDomainEvalSuite(suitePath);
        const suiteRecord =
          sourceSuite && typeof sourceSuite === "object"
            ? /** @type {Record<string, unknown>} */ (sourceSuite)
            : {};

        const report = runDomainEvalSuite({
          suite: String(suiteRecord.suite ?? "nexus-domain-suite"),
          thresholds:
            suiteRecord.thresholds && typeof suiteRecord.thresholds === "object"
              ? /** @type {Record<string, unknown>} */ (suiteRecord.thresholds)
              : {},
          qualityPolicy:
            suiteRecord.qualityPolicy && typeof suiteRecord.qualityPolicy === "object"
              ? /** @type {Record<string, unknown>} */ (suiteRecord.qualityPolicy)
              : {},
          cases: Array.isArray(suiteRecord.cases) ? suiteRecord.cases : []
        });

        sendJson(response, 200, {
          status: report.status,
          suitePath,
          report
        });
        await recordApiMetric("api.evals.domain-suite", requestStartedAt, {
          command: "api.evals.domain-suite",
          durationMs: 0,
          degraded: report.status !== "pass",
          safety: {
            blocked: report.status !== "pass",
            reason: report.status !== "pass" ? "domain-evals-blocked" : ""
          }
        });
        return;
      }

      if (method === "GET" && pathname === "/api/versioning/prompts") {
        const promptKey = String(requestUrl.searchParams.get("promptKey") ?? "").trim();

        if (!promptKey) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_prompt_key",
            message: "Missing 'promptKey' query parameter."
          });
          await recordApiMetric("api.versioning.list", requestStartedAt, {
            command: "api.versioning.list",
            durationMs: 0,
            degraded: true,
            safety: {
              blocked: true,
              reason: "missing-prompt-key"
            }
          });
          return;
        }

        const versions = await promptVersionStore.listVersions(promptKey);
        sendJson(response, 200, {
          status: "ok",
          promptKey,
          versions
        });
        await recordApiMetric("api.versioning.list", requestStartedAt);
        return;
      }

      if (method === "POST" && pathname === "/api/versioning/prompts") {
        const body = /** @type {{ promptKey?: string, content?: string, metadata?: Record<string, unknown> }} */ (
          await readJsonBody(request)
        );
        const promptKey = String(body.promptKey ?? "").trim();
        const content = String(body.content ?? "").trim();

        if (!promptKey || !content) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_prompt_version_input",
            message: "Missing 'promptKey' or 'content' in request body."
          });
          await recordApiMetric("api.versioning.save", requestStartedAt, {
            command: "api.versioning.save",
            durationMs: 0,
            degraded: true,
            safety: {
              blocked: true,
              reason: "missing-prompt-version-input"
            }
          });
          return;
        }

        const version = await promptVersionStore.saveVersion({
          promptKey,
          content,
          metadata: body.metadata ?? {}
        });

        sendJson(response, 200, {
          status: "ok",
          version
        });
        await recordApiMetric("api.versioning.save", requestStartedAt);
        return;
      }

      if (method === "GET" && pathname === "/api/versioning/compare") {
        const leftId = String(requestUrl.searchParams.get("leftId") ?? "").trim();
        const rightId = String(requestUrl.searchParams.get("rightId") ?? "").trim();

        if (!leftId || !rightId) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_version_diff_input",
            message: "Missing 'leftId' or 'rightId' query parameters."
          });
          await recordApiMetric("api.versioning.compare", requestStartedAt, {
            command: "api.versioning.compare",
            durationMs: 0,
            degraded: true,
            safety: {
              blocked: true,
              reason: "missing-version-diff-input"
            }
          });
          return;
        }

        const diff = await promptVersionStore.diffVersions(leftId, rightId);
        sendJson(response, 200, {
          status: "ok",
          diff
        });
        await recordApiMetric("api.versioning.compare", requestStartedAt);
        return;
      }

      if (method === "POST" && pathname === "/api/versioning/rollback-plan") {
        const body = /** @type {{ promptKey?: string, evalScoresByVersion?: Record<string, number>, minScore?: number, preferPrevious?: boolean }} */ (
          await readJsonBody(request)
        );
        const promptKey = String(body.promptKey ?? "").trim();

        if (!promptKey) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_prompt_key",
            message: "Missing 'promptKey' in request body."
          });
          await recordApiMetric("api.versioning.rollback-plan", requestStartedAt, {
            command: "api.versioning.rollback-plan",
            durationMs: 0,
            degraded: true,
            safety: {
              blocked: true,
              reason: "missing-prompt-key"
            }
          });
          return;
        }

        const plan = await rollbackPolicy.buildPlan(promptVersionStore, {
          promptKey,
          evalScoresByVersion:
            body.evalScoresByVersion && typeof body.evalScoresByVersion === "object"
              ? body.evalScoresByVersion
              : {},
          minScore: body.minScore,
          preferPrevious: body.preferPrevious
        });
        sendJson(response, 200, {
          status: "ok",
          rollback: plan
        });
        await recordApiMetric("api.versioning.rollback-plan", requestStartedAt);
        return;
      }

      if (method === "POST" && pathname === "/api/guard/output") {
        const body = /** @type {{ output?: string, guard?: object, compliance?: object, guardPolicyProfile?: string }} */ (
          await readJsonBody(request)
        );
        const output = String(body.output ?? "");
        const compliance = checkOutputCompliance(output, /** @type {any} */ (body.compliance ?? {}));
        const guardPolicy = resolveDomainGuardPolicy(
          body.guardPolicyProfile,
          /** @type {Record<string, unknown>} */ (body.guard ?? {})
        );
        const guard = enforceOutputGuard(output, /** @type {any} */ (guardPolicy));

        await outputAuditor.record({
          action: guard.action,
          reasons: [...guard.reasons, ...compliance.violations],
          outputLength: guard.output.length,
          source: "api:guard/output",
          metadata: {
            compliant: compliance.compliant
          }
        });

        sendJson(response, guard.allowed && compliance.compliant ? 200 : 422, {
          status: guard.allowed && compliance.compliant ? "ok" : "blocked",
          guard,
          compliance
        });
        await recordApiMetric("api.guard.output", requestStartedAt, {
          command: "api.guard.output",
          durationMs: 0,
          safety: {
            blocked: !(guard.allowed && compliance.compliant),
            reason: guard.reasons[0] ?? compliance.violations[0] ?? ""
          }
        });
        return;
      }

      if (method === "POST" && pathname === "/api/pipeline/run") {
        const body = /** @type {{ input?: unknown, pipeline?: import("../orchestration/pipeline-builder.js").WorkflowPipeline }} */ (
          await readJsonBody(request)
        );
        const pipeline = body.pipeline ?? buildDefaultNexusPipeline();
        const result = await pipelineBuilder.runPipeline(pipeline, body.input ?? {});

        sendJson(response, 200, {
          status: "ok",
          pipeline: result
        });
        await recordApiMetric("api.pipeline.run", requestStartedAt);
        return;
      }

      if (method === "POST" && pathname === "/api/ask") {
        const body = /** @type {{
         *   question?: string,
         *   task?: string,
         *   objective?: string,
         *   language?: "es" | "en",
         *   provider?: string,
         *   fallbackProviders?: string[],
         *   attemptTimeoutMs?: number,
         *   model?: string,
         *   chunks?: import("../types/core-contracts.d.ts").Chunk[],
         *   tokenBudget?: number,
         *   maxChunks?: number,
         *   guardPolicyProfile?: string,
         *   guard?: object,
         *   compliance?: object
         * }} */ (await readJsonBody(request));

        const question = String(body.question ?? "").trim();

        if (!question) {
          sendErrorJson(response, 400, {
            requestId,
            code: "missing_question",
            message: "Missing 'question' in request body."
          });
          return;
        }

        const builtPrompt = buildLlmPrompt({
          question,
          task: body.task,
          objective: body.objective,
          language: body.language,
          chunks: Array.isArray(body.chunks) ? body.chunks : [],
          tokenBudget: body.tokenBudget ?? options.llm?.tokenBudget,
          maxChunks: body.maxChunks ?? options.llm?.maxChunks
        });
        const requestChunks = Array.isArray(body.chunks) ? body.chunks : [];
        const rawTokens = requestChunks.reduce((sum, entry) => {
          const record = asRecord(entry);
          const providedTokens = Number(record.tokens ?? 0);

          if (Number.isFinite(providedTokens) && providedTokens > 0) {
            return sum + Math.round(providedTokens);
          }

          return sum + estimateTokenCount(String(record.content ?? ""));
        }, 0);
        const contextImpact = buildContextImpact({
          rawChunks: requestChunks.length,
          rawTokens,
          selectedChunks: builtPrompt.context.includedChunks.length,
          selectedTokens: builtPrompt.context.stats.usedTokens,
          suppressedChunks: builtPrompt.context.suppressedChunks.length
        });

        try {
          const generation = await registry.generateWithFallback(builtPrompt.prompt, {
            provider: body.provider,
            fallbackProviders: Array.isArray(body.fallbackProviders)
              ? body.fallbackProviders
              : [],
            attemptTimeoutMs: Number(
              body.attemptTimeoutMs ?? options.llm?.attemptTimeoutMs ?? 0
            ),
            options: {
              model: body.model
            }
          });
          const generated = generation.generated;
          const parsed = parseLlmResponse(generated.content);
          const compliance = checkOutputCompliance(generated.content, /** @type {any} */ (body.compliance ?? {}));
          const guardPolicy = resolveDomainGuardPolicy(
            body.guardPolicyProfile,
            /** @type {Record<string, unknown>} */ (body.guard ?? {})
          );
          const guard = enforceOutputGuard(generated.content, /** @type {any} */ (guardPolicy));

          await outputAuditor.record({
            action: guard.action,
            reasons: [...guard.reasons, ...compliance.violations],
            outputLength: guard.output.length,
            source: "api:ask",
            metadata: {
              provider: generation.provider,
              fallbackAttempts: generation.attempts,
              compliant: compliance.compliant
            }
          });

          sendJson(response, guard.allowed && compliance.compliant ? 200 : 422, {
            status: guard.allowed && compliance.compliant ? "ok" : "blocked",
            provider: generation.provider,
            fallback: {
              attempts: generation.attempts,
              summary: generation.summary
            },
            prompt: {
              language: builtPrompt.language,
              stats: builtPrompt.context.stats,
              includedChunks: builtPrompt.context.includedChunks.length,
              suppressedChunks: builtPrompt.context.suppressedChunks.length
            },
            context: {
              rawChunks: requestChunks.length,
              rawTokens,
              selectedChunks: builtPrompt.context.includedChunks.length,
              selectedTokens: builtPrompt.context.stats.usedTokens,
              suppressedChunks: builtPrompt.context.suppressedChunks.length
            },
            impact: contextImpact,
            generation: {
              content: guard.output,
              finishReason: generated.finishReason,
              usage: generated.usage,
              model: generated.model
            },
            parsed,
            guard,
            compliance
          });
          await recordApiMetric("api.ask", requestStartedAt, {
            command: "api.ask",
            durationMs: 0,
            degraded: generation.summary.failedAttempts > 0,
            selection: {
              selectedCount: builtPrompt.context.includedChunks.length,
              suppressedCount: builtPrompt.context.suppressedChunks.length
            },
            safety: {
              blocked: !(guard.allowed && compliance.compliant),
              reason: guard.reasons[0] ?? compliance.violations[0] ?? ""
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const preview = builtPrompt.context.includedChunks
            .slice(0, 2)
            .map((chunk, index) => {
              const source = String(chunk.source ?? `chunk-${index + 1}`);
              const excerpt = String(chunk.content ?? "").trim().slice(0, 220);
              return `${index + 1}) [${source}] ${excerpt}`;
            });
          const fallbackResponse = [
            "⚠ NEXUS está en modo degradado (sin proveedor LLM disponible).",
            "",
            builtPrompt.context.includedChunks.length
              ? "Resumen de contexto recuperado:"
              : "No hay chunks seleccionados para esta consulta.",
            ...preview
          ]
            .filter(Boolean)
            .join("\n");

          sendJson(response, 200, {
            status: "degraded",
            degraded: true,
            provider: "offline-fallback",
            prompt: {
              language: builtPrompt.language,
              stats: builtPrompt.context.stats,
              includedChunks: builtPrompt.context.includedChunks.length,
              suppressedChunks: builtPrompt.context.suppressedChunks.length
            },
            context: {
              rawChunks: requestChunks.length,
              rawTokens,
              selectedChunks: builtPrompt.context.includedChunks.length,
              selectedTokens: builtPrompt.context.stats.usedTokens,
              suppressedChunks: builtPrompt.context.suppressedChunks.length
            },
            impact: contextImpact,
            generation: {
              content: fallbackResponse,
              finishReason: "degraded",
              usage: {
                inputTokens: builtPrompt.context.stats.usedTokens,
                outputTokens: estimateTokenCount(fallbackResponse)
              },
              model: "none"
            },
            fallback: {
              attempts: 0,
              summary: {
                attemptedProviders: 0,
                failedAttempts: 0,
                succeededAfterRetries: false
              }
            },
            error: message
          });
          await recordApiMetric("api.ask", requestStartedAt, {
            command: "api.ask",
            durationMs: 0,
            degraded: true,
            selection: {
              selectedCount: builtPrompt.context.includedChunks.length,
              suppressedCount: builtPrompt.context.suppressedChunks.length
            },
            safety: {
              blocked: false,
              reason: "llm-provider-unavailable"
            }
          });
        }
        return;
      }

      sendErrorJson(response, 404, {
        requestId,
        code: "route_not_found",
        message: `Route ${method} ${pathname} not found.`
      });
      await recordApiMetric("api.route.404", requestStartedAt, {
        command: "api.route.404",
        durationMs: 0,
        degraded: true,
        safety: {
          blocked: true,
          reason: "route-not-found"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const invalidJson = /Invalid JSON request body\./i.test(message);
      const statusCode = invalidJson ? 400 : 500;

      sendErrorJson(response, statusCode, {
        requestId,
        code: invalidJson ? "invalid_json" : "internal_error",
        message
      });
      await recordApiMetric(invalidJson ? "api.route.400" : "api.route.500", requestStartedAt, {
        command: invalidJson ? "api.route.400" : "api.route.500",
        durationMs: 0,
        degraded: true,
        safety: {
          blocked: true,
          reason: invalidJson ? "invalid-json" : "internal-error"
        }
      });
    }
  });

  return {
    host,
    port,
    server,
    scheduler,
    syncRuntime,
    registry,
    promptVersionStore,
    driftMonitor,
    rollbackPolicy,
    openApiSpec,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(undefined));
      });

      const address = server.address();
      return {
        host,
        port: typeof address === "object" && address ? address.port : port
      };
    },
    async stop() {
      scheduler.stop();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(undefined);
        });
      });
      return {
        stopped: true
      };
    }
  };
}
