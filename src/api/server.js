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
import { createChangeDetector } from "../sync/change-detector.js";
import { createSyncScheduler } from "../sync/sync-scheduler.js";
import { createSyncDriftMonitor } from "../sync/drift-monitor.js";
import { createPipelineBuilder, buildDefaultNexusPipeline } from "../orchestration/pipeline-builder.js";
import { createDefaultExecutors } from "../orchestration/default-executors.js";
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
  const changeDetector = createChangeDetector({
    stateFilePath: options.sync?.stateFilePath
  });
  const driftMonitor = createSyncDriftMonitor({
    filePath: options.sync?.driftFilePath,
    maxHistory: options.sync?.driftMaxHistory
  });

  let lastSyncResult = {
    status: "never",
    summary: {
      discovered: 0,
      created: 0,
      changed: 0,
      deleted: 0,
      unchanged: 0
    },
    startedAt: "",
    finishedAt: ""
  };

  const scheduler = createSyncScheduler({
    intervalMs: options.sync?.intervalMs,
    autoStart: options.sync?.autoStart,
    async onTick() {
      const startedAt = new Date().toISOString();
      try {
        const result = await changeDetector.detectChanges(syncRootPath);
        lastSyncResult = {
          status: "ok",
          startedAt,
          finishedAt: new Date().toISOString(),
          ...result
        };
        await driftMonitor.record(lastSyncResult);
      } catch (error) {
        lastSyncResult = {
          status: "error",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
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
  const openApiSpec = buildNexusOpenApiSpec({
    title: options.openApi?.title,
    version: options.openApi?.version,
    description: options.openApi?.description
  });
  const demoPage = buildNexusDemoPage();

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
        sendJson(response, authResult.statusCode ?? 401, {
          status: "error",
          error: authResult.error,
          reason: authResult.reason
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

      if (method === "GET" && pathname === "/api/versioning/prompts") {
        const promptKey = String(requestUrl.searchParams.get("promptKey") ?? "").trim();

        if (!promptKey) {
          sendJson(response, 400, {
            status: "error",
            error: "Missing 'promptKey' query parameter."
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
          sendJson(response, 400, {
            status: "error",
            error: "Missing 'promptKey' or 'content' in request body."
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
          sendJson(response, 400, {
            status: "error",
            error: "Missing 'leftId' or 'rightId' query parameters."
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
          sendJson(response, 400, {
            status: "error",
            error: "Missing 'promptKey' in request body."
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
          sendJson(response, 400, {
            status: "error",
            error: "Missing 'question' in request body."
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
        return;
      }

      sendJson(response, 404, {
        status: "error",
        error: `Route ${method} ${pathname} not found.`
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
      sendJson(response, 500, {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      await recordApiMetric("api.route.500", requestStartedAt, {
        command: "api.route.500",
        durationMs: 0,
        degraded: true,
        safety: {
          blocked: true,
          reason: "internal-error"
        }
      });
    }
  });

  return {
    host,
    port,
    server,
    scheduler,
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
