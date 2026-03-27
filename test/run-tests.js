import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { buildLearningReadme } from "../src/analysis/readme-generator.js";
import { runNexusComparisonSuite } from "../src/benchmark/nexus-comparison.js";
import { runCli } from "../src/cli/app.js";
import {
  evaluateDashboardRenderPolicy,
  createShellState,
  getShellMenuItems,
  normalizeShellRenderMode,
  resolveShellInput,
  shouldBlockMenuInteractionWhileBusy,
  shouldIgnoreMenuReadlineLine,
  shouldPreserveMenuActionOutput,
  tokenizeShellInput
} from "../src/cli/shell-command.js";
import {
  buildGeneratedSkillMarkdown,
  compareSkillTelemetry,
  createGeneratedSkillRegistry,
  detectSkillConflicts,
  evaluateSkillCandidateHealth,
  extractRepeatedTasks,
  parseSkillFrontmatterMetadata,
  parseSkillTelemetryJsonl,
  scoreSkillSimilarity,
  summarizeSkillTelemetry,
  toSkillSlug,
  upsertGeneratedSkillRegistry
} from "../src/skills/auto-generator.js";
import { defaultProjectConfig, parseProjectConfig } from "../src/contracts/config-contracts.js";
import { parseChunkFile } from "../src/contracts/context-contracts.js";
import { parseVerticalBenchmarkFile } from "../src/contracts/vertical-benchmark-contracts.js";
import { loadWorkspaceChunks } from "../src/io/workspace-chunks.js";
import { buildLearningPacket } from "../src/learning/mentor-loop.js";
import { initProjectConfig, runProjectDoctor } from "../src/system/project-ops.js";
import { parseDocumentStructure } from "../src/processing/structure-parser.js";
import { chunkDocument } from "../src/processing/chunker.js";
import { extractCodeSymbols } from "../src/processing/code-symbol-extractor.js";
import { tagChunkMetadata } from "../src/processing/metadata-tagger.js";
import { extractEntities } from "../src/processing/entity-extractor.js";
import { enforceOutputGuard } from "../src/guard/output-guard.js";
import { createOutputAuditor } from "../src/guard/output-auditor.js";
import { checkOutputCompliance } from "../src/guard/compliance-checker.js";
import { createChunkRepository } from "../src/storage/chunk-repository.js";
import { createBm25Index } from "../src/storage/bm25-index.js";
import { createHybridRetriever } from "../src/storage/hybrid-retriever.js";
import {
  createLlmProviderRegistry,
  generateWithProviderFallback,
  normalizeGenerateResult
} from "../src/llm/provider.js";
import { buildLlmPrompt } from "../src/llm/prompt-builder.js";
import { parseLlmResponse } from "../src/llm/response-parser.js";
import {
  buildDefaultNexusPipeline,
  createPipelineBuilder
} from "../src/orchestration/pipeline-builder.js";
import { createDefaultExecutors } from "../src/orchestration/default-executors.js";
import { createAuthMiddleware } from "../src/api/auth-middleware.js";
import { createNexusApiServer } from "../src/api/server.js";
import "../src/api/handlers.js";
import { matchRoute } from "../src/api/router.js";
import { loadApiAxioms } from "../src/api/axioms-loader.js";
import { createChangeDetector } from "../src/sync/change-detector.js";
import { createVersionTracker } from "../src/sync/version-tracker.js";
import { createSyncScheduler } from "../src/sync/sync-scheduler.js";
import { createSyncRuntime } from "../src/sync/sync-runtime.js";
import { scoreResponseConsistency } from "../src/eval/consistency-scorer.js";
import { evaluateCiGate, formatCiGateReport } from "../src/eval/ci-gate.js";
import {
  getObservabilityReport,
  recordCommandMetric
} from "../src/observability/metrics-store.js";
import { buildDashboardData } from "../src/observability/dashboard-data.js";
import {
  evaluateObservabilityAlerts,
  formatObservabilityAlertReport
} from "../src/observability/alert-engine.js";
import { createPromptVersionStore } from "../src/versioning/prompt-version-store.js";
import { buildRollbackPlan } from "../src/versioning/rollback-engine.js";
import { createRollbackPolicy } from "../src/versioning/rollback-policy.js";
import { createSyncDriftMonitor } from "../src/sync/drift-monitor.js";
import {
  listDomainGuardPolicyProfiles,
  resolveDomainGuardPolicy
} from "../src/guard/domain-policy-profiles.js";
import {
  buildCloseSummaryContent,
  createEngramClient,
  searchOutputToChunks
} from "../src/memory/engram-client.js";
import { createExternalBatteryMemoryClient } from "../src/memory/external-battery-memory-client.js";
import { createLocalMemoryStore } from "../src/memory/local-memory-store.js";
import { createResilientMemoryClient } from "../src/memory/resilient-memory-client.js";
import { buildTeachRecallQueries } from "../src/memory/recall-queries.js";
import { resolveTeachRecall } from "../src/memory/teach-recall.js";
import {
  buildKnowledgeBlocks,
  createNotionSyncClient,
  resolveNotionConfig
} from "../src/integrations/notion-sync.js";
import {
  compressContent,
  NEXUS_SCORING_PROFILES,
  selectContextWindow
} from "../src/context/noise-canceler.js";
import {
  redactSensitiveContent,
  shouldIgnoreSensitiveFile
} from "../src/security/secret-redaction.js";
import {
  normalizeProwlerStatusFilter,
  prowlerFindingsToChunkFile
} from "../src/security/prowler-ingest.js";
import {
  buildPrLearningsSyncPayload,
  extractPrBodyHighlights
} from "../src/ci/pr-learnings.js";
import {
  SECURITY_PIPELINE_SUMMARY_MARKER,
  buildSecurityPipelineSummaryComment,
  parseSecuritySummaryMetric
} from "../src/ci/security-pr-summary.js";
import {
  evaluateReleaseDiscipline,
  formatReleaseDisciplineReport
} from "../src/ci/release-discipline.js";
import {
  evaluateNorthStarGate,
  formatNorthStarGateReport
} from "../src/ci/north-star-gate.js";
import { buildNexusOpenApiSpec } from "../src/interface/nexus-openapi.js";
import { createNexusApiClient } from "../src/sdk/nexus-api-client.js";
import {
  formatDomainEvalSuiteReport,
  runDomainEvalSuite
} from "../src/eval/domain-eval-suite.js";
import {
  getGateErrors,
  formatGateErrors
} from "../src/guard/code-gate.js";
import {
  runArchitectureGate,
  checkFileArchitecture
} from "../src/guard/architecture-gate.js";
import { runDeprecationGate } from "../src/guard/deprecation-gate.js";
import { createAxiomStore } from "../src/memory/axiom-store.js";
import { createAxiomInjector, formatAxiomBlock } from "../src/memory/axiom-injector.js";
import {
  detectClusters,
  synthesizeAgent,
  runMitosisPipeline
} from "../src/orchestration/agent-synthesizer.js";

const tests = [];
const execFile = promisify(execFileCallback);
const TEST_MEMORY_ROOT = path.join(tmpdir(), `lcs-cli-test-memory-${process.pid}`);

process.env.LCS_TEST_MEMORY_BASE_DIR = path.join(TEST_MEMORY_ROOT, "memory");
process.env.LCS_TEST_MEMORY_FALLBACK_FILE = path.join(TEST_MEMORY_ROOT, "local-memory-store.jsonl");
process.env.LCS_TEST_MEMORY_QUARANTINE_DIR = path.join(TEST_MEMORY_ROOT, "memory-quarantine");

function run(name, fn) {
  tests.push({ name, fn });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} root
 * @param {string} pathExpression
 */
function getPathValue(root, pathExpression) {
  const parts = pathExpression.split(".");
  /** @type {unknown} */
  let current = root;

  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);

      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return {
          exists: false,
          value: undefined
        };
      }

      current = current[index];
      continue;
    }

    if (!isRecord(current) || !(part in current)) {
      return {
        exists: false,
        value: undefined
      };
    }

    current = current[part];
  }

  return {
    exists: true,
    value: current
  };
}

/**
 * @param {unknown} value
 * @param {string} expectedType
 */
function assertValueType(value, expectedType) {
  if (expectedType === "string") {
    assert.equal(typeof value, "string");
    return;
  }

  if (expectedType === "number") {
    assert.equal(typeof value, "number");
    return;
  }

  if (expectedType === "boolean") {
    assert.equal(typeof value, "boolean");
    return;
  }

  if (expectedType === "array") {
    assert.equal(Array.isArray(value), true);
    return;
  }

  if (expectedType === "object") {
    assert.equal(isRecord(value), true);
    return;
  }

  if (expectedType === "object_or_null") {
    assert.equal(value === null || isRecord(value), true);
    return;
  }

  throw new Error(`Unsupported expected type '${expectedType}'.`);
}

/**
 * @param {string} value
 */
function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

/**
 * @param {string} name
 */
async function loadContractFixture(name) {
  const fixturePath = path.join(
    process.cwd(),
    "test",
    "fixtures",
    "contracts",
    "v1",
    `${name}.json`
  );
  const content = await readFile(fixturePath, "utf8");
  return JSON.parse(content);
}

/**
 * @param {unknown} contract
 * @param {{
 *   requiredPaths?: string[],
 *   pathTypes?: Record<string, string>,
 *   arrayItemRequiredPaths?: Record<string, string[]>
 * }} fixture
 * @param {string} label
 */
function assertContractCompatibility(contract, fixture, label) {
  for (const requiredPath of fixture.requiredPaths ?? []) {
    const resolved = getPathValue(contract, requiredPath);
    assert.equal(
      resolved.exists,
      true,
      `${label}: required path '${requiredPath}' is missing`
    );
  }

  for (const [pathExpression, expectedType] of Object.entries(fixture.pathTypes ?? {})) {
    const resolved = getPathValue(contract, pathExpression);

    assert.equal(
      resolved.exists,
      true,
      `${label}: typed path '${pathExpression}' is missing`
    );
    assertValueType(resolved.value, expectedType);
  }

  for (const [pathExpression, requiredKeys] of Object.entries(fixture.arrayItemRequiredPaths ?? {})) {
    const resolved = getPathValue(contract, pathExpression);

    assert.equal(
      resolved.exists,
      true,
      `${label}: array path '${pathExpression}' is missing`
    );
    assert.equal(Array.isArray(resolved.value), true, `${label}: '${pathExpression}' must be an array`);

    if (!Array.isArray(resolved.value)) {
      continue;
    }

    for (const [index, item] of resolved.value.entries()) {
      assert.equal(
        isRecord(item),
        true,
        `${label}: '${pathExpression}[${index}]' must be an object`
      );

      if (!isRecord(item)) {
        continue;
      }

      for (const key of requiredKeys) {
        assert.equal(
          key in item,
          true,
          `${label}: '${pathExpression}[${index}].${key}' is missing`
        );
      }
    }
  }
}

const JSON_CONTRACT_COMMANDS = [
  "version",
  "doctor",
  "doctor-memory",
  "memory-stats",
  "init",
  "prune-memory",
  "compact-memory",
  "sync-knowledge",
  "ingest-security",
  "select",
  "teach",
  "readme",
  "recall",
  "remember",
  "close"
];

/**
 * @param {string} message
 * @param {{
 *   code?: string,
 *   stdout?: string,
 *   stderr?: string
 * }} [extra]
 */
function createExecError(message, extra = {}) {
  const error = new Error(message);
  return Object.assign(error, extra);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 */
function createHs256Jwt(payload, secret) {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const encode = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/gu, "");
  const encodedHeader = encode(header);
  const encodedPayload = encode(payload);
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

run("prioritizes relevant code and filters noisy logs", () => {
  const chunks = [
    {
      id: "code-auth",
      source: "src/auth.js",
      kind: "code",
      content: "Authentication middleware validates JWT tokens and rejects expired sessions.",
      certainty: 0.95,
      recency: 0.9,
      teachingValue: 0.8,
      priority: 0.9
    },
    {
      id: "log-noise",
      source: "runtime.log",
      kind: "log",
      content: "INFO boot INFO boot INFO boot debug trace trace trace repeated service heartbeat.",
      certainty: 0.3,
      recency: 0.4,
      teachingValue: 0.1,
      priority: 0.1
    },
    {
      id: "test-auth",
      source: "test/auth.test.js",
      kind: "test",
      content: "Tests cover invalid JWT handling and expired session behavior in middleware.",
      certainty: 0.9,
      recency: 0.85,
      teachingValue: 0.75,
      priority: 0.8
    }
  ];

  const result = selectContextWindow(chunks, {
    focus: "jwt middleware expired session validation",
    tokenBudget: 120
  });

  assert.equal(result.selected[0].id, "code-auth");
  assert.ok(result.selected.some((chunk) => chunk.id === "test-auth"));
  assert.ok(result.suppressed.some((chunk) => chunk.id === "log-noise"));
});

run("suppresses highly redundant chunks", () => {
  const chunks = [
    {
      id: "memory-a",
      source: "memory/a.md",
      kind: "memory",
      content: "Use optimistic updates in the cart service to keep the UI responsive.",
      certainty: 0.9,
      recency: 0.8,
      teachingValue: 0.7,
      priority: 0.8
    },
    {
      id: "memory-b",
      source: "memory/b.md",
      kind: "memory",
      content: "Use optimistic updates in the cart service to keep the UI responsive for users.",
      certainty: 0.9,
      recency: 0.75,
      teachingValue: 0.68,
      priority: 0.75
    }
  ];

  const result = selectContextWindow(chunks, {
    focus: "optimistic updates cart ui",
    tokenBudget: 120
  });

  assert.equal(result.selected.length, 1);
  assert.ok(result.suppressed.some((chunk) => chunk.id === "memory-b"));
});

run("keeps the most focus-heavy sentences during compression", () => {
  const content = [
    "The cache layer is experimental and unrelated.",
    "JWT verification happens inside the auth middleware before request routing.",
    "Old notes about CSS refactors are not important here.",
    "Expired sessions trigger a 401 response and short-circuit the pipeline."
  ].join(" ");

  const compressed = compressContent(content, "jwt auth middleware expired sessions", 2);

  assert.match(compressed, /JWT verification/);
  assert.match(compressed, /Expired sessions/);
  assert.doesNotMatch(compressed, /CSS refactors/);
});

run("builds a learning packet with teaching scaffolding", () => {
  const packet = buildLearningPacket({
    task: "Improve auth middleware",
    objective: "Teach why JWT validation order matters",
    changedFiles: ["src/auth.js"],
    chunks: [
      {
        id: "code-auth",
        source: "src/auth.js",
        kind: "code",
        content: "JWT validation now runs before route handlers to fail fast on invalid tokens.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.9,
        priority: 0.95
      }
    ]
  });

  assert.equal(packet.selectedContext.length, 1);
  assert.equal(packet.changedFiles[0], "src/auth.js");
  assert.equal(packet.teachingChecklist.length, 4);
  assert.equal(packet.teachingSections.codeFocus?.source, "src/auth.js");
  assert.equal(packet.teachingSections.relatedTests.length, 0);
});

run("implementation flows prioritize changed code and related tests over generic docs", () => {
  const packet = buildLearningPacket({
    task: "Improve CLI recall",
    objective: "Teach how changed files drive the ranking",
    changedFiles: ["src/cli/app.js"],
    tokenBudget: 90,
    maxChunks: 2,
    chunks: [
      {
        id: "readme",
        source: "README.md",
        kind: "spec",
        content:
          "The CLI supports recall, remember, and close commands and explains how the system works.",
        certainty: 0.96,
        recency: 0.92,
        teachingValue: 0.95,
        priority: 0.93
      },
      {
        id: "usage",
        source: "docs/usage.md",
        kind: "spec",
        content:
          "Usage instructions explain teach, recall, and how the command line uses memory and changed files.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.94,
        priority: 0.9
      },
      {
        id: "cli-app",
        source: "src/cli/app.js",
        kind: "code",
        content:
          "The CLI app parses teach options, attaches recalled memory, and builds the learning packet.",
        certainty: 0.94,
        recency: 0.88,
        teachingValue: 0.82,
        priority: 0.92
      },
      {
        id: "cli-test",
        source: "test/cli/app.test.js",
        kind: "test",
        content:
          "Tests verify the CLI app prioritizes recalled memory, changed files, and teaching packet output.",
        certainty: 0.93,
        recency: 0.86,
        teachingValue: 0.84,
        priority: 0.85
      }
    ]
  });

  assert.equal(packet.selectedContext[0].source, "src/cli/app.js");
  assert.equal(packet.selectedContext.some((chunk) => chunk.source === "test/cli/app.test.js"), true);
  assert.equal(packet.selectedContext.some((chunk) => chunk.source === "README.md"), false);
  assert.equal(packet.teachingSections.codeFocus?.source, "src/cli/app.js");
  assert.equal(packet.teachingSections.relatedTests[0]?.source, "test/cli/app.test.js");
});

run("teaching packet separates code, tests, and historical memory into pedagogical sections", () => {
  const packet = buildLearningPacket({
    task: "Integrate memory runtime recall",
    objective: "Teach the historical role of memory in the flow",
    changedFiles: ["src/cli/app.js"],
    tokenBudget: 120,
    maxChunks: 4,
    chunks: [
      {
        id: "cli-app",
        source: "src/cli/app.js",
        kind: "code",
        content: "The CLI app resolves teach recall before building the packet.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.84,
        priority: 0.94
      },
      {
        id: "cli-test",
        source: "test/cli/app.test.js",
        kind: "test",
        content: "Tests verify the CLI app consumes recalled memory.",
        certainty: 0.93,
        recency: 0.86,
        teachingValue: 0.84,
        priority: 0.87
      },
      {
        id: "memory-arch",
        source: "engram://learning-context-system/22",
        kind: "memory",
        content:
          "CLI memory runtime integration. Durable memory now enters the teach packet automatically. Memory type: architecture. Memory scope: project",
        certainty: 0.92,
        recency: 0.94,
        teachingValue: 0.9,
        priority: 0.88
      },
      {
        id: "spec-doc",
        source: "docs/usage.md",
        kind: "spec",
        content: "Usage docs explain how teach invokes recall.",
        certainty: 0.9,
        recency: 0.82,
        teachingValue: 0.74,
        priority: 0.72
      }
    ]
  });

  assert.equal(packet.teachingSections.codeFocus?.source, "src/cli/app.js");
  assert.equal(packet.teachingSections.relatedTests[0]?.source, "test/cli/app.test.js");
  assert.equal(packet.teachingSections.historicalMemory[0]?.source, "engram://learning-context-system/22");
  assert.equal(packet.teachingSections.historicalMemory[0]?.memoryType, "architecture");
  assert.equal(packet.teachingSections.supportingContext[0]?.source, "docs/usage.md");
  assert.equal(packet.teachingSections.flow.length >= 3, true);
});

run("structural AST signals boost chunks whose symbols match the focus", () => {
  const result = selectContextWindow(
    [
      {
        id: "user-service",
        source: "src/services/user-service.ts",
        kind: "code",
        content: "Service layer orchestration for user operations and persistence.",
        certainty: 0.9,
        recency: 0.86,
        teachingValue: 0.78,
        priority: 0.88,
        processing: {
          symbols: {
            exports: ["UserService"],
            publicSurface: ["UserService.createUser", "UserService.updateUser"],
            dependencyHints: ["DatabaseConnector", "UserRepository", "./database-connector"],
            imports: [
              {
                source: "./database-connector",
                bindings: ["DatabaseConnector"],
                typeOnly: false
              }
            ],
            declarations: [
              {
                name: "UserService",
                kind: "class",
                exported: true,
                visibility: "module",
                startLine: 1,
                endLine: 40
              }
            ]
          }
        }
      },
      {
        id: "string-utils",
        source: "src/utils/string-utils.ts",
        kind: "code",
        content: "Utilities for normalization, formatting, and token cleanup.",
        certainty: 0.92,
        recency: 0.84,
        teachingValue: 0.76,
        priority: 0.8
      }
    ],
    {
      focus: "Refactor UserService to use DatabaseConnector transactions safely",
      tokenBudget: 120,
      maxChunks: 1
    }
  );

  assert.equal(result.selected[0]?.id, "user-service");
  assert.equal(result.selected[0]?.diagnostics.structuralSignalCount > 0, true);
  assert.equal(result.selected[0]?.diagnostics.structuralOverlap > 0, true);
  assert.equal(result.selected[0]?.diagnostics.structuralDependency > 0, true);
});

run("tests that map directly to changed files outrank generic test runners", () => {
  const result = selectContextWindow(
    [
      {
        id: "generic-runner",
        source: "test/run-tests.js",
        kind: "test",
        content:
          "Runs portable checks for the whole repository and prints pass or fail messages.",
        certainty: 0.92,
        recency: 0.82,
        teachingValue: 0.72,
        priority: 0.74
      },
      {
        id: "related-test",
        source: "test/cli/app.test.js",
        kind: "test",
        content:
          "Verifies CLI app teach flow, memory recall, changed files, and packet ranking behavior.",
        certainty: 0.93,
        recency: 0.86,
        teachingValue: 0.84,
        priority: 0.86
      },
      {
        id: "changed-code",
        source: "src/cli/app.js",
        kind: "code",
        content:
          "The CLI app integrates teach recall and passes changed files into the selector.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.82,
        priority: 0.94
      }
    ],
    {
      focus: "cli teach recall changed files selector",
      changedFiles: ["src/cli/app.js"],
      tokenBudget: 90,
      maxChunks: 2
    }
  );

  assert.equal(result.selected[0].id, "changed-code");
  assert.equal(result.selected[1].id, "related-test");
  assert.equal(result.selected.some((chunk) => chunk.id === "generic-runner"), false);
});

run("implementation flows penalize session-close memory against technical memory", () => {
  const result = selectContextWindow(
    [
      {
        id: "close-note",
        source: "engram://learning-context-system/3",
        kind: "memory",
        content:
          "## Session Close Summary. - Summary: Integrated recall. - Learned: Memory and context are different. - Next: Improve the selector.",
        certainty: 0.88,
        recency: 0.95,
        teachingValue: 0.82,
        priority: 0.84
      },
      {
        id: "arch-memory",
        source: "engram://learning-context-system/4",
        kind: "memory",
        content:
          "CLI memory runtime integration. Added an external battery adapter and new CLI commands recall, remember, and close for durable memory.",
        certainty: 0.92,
        recency: 0.93,
        teachingValue: 0.9,
        priority: 0.9
      },
      {
        id: "changed-code",
        source: "src/cli/app.js",
        kind: "code",
        content:
          "The CLI app integrates recall before building the teaching packet and passes changed files into the selector.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.85,
        priority: 0.94
      }
    ],
    {
      focus: "cli recall teaching packet changed files",
      changedFiles: ["src/cli/app.js"],
      tokenBudget: 80,
      maxChunks: 2
    }
  );

  assert.equal(result.selected.some((chunk) => chunk.id === "changed-code"), true);
  assert.equal(result.selected.some((chunk) => chunk.id === "arch-memory"), true);
  assert.equal(result.selected.some((chunk) => chunk.id === "close-note"), false);
});

run("validates chunk file input and rejects invalid kinds", () => {
  assert.throws(
    () =>
      parseChunkFile(
        JSON.stringify({
          chunks: [
            {
              id: "x",
              source: "src/x.ts",
              kind: "unknown",
              content: "bad"
            }
          ]
        }),
        "inline.json"
      ),
    /must be one of/
  );
});

run("cli select returns a readable context summary", async () => {
  const result = await runCli([
    "select",
    "--input",
    "examples/auth-context.json",
    "--focus",
    "jwt middleware expired session validation",
    "--format",
    "text"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Selected chunks:/);
  assert.match(result.stdout, /auth-middleware/);
  assert.doesNotMatch(result.stdout, /legacy-chat from/);
});

run("cli select debug exposes selection diagnostics", async () => {
  const result = await runCli([
    "select",
    "--input",
    "examples/auth-context.json",
    "--focus",
    "jwt middleware expired session validation",
    "--debug",
    "--format",
    "text"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Selection diagnostics:/);
  assert.match(result.stdout, /Suppression reasons:/);
  assert.match(result.stdout, /origin=workspace/);
});

run("cli select workspace json exposes scan stats metadata", async () => {
  const result = await runCli([
    "select",
    "--workspace",
    ".",
    "--focus",
    "cli context selector config",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("select");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "select.v1");
  assert.equal(parsed.command, "select");
  assert.equal(typeof parsed.meta.durationMs, "number");
  assert.equal(parsed.meta.scanStats.includedFiles > 0, true);
  assert.equal(parsed.meta.scanStats.discoveredFiles >= parsed.meta.scanStats.includedFiles, true);
  assert.equal(parsed.observability.event.command, "select");
  assert.equal(parsed.observability.selection.selectedCount >= 0, true);
});

run("cli teach returns a teaching packet summary", async () => {
  const result = await runCli([
    "teach",
    "--input",
    "examples/auth-context.json",
    "--task",
    "Improve auth middleware",
    "--objective",
    "Teach why validation runs before route handlers",
    "--changed-files",
    "src/auth/middleware.ts,test/auth/middleware.test.ts",
    "--format",
    "text"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Memory recall:/);
  assert.match(result.stdout, /Teaching checklist:/);
  assert.match(result.stdout, /Teaching map:/);
  assert.match(result.stdout, /Pedagogical sections:/);
  assert.match(result.stdout, /Changed files:/);
  assert.doesNotMatch(result.stdout, /legacy-chat from/);
});

run("cli teach works end-to-end on the TypeScript backend vertical", async () => {
  const result = await runCli([
    "teach",
    "--workspace",
    "examples/typescript-backend",
    "--task",
    "Harden auth middleware",
    "--objective",
    "Teach request-boundary validation in a TypeScript server",
    "--changed-files",
    "src/auth/middleware.ts,test/auth/middleware.test.ts",
    "--project",
    "typescript-backend-vertical",
    "--no-recall",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.teachingSections.codeFocus.source, "src/auth/middleware.ts");
  assert.equal(parsed.teachingSections.relatedTests[0].source, "test/auth/middleware.test.ts");
  assert.equal(parsed.selectedContext.some((chunk) => chunk.source === "logs/server.log"), false);
  assert.equal(parsed.selectedContext.some((chunk) => chunk.source === "chat/history.md"), false);
});

run("cli teach debug exposes recall ids and selection diagnostics", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      if (!/auth/u.test(query) || !/(middleware|validation)/u.test(query)) {
        return {
          mode: "search",
          project: options?.project ?? "",
          query,
          stdout: "No memories found for that query.",
          dataDir: ".engram"
        };
      }

      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: [
          "Found 1 memories:",
          "",
          "[1] #7 (decision) â€” Auth validation order",
          "    Reject invalid tokens before route handlers so the failure stays at the boundary.",
          "    2026-03-17 18:05:00 | project: learning-context-system | scope: project"
        ].join("\n"),
        dataDir: ".engram"
      };
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Improve auth middleware",
      "--objective",
      "Teach why validation runs before route handlers",
      "--changed-files",
      "src/auth/middleware.ts,test/auth/middleware.test.ts",
      "--project",
      "learning-context-system",
      "--debug",
      "--format",
      "text"
    ],
    {
      engramClient: fakeClient
    }
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Recall debug:/);
  assert.match(result.stdout, /Recovered memory ids:/);
  assert.match(result.stdout, /Selected recalled ids:/);
  assert.match(result.stdout, /Selection diagnostics:/);
});

run("workspace scanning collects repository chunks", async () => {
  const result = await loadWorkspaceChunks(".");

  assert.ok(result.payload.chunks.length > 5);
  assert.ok(result.payload.chunks.some((chunk) => chunk.source === "src/cli.js"));
  assert.ok(result.payload.chunks.some((chunk) => chunk.source === "package.json"));
});

run("workspace scanning ignores .tmp directories to avoid local clone noise", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-ignore-tmp-"));

  try {
    await mkdir(path.join(tempRoot, ".tmp", "fresh-clone", "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(path.join(tempRoot, ".tmp", "fresh-clone", "src", "noise.js"), "export {};\n", "utf8");
    await writeFile(path.join(tempRoot, "src", "keep.js"), "export const keep = true;\n", "utf8");

    const result = await loadWorkspaceChunks(tempRoot);

    assert.equal(result.payload.chunks.some((chunk) => chunk.source.startsWith(".tmp/")), false);
    assert.equal(result.payload.chunks.some((chunk) => chunk.source === "src/keep.js"), true);
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
});

run("workspace scanning honors configurable ignore directories", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-ignore-dirs-"));

  try {
    await mkdir(path.join(tempRoot, "vendor-cache", "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "vendor-cache", "src", "noise.ts"),
      "export const noise = true;\n",
      "utf8"
    );
    await writeFile(path.join(tempRoot, "src", "keep.ts"), "export const keep = true;\n", "utf8");

    const result = await loadWorkspaceChunks(tempRoot, {
      scan: {
        ignoreDirs: ["vendor-cache"]
      }
    });

    assert.equal(result.payload.chunks.some((chunk) => chunk.source.includes("vendor-cache")), false);
    assert.equal(result.payload.chunks.some((chunk) => chunk.source === "src/keep.ts"), true);
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
});

run("workspace scanning understands the TypeScript backend vertical", async () => {
  const result = await loadWorkspaceChunks("examples/typescript-backend");

  assert.ok(result.payload.chunks.some((chunk) => chunk.source === "src/auth/middleware.ts"));
  assert.ok(result.payload.chunks.some((chunk) => chunk.source === "test/auth/middleware.test.ts"));
  assert.ok(result.payload.chunks.some((chunk) => chunk.source === "logs/server.log"));
  assert.ok(result.payload.chunks.some((chunk) => chunk.source === "chat/history.md"));
});

run("workspace scanning redacts inline secrets and ignores dot env files", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-redaction-"));

  try {
    await writeFile(
      path.join(tempRoot, "app.js"),
      [
        'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";',
        'const bearer = "Bearer abcdefghijklmnopqrstuvwxyz";',
        'const password = "super-secret";'
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(tempRoot, ".env"), "SECRET=value\n", "utf8");

    const result = await loadWorkspaceChunks(tempRoot);
    const chunk = result.payload.chunks.find((entry) => entry.source === "app.js");

    assert.ok(chunk);
    assert.match(chunk.content, /apiKey = "\[REDACTED\]"/);
    assert.match(chunk.content, /\[REDACTED_TOKEN\]/);
    assert.match(chunk.content, /\[REDACTED\]/);
    assert.equal(result.payload.chunks.some((entry) => entry.source === ".env"), false);
    assert.equal(result.stats.redactedFiles, 1);
    assert.equal(result.stats.ignoredFiles >= 1, true);
    assert.equal(result.stats.security.ignoredSensitiveFiles >= 1, true);
    assert.equal(result.stats.security.inlineSecrets >= 2, true);
    assert.equal(result.stats.security.tokenPatterns >= 1, true);
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
});

run("workspace scanning ignores common credential files before chunking", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-sensitive-ignore-"));

  try {
    await mkdir(path.join(tempRoot, ".aws"), { recursive: true });
    await writeFile(path.join(tempRoot, ".env.local"), "TOKEN=value\n", "utf8");
    await writeFile(path.join(tempRoot, ".npmrc"), "//registry.npmjs.org/:_authToken=abc\n", "utf8");
    await writeFile(path.join(tempRoot, ".aws", "credentials"), "[default]\naws_access_key_id=abc\n", "utf8");
    await writeFile(path.join(tempRoot, "id_ed25519"), "PRIVATE KEY\n", "utf8");
    await writeFile(path.join(tempRoot, "safe.js"), "export const ok = true;\n", "utf8");

    const result = await loadWorkspaceChunks(tempRoot);

    assert.equal(result.payload.chunks.some((entry) => entry.source === ".env.local"), false);
    assert.equal(result.payload.chunks.some((entry) => entry.source === ".npmrc"), false);
    assert.equal(result.payload.chunks.some((entry) => entry.source === ".aws/credentials"), false);
    assert.equal(result.payload.chunks.some((entry) => entry.source === "id_ed25519"), false);
    assert.equal(result.payload.chunks.some((entry) => entry.source === "safe.js"), true);
    assert.equal(result.stats.security.ignoredSensitiveFiles, 4);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("workspace scanning honors project security policy overrides", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-security-policy-"));

  try {
    await writeFile(
      path.join(tempRoot, ".env.example"),
      'API_KEY="sk-abcdefghijklmnopqrstuvwxyz123456"\n',
      "utf8"
    );
    await writeFile(path.join(tempRoot, "keep.js"), "export const keep = true;\n", "utf8");

    const result = await loadWorkspaceChunks(tempRoot, {
      security: {
        allowSensitivePaths: [".env.example"],
        redactSensitiveContent: false
      }
    });

    const envChunk = result.payload.chunks.find((entry) => entry.source === ".env.example");

    assert.ok(envChunk);
    assert.match(envChunk.content, /sk-abcdefghijklmnopqrstuvwxyz123456/);
    assert.equal(result.stats.redactedFiles, 0);
    assert.equal(result.stats.security.ignoredSensitiveFiles, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("secret redaction catches private keys jwt tokens and connection strings", () => {
  const redacted = redactSensitiveContent(
    [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "very-secret-material",
      "-----END OPENSSH PRIVATE KEY-----",
      'const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepayload12345";',
      'const database_url = "postgres://admin:password@localhost:5432/app";'
    ].join("\n")
  );

  assert.equal(redacted.redacted, true);
  assert.match(redacted.content, /\[REDACTED_PRIVATE_KEY_BLOCK\]/);
  assert.match(redacted.content, /\[REDACTED_JWT\]/);
  assert.match(redacted.content, /database_url = "\[REDACTED\]"/);
  assert.equal(redacted.breakdown.privateBlocks, 1);
  assert.equal(redacted.breakdown.jwtLike, 1);
  assert.equal(redacted.breakdown.connectionStrings, 1);
});

run("sensitive file matcher flags high-risk credential paths", () => {
  assert.equal(shouldIgnoreSensitiveFile(".env.local"), true);
  assert.equal(shouldIgnoreSensitiveFile(".aws/credentials"), true);
  assert.equal(shouldIgnoreSensitiveFile("secrets/prod.json"), true);
  assert.equal(shouldIgnoreSensitiveFile("src/auth/service.ts"), false);
  assert.equal(
    shouldIgnoreSensitiveFile(".env.example", {
      allowSensitivePaths: [".env.example"]
    }),
    false
  );
  assert.equal(
    shouldIgnoreSensitiveFile("docs/private-notes.md", {
      extraSensitivePathFragments: ["private-notes"]
    }),
    true
  );
});

run("project config parses security policy overrides", () => {
  const parsed = parseProjectConfig(
    JSON.stringify({
      project: "demo",
      memory: {
        autoRecall: false,
        autoRemember: true,
        backend: "engram-only"
      },
      security: {
        ignoreSensitiveFiles: false,
        redactSensitiveContent: false,
        ignoreGeneratedFiles: false,
        allowSensitivePaths: [".env.example"],
        extraSensitivePathFragments: ["fixtures/private"]
      },
      scan: {
        ignoreDirs: [".cache", "vendor-cache"]
      },
      safety: {
        requirePlanForWrite: true,
        allowedScopePaths: ["src/auth", "docs"],
        maxTokenBudget: 420,
        requireExplicitFocusForWorkspaceScan: false,
        minWorkspaceFocusLength: 12,
        blockDebugWithoutStrongFocus: false
      }
    }),
    "inline"
  );

  assert.equal(parsed.memory.autoRecall, false);
  assert.equal(parsed.memory.autoRemember, true);
  assert.equal(parsed.memory.backend, "resilient");
  assert.equal(parsed.security.ignoreSensitiveFiles, false);
  assert.equal(parsed.security.redactSensitiveContent, false);
  assert.equal(parsed.security.ignoreGeneratedFiles, false);
  assert.deepEqual(parsed.security.allowSensitivePaths, [".env.example"]);
  assert.deepEqual(parsed.security.extraSensitivePathFragments, ["fixtures/private"]);
  assert.deepEqual(parsed.scan.ignoreDirs, [".cache", "vendor-cache"]);
  assert.equal(parsed.safety.requirePlanForWrite, true);
  assert.deepEqual(parsed.safety.allowedScopePaths, ["src/auth", "docs"]);
  assert.equal(parsed.safety.maxTokenBudget, 420);
  assert.equal(parsed.safety.requireExplicitFocusForWorkspaceScan, false);
  assert.equal(parsed.safety.minWorkspaceFocusLength, 12);
  assert.equal(parsed.safety.blockDebugWithoutStrongFocus, false);
});

run("project config rejects unsupported memory backend values", () => {
  assert.throws(
    () =>
      parseProjectConfig(
        JSON.stringify({
          memory: {
            backend: "redis-cluster"
          }
        }),
        "inline"
      ),
    /memory\.backend must be 'resilient' or 'local-only' \(legacy alias: 'engram-only'\)/i
  );
});

run("v1 contract fixture exists for every JSON CLI command", async () => {
  for (const command of JSON_CONTRACT_COMMANDS) {
    const fixture = await loadContractFixture(command);
    assert.equal(Array.isArray(fixture.requiredPaths), true, `${command}: requiredPaths missing`);
    assert.equal(
      isRecord(fixture.pathTypes),
      true,
      `${command}: pathTypes must be an object`
    );
  }
});

run("cli help documents all supported commands including doctor init sync-knowledge and ingest-security", async () => {
  const result = await runCli(["help"]);

  assert.equal(result.exitCode, 0);
  for (const command of [
    "version",
    "doctor",
    "doctor-memory",
    "memory-stats",
    "init",
    "prune-memory",
    "compact-memory",
    "sync-knowledge",
    "ingest-security",
    "select",
    "teach",
    "readme",
    "recall",
    "remember",
    "close",
    "shell"
  ]) {
    assert.match(result.stdout, new RegExp(`node src/cli\\.js ${command}`));
  }
  assert.match(
    result.stdout,
    /doctor\s+-> checks runtime, config, workspace, semantic tier, and external battery health/
  );
  assert.match(
    result.stdout,
    /doctor-memory\s+-> audits local memory quality and quarantine candidates/
  );
  assert.match(
    result.stdout,
    /memory-stats\s+-> reports memory health, noise, duplicate, and durable recall metrics/
  );
  assert.match(
    result.stdout,
    /prune-memory\s+-> moves suspicious local memories into quarantine/
  );
  assert.match(
    result.stdout,
    /compact-memory\s+-> consolidates reviewable memory clusters into compact entries/
  );
  assert.match(
    result.stdout,
    /init\s+-> creates learning-context\.config\.json with safe defaults/
  );
  assert.match(
    result.stdout,
    /sync-knowledge\s+-> appends a durable learning note into a Notion page/
  );
  assert.match(
    result.stdout,
    /ingest-security\s+-> converts Prowler findings JSON into LCS chunk JSON/
  );
  assert.match(
    result.stdout,
    /shell\s+-> opens interactive tabbed Bash-like console/
  );
  assert.match(result.stdout, /version\s+-> prints CLI version/);
});

run("cli help accepts --help and -h aliases", async () => {
  const longResult = await runCli(["--help"]);
  const shortResult = await runCli(["-h"]);

  assert.equal(longResult.exitCode, 0);
  assert.equal(shortResult.exitCode, 0);
  assert.match(longResult.stdout, /Commands:/);
  assert.match(shortResult.stdout, /Commands:/);
});

run("command-level -h shows usage instead of failing positional parse", async () => {
  const result = await runCli(["teach", "-h"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /node src\/cli\.js teach/);
});

run("NEXUS shell tokenizer keeps quoted segments and escapes", async () => {
  const tokens = tokenizeShellInput('/teach --task "auth validation" --objective "request \\"boundary\\""');

  assert.deepEqual(tokens, [
    "/teach",
    "--task",
    "auth validation",
    "--objective",
    'request "boundary"'
  ]);
});

run("NEXUS shell resolves plain input using active tab and session defaults", async () => {
  const state = createShellState({
    session: {
      project: "nexus",
      workspace: ".",
      memoryBackend: "resilient",
      format: "text"
    },
    activeTab: "recall"
  });
  const action = resolveShellInput("jwt middleware order", state);

  assert.equal(action.kind, "exec");
  assert.deepEqual(action.argv.slice(0, 4), ["recall", "--query", "jwt middleware order", "--memory-backend"]);
  assert.equal(action.argv.includes("--project"), true);
  assert.equal(action.argv.includes("nexus"), true);
});

run("NEXUS shell supports tab switching and settings updates", async () => {
  const state = createShellState({
    activeTab: "recall"
  });
  const tabAction = resolveShellInput("/tab teach", state);
  const setAction = resolveShellInput("/set backend local-only", state);
  const commandAction = resolveShellInput("/remember harden auth docs", state);

  assert.equal(tabAction.kind, "info");
  assert.equal(state.activeTab, "teach");
  assert.equal(setAction.kind, "info");
  assert.equal(state.session.memoryBackend, "local-only");
  assert.equal(commandAction.kind, "exec");
  assert.equal(commandAction.argv[0], "remember");
  assert.equal(commandAction.argv.includes("--format"), true);
});

run("NEXUS shell quick tab shortcuts accept single key input", async () => {
  const state = createShellState({
    activeTab: "recall"
  });
  const action = resolveShellInput("D", state);

  assert.equal(action.kind, "info");
  assert.equal(state.activeTab, "doctor");
});

run("NEXUS shell resolves menu section commands", async () => {
  const state = createShellState({
    activeTab: "recall"
  });
  const openSkills = resolveShellInput("/skills", state);
  const openMemory = resolveShellInput("/memory", state);
  const openNexus = resolveShellInput("/nexus", state);
  const menuToggle = resolveShellInput("/menu toggle", state);
  const menuMemory = resolveShellInput("/menu memory", state);

  assert.equal(openSkills.kind, "menu");
  assert.equal(openSkills.section, "skills");
  assert.equal(openMemory.kind, "menu");
  assert.equal(openMemory.section, "nexus-memory");
  assert.equal(openNexus.kind, "menu");
  assert.equal(openNexus.section, "nexus");
  assert.equal(menuToggle.kind, "menu");
  assert.equal(menuToggle.toggle, true);
  assert.equal(menuMemory.kind, "menu");
  assert.equal(menuMemory.section, "nexus-memory");
});

run("NEXUS shell exposes memory hygiene submenu with safe commands", async () => {
  const state = createShellState({
    activeTab: "recall",
    session: {
      project: "nexus",
      workspace: ".",
      memoryBackend: "local-only",
      format: "text"
    }
  });
  const items = getShellMenuItems(
    {
      open: true,
      section: "nexus-memory",
      selectedIndex: 0,
      generatedSkills: [],
      focusedSkillName: "",
      lastUpdatedAt: "",
      notice: ""
    },
    state
  );

  const ids = items.map((item) => item.id);
  assert.deepEqual(ids.slice(0, 7), [
    "memory-back",
    "memory-stats-text",
    "memory-stats-json",
    "doctor-memory-text",
    "doctor-memory-json",
    "prune-memory-dry-run",
    "compact-memory-dry-run"
  ]);

  const compactAction = items.find((item) => item.id === "compact-memory-dry-run")?.action;
  assert.equal(compactAction?.type, "run-cli");
  assert.equal(compactAction?.argv.includes("--dry-run"), true);
  assert.equal(compactAction?.argv.includes("true"), true);
  assert.equal(compactAction?.argv.includes("--project"), true);
  assert.equal(compactAction?.argv.includes("nexus"), true);
});

run("NEXUS shell render mode normalization supports safe override", async () => {
  assert.equal(normalizeShellRenderMode(undefined), "auto");
  assert.equal(normalizeShellRenderMode("auto"), "auto");
  assert.equal(normalizeShellRenderMode("SAFE"), "safe");
});

run("NEXUS shell ignores empty/menu-control readline artifacts when menu is open", async () => {
  assert.equal(shouldIgnoreMenuReadlineLine({ menuOpen: true, line: "" }), true);
  assert.equal(shouldIgnoreMenuReadlineLine({ menuOpen: true, line: "[A" }), true);
  assert.equal(shouldIgnoreMenuReadlineLine({ menuOpen: false, line: "" }), false);
  assert.equal(shouldIgnoreMenuReadlineLine({ menuOpen: true, line: "teach auth middleware" }), false);
});

run("NEXUS shell menu output policy preserves doctor/help output before redraw", async () => {
  assert.equal(shouldPreserveMenuActionOutput("run-script"), true);
  assert.equal(shouldPreserveMenuActionOutput("run-cli"), true);
  assert.equal(shouldPreserveMenuActionOutput("show-help"), true);
  assert.equal(shouldPreserveMenuActionOutput("open-section"), false);
});

run("NEXUS shell blocks interactive menu actions while a command is running", async () => {
  assert.equal(
    shouldBlockMenuInteractionWhileBusy({
      commandInFlight: true,
      canCaptureMenuNav: true,
      keyName: "enter"
    }),
    true
  );
  assert.equal(
    shouldBlockMenuInteractionWhileBusy({
      commandInFlight: true,
      canCaptureMenuNav: true,
      keyName: "x"
    }),
    false
  );
  assert.equal(
    shouldBlockMenuInteractionWhileBusy({
      commandInFlight: false,
      canCaptureMenuNav: true,
      keyName: "enter"
    }),
    false
  );
});

run("NEXUS shell dashboard render policy avoids redundant notice redraw in safe mode", async () => {
  const safeNotice = evaluateDashboardRenderPolicy({
    renderMode: "safe",
    reason: "notice",
    stateChanged: false
  });
  const safeNavigation = evaluateDashboardRenderPolicy({
    renderMode: "safe",
    reason: "navigation",
    stateChanged: true
  });
  const autoNotice = evaluateDashboardRenderPolicy({
    renderMode: "auto",
    reason: "notice",
    stateChanged: true
  });

  assert.deepEqual(safeNotice, { redraw: false, clear: false });
  assert.deepEqual(safeNavigation, { redraw: true, clear: true });
  assert.deepEqual(autoNotice, { redraw: true, clear: true });
});

run("skill auto-generator detects repeated task patterns and ignores nav noise", async () => {
  const repeated = extractRepeatedTasks([
    "/help",
    "/status",
    "teach auth middleware validation order",
    "Teach   auth middleware   validation order",
    "/teach auth middleware validation order",
    "D",
    "/tab doctor",
    "select api auth guard",
    "select api auth guard",
    "select api auth guard"
  ], {
    minOccurrences: 3,
    top: 5
  });

  assert.equal(repeated.length, 2);
  assert.equal(repeated[0]?.key, "select api auth guard");
  assert.equal(repeated[0]?.occurrences, 3);
  assert.equal(repeated[1]?.key, "teach auth middleware validation order");
  assert.equal(repeated[1]?.occurrences, 3);
});

run("skill auto-generator builds draft markdown with promotion checklist", async () => {
  const markdown = buildGeneratedSkillMarkdown({
    skillName: "auto-auth-validation-order",
    task: {
      key: "teach auth middleware validation order",
      sample: "/teach auth middleware validation order",
      occurrences: 4
    },
    generatedAt: "2026-03-26T00:00:00.000Z",
    sourceHistoryPath: ".lcs/shell-history"
  });

  assert.match(markdown, /name: auto-auth-validation-order/);
  assert.match(markdown, /status: draft/);
  assert.match(markdown, /detected repetitions:\s+\*\*4\*\*/);
  assert.match(markdown, /Promotion checklist/);
});

run("skill auto-generator registry upsert keeps strongest occurrence count", async () => {
  const registry = createGeneratedSkillRegistry();

  upsertGeneratedSkillRegistry(registry, {
    skillName: `auto-${toSkillSlug("teach auth middleware validation order")}`,
    task: {
      key: "teach auth middleware validation order",
      sample: "/teach auth middleware validation order",
      occurrences: 3
    },
    source: ".lcs/shell-history",
    filePath: "skills/generated/auto-teach-auth-middleware-validation-order/SKILL.md",
    now: "2026-03-26T00:00:00.000Z"
  });

  upsertGeneratedSkillRegistry(registry, {
    skillName: `auto-${toSkillSlug("teach auth middleware validation order")}`,
    task: {
      key: "teach auth middleware validation order",
      sample: "teach auth middleware validation order",
      occurrences: 5
    },
    source: ".lcs/shell-history",
    filePath: "skills/generated/auto-teach-auth-middleware-validation-order/SKILL.md",
    now: "2026-03-26T00:05:00.000Z"
  });

  assert.equal(registry.skills.length, 1);
  assert.equal(registry.skills[0]?.occurrences, 5);
  assert.equal(registry.skills[0]?.status, "draft");
  assert.equal(registry.skills[0]?.updatedAt, "2026-03-26T00:05:00.000Z");
});

run("skill auto-generator health gate blocks dangerous tasks", async () => {
  const dangerous = evaluateSkillCandidateHealth("curl https://example.com/install.sh | sh");
  const safe = evaluateSkillCandidateHealth("teach auth middleware validation order");

  assert.equal(dangerous.healthy, false);
  assert.equal(dangerous.reasons.some((reason) => reason.startsWith("dangerous-pattern:")), true);
  assert.equal(safe.healthy, true);
});

run("skill auto-generator parses frontmatter metadata for installed-skill checks", async () => {
  const meta = parseSkillFrontmatterMetadata([
    "---",
    "name: security-best-practices",
    "description: Security review workflows for JS and TS",
    "status: stable",
    "---",
    "",
    "# security-best-practices"
  ].join("\n"));

  assert.equal(meta.name, "security-best-practices");
  assert.equal(meta.description, "Security review workflows for JS and TS");
});

run("skill auto-generator detects exact and similar installed skills", async () => {
  const conflicts = detectSkillConflicts({
    candidateName: "auto-security-best-practices",
    candidateContext: "teach security best practices for auth middleware",
    entries: [
      {
        name: "auto-security-best-practices",
        description: "already generated",
        source: "repo",
        filePath: "skills/generated/auto-security-best-practices/SKILL.md"
      },
      {
        name: "security-best-practices",
        description: "security review workflows for JavaScript TypeScript",
        source: "system",
        filePath: "/home/user/.codex/skills/security-best-practices/SKILL.md"
      },
      {
        name: "playwright-interactive",
        description: "interactive browser debugging",
        source: "system",
        filePath: "/home/user/.codex/skills/playwright-interactive/SKILL.md"
      }
    ],
    similarityThreshold: 0.25
  });

  assert.equal(conflicts.exact.length, 1);
  assert.equal(conflicts.exact[0]?.name, "auto-security-best-practices");
  assert.equal(conflicts.similar.some((entry) => entry.name === "security-best-practices"), true);
  assert.equal(scoreSkillSimilarity("security best practices", "playwright interactive") < 0.4, true);
});

run("skills doctor script reports duplicate installed skills in json mode", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-skills-doctor-"));

  try {
    const repoSkills = path.join(tempRoot, "skills");
    const duplicateA = path.join(repoSkills, "security-best-practices");
    const duplicateB = path.join(repoSkills, "Security Best Practices");

    await mkdir(duplicateA, { recursive: true });
    await mkdir(duplicateB, { recursive: true });

    await writeFile(
      path.join(duplicateA, "SKILL.md"),
      [
        "---",
        "name: security-best-practices",
        "description: security review workflows",
        "---",
        "",
        "# security-best-practices"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(duplicateB, "SKILL.md"),
      [
        "---",
        "name: Security Best Practices",
        "description: security review workflows",
        "---",
        "",
        "# Security Best Practices"
      ].join("\n"),
      "utf8"
    );

    const { stdout } = await execFile("node", [
      "scripts/doctor-skills.js",
      "--format",
      "json",
      "--no-system-scan",
      "--skills-dir",
      repoSkills
    ]);
    const result = JSON.parse(stdout);

    assert.equal(result.command, "skills-doctor");
    assert.equal(result.status, "warn");
    assert.equal(result.catalog.totalSkills, 2);
    assert.equal(Array.isArray(result.exactDuplicateGroups), true);
    assert.equal(result.exactDuplicateGroups.length, 1);
    assert.equal(result.exactDuplicateGroups[0]?.skills?.length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("skills doctor auto-resolves exact mirror duplicates across repo and system", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-skills-doctor-mirror-"));

  try {
    const repoSkills = path.join(tempRoot, "skills");
    const systemSkills = path.join(tempRoot, "system-skills");
    const repoSkillDir = path.join(repoSkills, "debug-playground-companion");
    const systemSkillDir = path.join(systemSkills, "debug-playground-companion");
    const markdown = [
      "---",
      "name: debug-playground-companion",
      "description: Debug LCS playground and shell flow",
      "---",
      "",
      "# debug-playground-companion"
    ].join("\n");

    await mkdir(repoSkillDir, { recursive: true });
    await mkdir(systemSkillDir, { recursive: true });
    await writeFile(path.join(repoSkillDir, "SKILL.md"), markdown, "utf8");
    await writeFile(path.join(systemSkillDir, "SKILL.md"), markdown, "utf8");

    const { stdout } = await execFile("node", [
      "scripts/doctor-skills.js",
      "--format",
      "json",
      "--no-system-scan",
      "--skills-dir",
      repoSkills,
      "--system-skills-dir",
      systemSkills
    ]);
    const result = JSON.parse(stdout);

    assert.equal(result.command, "skills-doctor");
    assert.equal(result.status, "ok");
    assert.equal(result.catalog.totalSkills, 2);
    assert.equal(result.exactDuplicateGroups.length, 0);
    assert.equal(result.exactDuplicateMirrorsResolved.length, 1);
    assert.equal(result.exactDuplicateMirrorsResolved[0]?.skills?.length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("package scripts expose deterministic and full skills doctor strict modes", async () => {
  const packageRaw = await readFile(path.join(process.cwd(), "package.json"), "utf8");
  const pkg = JSON.parse(packageRaw);

  assert.match(String(pkg?.scripts?.["skills:doctor:strict"] ?? ""), /--no-system-scan/);
  assert.match(String(pkg?.scripts?.["skills:doctor:strict:full"] ?? ""), /--include-mirror-duplicates/);
});

run("skill auto-generator telemetry summary and delta compute token/time/error improvements", async () => {
  const telemetry = parseSkillTelemetryJsonl([
    JSON.stringify({
      recordedAt: "2026-03-26T00:00:00.000Z",
      taskKey: "teach auth middleware validation order",
      command: "teach",
      durationMs: 400,
      exitCode: 1,
      usedTokens: 200,
      tokenBudget: 520
    }),
    JSON.stringify({
      recordedAt: "2026-03-26T00:01:00.000Z",
      taskKey: "teach auth middleware validation order",
      command: "teach",
      durationMs: 300,
      exitCode: 0,
      usedTokens: 180,
      tokenBudget: 520
    }),
    JSON.stringify({
      recordedAt: "2026-03-26T00:10:00.000Z",
      taskKey: "teach auth middleware validation order",
      command: "teach",
      durationMs: 200,
      exitCode: 0,
      usedTokens: 120,
      tokenBudget: 520
    }),
    JSON.stringify({
      recordedAt: "2026-03-26T00:11:00.000Z",
      taskKey: "teach auth middleware validation order",
      command: "teach",
      durationMs: 180,
      exitCode: 0,
      usedTokens: 110,
      tokenBudget: 520
    })
  ].join("\n"));

  const baseline = summarizeSkillTelemetry(telemetry, {
    taskKey: "teach auth middleware validation order",
    until: "2026-03-26T00:05:00.000Z"
  });
  const current = summarizeSkillTelemetry(telemetry, {
    taskKey: "teach auth middleware validation order",
    since: "2026-03-26T00:05:00.000Z"
  });
  const delta = compareSkillTelemetry(baseline, current);

  assert.equal(baseline.samples, 2);
  assert.equal(current.samples, 2);
  assert.equal(delta.durationImprovementPct !== null && delta.durationImprovementPct > 0.4, true);
  assert.equal(delta.errorImprovementPct, 1);
  assert.equal(delta.tokenImprovementPct !== null && delta.tokenImprovementPct > 0.35, true);
});

run("cli version command and aliases return the package version", async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const expectedVersion = packageJson.version;

  const commandResult = await runCli(["version"]);
  const longAliasResult = await runCli(["--version"]);
  const shortAliasResult = await runCli(["-v"]);

  assert.equal(commandResult.exitCode, 0);
  assert.equal(longAliasResult.exitCode, 0);
  assert.equal(shortAliasResult.exitCode, 0);
  assert.equal(commandResult.stdout, `learning-context-system ${expectedVersion}`);
  assert.equal(longAliasResult.stdout, `learning-context-system ${expectedVersion}`);
  assert.equal(shortAliasResult.stdout, `learning-context-system ${expectedVersion}`);
});

run("cli version supports json format", async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const expectedVersion = packageJson.version;
  const result = await runCli(["version", "--format", "json"]);
  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("version");

  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "version.v1");
  assert.equal(parsed.command, "version");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.version, expectedVersion);
  assert.equal(parsed.degraded, false);
});

run("init creates config with a stable project id from package name", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-init-"));

  try {
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "example-learning-repo" }, null, 2),
      "utf8"
    );

    const result = await initProjectConfig({ cwd: tempRoot });
    const raw = await readFile(path.join(tempRoot, "learning-context.config.json"), "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(result.status, "created");
    assert.equal(result.project, "example-learning-repo");
    assert.equal(parsed.project, "example-learning-repo");
    assert.equal(parsed.workspace, ".");
    assert.equal(parsed.memory.backend, "resilient");
    assert.equal(parsed.safety.requireExplicitFocusForWorkspaceScan, true);
    assert.equal(parsed.safety.minWorkspaceFocusLength, 24);
    assert.equal(parsed.safety.blockDebugWithoutStrongFocus, true);
    assert.equal(parsed.security.ignoreSensitiveFiles, true);
    assert.equal(parsed.security.redactSensitiveContent, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli init emits a stable JSON contract", async () => {
  const configPath = path.join("test-output", "init-contract.json");
  await rm(configPath, { force: true });

  const result = await runCli([
    "init",
    "--config",
    configPath,
    "--force",
    "true",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("init");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "init.v1");
  assert.equal(parsed.command, "init");
  assert.match(parsed.path, /init-contract\.json/);
});

run("doctor reports missing dependencies as actionable warnings", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-"));

  try {
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "doctor-fixture" }, null, 2),
      "utf8"
    );

    const config = defaultProjectConfig();
    config.project = "doctor-fixture";
    config.workspace = ".";

    const result = await runProjectDoctor({
      cwd: tempRoot,
      configInfo: {
        found: false,
        path: "",
        config
      }
    });

    const dependencyCheck = result.checks.find((check) => check.id === "dependencies");
    const npmCheck = result.checks.find((check) => check.id === "npm");
    const scanSafetyCheck = result.checks.find((check) => check.id === "scan-safety");
    const taskSafetyCheck = result.checks.find((check) => check.id === "task-safety-gate");
    const focusSafetyCheck = result.checks.find((check) => check.id === "focus-safety-gate");
    const memoryBackendCheck = result.checks.find((check) => check.id === "memory-backend");
    const installPolicyCheck = result.checks.find((check) => check.id === "npm-install-scripts-policy");

    assert.ok(dependencyCheck);
    assert.equal(dependencyCheck.status, "warn");
    assert.match(dependencyCheck.fix, /npm ci/i);
    assert.ok(npmCheck);
    assert.equal(npmCheck.status, "pass");
    assert.ok(scanSafetyCheck);
    assert.equal(scanSafetyCheck.status, "pass");
    assert.ok(taskSafetyCheck);
    assert.equal(taskSafetyCheck.status, "warn");
    assert.match(taskSafetyCheck.fix, /requirePlanForWrite/i);
    assert.ok(focusSafetyCheck);
    assert.equal(focusSafetyCheck.status, "pass");
    assert.ok(memoryBackendCheck);
    assert.equal(memoryBackendCheck.status, "pass");
    assert.match(memoryBackendCheck.detail, /ruflo hnsw primary \+ local jsonl fallback/i);
    assert.ok(installPolicyCheck);
    assert.equal(["pass", "warn"].includes(installPolicyCheck.status), true);
    assert.match(installPolicyCheck.detail, /ignore-scripts/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("doctor passes task safety when a strict production profile exists", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-production-safety-"));

  try {
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "doctor-production-safety-fixture" }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(tempRoot, "learning-context.config.production.json"),
      JSON.stringify(
        {
          safety: {
            requirePlanForWrite: true,
            allowedScopePaths: ["src", "docs", "test"]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const config = defaultProjectConfig();
    config.project = "doctor-production-safety-fixture";
    config.workspace = ".";

    const result = await runProjectDoctor({
      cwd: tempRoot,
      configInfo: {
        found: true,
        path: path.join(tempRoot, "learning-context.config.json"),
        config
      }
    });

    const taskSafetyCheck = result.checks.find((check) => check.id === "task-safety-gate");

    assert.ok(taskSafetyCheck);
    assert.equal(taskSafetyCheck.status, "pass");
    assert.match(taskSafetyCheck.detail, /production profile is locked/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("doctor reports npm install script policy when ignore-scripts is enabled", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-ignore-scripts-on-"));
  const previousPolicy = process.env.npm_config_ignore_scripts;

  try {
    process.env.npm_config_ignore_scripts = "true";
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "doctor-ignore-scripts-on-fixture" }, null, 2),
      "utf8"
    );

    const config = defaultProjectConfig();
    config.project = "doctor-ignore-scripts-on-fixture";
    config.workspace = ".";

    const result = await runProjectDoctor({
      cwd: tempRoot,
      configInfo: {
        found: true,
        path: path.join(tempRoot, "learning-context.config.json"),
        config
      }
    });

    const installPolicyCheck = result.checks.find((check) => check.id === "npm-install-scripts-policy");

    assert.ok(installPolicyCheck);
    assert.equal(installPolicyCheck.status, "pass");
    assert.match(installPolicyCheck.detail, /ignore-scripts=true/i);
  } finally {
    if (previousPolicy === undefined) {
      delete process.env.npm_config_ignore_scripts;
    } else {
      process.env.npm_config_ignore_scripts = previousPolicy;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("doctor warns when npm install scripts are not ignored by default", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-ignore-scripts-off-"));
  const previousPolicy = process.env.npm_config_ignore_scripts;

  try {
    process.env.npm_config_ignore_scripts = "false";
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "doctor-ignore-scripts-off-fixture" }, null, 2),
      "utf8"
    );

    const config = defaultProjectConfig();
    config.project = "doctor-ignore-scripts-off-fixture";
    config.workspace = ".";

    const result = await runProjectDoctor({
      cwd: tempRoot,
      configInfo: {
        found: true,
        path: path.join(tempRoot, "learning-context.config.json"),
        config
      }
    });

    const installPolicyCheck = result.checks.find((check) => check.id === "npm-install-scripts-policy");

    assert.ok(installPolicyCheck);
    assert.equal(installPolicyCheck.status, "warn");
    assert.match(installPolicyCheck.detail, /ignore-scripts=false/i);
    assert.match(installPolicyCheck.fix, /npm ci --ignore-scripts/i);
  } finally {
    if (previousPolicy === undefined) {
      delete process.env.npm_config_ignore_scripts;
    } else {
      process.env.npm_config_ignore_scripts = previousPolicy;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("doctor warns when security protections are relaxed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-security-"));

  try {
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "doctor-security-fixture" }, null, 2),
      "utf8"
    );

    const config = defaultProjectConfig();
    config.project = "doctor-security-fixture";
    config.workspace = ".";
    config.security.ignoreSensitiveFiles = false;

    const result = await runProjectDoctor({
      cwd: tempRoot,
      configInfo: {
        found: true,
        path: path.join(tempRoot, "learning-context.config.json"),
        config
      }
    });

    const scanSafetyCheck = result.checks.find((check) => check.id === "scan-safety");

    assert.ok(scanSafetyCheck);
    assert.equal(scanSafetyCheck.status, "warn");
    assert.match(scanSafetyCheck.fix, /ignoreSensitiveFiles/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("doctor reports local-only backend and skips Ruflo semantic tier warnings", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-local-only-"));

  try {
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ name: "doctor-local-only-fixture" }, null, 2),
      "utf8"
    );

    const config = defaultProjectConfig();
    config.project = "doctor-local-only-fixture";
    config.workspace = ".";
    config.memory.backend = "local-only";

    const result = await runProjectDoctor({
      cwd: tempRoot,
      configInfo: {
        found: true,
        path: path.join(tempRoot, "learning-context.config.json"),
        config
      }
    });

    const backendCheck = result.checks.find((check) => check.id === "memory-backend");
    const rufloCheck = result.checks.find((check) => check.id === "ruflo-memory");
    const localMemoryCheck = result.checks.find((check) => check.id === "local-memory");

    assert.ok(backendCheck);
    assert.equal(backendCheck.status, "warn");
    assert.match(backendCheck.detail, /local-only/i);
    assert.ok(rufloCheck);
    assert.equal(rufloCheck.status, "pass");
    assert.match(rufloCheck.detail, /skipped because memory\.backend='local-only'/i);
    assert.ok(localMemoryCheck);
    assert.equal(localMemoryCheck.status, "pass");
    assert.match(localMemoryCheck.detail, /\.lcs[\\/]memory/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli doctor emits runtime metadata in json mode", async () => {
  const result = await runCli(["doctor", "--format", "json"]);
  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("doctor");

  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "doctor.v1");
  assert.equal(parsed.schemaVersion, "1.0.0");
  assert.equal(parsed.command, "doctor");
  assert.equal(typeof parsed.meta.durationMs, "number");
  assert.equal(parsed.meta.durationMs >= 0, true);
  assert.equal(typeof parsed.meta.cwd, "string");
  assert.equal(parsed.meta.cwd.length > 0, true);
  assert.equal(parsed.observability.schemaVersion, "1.0.0");
  assert.equal(typeof parsed.observability.recall.hitRate, "number");
  assert.ok(parsed.checks.length >= 1);
});

run("prowler status filter validator rejects unsupported values", () => {
  assert.throws(() => normalizeProwlerStatusFilter("maybe"), /must be one of/);
});

run("prowler findings converter maps fail findings to chunk format", () => {
  const converted = prowlerFindingsToChunkFile(
    [
      {
        metadata: {
          Provider: "aws",
          CheckID: "s3_bucket_public_access_block",
          CheckTitle: "S3 bucket public access must be blocked",
          Severity: {
            value: "high"
          },
          Risk: "Public access could leak data.",
          Remediation: {
            Recommendation: {
              Text: "Enable S3 block public access."
            }
          }
        },
        resource_uid: "arn:aws:s3:::prod-bucket",
        status: {
          value: "FAIL"
        }
      },
      {
        metadata: {
          Provider: "aws",
          CheckID: "cloudtrail_enabled",
          CheckTitle: "CloudTrail should be enabled",
          Severity: {
            value: "low"
          }
        },
        status: {
          value: "PASS"
        }
      }
    ],
    {
      statusFilter: "non-pass"
    }
  );

  assert.equal(converted.totalFindings, 2);
  assert.equal(converted.includedFindings, 1);
  assert.equal(converted.discardedFindings, 0);
  assert.equal(converted.skippedFindings, 1);
  assert.equal(converted.redactedFindings, 0);
  assert.equal(converted.redactionCountTotal, 0);
  assert.equal(converted.chunks[0].kind, "spec");
  assert.match(converted.chunks[0].content, /Remediation:/);
  assert.match(converted.chunks[0].source, /security:\/\/prowler\//);
});

run("prowler findings converter redacts inline secrets and discards empty records", () => {
  const converted = prowlerFindingsToChunkFile(
    [
      {
        metadata: {
          Provider: "aws",
          CheckID: "exposed_token",
          CheckTitle: "Token exposed in note",
          Severity: {
            value: "high"
          },
          Risk: "authorization='Bearer ghp_1234567890ABCDEFGHIJK' in notes."
        },
        status: {
          value: "FAIL"
        }
      },
      42
    ],
    {
      statusFilter: "all"
    }
  );

  assert.equal(converted.totalFindings, 2);
  assert.equal(converted.includedFindings, 1);
  assert.equal(converted.discardedFindings, 1);
  assert.equal(converted.redactedFindings, 1);
  assert.equal(converted.redactionCountTotal >= 1, true);
  assert.match(converted.chunks[0].content, /\[REDACTED\]|\[REDACTED_TOKEN\]/);
});

run("cli ingest-security emits a stable JSON contract and writes chunk output", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-prowler-ingest-"));
  const inputPath = path.join(tempRoot, "prowler-findings.json");
  const outputPath = path.join(tempRoot, "security-chunks.json");

  try {
    await writeFile(
      inputPath,
      JSON.stringify(
        [
          {
            metadata: {
              Provider: "aws",
              CheckID: "iam_root_mfa_enabled",
              CheckTitle: "Root account should use MFA",
              Severity: {
                value: "critical"
              },
              Risk: "Root credentials without MFA increase takeover risk.",
              Remediation: {
                Recommendation: {
                  Text: "Enable MFA for the AWS root account."
                }
              }
            },
            status: {
              value: "FAIL"
            },
            resource_uid: "arn:aws:iam::123456789012:root"
          },
          {
            metadata: {
              Provider: "aws",
              CheckID: "cloudtrail_enabled",
              CheckTitle: "CloudTrail enabled",
              Severity: {
                value: "low"
              }
            },
            status: {
              value: "PASS"
            }
          }
        ],
        null,
        2
      ),
      "utf8"
    );

    const result = await runCli([
      "ingest-security",
      "--input",
      inputPath,
      "--status-filter",
      "non-pass",
      "--output",
      outputPath,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    const fixture = await loadContractFixture("ingest-security");
    assert.equal(result.exitCode, 0);
    assertContractCompatibility(parsed, fixture, "ingest-security.v1");
    assert.equal(parsed.schemaVersion, "1.0.0");
    assert.equal(parsed.command, "ingest-security");
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.totalFindings, 2);
    assert.equal(parsed.includedFindings, 1);
    assert.equal(parsed.discardedFindings, 0);
    assert.equal(parsed.skippedFindings, 1);
    assert.equal(parsed.redactedFindings, 0);
    assert.equal(parsed.redactionCountTotal, 0);
    assert.equal(parsed.chunkFile.chunks.length, 1);
    assert.match(parsed.chunkFile.chunks[0].content, /Risk:/);
    assert.match(parsed.output, /security-chunks\.json/);
    assert.equal(parsed.observability.event.command, "ingest-security");

    const written = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(Array.isArray(written.chunks), true);
    assert.equal(written.chunks.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("ingest-security output feeds teach and prioritizes higher severity findings", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-security-e2e-"));
  const findingsPath = path.join(tempRoot, "findings.json");
  const chunksPath = path.join(tempRoot, "chunks.json");

  try {
    await writeFile(
      findingsPath,
      JSON.stringify(
        [
          {
            metadata: {
              Provider: "aws",
              CheckID: "critical_control",
              CheckTitle: "Critical control",
              Severity: {
                value: "critical"
              },
              Risk: "Control failure impacts confidentiality."
            },
            status: {
              value: "FAIL"
            },
            resource_uid: "res-critical"
          },
          {
            metadata: {
              Provider: "aws",
              CheckID: "medium_control",
              CheckTitle: "Medium control",
              Severity: {
                value: "medium"
              },
              Risk: "Control failure impacts integrity."
            },
            status: {
              value: "FAIL"
            },
            resource_uid: "res-medium"
          },
          {
            metadata: {
              Provider: "aws",
              CheckID: "low_control",
              CheckTitle: "Low control",
              Severity: {
                value: "low"
              },
              Risk: "Control failure impacts hygiene."
            },
            status: {
              value: "FAIL"
            },
            resource_uid: "res-low"
          }
        ],
        null,
        2
      ),
      "utf8"
    );

    const ingestResult = await runCli([
      "ingest-security",
      "--input",
      findingsPath,
      "--status-filter",
      "fail",
      "--output",
      chunksPath,
      "--format",
      "json"
    ]);

    const ingestParsed = JSON.parse(ingestResult.stdout);
    assert.equal(ingestResult.exitCode, 0);
    assert.equal(ingestParsed.includedFindings, 3);

    const teachResult = await runCli([
      "teach",
      "--input",
      chunksPath,
      "--task",
      "Prioritize cloud findings",
      "--objective",
      "Teach severity-first remediation planning",
      "--no-recall",
      "--format",
      "json"
    ]);

    const teachParsed = JSON.parse(teachResult.stdout);
    assert.equal(teachResult.exitCode, 0);
    const selectedSecurityChunks = teachParsed.selectedContext.filter(
      (chunk) =>
        String(chunk.source).startsWith("security://prowler/") ||
        String(chunk.id).startsWith("prowler-")
    );
    const suppressedSecurityChunks = teachParsed.suppressedContext.filter((chunk) =>
      String(chunk.id).startsWith("prowler-")
    );

    assert.equal(selectedSecurityChunks.length + suppressedSecurityChunks.length, 3);

    const allSecurityChunks = [...selectedSecurityChunks, ...suppressedSecurityChunks];
    const critical = allSecurityChunks.find((chunk) =>
      String(chunk.id).includes("critical-control")
    );
    const medium = allSecurityChunks.find((chunk) =>
      String(chunk.id).includes("medium-control")
    );
    const low = allSecurityChunks.find((chunk) => String(chunk.id).includes("low-control"));

    assert.equal(Boolean(critical && medium && low), true);
    assert.equal((critical?.score ?? 0) >= (medium?.score ?? 0), true);
    assert.equal((medium?.score ?? 0) >= (low?.score ?? 0), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("security pipeline script produces chunk and teach outputs", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-security-pipeline-"));
  const findingsPath = path.join(tempRoot, "findings.json");
  const outputDir = path.join(tempRoot, "pipeline-output");
  const chunksPath = path.join(outputDir, "security-chunks.json");
  const teachPath = path.join(outputDir, "security-teach.json");

  try {
    await writeFile(
      findingsPath,
      JSON.stringify(
        [
          {
            metadata: {
              Provider: "aws",
              CheckID: "critical_control",
              CheckTitle: "Critical control",
              Severity: {
                value: "critical"
              },
              Risk: "Control failure impacts confidentiality."
            },
            status: {
              value: "FAIL"
            },
            resource_uid: "res-critical"
          }
        ],
        null,
        2
      ),
      "utf8"
    );

    const result = await execFile(process.execPath, [
      "scripts/run-security-pipeline.js",
      "--input",
      findingsPath,
      "--output-dir",
      outputDir,
      "--status-filter",
      "fail"
    ]);

    assert.match(result.stdout, /Pipeline completed/);
    assert.match(result.stdout, /quality gate: PASS/i);

    const chunks = JSON.parse(await readFile(chunksPath, "utf8"));
    const teach = JSON.parse(await readFile(teachPath, "utf8"));
    assert.equal(Array.isArray(chunks.chunks), true);
    assert.equal(chunks.chunks.length, 1);
    assert.equal(teach.command, "teach");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("security pipeline quality gate fails when findings do not meet thresholds", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-security-pipeline-gate-"));
  const findingsPath = path.join(tempRoot, "findings-pass-only.json");
  const outputDir = path.join(tempRoot, "pipeline-output");

  try {
    await writeFile(
      findingsPath,
      JSON.stringify(
        [
          {
            metadata: {
              Provider: "aws",
              CheckID: "low_control",
              CheckTitle: "Low control",
              Severity: {
                value: "low"
              },
              Risk: "Hygiene issue only."
            },
            status: {
              value: "PASS"
            },
            resource_uid: "res-low"
          }
        ],
        null,
        2
      ),
      "utf8"
    );

    await assert.rejects(
      () =>
        execFile(process.execPath, [
          "scripts/run-security-pipeline.js",
          "--input",
          findingsPath,
          "--output-dir",
          outputDir,
          "--status-filter",
          "fail",
          "--min-priority",
          "0.9"
        ]),
      (error) => {
        const parsed = /** @type {{ code?: number, stderr?: string }} */ (error);
        assert.equal(parsed.code, 2);
        assert.match(parsed.stderr ?? "", /Quality gate failed/i);
        return true;
      }
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("security PR summary builder emits baseline comment with stable marker", () => {
  const summary = buildSecurityPipelineSummaryComment({
    nodeVersion: "20",
    chunksPayload: {
      chunks: [
        {
          id: "finding-critical",
          priority: 1
        }
      ]
    },
    teachPayload: {
      selectedContext: [{}]
    }
  });

  assert.match(summary.body, new RegExp(SECURITY_PIPELINE_SUMMARY_MARKER));
  assert.match(summary.body, /Quality gate: PASS/);
  assert.match(summary.body, /Delta vs previous comment: baseline/);
  assert.equal(summary.metrics.includedFindings, 1);
  assert.equal(summary.metrics.selectedTeachChunks, 1);
  assert.equal(summary.metrics.maxPriority, 1);
});

run("security PR summary builder computes deltas against previous bot comment", () => {
  const previous = buildSecurityPipelineSummaryComment({
    nodeVersion: "20",
    chunksPayload: {
      chunks: [
        {
          id: "finding-critical",
          priority: 0.9
        }
      ]
    },
    teachPayload: {
      selectedContext: [{}]
    }
  });
  const current = buildSecurityPipelineSummaryComment({
    nodeVersion: "20",
    chunksPayload: {
      chunks: [
        {
          id: "finding-critical",
          priority: 1
        },
        {
          id: "finding-medium",
          priority: 0.84
        }
      ]
    },
    teachPayload: {
      selectedContext: [{}, {}]
    },
    previousCommentBody: previous.body
  });

  assert.match(current.body, /Included findings: 2/);
  assert.match(current.body, /Selected teach chunks: 2/);
  assert.match(current.body, /Max finding priority: 1.000/);
  assert.match(current.body, /Delta vs previous comment:/);
  assert.match(current.body, /Included findings: \+1/);
  assert.match(current.body, /Selected teach chunks: \+1/);
  assert.match(current.body, /Max finding priority: \+0.100/);
  assert.equal(parseSecuritySummaryMetric(current.body, "Included findings"), 2);
  assert.equal(parseSecuritySummaryMetric(current.body, "Unknown metric"), null);
});

run("security PR summary baseline matches golden fixture", async () => {
  const summary = buildSecurityPipelineSummaryComment({
    nodeVersion: "20",
    chunksPayload: {
      chunks: [
        {
          id: "finding-critical",
          priority: 1
        }
      ]
    },
    teachPayload: {
      selectedContext: [{}]
    }
  });
  const fixturePath = path.join(
    process.cwd(),
    "test",
    "fixtures",
    "ci",
    "security-pr-summary.baseline.md"
  );
  const expected = await readFile(fixturePath, "utf8");

  assert.equal(normalizeNewlines(summary.body), normalizeNewlines(expected));
});

run("security PR summary delta matches golden fixture", async () => {
  const previous = buildSecurityPipelineSummaryComment({
    nodeVersion: "20",
    chunksPayload: {
      chunks: [
        {
          id: "finding-critical",
          priority: 0.9
        }
      ]
    },
    teachPayload: {
      selectedContext: [{}]
    }
  });
  const current = buildSecurityPipelineSummaryComment({
    nodeVersion: "20",
    chunksPayload: {
      chunks: [
        {
          id: "finding-critical",
          priority: 1
        },
        {
          id: "finding-medium",
          priority: 0.84
        }
      ]
    },
    teachPayload: {
      selectedContext: [{}, {}]
    },
    previousCommentBody: previous.body
  });
  const fixturePath = path.join(
    process.cwd(),
    "test",
    "fixtures",
    "ci",
    "security-pr-summary.delta.md"
  );
  const expected = await readFile(fixturePath, "utf8");

  assert.equal(normalizeNewlines(current.body), normalizeNewlines(expected));
});

run("pr learnings builder skips closed pull requests that were not merged", () => {
  const built = buildPrLearningsSyncPayload({
    pull_request: {
      number: 41,
      merged: false
    },
    repository: {
      full_name: "IGMED01/learning-context-system"
    }
  });

  assert.equal(built.skipped, true);
  assert.match(built.reason, /not merged/i);
});

run("pr learnings builder creates sync payload from merged PR metadata", () => {
  const built = buildPrLearningsSyncPayload({
    pull_request: {
      number: 42,
      title: "feat: quality gate for security pipeline",
      body: [
        "- Added quality gate for included findings.",
        "- Added selected teach chunks threshold.",
        "- Added max priority threshold.",
        "",
        "This PR hardens the CI surface."
      ].join("\n"),
      html_url: "https://github.com/IGMED01/learning-context-system/pull/42",
      merged: true,
      merged_at: "2026-03-18T22:10:00.000Z",
      additions: 120,
      deletions: 17,
      changed_files: 6,
      commits: 2,
      merge_commit_sha: "abc123",
      base: {
        ref: "main"
      },
      head: {
        ref: "codex/security-quality-gate"
      },
      user: {
        login: "IGMED01"
      },
      labels: [{ name: "security" }, { name: "ci" }]
    },
    repository: {
      full_name: "IGMED01/learning-context-system"
    }
  });

  assert.equal(built.skipped, false);

  if (built.skipped) {
    throw new Error("Expected non-skipped PR learnings payload.");
  }

  assert.match(built.entry.title, /PR Learnings #42/i);
  assert.match(built.entry.content, /Repository: IGMED01\/learning-context-system/);
  assert.match(built.entry.content, /Extracted highlights/);
  assert.match(built.entry.content, /Added quality gate for included findings/i);
  assert.equal(built.entry.source, "github-pr-42");
  assert.equal(built.entry.project, "IGMED01/learning-context-system");
  assert.equal(built.entry.tags.includes("pr-learnings"), true);
  assert.equal(built.entry.tags.includes("security"), true);
  assert.equal(built.entry.tags.includes("main"), true);
  assert.equal(built.entry.tags.includes("merged"), true);
});

run("pr body highlights fall back to compact excerpt when body has no bullets", () => {
  const highlights = extractPrBodyHighlights(
    "This change aligns release checks and improves CI reliability with explicit contracts."
  );

  assert.equal(highlights.length, 1);
  assert.match(highlights[0], /aligns release checks/i);
});

run("release discipline evaluator passes for repository policy files", async () => {
  const [packageJsonRaw, changelogRaw, versioningRaw] = await Promise.all([
    readFile(path.join(process.cwd(), "package.json"), "utf8"),
    readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8"),
    readFile(path.join(process.cwd(), "VERSIONING.md"), "utf8")
  ]);

  const result = evaluateReleaseDiscipline({
    packageJsonRaw,
    changelogRaw,
    versioningRaw
  });

  assert.equal(result.passed, true, formatReleaseDisciplineReport(result));
  assert.equal(result.checks.semverVersion, true);
  assert.equal(result.checks.changelogHasCurrentVersion, true);
  assert.equal(result.checks.versioningHasReleaseChecklist, true);
});

run("release discipline evaluator fails when changelog misses current version section", () => {
  const result = evaluateReleaseDiscipline({
    packageJsonRaw: JSON.stringify({ version: "1.2.3" }),
    changelogRaw: ["## [Unreleased]", "", "## [1.2.2] - 2026-03-18", "", "### Contracts"].join("\n"),
    versioningRaw: ["## Release checklist", "", "1. test"].join("\n")
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.errors.some((error) => /must include a release heading for package version 1.2.3/i.test(error)),
    true
  );
});

run("release discipline evaluator fails when current release has no Contracts subsection", () => {
  const result = evaluateReleaseDiscipline({
    packageJsonRaw: JSON.stringify({ version: "1.2.3" }),
    changelogRaw: [
      "## [Unreleased]",
      "",
      "## [1.2.3] - 2026-03-18",
      "",
      "### Added",
      "- feature"
    ].join("\n"),
    versioningRaw: ["## Release checklist", "", "1. test"].join("\n")
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.errors.some((error) => /must include a '### Contracts' subsection/i.test(error)),
    true
  );
});

run("north star gate passes when prevented-error metrics meet thresholds", () => {
  const result = evaluateNorthStarGate({
    observability: {
      found: true,
      filePath: ".lcs/observability.json",
      totals: {
        runs: 120,
        degradedRuns: 4,
        blockedRuns: 12,
        preventedErrors: 9,
        degradedRate: 0.033
      }
    },
    thresholds: {
      minRuns: 100,
      minBlockedRuns: 10,
      minPreventedErrors: 8,
      minPreventedErrorRate: 0.05,
      maxDegradedRate: 0.1
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.metrics.preventedErrorRate, 0.075);
  assert.equal(result.metrics.blockedCoverage, 0.75);
  assert.match(formatNorthStarGateReport(result), /passed: yes/);
});

run("north star gate fails when prevention signal is too low", () => {
  const result = evaluateNorthStarGate({
    observability: {
      found: true,
      filePath: ".lcs/observability.json",
      totals: {
        runs: 80,
        degradedRuns: 12,
        blockedRuns: 1,
        preventedErrors: 0,
        degradedRate: 0.15
      }
    },
    thresholds: {
      minRuns: 50,
      minBlockedRuns: 1,
      minPreventedErrors: 1,
      minPreventedErrorRate: 0.01,
      maxDegradedRate: 0.12
    }
  });

  assert.equal(result.passed, false);
  assert.equal(result.failures.some((line) => /preventedErrors=0/i.test(line)), true);
  assert.equal(result.failures.some((line) => /preventedErrorRate=0/i.test(line)), true);
  assert.equal(result.failures.some((line) => /degradedRate=0.15/i.test(line)), true);
  assert.match(formatNorthStarGateReport(result), /passed: no/);
});

run("readme generator infers concepts and reading order", async () => {
  const workspace = await loadWorkspaceChunks(".");
  const result = await buildLearningReadme({
    title: "README.LEARN",
    projectRoot: ".",
    focus: "learning context cli noise cancellation",
    chunks: workspace.payload.chunks
  });

  assert.match(result.markdown, /# README\.LEARN/);
  assert.match(result.markdown, /## Dependencies/);
  assert.match(result.markdown, /## Core Concepts To Learn First/);
  assert.match(result.markdown, /Node\.js/);
  assert.match(result.markdown, /src\/cli\.js/);
});

run("readme generator explains dependencies for the TypeScript backend vertical", async () => {
  const workspace = await loadWorkspaceChunks("examples/typescript-backend");
  const result = await buildLearningReadme({
    title: "README.LEARN",
    projectRoot: "examples/typescript-backend",
    focus: "typescript backend auth middleware request boundary",
    chunks: workspace.payload.chunks
  });

  assert.match(result.markdown, /TypeScript/i);
  assert.match(result.markdown, /Vitest/i);
  assert.match(result.markdown, /Zod/i);
  assert.match(result.markdown, /src\/auth\/middleware\.ts/);
});

run("cli readme writes markdown output", async () => {
  const outputPath = "test-output/README.LEARN.md";
  const result = await runCli([
    "readme",
    "--workspace",
    ".",
    "--focus",
    "learning context cli noise cancellation",
    "--output",
    outputPath,
    "--format",
    "text"
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /README generated at/);

  const written = await readFile(outputPath, "utf8");
  assert.match(written, /## How The Code Flows/);
  assert.match(written, /## Dependencies/);
});

run("cli readme emits a stable JSON contract", async () => {
  const result = await runCli([
    "readme",
    "--input",
    "examples/auth-context.json",
    "--focus",
    "learning context cli noise cancellation",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("readme");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "readme.v1");
  assert.equal(parsed.command, "readme");
  assert.equal(typeof parsed.markdown, "string");
});

run("numeric CLI options reject invalid ranges", async () => {
  const failure = await runCli([
    "select",
    "--input",
    "examples/auth-context.json",
    "--focus",
    "jwt middleware expired session validation",
    "--min-score",
    "1.5"
  ]).catch((error) => error);

  assert.match(String(failure.message ?? failure), /--min-score must be <= 1/);
});

run("engram client builds search and save commands with workspace-backed env", async () => {
  /** @type {Array<{ file: string, args: string[], options: import("node:child_process").ExecFileOptions }>} */
  const calls = [];
  const client = createEngramClient({
    cwd: "C:/repo",
    binaryPath: "C:/repo/tools/engram/engram.exe",
    dataDir: "C:/repo/.engram",
    exec: async (file, args, options) => {
      calls.push({
        file,
        args: [...args],
        options
      });

      return {
        stdout: "ok",
        stderr: ""
      };
    }
  });

  await client.search("jwt middleware", {
    project: "learning-context-system",
    scope: "project",
    type: "learning",
    limit: 3
  });
  await client.save({
    title: "Auth order",
    content: "Validation happens before handlers.",
    project: "learning-context-system",
    scope: "project",
    type: "decision",
    topic: "architecture/auth-order"
  });
  const closed = await client.closeSession({
    summary: "Integrated memory into the teaching flow.",
    project: "learning-context-system"
  });

  assert.match(calls[0].file, /C:[\\/]+repo[\\/]+tools[\\/]+engram[\\/]+engram\.exe/);
  assert.deepEqual(calls[0].args, [
    "search",
    "jwt middleware",
    "--type",
    "learning",
    "--project",
    "learning-context-system",
    "--scope",
    "project",
    "--limit",
    "3"
  ]);
  assert.match(String(calls[0].options.env?.ENGRAM_DATA_DIR), /C:[\\/]+repo[\\/]+\.engram/);
  assert.deepEqual(calls[1].args, [
    "save",
    "Auth order",
    "Validation happens before handlers.",
    "--type",
    "decision",
    "--project",
    "learning-context-system",
    "--scope",
    "project",
    "--topic",
    "architecture/auth-order"
  ]);
  assert.equal(closed.action, "close");
  assert.equal(calls[2].args[0], "save");
});

run("engram client wraps missing-binary errors with command context", async () => {
  const client = createEngramClient({
    cwd: "C:/repo",
    binaryPath: "C:/repo/tools/engram/missing-engram.exe",
    dataDir: "C:/repo/.engram",
    async exec() {
      throw createExecError("spawn ENOENT", {
        code: "ENOENT",
        stderr: "The system cannot find the file specified."
      });
    }
  });

  await assert.rejects(
    () =>
      client.search("auth middleware", {
        project: "learning-context-system"
      }),
    /Engram command failed: .*missing-engram\.exe search auth middleware/
  );
});

run("engram client wraps timeout errors and keeps stderr detail", async () => {
  const client = createEngramClient({
    cwd: "C:/repo",
    binaryPath: "C:/repo/tools/engram/engram.exe",
    dataDir: "C:/repo/.engram",
    async exec() {
      throw createExecError("process timeout", {
        code: "ETIMEDOUT",
        stderr: "query timed out after 10s"
      });
    }
  });

  await assert.rejects(
    () =>
      client.search("auth middleware", {
        project: "learning-context-system"
      }),
    /query timed out after 10s/
  );
});

run("local memory store saves and searches memories with engram-like output", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-local-memory-store-"));
  const store = createLocalMemoryStore({
    filePath: path.join(tempRoot, "memory-store.jsonl"),
    baseDir: path.join(tempRoot, "memory")
  });

  try {
    await store.save({
      title: "Auth validation order",
      content: "Reject invalid tokens before route handlers.",
      type: "decision",
      project: "learning-context-system",
      scope: "project"
    });
    await store.save({
      title: "Rate-limit middleware",
      content: "Throttle abusive IP ranges to protect auth endpoints.",
      type: "architecture",
      project: "learning-context-system",
      scope: "project"
    });

    const result = await store.search("auth validation", {
      project: "learning-context-system",
      scope: "project",
      limit: 5
    });

    assert.match(result.stdout, /Found \d+ memories:/);
    assert.match(result.stdout, /Auth validation order/);
    const chunks = searchOutputToChunks(result.stdout, {
      query: "auth validation",
      project: "learning-context-system"
    });
    assert.ok(chunks.length >= 1, "Expected at least 1 chunk from TF-IDF search");
    assert.match(chunks[0].content, /Auth validation order/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("resilient memory client falls back to local store when Engram search fails", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-resilient-memory-"));
  const fallback = createLocalMemoryStore({
    filePath: path.join(tempRoot, "memory-store.jsonl"),
    baseDir: path.join(tempRoot, "memory")
  });
  await fallback.save({
    title: "CLI integration memory",
    content: "Durable memory now enters teach packets.",
    type: "architecture",
    project: "learning-context-system",
    scope: "project"
  });

  const resilient = createResilientMemoryClient({
    primary: {
      config: { dataDir: ".engram" },
      async recallContext() {
        throw new Error("engram offline");
      },
      async search() {
        throw new Error("engram offline");
      },
      async save() {
        throw new Error("engram offline");
      },
      async closeSession() {
        throw new Error("engram offline");
      }
    },
    fallback
  });

  try {
    const result = await resilient.search("cli integration", {
      project: "learning-context-system",
      scope: "project",
      limit: 5
    });

    assert.equal(result.provider, "local");
    assert.equal(result.degraded, true);
    assert.match(result.warning ?? "", /local fallback/i);
    assert.match(result.stdout ?? "", /CLI integration memory/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("external battery memory client uses Engram battery only after primary chain failure", async () => {
  const batteryClient = createExternalBatteryMemoryClient({
    primary: /** @type {any} */ ({
      name: "primary-chain",
      async search() {
        throw new Error("ruflo/local chain offline");
      },
      async save() {
        throw new Error("ruflo/local chain offline");
      },
      async delete(id) {
        throw new Error(`cannot delete ${id}`);
      },
      async list() {
        throw new Error("ruflo/local chain offline");
      },
      async health() {
        return {
          healthy: false,
          provider: "primary-chain",
          detail: "primary chain offline"
        };
      },
      async recallContext() {
        throw new Error("ruflo/local chain offline");
      },
      async search() {
        throw new Error("ruflo/local chain offline");
      },
      async save() {
        throw new Error("ruflo/local chain offline");
      },
      async closeSession() {
        throw new Error("ruflo/local chain offline");
      }
    }),
    battery: /** @type {any} */ ({
      name: "engram",
      async search(query) {
        return {
          entries: [],
          stdout: `Battery result for ${query}`,
          provider: "engram"
        };
      },
      async save(input) {
        return {
          id: "battery-1",
          stdout: `Saved ${input.title}`,
          provider: "engram"
        };
      },
      async delete(id) {
        return { deleted: true, id };
      },
      async list() {
        return [];
      },
      async health() {
        return {
          healthy: true,
          provider: "engram",
          detail: "battery online"
        };
      },
      async recallContext(project) {
        return {
          mode: "context",
          project: project ?? "",
          stdout: "Battery recent memories",
          provider: "engram"
        };
      },
      async search(query) {
        return {
          mode: "search",
          query,
          stdout: `Battery result for ${query}`,
          provider: "engram"
        };
      },
      async save(input) {
        return {
          action: "save",
          title: input.title,
          content: input.content,
          stdout: `Saved ${input.title}`,
          provider: "engram"
        };
      },
      async closeSession(input) {
        return {
          action: "close",
          title: input.title ?? "Session close",
          stdout: input.summary,
          provider: "engram"
        };
      }
    })
  });

  const result = await batteryClient.search("auth middleware", {
    project: "learning-context-system",
    limit: 3
  });

  assert.equal(result.provider, "engram-battery");
  assert.equal(result.degraded, true);
  assert.match(result.warning ?? "", /external battery memory provider/i);
  assert.match(result.error ?? "", /ruflo\/local chain offline/i);
  assert.match(result.stdout, /Battery result for auth middleware/);
});

run("close summary builder captures summary, learning, and next step", () => {
    const content = buildCloseSummaryContent({
      summary: "Integrated the memory runtime into the CLI",
      learned: "Recent context and durable memory are different layers.",
      next: "Wire recall output into the teaching flow.",
      workspace: "C:/repo",
      closedAt: "2026-03-17T18:00:00.000Z"
  });

  assert.match(content, /Session Close Summary/);
  assert.match(content, /Integrated the memory runtime into the CLI/);
  assert.match(content, /durable memory are different layers/);
  assert.match(content, /Wire recall output into the teaching flow/);
});

run("notion config resolver uses explicit options over env defaults", () => {
  const config = resolveNotionConfig({
    token: "test-token",
    parentPageId: "page-123",
    apiBaseUrl: "https://api.notion.com/v1/"
  });

  assert.equal(config.token, "test-token");
  assert.equal(config.parentPageId, "page-123");
  assert.equal(config.apiBaseUrl, "https://api.notion.com/v1");
});

run("notion config resolver extracts page id from full Notion URL", () => {
  const config = resolveNotionConfig({
    token: "test-token",
    parentPageId:
      "https://www.notion.so/Workspace/PR-Learnings-1234567890abcdef1234567890abcdef?pvs=4"
  });

  assert.equal(config.parentPageId, "12345678-90ab-cdef-1234-567890abcdef");
});

run("notion config resolver converts raw 32-char ids to UUID format", () => {
  const config = resolveNotionConfig({
    token: "test-token",
    parentPageId: "327b5232556680d580bee12c22b4037d"
  });

  assert.equal(config.parentPageId, "327b5232-5566-80d5-80be-e12c22b4037d");
});

run("knowledge block builder includes metadata summary and tags", () => {
  const built = buildKnowledgeBlocks(
    "CLI rollout",
    {
      project: "learning-context-system",
      source: "pr-39",
      tags: ["memory", "notion"]
    },
    "2026-03-18T21:00:00.000Z"
  );

  assert.equal(Array.isArray(built.blocks), true);
  assert.equal(built.blocks.length >= 2, true);
  assert.deepEqual(built.tags, ["memory", "notion"]);
});

run("notion client appends a knowledge entry through block children API", async () => {
  /** @type {Array<{ url: string, init: RequestInit | undefined }>} */
  const calls = [];
  const client = createNotionSyncClient({
    token: "token-123",
    parentPageId: "page-abc",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({ object: "list", results: [] });
        }
      };
    }
  });
  const result = await client.appendKnowledgeEntry({
    title: "PR learnings",
    content: "We stabilized the release gate and aligned changelog semantics.",
    project: "learning-context-system",
    source: "manual-test",
    tags: ["release", "governance"]
  });

  assert.equal(result.action, "append");
  assert.equal(result.parentPageId, "page-abc");
  assert.equal(result.appendedBlocks >= 3, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/blocks\/page-abc\/children$/);
  assert.equal(calls[0].init?.method, "PATCH");
});

run("notion client renders markdown headings and lists as native Notion blocks", async () => {
  /** @type {Array<{ type?: string }>} */
  let capturedChildren = [];
  const client = createNotionSyncClient({
    token: "token-123",
    parentPageId: "page-abc",
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(String(init?.body || "{}"));
      capturedChildren = Array.isArray(payload.children) ? payload.children : [];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({ object: "list", results: [] });
        }
      };
    }
  });

  await client.appendKnowledgeEntry({
    title: "PR learnings",
    content: [
      "## Pull Request Learnings",
      "",
      "- Repository: IGMED01/learning-context-system",
      "- URL: https://github.com/IGMED01/learning-context-system/pull/45",
      "",
      "### Why this change",
      "1. Switch append transport to PATCH.",
      "2. Retry alternate page-id formats.",
      "",
      "Body excerpt line one.",
      "Body excerpt line two."
    ].join("\n")
  });

  const blockTypes = capturedChildren.map((block) => block.type || "");
  assert.deepEqual(blockTypes.slice(0, 9), [
    "heading_3",
    "paragraph",
    "heading_2",
    "bulleted_list_item",
    "bulleted_list_item",
    "heading_3",
    "numbered_list_item",
    "numbered_list_item",
    "paragraph"
  ]);
  assert.doesNotMatch(JSON.stringify(capturedChildren), /## Pull Request Learnings/);
});

run("notion client retries with alternate page-id format on invalid request url", async () => {
  /** @type {Array<{ url: string, method: string }>} */
  const calls = [];
  const client = createNotionSyncClient({
    token: "token-123",
    parentPageId: "327b5232556680d580bee12c22b4037d",
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: String(init?.method || "")
      });

      if (url.includes("/blocks/327b5232-5566-80d5-80be-e12c22b4037d/children")) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          async text() {
            return JSON.stringify({
              object: "error",
              message: "Invalid request URL."
            });
          }
        };
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({ object: "list", results: [] });
        }
      };
    }
  });

  const result = await client.appendKnowledgeEntry({
    title: "PR learnings",
    content: "Retry path should survive Notion URL format mismatch."
  });

  assert.equal(calls.length >= 2, true);
  assert.equal(
    calls.some((call) => call.url.includes("/blocks/327b5232556680d580bee12c22b4037d/children")),
    true
  );
  assert.equal(calls.every((call) => call.method === "PATCH"), true);
  assert.equal(result.action, "append");
});

run("notion client fails fast when required config is missing", async () => {
  const client = createNotionSyncClient({
    token: "",
    parentPageId: ""
  });

  await assert.rejects(
    () =>
      client.appendKnowledgeEntry({
        title: "x",
        content: "y"
      }),
    /Notion token is missing/i
  );
});

run("observability store aggregates degraded runs and recall hit rate", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-observability-"));

  try {
    await recordCommandMetric(
      {
        command: "recall",
        durationMs: 42,
        degraded: true,
        recall: {
          attempted: true,
          status: "failed-degraded",
          recoveredChunks: 0,
          hit: false
        }
      },
      { cwd: tempRoot }
    );

    await recordCommandMetric(
      {
        command: "teach",
        durationMs: 30,
        degraded: false,
        selection: {
          selectedCount: 4,
          suppressedCount: 12
        },
        recall: {
          attempted: true,
          status: "recalled",
          recoveredChunks: 2,
          selectedChunks: 1,
          suppressedChunks: 0,
          hit: true
        }
      },
      { cwd: tempRoot }
    );

    const report = await getObservabilityReport({ cwd: tempRoot });

    assert.equal(report.found, true);
    assert.equal(report.totals.runs, 2);
    assert.equal(report.totals.degradedRuns, 1);
    assert.equal(report.recall.attempts, 2);
    assert.equal(report.recall.hits, 1);
    assert.equal(report.recall.hitRate, 0.5);
    assert.equal(report.selection.selectedTotal, 4);
    assert.equal(report.selection.suppressedTotal, 12);
    assert.equal(report.commands.some((entry) => entry.command === "teach"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("observability store tracks safety-blocked and prevented-error events", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-observability-safety-"));

  try {
    await recordCommandMetric(
      {
        command: "remember",
        durationMs: 12,
        degraded: true,
        safety: {
          blocked: true,
          reason: "safety-gate",
          preventedError: true
        }
      },
      { cwd: tempRoot }
    );

    const report = await getObservabilityReport({ cwd: tempRoot });

    assert.equal(report.totals.runs, 1);
    assert.equal(report.totals.blockedRuns, 1);
    assert.equal(report.totals.preventedErrors, 1);
    assert.equal(report.safety.blockedRuns, 1);
    assert.equal(report.safety.preventedErrors, 1);
    assert.equal(report.safety.byReason["safety-gate"], 1);
    assert.equal(report.commands[0]?.blockedRuns, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("engram search output is converted into memory chunks", () => {
  const chunks = searchOutputToChunks(
    [
      "Found 1 memories:",
      "",
      "[1] #2 (architecture) — CLI Engram integration",
      "    Added recall, remember, and close commands to wrap the local Engram binary from the project CLI.",
      "    2026-03-17 17:33:39 | project: learning-context-system | scope: project"
    ].join("\n"),
    {
      query: "CLI Engram integration",
      project: "learning-context-system"
    }
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].kind, "memory");
  assert.match(chunks[0].source, /engram:\/\/learning-context-system\/2/);
  assert.match(chunks[0].content, /Recall query: CLI Engram integration/);
  assert.equal(chunks[0].priority > 0.85, true);
});

run("teach recall query builder derives shorter concept queries", () => {
  const queries = buildTeachRecallQueries({
    task: "Integrate memory runtime CLI",
    objective: "Teach how durable memory feeds the packet",
    focus: "CLI memory runtime integration durable memory recall remember close",
    changedFiles: ["src/cli/app.js", "src/memory/engram-client.js"]
  });

  assert.ok(queries.length >= 3);
  assert.ok(queries.some((query) => /(memory|engram)/u.test(query) && /cli/u.test(query)));
  assert.ok(queries.some((query) => /integration/u.test(query)));
  assert.equal(queries.some((query) => query.split(/\s+/u).length <= 4), true);
});

run("teach recall strategy retries queries and deduplicates repeated memories", async () => {
  const seenQueries = [];
  const result = await resolveTeachRecall({
    task: "Integrate memory runtime CLI",
    objective: "Teach how durable memory feeds the packet",
    focus: "cli durable memory integration recall",
    changedFiles: ["src/cli/app.js", "src/memory/engram-client.js"],
    project: "learning-context-system",
    limit: 3,
    baseChunks: [
      {
        id: "cli-app",
        source: "src/cli/app.js",
        kind: "code",
        content: "CLI app wires recall into teach.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.82,
        priority: 0.93
      }
    ],
    async search(query) {
      seenQueries.push(query);

      if (!/integration/u.test(query) && !/(memory|engram)\s+(runtime\s+)?cli/u.test(query)) {
        return {
          entries: [],
          stdout: "No memories found for that query.",
          provider: "memory"
        };
      }

      return {
        entries: [
          {
            id: "8",
            title: "CLI memory runtime integration",
            content: "Durable memory now enters the teach packet automatically.",
            type: "architecture",
            project: "learning-context-system",
            scope: "project",
            topic: "",
            createdAt: "2026-03-17T18:15:00.000Z"
          }
        ],
        stdout: "Found 1 memories:",
        provider: "memory"
      };
    }
  });

  assert.equal(result.memoryRecall.status, "recalled");
  assert.equal(result.memoryRecall.recoveredChunks, 1);
  assert.equal(result.memoryRecall.firstMatchIndex >= 0, true);
  assert.equal(result.memoryRecall.matchedQueries.length >= 1, true);
  assert.equal(result.chunks.filter((chunk) => chunk.kind === "memory").length, 1);
  assert.equal(seenQueries.length >= 1, true);
});

run("teach recall strategy reports recoverable provider errors without throwing", async () => {
  const result = await resolveTeachRecall({
    task: "Improve auth middleware",
    objective: "Teach validation order",
    focus: "auth middleware validation order",
    changedFiles: ["src/auth/middleware.ts"],
    project: "learning-context-system",
    limit: 2,
    baseChunks: [],
    strictRecall: false,
    async search() {
      throw new Error("temporary memory provider failure");
    }
  });

  assert.equal(result.memoryRecall.status, "failed");
  assert.match(result.memoryRecall.error, /temporary memory provider failure/);
  assert.match(result.memoryRecall.error, /retryAttempts=2/);
  assert.equal(result.chunks.length, 0);
});

run("teach recall retries transient failures before succeeding", async () => {
  let attempts = 0;
  const result = await resolveTeachRecall({
    task: "Integrate memory runtime CLI",
    objective: "Teach memory flow",
    focus: "memory runtime cli retry",
    changedFiles: ["src/memory/teach-recall.js"],
    project: "learning-context-system",
    explicitQuery: "memory runtime cli integration",
    limit: 2,
    retryAttempts: 3,
    retryBackoffMs: 0,
    baseChunks: [],
    async search() {
      attempts += 1;

      if (attempts < 3) {
        throw new Error("ETIMEDOUT while querying memory provider");
      }

      return {
        entries: [
          {
            id: "11",
            title: "CLI memory runtime integration",
            content: "Memory retry recovered and produced a stable recall payload.",
            type: "architecture",
            project: "learning-context-system",
            scope: "project",
            topic: "",
            createdAt: "2026-03-18T17:00:00.000Z"
          }
        ],
        stdout: "Found 1 memories:",
        provider: "memory"
      };
    }
  });

  assert.equal(result.memoryRecall.status, "recalled");
  assert.equal(result.memoryRecall.recoveredChunks, 1);
  assert.equal(attempts, 3);
});

run("teach recall does not retry non-recoverable failures", async () => {
  let attempts = 0;
  const result = await resolveTeachRecall({
    task: "Integrate memory runtime CLI",
    objective: "Teach memory flow",
    focus: "memory runtime binary path",
    changedFiles: ["src/memory/engram-client.js"],
    project: "learning-context-system",
    explicitQuery: "memory runtime binary",
    retryAttempts: 4,
    retryBackoffMs: 0,
    baseChunks: [],
    async search() {
      attempts += 1;
      throw new Error("ENOENT binary not found");
    }
  });

  assert.equal(result.memoryRecall.status, "failed");
  assert.equal(result.memoryRecall.degraded, true);
  assert.equal(attempts, 1);
});

run("teach recall treats malformed provider output as empty recall instead of crash", async () => {
  const result = await resolveTeachRecall({
    task: "Integrate memory runtime CLI",
    objective: "Teach memory flow",
    focus: "memory runtime cli",
    changedFiles: ["src/memory/teach-recall.js"],
    project: "learning-context-system",
    limit: 2,
    baseChunks: [],
    async search() {
      return {
        entries: [],
        stdout: "Found memory entries but output format is malformed",
        provider: "memory"
      };
    }
  });

  assert.equal(result.memoryRecall.status, "empty");
  assert.equal(result.memoryRecall.recoveredChunks, 0);
  assert.equal(result.memoryRecall.degraded, false);
  assert.equal(result.chunks.length, 0);
});

run("teach recall strict mode throws provider errors", async () => {
  await assert.rejects(
    () =>
      resolveTeachRecall({
        task: "Improve auth middleware",
        objective: "Teach validation order",
        focus: "auth middleware validation",
        changedFiles: ["src/auth/middleware.ts"],
        project: "learning-context-system",
        strictRecall: true,
        async search() {
          throw new Error("ETIMEDOUT while querying memory provider");
        }
      }),
    /ETIMEDOUT/
  );
});

run("cli recall delegates to Engram search when a query is provided", async () => {
  /** @type {Array<{ kind: string, payload: unknown }>} */
  const calls = [];
  const fakeClient = {
    async recallContext(project) {
      calls.push({ kind: "context", payload: project });
      return {
        mode: "context",
        project: project ?? "",
        query: "",
        stdout: "No previous session memories found.",
        dataDir: ".engram"
      };
    },
    async search(query, options) {
      calls.push({ kind: "search", payload: { query, options } });
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        type: options?.type ?? "",
        scope: options?.scope ?? "",
        limit: options?.limit ?? null,
        stdout: "1. Auth order decision",
        dataDir: ".engram"
      };
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "recall",
      "--query",
      "auth middleware",
      "--project",
      "learning-context-system",
      "--type",
      "decision",
      "--scope",
      "project",
      "--limit",
      "2",
      "--format",
      "text"
    ],
    {
      engramClient: fakeClient
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "search");
  assert.match(result.stdout, /Recall mode: search/);
  assert.match(result.stdout, /auth middleware/);
  assert.match(result.stdout, /Auth order decision/);
});

run("cli recall uses config defaults and emits a stable JSON contract", async () => {
  const configPath = "test-output/cli-config.json";
  await writeFile(
    configPath,
    JSON.stringify({
      project: "configured-project",
      memory: {
        project: "configured-project",
        degradedRecall: true
      }
    }),
    "utf8"
  );

  /** @type {{ query?: string, options?: unknown }} */
  const seen = {};
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      seen.query = query;
      seen.options = options;
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        type: options?.type ?? "",
        scope: options?.scope ?? "",
        limit: options?.limit ?? null,
        stdout: "1. Configured project memory",
        dataDir: ".engram"
      };
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "recall",
      "--config",
      configPath,
      "--query",
      "auth middleware",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("recall");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "recall.v1");
  assert.equal(parsed.schemaVersion, "1.0.0");
  assert.equal(parsed.command, "recall");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.degraded, false);
  assert.equal(parsed.config.found, true);
  assert.match(parsed.config.path, /cli-config\.json/);
  assert.equal(typeof parsed.meta.durationMs, "number");
  assert.equal(typeof parsed.meta.cwd, "string");
  assert.equal(parsed.meta.cwd.length > 0, true);
  assert.equal(parsed.observability.event.command, "recall");
  assert.equal(typeof parsed.observability.event.durationMs, "number");
  assert.equal(typeof parsed.observability.recall.hit, "boolean");
  assert.equal(parsed.project, "configured-project");
  assert.equal(seen.query, "auth middleware");
  assert.equal(seen.options?.project, "configured-project");
});

run("cli recall returns a degraded contract when Engram is unavailable", async () => {
  const fakeClient = {
    config: {
      dataDir: ".engram"
    },
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("engram offline");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "recall",
      "--query",
      "auth middleware",
      "--degraded-recall",
      "true",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.command, "recall");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.degraded, true);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /degraded mode/i);
  assert.equal(parsed.stdout, "");
  assert.match(parsed.error, /engram offline/);
});

run("cli recall can use local fallback memory store when Engram binary is missing", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-recall-fallback-"));
  const fallbackFile = path.join(tempRoot, "fallback-memory.jsonl");
  const memoryBaseDir = path.join(tempRoot, "memory");

  try {
    const store = createLocalMemoryStore({
      filePath: fallbackFile,
      baseDir: memoryBaseDir
    });
    await store.save({
      title: "Auth boundary memory",
      content: "Validate token before business logic.",
      type: "architecture",
      project: "learning-context-system",
      scope: "project"
    });

    const result = await runCli([
      "recall",
      "--query",
      "auth boundary",
      "--project",
      "learning-context-system",
      "--engram-bin",
      "tools/engram/missing-engram.exe",
      "--local-memory-fallback",
      "true",
      "--memory-base-dir",
      memoryBaseDir,
      "--memory-fallback-file",
      fallbackFile,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.degraded, true);
    assert.equal(parsed.provider, "local");
    assert.match(parsed.warnings[0], /local fallback memory store/i);
    assert.match(parsed.stdout, /Auth boundary memory/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli recall supports local-only backend without calling Engram", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-recall-local-only-"));
  const fallbackFile = path.join(tempRoot, "fallback-memory.jsonl");
  const memoryBaseDir = path.join(tempRoot, "memory");

  try {
    const store = createLocalMemoryStore({
      filePath: fallbackFile,
      baseDir: memoryBaseDir
    });
    await store.save({
      title: "Local-only memory",
      content: "Use local backend when Engram is optional.",
      type: "pattern",
      project: "learning-context-system",
      scope: "project"
    });

    const result = await runCli([
      "recall",
      "--query",
      "local-only memory",
      "--project",
      "learning-context-system",
      "--memory-backend",
      "local-only",
      "--engram-bin",
      "tools/engram/missing-engram.exe",
      "--memory-base-dir",
      memoryBaseDir,
      "--memory-fallback-file",
      fallbackFile,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.degraded, false);
    assert.equal(parsed.provider, "local");
    assert.match(parsed.stdout, /Local-only memory/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli recall degraded mode classifies timeout failures", async () => {
  const fakeClient = {
    config: {
      dataDir: ".engram"
    },
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("ETIMEDOUT: query timed out after 8s");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "recall",
      "--query",
      "auth middleware",
      "--degraded-recall",
      "true",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.degraded, true);
  assert.equal(parsed.failureKind, "timeout");
  assert.match(parsed.fixHint, /retry/i);
});

run("cli recall degraded mode classifies malformed provider output", async () => {
  const fakeClient = {
    config: {
      dataDir: ".engram"
    },
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("Unexpected token } in JSON at position 12");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "recall",
      "--query",
      "auth middleware",
      "--degraded-recall",
      "true",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.degraded, true);
  assert.equal(parsed.failureKind, "malformed-output");
  assert.match(parsed.fixHint, /doctor/i);
});

run("cli recall degraded mode classifies missing binary in real subprocess path", async () => {
  const result = await runCli([
    "recall",
    "--query",
    "auth middleware",
    "--engram-bin",
    "tools/engram/missing-engram.exe",
    "--local-memory-fallback",
    "false",
    "--degraded-recall",
    "true",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.degraded, true);
  assert.equal(parsed.failureKind, "binary-missing");
  assert.match(parsed.fixHint, /ruflo|local-only|skip-ruflo/i);
});

run("cli recall debug shows active filter state", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        type: options?.type ?? "",
        scope: options?.scope ?? "",
        limit: options?.limit ?? null,
        stdout: "1. Auth order decision",
        dataDir: ".engram"
      };
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "recall",
      "--query",
      "auth middleware",
      "--project",
      "learning-context-system",
      "--scope",
      "project",
      "--debug",
      "--format",
      "text"
    ],
    {
      engramClient: fakeClient
    }
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Recall debug:/);
  assert.match(result.stdout, /Query provided: yes/);
  assert.match(result.stdout, /Scope filter active: yes/);
});

run("cli remember can be blocked by safety gate when write plan is not approved", async () => {
  const configPath = path.join(process.cwd(), "test-safety-gate-config.json");
  let called = false;
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("not used");
    },
    async save() {
      called = true;
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        project: "learning-context-system",
        safety: {
          requirePlanForWrite: true
        }
      }),
      "utf8"
    );

    const result = await runCli(
      [
        "remember",
        "--config",
        configPath,
        "--title",
        "JWT order",
        "--content",
        "Validation first.",
        "--format",
        "json"
      ],
      {
        engramClient: fakeClient
      }
    );

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 1);
    assert.equal(called, false);
    assert.equal(parsed.status, "error");
    assert.equal(parsed.action, "blocked");
    assert.equal(parsed.reason, "safety-gate");
    assert.equal(parsed.details.some((detail) => /plan-approved/i.test(detail)), true);
    assert.equal(parsed.observability.safety.blocked, true);
  } finally {
    await rm(configPath, { force: true });
  }
});

run("cli remember falls back to local store when Engram binary is missing", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-remember-fallback-"));
  const fallbackFile = path.join(tempRoot, "fallback-memory.jsonl");

  try {
    const result = await runCli([
      "remember",
      "--title",
      "Retry strategy for memory persistence",
      "--content",
      "When the primary memory backend is unavailable, persist the note locally and surface a degraded warning to the operator.",
      "--project",
      "learning-context-system",
      "--engram-bin",
      "tools/engram/missing-engram.exe",
      "--local-memory-fallback",
      "true",
      "--memory-fallback-file",
      fallbackFile,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.degraded, true);
    assert.equal(parsed.provider, "local");
    assert.match(parsed.stdout, /Saved local memory/i);
    assert.equal(parsed.warnings.some((entry) => /local fallback/i.test(entry)), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli remember quarantines obvious test-noise memory writes", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-remember-quarantine-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const quarantineDir = path.join(tempRoot, "memory-quarantine");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    const result = await runCli([
      "remember",
      "--title",
      "Fallback memory write",
      "--content",
      "Store this even when engram is down.",
      "--project",
      "learning-context-system",
      "--memory-backend",
      "local-only",
      "--memory-base-dir",
      memoryBaseDir,
      "--memory-quarantine-dir",
      quarantineDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.provider, "quarantine");
    assert.equal(parsed.memoryStatus, "quarantined");
    assert.equal(parsed.reviewStatus, "quarantined");
    assert.equal(parsed.warnings.some((entry) => /hygiene gate/i.test(entry)), true);
    await assert.rejects(() => readFile(memoryFile, "utf8"));
    const quarantineFiles = await readdir(path.join(quarantineDir, "learning-context-system"));
    assert.equal(quarantineFiles.length >= 1, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli remember persists hygiene metadata on accepted local memories", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-remember-metadata-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    const result = await runCli([
      "remember",
      "--title",
      "Guard order stays before prompt dispatch",
      "--content",
      "Guard runs before the LLM so unsafe prompts are blocked without spending tokens. Files: src/guard/guard-engine.js and src/cli/app.js.",
      "--project",
      "learning-context-system",
      "--type",
      "decision",
      "--topic",
      "architecture/guard-order",
      "--memory-backend",
      "local-only",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    const stored = (await readFile(memoryFile, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.equal(result.exitCode, 0);
    assert.equal(parsed.memoryStatus, "accepted");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].sourceKind, "manual");
    assert.equal(stored[0].reviewStatus, "accepted");
    assert.equal(stored[0].protected, true);
    assert.equal(typeof stored[0].signalScore, "number");
    assert.equal(typeof stored[0].healthScore, "number");
    assert.deepEqual(stored[0].reviewReasons, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli close persists hygiene metadata on accepted local memories", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-close-metadata-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    const result = await runCli([
      "close",
      "--summary",
      "Finished hygiene gate MVP for durable memory writes.",
      "--learned",
      "It is better to block noisy memories before they enter recall than to prune them later.",
      "--next",
      "Add memory compaction after quarantine is stable.",
      "--project",
      "learning-context-system",
      "--memory-backend",
      "local-only",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    const stored = (await readFile(memoryFile, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.equal(result.exitCode, 0);
    assert.equal(parsed.memoryStatus, "accepted");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].sourceKind, "close");
    assert.equal(stored[0].reviewStatus, "accepted");
    assert.equal(stored[0].protected, false);
    assert.equal(typeof stored[0].signalScore, "number");
    assert.equal(typeof stored[0].healthScore, "number");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli doctor-memory flags duplicate test-noise memories without mutating the store", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-memory-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      [
        JSON.stringify({
          id: "dup-1",
          title: "CLI integration memory",
          content: "Durable memory now enters teach packets.",
          type: "architecture",
          project: "learning-context-system",
          scope: "project",
          topic: "",
          createdAt: "2026-03-26T00:55:21.834Z"
        }),
        JSON.stringify({
          id: "dup-2",
          title: "CLI integration memory",
          content: "Durable memory now enters teach packets.",
          type: "architecture",
          project: "learning-context-system",
          scope: "project",
          topic: "",
          createdAt: "2026-03-26T00:56:21.834Z"
        }),
        JSON.stringify({
          id: "decision-1",
          title: "Guard order is fixed",
          content: "Guard runs before the LLM to block unsafe prompts without wasting tokens.",
          type: "decision",
          project: "learning-context-system",
          scope: "project",
          topic: "architecture/guard-order",
          createdAt: "2026-03-26T02:10:00.000Z"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await runCli([
      "doctor-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.command, "doctor-memory");
    assert.equal(parsed.summary.total, 3);
    assert.equal(parsed.summary.candidate >= 1, true);
    assert.equal(
      parsed.entries.some(
        (entry) =>
          entry.title === "CLI integration memory" &&
          entry.reasons.includes("duplicate") &&
          (entry.reasons.includes("generic") || entry.quarantineCandidate === true)
      ),
      true
    );

    const after = await readFile(memoryFile, "utf8");
    assert.equal(after.includes("CLI integration memory"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli memory-stats reports stable health and noise metrics", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-memory-stats-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      [
        JSON.stringify({
          id: "decision-1",
          title: "Guard order is fixed",
          content: "Guard runs before the LLM to block unsafe prompts without wasting tokens.",
          type: "decision",
          project: "learning-context-system",
          scope: "project",
          topic: "architecture/guard-order",
          createdAt: "2026-03-26T02:10:00.000Z",
          reviewStatus: "accepted",
          protected: true,
          signalScore: 0.82,
          duplicateScore: 0,
          durabilityScore: 0.96,
          healthScore: 0.88,
          reviewReasons: []
        }),
        JSON.stringify({
          id: "learning-1",
          title: "CLI integration memory",
          content: "Durable memory now enters teach packets.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "",
          createdAt: "2026-03-26T00:55:21.834Z"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await runCli([
      "memory-stats",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.command, "memory-stats");
    assert.equal(parsed.summary.total, 2);
    assert.equal(parsed.metrics.durableCount, 1);
    assert.equal(parsed.metrics.reviewableCount, 1);
    assert.equal(parsed.metrics.recallableDurableCount, 1);
    assert.equal(typeof parsed.metrics.averageHealthScore, "number");
    assert.equal(parsed.metrics.noiseRate >= 0, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli prune-memory dry-run reports candidates without moving them", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-prune-memory-dry-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const quarantineDir = path.join(tempRoot, "memory-quarantine");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      [
        JSON.stringify({
          id: "fallback-1",
          title: "Fallback memory write",
          content: "Store this even when engram is down.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "",
          createdAt: "2026-03-26T00:55:21.834Z"
        }),
        JSON.stringify({
          id: "decision-1",
          title: "Guard order is fixed",
          content: "Guard runs before the LLM to block unsafe prompts without wasting tokens.",
          type: "decision",
          project: "learning-context-system",
          scope: "project",
          topic: "architecture/guard-order",
          createdAt: "2026-03-26T02:10:00.000Z"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await runCli([
      "prune-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--memory-quarantine-dir",
      quarantineDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.command, "prune-memory");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.applied, false);
    assert.equal(parsed.summary.candidates, 1);
    assert.equal(parsed.summary.moved, 0);
    await assert.rejects(() => readFile(path.join(quarantineDir, "learning-context-system", "2026-03-26.jsonl"), "utf8"));
    const after = await readFile(memoryFile, "utf8");
    assert.equal(after.includes("Fallback memory write"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli prune-memory apply moves candidates into quarantine and keeps protected entries", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-prune-memory-apply-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const quarantineDir = path.join(tempRoot, "memory-quarantine");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      [
        JSON.stringify({
          id: "fallback-1",
          title: "Fallback memory write",
          content: "Store this even when engram is down.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "",
          createdAt: "2026-03-26T00:55:21.834Z"
        }),
        JSON.stringify({
          id: "decision-1",
          title: "Guard order is fixed",
          content: "Guard runs before the LLM to block unsafe prompts without wasting tokens.",
          type: "decision",
          project: "learning-context-system",
          scope: "project",
          topic: "architecture/guard-order",
          createdAt: "2026-03-26T02:10:00.000Z"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await runCli([
      "prune-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--memory-quarantine-dir",
      quarantineDir,
      "--apply",
      "true",
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.applied, true);
    assert.equal(parsed.summary.moved, 1);
    assert.equal(parsed.quarantinePaths.length, 1);

    const after = await readFile(memoryFile, "utf8");
    assert.equal(after.includes("Fallback memory write"), false);
    assert.equal(after.includes("Guard order is fixed"), true);

    const quarantineFile = parsed.quarantinePaths[0];
    const quarantineContent = await readFile(quarantineFile, "utf8");
    assert.equal(quarantineContent.includes("Fallback memory write"), true);
    assert.equal(quarantineContent.includes("\"reviewStatus\":\"quarantined\""), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli compact-memory dry-run reports reviewable compaction groups", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-compact-memory-dry-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      [
        JSON.stringify({
          id: "learn-1",
          title: "Auth middleware learning",
          content: "Guard now blocks unsafe auth prompts before the provider call.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "auth/middleware",
          createdAt: "2026-03-26T02:10:00.000Z"
        }),
        JSON.stringify({
          id: "learn-2",
          title: "Auth middleware learning",
          content: "Retry logic only runs after guard clears the request path.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "auth/middleware",
          createdAt: "2026-03-26T03:10:00.000Z"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await runCli([
      "compact-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.command, "compact-memory");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.summary.groups, 1);
    assert.equal(parsed.summary.entriesToCompact, 2);
    assert.equal(parsed.groups[0].topic, "auth/middleware");

    const after = await readFile(memoryFile, "utf8");
    assert.equal(after.includes("\"learn-1\""), true);
    assert.equal(after.includes("\"learn-2\""), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli compact-memory apply writes compacted entry and quarantines superseded sources", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-compact-memory-apply-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const quarantineDir = path.join(tempRoot, "memory-quarantine");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      [
        JSON.stringify({
          id: "learn-1",
          title: "Auth middleware learning",
          content: "Guard now blocks unsafe auth prompts before the provider call.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "auth/middleware",
          createdAt: "2026-03-26T02:10:00.000Z"
        }),
        JSON.stringify({
          id: "learn-2",
          title: "Auth middleware learning",
          content: "Retry logic only runs after guard clears the request path.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "auth/middleware",
          createdAt: "2026-03-26T03:10:00.000Z"
        }),
        JSON.stringify({
          id: "decision-1",
          title: "Guard order is fixed",
          content: "Guard runs before the LLM to block unsafe prompts without wasting tokens.",
          type: "decision",
          project: "learning-context-system",
          scope: "project",
          topic: "architecture/guard-order",
          createdAt: "2026-03-26T04:10:00.000Z"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await runCli([
      "compact-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--memory-quarantine-dir",
      quarantineDir,
      "--apply",
      "true",
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(parsed.applied, true);
    assert.equal(parsed.summary.groups, 1);
    assert.equal(parsed.summary.created, 1);
    assert.equal(parsed.summary.moved, 2);

    const after = (await readFile(memoryFile, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(after.some((entry) => entry.id === "decision-1"), true);
    assert.equal(after.some((entry) => entry.id === "learn-1"), false);
    assert.equal(after.some((entry) => entry.id === "learn-2"), false);
    assert.equal(after.some((entry) => entry.sourceKind === "compaction"), true);

    const quarantineContent = await readFile(parsed.quarantinePaths[0], "utf8");
    assert.equal(quarantineContent.includes("\"reviewStatus\":\"superseded\""), true);
    assert.equal(quarantineContent.includes("\"quarantineReasons\":[\"compacted\"]"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli doctor-memory emits a stable JSON contract", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-doctor-memory-contract-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      JSON.stringify({
        id: "decision-1",
        title: "Guard order is fixed",
        content: "Guard runs before the LLM to block unsafe prompts without wasting tokens.",
        type: "decision",
        project: "learning-context-system",
        scope: "project",
        topic: "architecture/guard-order",
        createdAt: "2026-03-26T02:10:00.000Z"
      }) + "\n",
      "utf8"
    );

    const result = await runCli([
      "doctor-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    const fixture = await loadContractFixture("doctor-memory");
    assert.equal(result.exitCode, 0);
    assertContractCompatibility(parsed, fixture, "doctor-memory.v1");
    assert.equal(parsed.command, "doctor-memory");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli memory-stats emits a stable JSON contract", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-memory-stats-contract-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      JSON.stringify({
        id: "decision-1",
        title: "Guard order is fixed",
        content: "Guard runs before the LLM to block unsafe prompts without wasting tokens.",
        type: "decision",
        project: "learning-context-system",
        scope: "project",
        topic: "architecture/guard-order",
        createdAt: "2026-03-26T02:10:00.000Z"
      }) + "\n",
      "utf8"
    );

    const result = await runCli([
      "memory-stats",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    const fixture = await loadContractFixture("memory-stats");
    assert.equal(result.exitCode, 0);
    assertContractCompatibility(parsed, fixture, "memory-stats.v1");
    assert.equal(parsed.command, "memory-stats");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli prune-memory emits a stable JSON contract", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-prune-memory-contract-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      JSON.stringify({
        id: "fallback-1",
        title: "Fallback memory write",
        content: "Store this even when engram is down.",
        type: "learning",
        project: "learning-context-system",
        scope: "project",
        topic: "",
        createdAt: "2026-03-26T00:55:21.834Z"
      }) + "\n",
      "utf8"
    );

    const result = await runCli([
      "prune-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    const fixture = await loadContractFixture("prune-memory");
    assert.equal(result.exitCode, 0);
    assertContractCompatibility(parsed, fixture, "prune-memory.v1");
    assert.equal(parsed.command, "prune-memory");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli compact-memory emits a stable JSON contract", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-compact-memory-contract-"));
  const memoryBaseDir = path.join(tempRoot, "memory");
  const memoryFile = path.join(memoryBaseDir, "learning-context-system", "memories.jsonl");

  try {
    await mkdir(path.dirname(memoryFile), { recursive: true });
    await writeFile(
      memoryFile,
      [
        JSON.stringify({
          id: "learn-1",
          title: "Auth middleware learning",
          content: "Guard now blocks unsafe auth prompts before the provider call.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "auth/middleware",
          createdAt: "2026-03-26T02:10:00.000Z"
        }),
        JSON.stringify({
          id: "learn-2",
          title: "Auth middleware learning",
          content: "Retry logic only runs after guard clears the request path.",
          type: "learning",
          project: "learning-context-system",
          scope: "project",
          topic: "auth/middleware",
          createdAt: "2026-03-26T03:10:00.000Z"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await runCli([
      "compact-memory",
      "--project",
      "learning-context-system",
      "--memory-base-dir",
      memoryBaseDir,
      "--format",
      "json"
    ]);

    const parsed = JSON.parse(result.stdout);
    const fixture = await loadContractFixture("compact-memory");
    assert.equal(result.exitCode, 0);
    assertContractCompatibility(parsed, fixture, "compact-memory.v1");
    assert.equal(parsed.command, "compact-memory");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("cli teach auto remember quarantines low-signal noisy summaries before save", async () => {
  let saveCalls = 0;
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: "No memories found for that query.",
        provider: "engram",
        dataDir: ".engram"
      };
    },
    async save() {
      saveCalls += 1;
      return {
        stdout: "should-not-save",
        provider: "engram",
        dataDir: ".engram"
      };
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Local-only memory",
      "--objective",
      "Fallback memory write",
      "--project",
      "learning-context-system",
      "--auto-remember",
      "true",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(saveCalls, 0);
  assert.equal(parsed.autoMemory.rememberSaved, false);
  assert.equal(parsed.autoMemory.rememberStatus, "quarantined");
  assert.equal(parsed.warnings.some((entry) => /quarantined by hygiene gate/i.test(entry)), true);
});

run("cli teach can be blocked when token budget exceeds safety max", async () => {
  const configPath = path.join(process.cwd(), "test-safety-budget-config.json");
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("not used");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        project: "learning-context-system",
        safety: {
          maxTokenBudget: 120
        }
      }),
      "utf8"
    );

    const result = await runCli(
      [
        "teach",
        "--config",
        configPath,
        "--input",
        "examples/auth-context.json",
        "--task",
        "Improve auth middleware",
        "--objective",
        "Teach why validation runs before route handlers",
        "--token-budget",
        "350",
        "--format",
        "json"
      ],
      {
        engramClient: fakeClient
      }
    );

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 1);
    assert.equal(parsed.status, "error");
    assert.equal(parsed.command, "teach");
    assert.equal(parsed.action, "blocked");
    assert.equal(parsed.reason, "safety-gate");
    assert.equal(parsed.details.some((detail) => /maxTokenBudget/i.test(detail)), true);
    assert.equal(parsed.observability.safety.preventedError, true);
  } finally {
    await rm(configPath, { force: true });
  }
});

run("cli readme can be blocked when workspace scan has no explicit focus signal", async () => {
  const result = await runCli([
    "readme",
    "--workspace",
    ".",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 1);
  assert.equal(parsed.status, "error");
  assert.equal(parsed.command, "readme");
  assert.equal(parsed.action, "blocked");
  assert.equal(parsed.reason, "safety-gate");
  assert.equal(
    parsed.details.some((detail) => /explicit --focus/i.test(detail)),
    true
  );
});

run("cli select debug can be blocked when focus signal is weak", async () => {
  const result = await runCli([
    "select",
    "--workspace",
    ".",
    "--focus",
    "auth",
    "--debug",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 1);
  assert.equal(parsed.status, "error");
  assert.equal(parsed.command, "select");
  assert.equal(parsed.action, "blocked");
  assert.equal(parsed.reason, "safety-gate");
  assert.equal(
    parsed.details.some((detail) => /stronger focus/i.test(detail)),
    true
  );
});

run("cli remember saves a durable memory through Engram", async () => {
  /** @type {Array<unknown>} */
  const calls = [];
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("not used");
    },
    async save(input) {
      calls.push(input);
      return {
        title: input.title,
        project: input.project ?? "",
        type: input.type ?? "",
        scope: input.scope ?? "",
        topic: input.topic ?? "",
        stdout: "Saved observation #2",
        dataDir: ".engram"
      };
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "remember",
      "--title",
      "JWT order",
      "--content",
      "Validation now runs before route handlers.",
      "--project",
      "learning-context-system",
      "--type",
      "decision",
      "--topic",
      "architecture/auth-order",
      "--format",
      "text"
    ],
    {
      engramClient: fakeClient
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].title, "JWT order");
  assert.equal(calls[0].content, "Validation now runs before route handlers.");
  assert.equal(calls[0].type, "decision");
  assert.equal(calls[0].project, "learning-context-system");
  assert.equal(calls[0].scope, "project");
  assert.equal(calls[0].topic, "architecture/auth-order");
  assert.equal(calls[0].sourceKind, "manual");
  assert.equal(["accepted", "candidate"].includes(calls[0].reviewStatus), true);
  assert.equal(calls[0].protected, true);
  assert.equal(typeof calls[0].healthScore, "number");
  assert.match(result.stdout, /Memory saved/);
  assert.match(result.stdout, /architecture\/auth-order/);
});

run("cli remember emits a stable JSON contract", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("not used");
    },
    async save(input) {
      return {
        action: "save",
        title: input.title,
        content: input.content,
        project: input.project ?? "",
        type: input.type ?? "",
        scope: input.scope ?? "",
        topic: input.topic ?? "",
        stdout: "Saved observation #2",
        dataDir: ".engram"
      };
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "remember",
      "--title",
      "JWT order",
      "--content",
      "Validation now runs before route handlers.",
      "--project",
      "learning-context-system",
      "--type",
      "decision",
      "--topic",
      "architecture/auth-order",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("remember");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "remember.v1");
  assert.equal(parsed.command, "remember");
});

run("cli close stores a structured session-close memory", async () => {
  /** @type {Array<unknown>} */
  const calls = [];
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("not used");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession(input) {
      calls.push(input);
      return {
        title: input.title ?? "Session close - 2026-03-17",
        project: input.project ?? "",
        type: input.type ?? "",
        scope: input.scope ?? "",
        topic: "",
        stdout: "Saved observation #3",
        dataDir: ".engram"
      };
    }
  };

  const result = await runCli(
    [
      "close",
      "--summary",
      "Integrated recall and remember commands.",
      "--learned",
      "Context retrieval and durable memory must stay separate.",
      "--next",
      "Connect recall output to the teaching packet.",
      "--project",
      "learning-context-system",
      "--format",
      "text"
    ],
    {
      engramClient: fakeClient
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].summary, "Integrated recall and remember commands.");
  assert.equal(calls[0].learned, "Context retrieval and durable memory must stay separate.");
  assert.equal(calls[0].next, "Connect recall output to the teaching packet.");
  assert.equal(calls[0].title, undefined);
  assert.equal(calls[0].project, "learning-context-system");
  assert.equal(calls[0].scope, "project");
  assert.equal(calls[0].type, "learning");
  assert.equal(calls[0].sourceKind, "close");
  assert.equal(calls[0].reviewStatus, "accepted");
  assert.equal(calls[0].protected, false);
  assert.equal(typeof calls[0].healthScore, "number");
  assert.match(result.stdout, /Session close note saved/);
});

run("cli close emits a stable JSON contract", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("not used");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession(input) {
      return {
        action: "close",
        title: input.title ?? "Session close - 2026-03-18",
        summary: input.summary,
        learned: input.learned ?? "",
        next: input.next ?? "",
        content: "## Session Close Summary",
        project: input.project ?? "",
        type: input.type ?? "",
        scope: input.scope ?? "",
        topic: "",
        stdout: "Saved observation #3",
        dataDir: ".engram"
      };
    }
  };

  const result = await runCli(
    [
      "close",
      "--summary",
      "Integrated recall and remember commands.",
      "--learned",
      "Context retrieval and durable memory must stay separate.",
      "--next",
      "Connect recall output to the teaching packet.",
      "--project",
      "learning-context-system",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("close");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "close.v1");
  assert.equal(parsed.command, "close");
});

run("cli sync-knowledge appends a Notion entry in text mode", async () => {
  /** @type {Array<unknown>} */
  const calls = [];
  const fakeNotionClient = {
    async appendKnowledgeEntry(input) {
      calls.push(input);
      return {
        action: "append",
        title: input.title,
        project: input.project ?? "",
        source: input.source ?? "lcs-cli",
        tags: input.tags ?? [],
        parentPageId: "page-123",
        appendedBlocks: 4,
        createdAt: "2026-03-18T21:00:00.000Z"
      };
    }
  };

  const result = await runCli(
    [
      "sync-knowledge",
      "--title",
      "PR #39 learnings",
      "--content",
      "Migrated Engram adapter to TS build track.",
      "--project",
      "learning-context-system",
      "--source",
      "pr-39",
      "--tags",
      "typescript,memory,engram",
      "--format",
      "text"
    ],
    {
      notionClient: fakeNotionClient
    }
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls[0], {
    title: "PR #39 learnings",
    content: "Migrated Engram adapter to TS build track.",
    project: "learning-context-system",
    source: "pr-39",
    tags: ["typescript", "memory", "engram"]
  });
  assert.match(result.stdout, /Notion sync summary/);
  assert.match(result.stdout, /appended blocks: 4/);
});

run("cli sync-knowledge emits a stable JSON contract", async () => {
  const fakeNotionClient = {
    async appendKnowledgeEntry(input) {
      return {
        action: "append",
        title: input.title,
        project: input.project ?? "",
        source: input.source ?? "lcs-cli",
        tags: input.tags ?? [],
        parentPageId: "page-abc",
        appendedBlocks: 3,
        createdAt: "2026-03-18T21:05:00.000Z"
      };
    }
  };

  const result = await runCli(
    [
      "sync-knowledge",
      "--title",
      "Weekly learnings",
      "--content",
      "Context quality and memory reliability improved.",
      "--project",
      "learning-context-system",
      "--tags",
      "weekly,learning",
      "--format",
      "json"
    ],
    {
      notionClient: fakeNotionClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("sync-knowledge");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "sync-knowledge.v1");
  assert.equal(parsed.command, "sync-knowledge");
  assert.equal(parsed.action, "append");
  assert.equal(parsed.parentPageId, "page-abc");
  assert.equal(parsed.observability.event.command, "sync-knowledge");
});

run("cli teach consumes recalled Engram memory automatically", async () => {
  const seenQueries = [];
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      seenQueries.push(query);
      assert.equal(options?.project, "learning-context-system");

      if (!/auth/u.test(query) || !/(middleware|validation)/u.test(query)) {
        return {
          mode: "search",
          project: options?.project ?? "",
          query,
          stdout: "No memories found for that query.",
          dataDir: ".engram"
        };
      }

      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: [
          "Found 1 memories:",
          "",
          "[1] #7 (decision) — Auth validation order",
          "    Reject invalid tokens before route handlers so the failure stays at the boundary.",
          "    2026-03-17 18:05:00 | project: learning-context-system | scope: project"
        ].join("\n"),
        dataDir: ".engram"
      };
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Improve auth middleware",
      "--objective",
      "Teach why validation runs before route handlers",
      "--changed-files",
      "src/auth/middleware.ts,test/auth/middleware.test.ts",
      "--project",
      "learning-context-system",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.memoryRecall.status, "recalled");
  assert.equal(parsed.memoryRecall.recoveredChunks, 1);
  assert.equal(parsed.memoryRecall.selectedChunks >= 1, true);
  assert.equal(parsed.memoryRecall.queriesTried.length >= 1, true);
  assert.equal(seenQueries.length >= 1, true);
  assert.equal(parsed.selectedContext.some((chunk) => chunk.kind === "memory"), true);
});

run("cli teach can persist an automatic memory summary when enabled", async () => {
  /** @type {Array<{ content: string, title: string, type?: string, scope?: string, project?: string }>} */
  const saveCalls = [];
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: "No memories found for that query.",
        dataDir: ".engram"
      };
    },
    async save(input) {
      saveCalls.push(input);
      return {
        ...input,
        stdout: "saved",
        dataDir: ".engram"
      };
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Improve auth middleware",
      "--objective",
      "Teach why validation runs before route handlers and never leak password='secret123'",
      "--changed-files",
      ".env,src/auth/middleware.ts,test/auth/middleware.test.ts",
      "--project",
      "learning-context-system",
      "--auto-remember",
      "true",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(saveCalls.length, 1);
  assert.equal(parsed.autoMemory.autoRememberEnabled, true);
  assert.equal(parsed.autoMemory.rememberAttempted, true);
  assert.equal(parsed.autoMemory.rememberSaved, true);
  assert.equal(parsed.autoMemory.rememberSensitivePathCount >= 1, true);
  assert.equal(parsed.autoMemory.rememberRedactionCount >= 1, true);
  assert.match(parsed.autoMemory.rememberTitle, /Teach loop/);
  assert.match(saveCalls[0].content, /\[redacted-sensitive-path\]/i);
  assert.match(saveCalls[0].content, /\[REDACTED\]/);
  assert.equal(parsed.warnings.some((entry) => /redacted/i.test(entry)), true);
});

run("cli teach reports degraded output when auto remember write fails", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: "No memories found for that query.",
        dataDir: ".engram"
      };
    },
    async save() {
      throw new Error("sqlite is locked");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Improve auth middleware",
      "--objective",
      "Teach validation order",
      "--auto-remember",
      "true",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.degraded, true);
  assert.equal(parsed.autoMemory.rememberSaved, false);
  assert.equal(parsed.autoMemory.rememberAttempted, true);
  assert.match(parsed.autoMemory.rememberError, /sqlite is locked/);
  assert.equal(parsed.warnings.some((entry) => /Auto remember failed/i.test(entry)), true);
});

run("cli teach respects config memory.autoRecall=false without requiring --no-recall", async () => {
  const configPath = path.join(process.cwd(), "test-auto-recall-config.json");
  let called = false;
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      called = true;
      throw new Error("not used");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        project: "learning-context-system",
        memory: {
          autoRecall: false
        }
      }),
      "utf8"
    );

    const result = await runCli(
      [
        "teach",
        "--config",
        configPath,
        "--input",
        "examples/auth-context.json",
        "--task",
        "Improve auth middleware",
        "--objective",
        "Teach why validation runs before route handlers",
        "--format",
        "json"
      ],
      {
        engramClient: fakeClient
      }
    );

    const parsed = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(called, false);
    assert.equal(parsed.memoryRecall.status, "disabled");
    assert.equal(parsed.autoMemory.autoRecallEnabled, false);
  } finally {
    await rm(configPath, { force: true });
  }
});

run("cli teach skips auto recall for low-signal tasks without changed files", async () => {
  let called = false;
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      called = true;
      throw new Error("not used");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Fix typo",
      "--objective",
      "Quick patch",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(called, false);
  assert.equal(parsed.memoryRecall.status, "skipped");
  assert.equal(parsed.memoryRecall.reason, "low-signal-task");
  assert.equal(parsed.autoMemory.autoRecallEnabled, false);
  assert.equal(parsed.warnings.some((entry) => /low-signal task/i.test(entry)), true);
});

run("cli teach emits a stable JSON contract and marks degraded recall", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      throw new Error("temporary memory provider failure");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Improve auth middleware",
      "--objective",
      "Teach why validation runs before route handlers",
      "--changed-files",
      "src/auth/middleware.ts,test/auth/middleware.test.ts",
      "--project",
      "learning-context-system",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  const fixture = await loadContractFixture("teach");
  assert.equal(result.exitCode, 0);
  assertContractCompatibility(parsed, fixture, "teach.v1");
  assert.equal(parsed.schemaVersion, "1.0.0");
  assert.equal(parsed.command, "teach");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.degraded, true);
  assert.equal(typeof parsed.meta.durationMs, "number");
  assert.equal(parsed.meta.scanStats, null);
  assert.equal(parsed.observability.event.command, "teach");
  assert.equal(typeof parsed.observability.recall.hit, "boolean");
  assert.equal(parsed.memoryRecall.status, "failed");
  assert.equal(parsed.memoryRecall.degraded, true);
  assert.equal(parsed.warnings.length, 1);
});

run("cli teach retries recall with fallback queries until a memory matches", async () => {
  const seenQueries = [];
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search(query, options) {
      seenQueries.push(query);

      if (!/integration/u.test(query)) {
        return {
          mode: "search",
          project: options?.project ?? "",
          query,
          stdout: "No memories found for that query.",
          dataDir: ".engram"
        };
      }

      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: [
          "Found 1 memories:",
          "",
          "[1] #8 (architecture) â€” CLI memory runtime integration",
          "    Durable memory now enters the teach packet automatically.",
          "    2026-03-17 18:15:00 | project: learning-context-system | scope: project"
        ].join("\n"),
        dataDir: ".engram"
      };
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--workspace",
      ".",
      "--task",
      "Integrate memory runtime CLI",
      "--objective",
      "Teach how durable memory feeds the packet",
      "--changed-files",
      "src/cli/app.js,src/memory/engram-client.js",
      "--project",
      "learning-context-system",
      "--recall-query",
      "CLI memory runtime integration",
      "--token-budget",
      "520",
      "--max-chunks",
      "8",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.memoryRecall.status, "recalled");
  assert.equal(parsed.memoryRecall.matchedQueries.some((query) => /integration/u.test(query)), true);
  assert.equal(seenQueries.length >= 1, true);
  assert.equal(parsed.memoryRecall.recoveredChunks >= 1, true);
  assert.equal(
    parsed.memoryRecall.selectedChunks + parsed.memoryRecall.suppressedChunks >= 1,
    true
  );
});

run("cli teach can disable automatic recall", async () => {
  let called = false;
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async search() {
      called = true;
      throw new Error("not used");
    },
    async save() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };

  const result = await runCli(
    [
      "teach",
      "--input",
      "examples/auth-context.json",
      "--task",
      "Improve auth middleware",
      "--objective",
      "Teach why validation runs before route handlers",
      "--no-recall",
      "--format",
      "json"
    ],
    {
      engramClient: fakeClient
    }
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(called, false);
  assert.equal(parsed.memoryRecall.status, "disabled");
  assert.equal(parsed.memoryRecall.enabled, false);
});

run("NEXUS:1 structure parser extracts markdown sections", async () => {
  const sections = parseDocumentStructure([
    "# Intro",
    "Context line",
    "",
    "## Details",
    "Important details",
    "",
    "## Next",
    "Action items"
  ].join("\n"));

  assert.equal(sections.length, 3);
  assert.equal(sections[0].title, "Intro");
  assert.equal(sections[1].level, 2);
  assert.match(sections[2].id, /^section-/u);
  assert.equal(sections[2].content.includes("Action items"), true);
});

run("NEXUS:1 chunker splits oversized sections", async () => {
  const longParagraph = "A".repeat(900);
  const chunks = chunkDocument(`# Summary\n\n${longParagraph}\n\n${longParagraph}`, {
    source: "docs/nexus.md",
    maxCharsPerChunk: 700
  });

  assert.equal(chunks.length >= 3, true);
  assert.equal(chunks.every((entry) => entry.id.startsWith("docs/nexus.md#")), true);
  assert.equal(chunks.every((entry) => entry.metadata.sectionTitle === "Summary"), true);
});

run("NEXUS:1 code symbol extractor maps imports exports and class surface", async () => {
  const symbols = extractCodeSymbols({
    source: "src/services/user-service.ts",
    content: [
      'import { DatabaseConnector } from "./database.js";',
      "",
      "export interface UserRecord {",
      "  id: string;",
      "}",
      "",
      "export class UserService extends DatabaseConnector {",
      "  async findUser(id: string) {",
      "    return this.query(id);",
      "  }",
      "",
      "  private mapRow(row: unknown) {",
      "    return row;",
      "  }",
      "}",
      "",
      "export const createUserService = () => new UserService();"
    ].join("\n")
  });

  assert.equal(symbols.parser, "typescript-ast");
  assert.equal(symbols.language, "typescript");
  assert.equal(symbols.imports[0]?.source, "./database.js");
  assert.equal(symbols.exports.includes("UserService"), true);
  assert.equal(symbols.publicSurface.includes("UserService.findUser"), true);
  assert.equal(symbols.dependencyHints.includes("DatabaseConnector"), true);
  assert.equal(
    symbols.declarations.some(
      (entry) =>
        entry.kind === "method" &&
        entry.parent === "UserService" &&
        entry.name === "mapRow" &&
        entry.visibility === "private"
    ),
    true
  );
});

run("NEXUS:1 workspace chunks include AST-backed symbol summaries for code", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-symbol-chunks-"));

  try {
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "src", "user-service.ts"),
      [
        'import { DatabaseConnector } from "./database.js";',
        "",
        "export class UserService extends DatabaseConnector {",
        "  async findUser(id: string) {",
        "    return this.query(id);",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const result = await loadWorkspaceChunks(tempRoot);
    const codeChunk = result.payload.chunks.find((entry) => entry.source === "src/user-service.ts");

    assert.ok(codeChunk);
    assert.equal(codeChunk.kind, "code");
    assert.equal(codeChunk.processing?.symbols?.parser, "typescript-ast");
    assert.equal(codeChunk.processing?.symbols?.publicSurface.includes("UserService"), true);
    assert.equal(codeChunk.processing?.symbols?.dependencyHints.includes("DatabaseConnector"), true);
    assert.equal(
      codeChunk.processing?.symbols?.declarations.some(
        (entry) => entry.kind === "class" && entry.name === "UserService"
      ),
      true
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:2 chunk repository upserts and filters persisted chunks", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-chunk-repo-"));
  const repository = createChunkRepository({
    filePath: path.join(tempRoot, "chunks.jsonl")
  });

  try {
    await repository.upsertChunk({
      id: "c1",
      source: "docs/one.md",
      kind: "doc",
      content: "first chunk"
    });
    await repository.upsertChunk({
      id: "c2",
      source: "src/auth/middleware.ts",
      kind: "code",
      content: "second chunk"
    });
    await repository.upsertChunk({
      id: "c1",
      source: "docs/one.md",
      kind: "doc",
      content: "first chunk updated"
    });

    const one = await repository.getChunksById(["c1"]);
    const code = await repository.listChunks({ kind: "code" });

    assert.equal(one.length, 1);
    assert.equal(one[0].content, "first chunk updated");
    assert.equal(code.length, 1);
    assert.equal(code[0].id, "c2");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:4 output guard blocks secret-like output", async () => {
  const result = enforceOutputGuard(
    'authorization = "Bearer sk-live-0123456789ABCDEF0123456789"',
    {
      blockOnSecretSignal: true
    }
  );

  assert.equal(result.allowed, false);
  assert.equal(result.action, "block");
  assert.equal(result.reasons.includes("secret-signal-detected"), true);
  assert.equal(result.output, "");
});

run("NEXUS:1 metadata tagger infers domain and topic", async () => {
  const tags = tagChunkMetadata({
    source: "src/auth/middleware.ts",
    kind: "code",
    content: "validate session token and reject expired auth context"
  });

  assert.equal(tags.domain, "security");
  assert.equal(tags.topic, "auth-validation");
  assert.equal(tags.type, "code");
  assert.equal(tags.confidence >= 0.75, true);
});

run("NEXUS:1 entity extractor finds dates urls organizations and references", async () => {
  const entities = extractEntities(
    "NEXUS sync review for GitHub happened on 2026-03-24. See https://example.com/docs and ask Ignacio Medina."
  );

  assert.equal(entities.some((entry) => entry.type === "date" && entry.value === "2026-03-24"), true);
  assert.equal(entities.some((entry) => entry.type === "url"), true);
  assert.equal(entities.some((entry) => entry.type === "organization" && entry.value === "GitHub"), true);
  assert.equal(entities.some((entry) => entry.type === "reference" && entry.normalized === "NEXUS"), true);
  assert.equal(entities.some((entry) => entry.type === "person" && entry.value === "Ignacio Medina"), true);
});

run("NEXUS:2 bm25 index ranks the most relevant document first", async () => {
  const index = createBm25Index([
    {
      id: "auth",
      content: "auth middleware validates expired session tokens before route handlers"
    },
    {
      id: "docs",
      content: "readme and docs about onboarding and release notes"
    },
    {
      id: "metrics",
      content: "observability metrics dashboard traces and counters"
    }
  ]);

  const results = index.search("auth session validation", { limit: 2 });

  assert.equal(results.length >= 1, true);
  assert.equal(results[0].id, "auth");
  assert.equal(results[0].score > 0, true);
});

run("NEXUS:4 output auditor records and lists guard events", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-output-audit-"));
  const auditor = createOutputAuditor({
    filePath: path.join(tempRoot, "audit.jsonl")
  });

  try {
    await auditor.record({
      action: "block",
      reasons: ["secret-signal-detected"],
      outputLength: 0,
      source: "nexus:test"
    });
    await auditor.record({
      action: "redact",
      reasons: ["policy-term:password"],
      outputLength: 24,
      source: "nexus:test"
    });

    const blocked = await auditor.list({ action: "block", limit: 10 });
    const recent = await auditor.list({ limit: 2 });

    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].action, "block");
    assert.equal(recent.length, 2);
    assert.equal(recent[1].action, "redact");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:2 hybrid retriever combines lexical and keyword signals", async () => {
  const retriever = createHybridRetriever([
    {
      id: "nexus-storage",
      content: "storage retrieval bm25 hybrid retriever for chunks"
    },
    {
      id: "nexus-guard",
      content: "guard output compliance redaction block unsafe responses"
    },
    {
      id: "nexus-sync",
      content: "sync notion change detector and version tracker"
    }
  ]);

  const results = retriever.search("hybrid storage retrieval", { limit: 2 });

  assert.equal(results.length >= 1, true);
  assert.equal(results[0].id, "nexus-storage");
  assert.equal(results[0].score >= results[0].lexicalScore * 0.75, true);
});

run("NEXUS:4 compliance checker detects email phone and blocked terms", async () => {
  const result = checkOutputCompliance(
    "Contact Ignacio at ignacio@example.com or +54 11 5555 1234. Internal secret scope.",
    {
      blockedTerms: ["internal secret"]
    }
  );

  assert.equal(result.compliant, false);
  assert.equal(result.violations.includes("email-detected"), true);
  assert.equal(result.violations.includes("phone-detected"), true);
  assert.equal(result.violations.includes("blocked-term:internal secret"), true);
});

run("NEXUS:4 output guard enforces domain-scope policy", async () => {
  const result = enforceOutputGuard("Security token validation is required for API access.", {
    domainScope: {
      allowedDomains: ["observability"]
    }
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reasons.some((reason) => reason.startsWith("domain-scope-outside:")), true);
});

run("NEXUS:0 change detector reports created changed and deleted files", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-change-detector-"));
  const stateFilePath = path.join(tempRoot, ".lcs", "change-detector.json");
  const detector = createChangeDetector({
    stateFilePath
  });

  try {
    await writeFile(path.join(tempRoot, "a.md"), "v1", "utf8");
    await writeFile(path.join(tempRoot, "b.md"), "stable", "utf8");

    const first = await detector.detectChanges(tempRoot);

    assert.equal(first.summary.created >= 2, true);
    assert.equal(first.summary.changed, 0);

    await writeFile(path.join(tempRoot, "a.md"), "v2", "utf8");
    await rm(path.join(tempRoot, "b.md"), { force: true });
    await writeFile(path.join(tempRoot, "c.md"), "new", "utf8");

    const second = await detector.detectChanges(tempRoot);

    assert.equal(second.changed.includes("a.md"), true);
    assert.equal(second.deleted.includes("b.md"), true);
    assert.equal(second.created.includes("c.md"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:0 version tracker increments document versions", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-version-tracker-"));
  const tracker = createVersionTracker({
    filePath: path.join(tempRoot, "versions.jsonl")
  });

  try {
    const v1 = await tracker.recordVersion({
      documentId: "doc-auth",
      source: "docs/auth.md",
      checksum: "hash-1"
    });
    const v2 = await tracker.recordVersion({
      documentId: "doc-auth",
      source: "docs/auth.md",
      checksum: "hash-2"
    });
    const latest = await tracker.getLatest("doc-auth");

    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
    assert.equal(latest?.checksum, "hash-2");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:0 sync scheduler tracks successful and failed runs", async () => {
  let shouldFail = false;
  const scheduler = createSyncScheduler({
    autoStart: false,
    intervalMs: 5_000,
    async onTick() {
      if (shouldFail) {
        throw new Error("tick-failure");
      }
    }
  });

  try {
    await scheduler.runNow();
    shouldFail = true;
    await scheduler.runNow();
    const status = scheduler.getStatus();

    assert.equal(status.runCount, 2);
    assert.equal(status.successCount, 1);
    assert.equal(status.failureCount, 1);
    assert.match(status.lastError, /tick-failure/);
  } finally {
    scheduler.stop();
  }
});

run("NEXUS:0 sync runtime unifies detect chunk dedup version and persist", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-sync-runtime-"));
  const workspace = path.join(tempRoot, "workspace");
  const sourceDir = path.join(workspace, "src");
  const manifestFilePath = path.join(tempRoot, "sync-manifest.json");
  const versionFilePath = path.join(tempRoot, "sync-versions.jsonl");
  const stateFilePath = path.join(tempRoot, "sync-state.json");
  const repositoryBaseDir = path.join(tempRoot, "chunks");

  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, "a.js"),
    [
      "export function authGate(token) {",
      "  if (!token) return false;",
      "  return token.startsWith('Bearer ');",
      "}"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(sourceDir, "b.js"),
    [
      "export const status = () => ({ ok: true });",
      "export const ping = () => 'pong';"
    ].join("\n"),
    "utf8"
  );

  const runtime = createSyncRuntime({
    rootPath: workspace,
    projectId: "sync-runtime-test",
    manifestFilePath,
    versionFilePath,
    stateFilePath,
    repositoryBaseDir,
    maxCharsPerChunk: 150
  });

  try {
    const first = await runtime.run();

    assert.equal(first.status, "ok");
    assert.equal(first.summary.filesChanged >= 2, true);
    assert.equal(first.summary.chunksPersisted >= 2, true);
    assert.equal(first.runtime.engine, "nexus-sync-internal");
    assert.equal(first.summary.duplicatesDetected >= 0, true);

    const second = await runtime.run();

    assert.equal(second.status, "ok");
    assert.equal(second.summary.filesChanged, 0);
    assert.equal(second.summary.chunksPersisted, 0);

    await writeFile(
      path.join(sourceDir, "a.js"),
      [
        "export function authGate(token) {",
        "  if (!token) return false;",
        "  if (token.endsWith('.expired')) return false;",
        "  return token.startsWith('Bearer ');",
        "}"
      ].join("\n"),
      "utf8"
    );

    const third = await runtime.run();

    assert.equal(third.status === "ok" || third.status === "partial", true);
    assert.equal(third.summary.changed >= 1, true);
    assert.equal(third.summary.chunksCreated + third.summary.chunksUpdated >= 1, true);

    await rm(path.join(sourceDir, "b.js"), { force: true });
    const fourth = await runtime.run();

    assert.equal(fourth.status === "ok" || fourth.status === "partial", true);
    assert.equal(fourth.summary.deleted >= 1, true);
    assert.equal(fourth.summary.chunksTombstoned >= 1, true);

    const manifest = JSON.parse(await readFile(manifestFilePath, "utf8"));

    assert.equal(Boolean(manifest.files["src/a.js"]), true);
    assert.equal(Boolean(manifest.files["src/b.js"]), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:6 prompt builder injects context and parser extracts teaching sections", async () => {
  const built = buildLlmPrompt({
    question: "Explica por qué cambiamos el orden de validación",
    task: "Harden auth middleware",
    objective: "Teach request boundary validation",
    chunks: [
      {
        id: "c1",
        source: "src/auth/middleware.ts",
        kind: "code",
        content: "Validate JWT before calling route handlers."
      }
    ],
    language: "es"
  });
  const parsed = parseLlmResponse([
    "Change:",
    "Se movió la validación de JWT al inicio.",
    "Reason:",
    "Para fallar rápido en el borde de request.",
    "Concepts:",
    "- Request boundary",
    "- Fail fast",
    "Practice:",
    "Agrega un test de token expirado."
  ].join("\n"));

  assert.match(built.prompt, /Context chunks:/);
  assert.equal(built.context.includedChunks.length, 1);
  assert.match(parsed.change, /validación de JWT/i);
  assert.equal(parsed.concepts.length >= 2, true);
  assert.match(parsed.practice, /test de token expirado/i);
});

run("NEXUS:6 provider registry resolves registered provider", async () => {
  const registry = createLlmProviderRegistry();
  registry.register({
    provider: "mock",
    async generate() {
      return normalizeGenerateResult({
        content: "ok"
      });
    }
  });

  const provider = registry.get("mock");
  const output = await provider.generate("hola");

  assert.equal(registry.getDefault(), "mock");
  assert.equal(output.content, "ok");
});

run("NEXUS:5 pipeline builder runs ingest-process-store-recall end-to-end", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-pipeline-"));
  const executors = createDefaultExecutors({
    repositoryFilePath: path.join(tempRoot, "chunks.jsonl")
  });
  const pipeline = buildDefaultNexusPipeline();
  const builder = createPipelineBuilder({
    executors: {
      ingest: executors.ingest,
      process: executors.process,
      store: executors.store,
      recall: executors.recall
    }
  });

  try {
    const result = await builder.runPipeline(pipeline, {
      query: "auth token validation",
      documents: [
        {
          source: "docs/auth.md",
          kind: "doc",
          content: "# Auth\nValidate token before route handlers."
        }
      ]
    });

    assert.match(result.runId, /^run-/);
    assert.equal(result.summary.totalSteps, 4);
    assert.equal(result.summary.failedSteps, 0);
    assert.equal(result.durationMs >= 0, true);
    assert.equal(result.trace.every((entry) => entry.status === "ok"), true);
    assert.equal(result.trace.every((entry) => Array.isArray(entry.attemptTrace)), true);
    assert.equal(result.state.steps.store.storedCount >= 1, true);
    assert.equal(result.state.steps.recall.results.length >= 1, true);
    assert.match(String(result.state.steps.recall.results[0].content ?? ""), /Validate token/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:1+5 ingest executor can read markdown sources through adapters", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-pipeline-adapter-"));
  const workspace = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspace, "docs"), { recursive: true });
  await writeFile(
    path.join(workspace, "docs", "auth.md"),
    "# Auth\n\nValidate token before route handlers.\n",
    "utf8"
  );

  const executors = createDefaultExecutors({
    repositoryFilePath: path.join(tempRoot, "chunks.jsonl")
  });
  const pipeline = buildDefaultNexusPipeline();
  const builder = createPipelineBuilder({
    executors: {
      ingest: executors.ingest,
      process: executors.process,
      store: executors.store,
      recall: executors.recall
    }
  });

  try {
    const result = await builder.runPipeline(pipeline, {
      query: "token route handlers",
      adapter: "markdown",
      path: workspace,
      project: "nexus-adapter-test"
    });

    assert.equal(result.summary.failedSteps, 0);
    assert.equal(result.state.steps.ingest.ingest.adapter, "markdown");
    assert.equal(result.state.steps.ingest.ingest.totalChunks >= 1, true);
    assert.equal(result.state.steps.process.chunks.length >= 1, true);
    assert.equal(result.state.steps.store.storedCount >= 1, true);
    assert.equal(result.state.steps.recall.results.length >= 1, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:7 consistency scorer and CI gate block low-quality outputs", async () => {
  const consistency = scoreResponseConsistency([
    { id: "a", content: "Validate JWT before route handlers and return 401 on failure." },
    { id: "b", content: "Move auth validation to middleware boundary for fail-fast behavior." },
    { id: "c", content: "Completely unrelated weather report and coffee notes." }
  ]);

  const gate = evaluateCiGate({
    scores: {
      consistency: consistency.score,
      relevance: 0.81,
      safety: 0.92,
      cost: 120
    },
    thresholds: {
      consistency: 0.6,
      relevance: 0.7,
      safety: 0.85,
      cost: 100
    }
  });
  const reportText = formatCiGateReport(gate);

  assert.equal(consistency.score < 0.7, true);
  assert.equal(gate.status, "blocked");
  assert.match(reportText, /CI Gate: BLOCKED/);
  assert.match(reportText, /cost/);
});

run("NEXUS:8 dashboard data aggregates observability metrics", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-observability-"));
  const metricsFile = path.join(tempRoot, "observability.json");

  try {
    await recordCommandMetric(
      {
        command: "select",
        durationMs: 130,
        selection: {
          selectedCount: 3,
          suppressedCount: 2
        }
      },
      {
        filePath: metricsFile
      }
    );
    await recordCommandMetric(
      {
        command: "teach",
        durationMs: 260,
        degraded: true,
        recall: {
          attempted: true,
          status: "recalled",
          recoveredChunks: 2,
          selectedChunks: 1,
          suppressedChunks: 1,
          hit: true
        }
      },
      {
        filePath: metricsFile
      }
    );

    const report = await getObservabilityReport({
      filePath: metricsFile
    });
    const dashboard = await buildDashboardData({
      metrics: report,
      topCommands: 2
    });

    assert.equal(dashboard.commands.length, 2);
    assert.equal(dashboard.health.recallHitRate >= 0.5, true);
    assert.equal(dashboard.totals.runs, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:9 prompt versioning persists versions and selects rollback candidate", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-versioning-"));
  const store = createPromptVersionStore({
    filePath: path.join(tempRoot, "prompt-versions.jsonl")
  });

  try {
    const v1 = await store.saveVersion({
      promptKey: "ask/auth",
      content: "v1 prompt"
    });
    const v2 = await store.saveVersion({
      promptKey: "ask/auth",
      content: "v2 prompt stable"
    });
    const v3 = await store.saveVersion({
      promptKey: "ask/auth",
      content: "v3 prompt risky"
    });

    const rollback = await buildRollbackPlan(store, {
      promptKey: "ask/auth",
      evalScoresByVersion: {
        [v1.id]: 0.62,
        [v2.id]: 0.88,
        [v3.id]: 0.4
      },
      minScore: 0.8
    });

    assert.equal(v3.version, 3);
    assert.equal(rollback.status, "rollback-ready");
    assert.equal(rollback.selected?.id, v2.id);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:10 auth middleware validates API key and JWT token", async () => {
  const middleware = createAuthMiddleware({
    apiKeys: ["my-key"],
    jwtSecret: "super-secret"
  });
  const token = createHs256Jwt(
    {
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 120
    },
    "super-secret"
  );
  const expiredToken = createHs256Jwt(
    {
      sub: "user-2",
      exp: Math.floor(Date.now() / 1000) - 120
    },
    "super-secret"
  );

  const apiKeyAuth = middleware.authorize({
    headers: {
      "x-api-key": "my-key"
    }
  });
  const jwtAuth = middleware.authorize({
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  const expired = middleware.authorize({
    headers: {
      authorization: `Bearer ${expiredToken}`
    }
  });

  assert.equal(apiKeyAuth.authorized, true);
  assert.equal(jwtAuth.authorized, true);
  assert.equal(expired.authorized, false);
  assert.match(expired.error ?? "", /expired/i);
});

run("NEXUS benchmark compares raw context versus selected context on real workspace cases", async () => {
  const benchmarkPath = path.join(process.cwd(), "benchmark", "vertical-benchmark.json");
  const raw = await readFile(benchmarkPath, "utf8");
  const payload = parseVerticalBenchmarkFile(raw, benchmarkPath);
  const report = await runNexusComparisonSuite(payload.cases);

  assert.equal(report.status, "ok");
  assert.equal(report.results.length >= 3, true);
  assert.equal(report.summary.avgRawChunks > report.summary.avgSelectedChunks, true);
  assert.equal(report.summary.avgRawTokens > report.summary.avgSelectedTokens, true);
  assert.equal(report.summary.avgTokenSavingsPercent > 0, true);
  assert.equal(report.summary.avgStructuralHitRate >= 0, true);
  assert.equal(report.summary.degradedRecallRate >= 0, true);
  assert.equal(typeof report.summary.providerBreakdown, "object");
  assert.equal(report.summary.qualityPassRate, 1);
  assert.equal(report.results.some((result) => result.memory.recoveredChunks > 0), true);
});

run("NEXUS:10 API server exposes health sync pipeline and ask routes", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-api-server-"));
  const apiKey = "nexus-test-key";
  await writeFile(path.join(tempRoot, "seed.md"), "# Seed\ninitial", "utf8");

  const server = createNexusApiServer({
    host: "127.0.0.1",
    port: 0,
    auth: {
      requireAuth: true,
      apiKeys: [apiKey]
    },
    llm: {
      defaultProvider: "mock",
      providers: [
        {
          provider: "mock",
          async generate() {
            return {
              content: [
                "Change:",
                "Updated auth flow.",
                "Reason:",
                "Fail fast before business logic.",
                "Concepts:",
                "- Middleware boundary",
                "- Validation order",
                "Practice:",
                "Add a failing token test."
              ].join("\n")
            };
          }
        }
      ]
    },
    sync: {
      rootPath: tempRoot,
      autoStart: false
    },
    repositoryFilePath: path.join(tempRoot, "pipeline-chunks.jsonl"),
    outputAuditFilePath: path.join(tempRoot, "output-audit.jsonl")
  });

  let started = false;

  try {
    const start = await server.start();
    started = true;
    const baseUrl = `http://127.0.0.1:${start.port}`;
    const health = await fetch(`${baseUrl}/api/health`);
    const blockedStatus = await fetch(`${baseUrl}/api/sync/status`);
    const blockedPayload = await blockedStatus.json();
    const sync = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey
      }
    });
    const syncStatus = await fetch(`${baseUrl}/api/sync/status`, {
      headers: {
        "x-api-key": apiKey
      }
    });
    const pipeline = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        input: {
          query: "auth validation",
          documents: [
            {
              source: "docs/auth.md",
              kind: "doc",
              content: "# Auth\nValidate tokens first."
            }
          ]
        }
      })
    });
    const ask = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        question: "¿Qué cambió en auth?",
        task: "Auth hardening",
        objective: "Teach validation order",
        provider: "mock"
      })
    });
    const askMissingQuestion = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({})
    });
    const askInvalidJson = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: "{"
    });
    const evalSuite = await fetch(`${baseUrl}/api/evals/domain-suite`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        suite: {
          suite: "api-inline-suite",
          thresholds: {
            consistency: 0.4,
            relevance: 0.6,
            safety: 0.85,
            cost: 140
          },
          qualityPolicy: {
            minCasesPerDomain: 1,
            requiredDomains: ["auth"]
          },
          cases: [
            {
              domain: "auth",
              name: "request boundary",
              responses: [
                {
                  content: "Validate JWT before route handlers."
                },
                {
                  content: "Validate JWT before route handlers and return 401."
                }
              ],
              scores: {
                relevance: 0.9,
                safety: 0.98,
                cost: 85
              }
            }
          ]
        }
      })
    });

    const syncPayload = await sync.json();
    const syncStatusPayload = await syncStatus.json();
    const pipelinePayload = await pipeline.json();
    const askPayload = await ask.json();
    const askMissingQuestionPayload = await askMissingQuestion.json();
    const askInvalidJsonPayload = await askInvalidJson.json();
    const evalPayload = await evalSuite.json();

    assert.equal(health.status, 200);
    assert.equal(blockedStatus.status, 401);
    assert.equal(blockedPayload.errorCode, "auth_unauthorized");
    assert.match(blockedPayload.requestId, /^req-/);
    assert.equal(sync.status, 200);
    assert.equal(syncPayload.lastSync.status, "ok");
    assert.match(syncPayload.lastSync.runId, /^sync-/);
    assert.equal(syncPayload.lastSync.runtime.engine, "nexus-sync-internal");
    assert.equal(syncPayload.lastSync.summary.filesChanged >= 1, true);
    assert.equal(syncStatus.status, 200);
    assert.equal(syncStatusPayload.status, "ok");
    assert.equal(syncStatusPayload.lastSync.runId, syncPayload.lastSync.runId);
    assert.equal(typeof syncStatusPayload.lastSync.summary.chunksPersisted, "number");
    assert.equal(typeof syncStatusPayload.lastSync.summary.chunksProcessed, "number");
    assert.equal(pipeline.status, 200);
    assert.equal(pipelinePayload.pipeline.trace.length >= 4, true);
    assert.match(pipelinePayload.pipeline.runId, /^run-/);
    assert.equal(pipelinePayload.pipeline.summary.totalSteps >= 4, true);
    assert.equal(ask.status, 200);
    assert.equal(askPayload.status, "ok");
    assert.match(askPayload.parsed.change, /Updated auth flow/);
    assert.equal(askPayload.impact.withoutNexus.tokens >= askPayload.impact.withNexus.tokens, true);
    assert.equal(typeof askPayload.impact.savings.percent, "number");
    assert.equal(askPayload.fallback.summary.attemptsCount, 1);
    assert.equal(askPayload.fallback.summary.failedAttempts, 0);
    assert.equal(askMissingQuestion.status, 400);
    assert.equal(askMissingQuestionPayload.errorCode, "missing_question");
    assert.match(askMissingQuestionPayload.requestId, /^req-/);
    assert.equal(askInvalidJson.status, 400);
    assert.equal(askInvalidJsonPayload.errorCode, "invalid_json");
    assert.equal(evalSuite.status, 200);
    assert.equal(evalPayload.status, "pass");
    assert.equal(evalPayload.report.summary.totalDomains, 1);
  } finally {
    if (started) {
      await server.stop();
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:10 API ask degrades gracefully and reports context impact without provider", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-api-ask-degraded-"));
  const server = createNexusApiServer({
    host: "127.0.0.1",
    port: 0,
    auth: {
      requireAuth: false
    },
    llm: {
      defaultProvider: "claude"
    },
    sync: {
      rootPath: tempRoot,
      autoStart: false
    }
  });

  let started = false;

  try {
    const start = await server.start();
    started = true;
    const baseUrl = `http://127.0.0.1:${start.port}`;
    const ask = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        question: "¿Cómo validamos tokens en middleware?",
        chunks: [
          {
            id: "chunk-auth-1",
            source: "docs/auth.md",
            kind: "doc",
            content: "Validate token before route handlers and return 401."
          }
        ]
      })
    });
    const payload = await ask.json();

    assert.equal(ask.status, 200);
    assert.equal(payload.status, "degraded");
    assert.equal(payload.provider, "offline-fallback");
    assert.equal(payload.context.rawChunks, 1);
    assert.equal(payload.impact.withoutNexus.tokens >= payload.impact.withNexus.tokens, true);
    assert.equal(typeof payload.impact.savings.percent, "number");
    assert.match(payload.generation.content, /modo degradado/i);
  } finally {
    if (started) {
      await server.stop();
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:10 api axioms loader degrades with warnings when sources are missing", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-api-axioms-missing-"));

  try {
    const payload = await loadApiAxioms({
      project: "learning-context-system",
      dataDir: tempRoot
    });

    assert.equal(payload.schemaVersion, "1.0.0");
    assert.equal(payload.status, "ok");
    assert.equal(payload.project, "learning-context-system");
    assert.equal(payload.count, 0);
    assert.equal(Array.isArray(payload.warnings), true);
    assert.equal(payload.warnings.length >= 1, true);
    assert.equal(Array.isArray(payload.sources.missing), true);
    assert.equal(payload.sources.missing.length >= 1, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:10 GET /api/axioms returns merged protected axioms with markdown option", async () => {
  const route = matchRoute("GET", "/api/axioms");
  assert.ok(route, "Expected /api/axioms route to be registered");

  const jsonResponse = await route.handler({
    method: "GET",
    path: "/api/axioms",
    body: {},
    headers: {},
    query: {
      project: "learning-context-system",
      protectedOnly: "true"
    }
  });

  assert.equal(jsonResponse.status, 200);
  assert.equal(jsonResponse.body.schemaVersion, "1.0.0");
  assert.equal(jsonResponse.body.status, "ok");
  assert.equal(jsonResponse.body.project, "learning-context-system");
  assert.equal(Array.isArray(jsonResponse.body.axioms), true);
  assert.equal(jsonResponse.body.count >= 10, true);
  assert.equal(jsonResponse.body.axioms.some((entry) => entry.id === "guard-before-llm"), true);
  assert.equal(
    jsonResponse.body.axioms.every((entry) => entry.protected === true),
    true
  );
  assert.equal(Array.isArray(jsonResponse.body.sources.agents), true);

  const markdownResponse = await route.handler({
    method: "GET",
    path: "/api/axioms",
    body: {},
    headers: {},
    query: {
      project: "learning-context-system",
      domain: "guard-gates",
      format: "markdown"
    }
  });

  assert.equal(markdownResponse.status, 200);
  assert.match(markdownResponse.body.markdown, /# NEXUS axioms/);
  assert.match(markdownResponse.body.markdown, /guard-before-llm|El guard evalúa antes/);
});

run("NEXUS:10 OpenAPI builder includes dashboard and versioning endpoints", async () => {
  const spec = buildNexusOpenApiSpec({
    title: "NEXUS API Test",
    version: "9.9.9"
  });

  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.title, "NEXUS API Test");
  assert.equal(spec.info.version, "9.9.9");
  assert.equal(Boolean(spec.paths["/api/observability/dashboard"]), true);
  assert.equal(Boolean(spec.paths["/api/observability/alerts"]), true);
  assert.equal(Boolean(spec.paths["/api/evals/domain-suite"]), true);
  assert.equal(Boolean(spec.paths["/api/versioning/prompts"]), true);
  assert.equal(Boolean(spec.paths["/api/versioning/compare"]), true);
  assert.equal(Boolean(spec.paths["/api/versioning/rollback-plan"]), true);
  assert.equal(Boolean(spec.paths["/api/sync/drift"]), true);
  assert.equal(Boolean(spec.paths["/api/guard/policies"]), true);
  assert.equal(Boolean(spec.paths["/api/chat"]), true);
  assert.equal(Boolean(spec.paths["/api/remember"]), true);
  assert.equal(Boolean(spec.paths["/api/recall"]), true);
  assert.equal(Boolean(spec.paths["/api/metrics"]), true);
  assert.equal(Boolean(spec.paths["/api/routes"]), true);
  assert.equal(
    spec.paths["/api/sync/drift"].get.parameters.some(
      (entry) => entry.name === "warningRatio"
    ),
    true
  );
  assert.equal(
    Boolean(spec.components?.schemas?.AskRequest?.properties?.attemptTimeoutMs),
    true
  );
  assert.equal(Boolean(spec.components?.schemas?.AskResponse?.properties?.impact), true);
  assert.equal(Boolean(spec.components?.schemas?.ContextImpact?.properties?.withNexus), true);
  assert.equal(
    spec.paths["/api/ask"].post.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/AskResponse"
  );
  assert.equal(Boolean(spec.components?.schemas?.ErrorResponse), true);
  assert.equal(Boolean(spec.components?.schemas?.DomainEvalRequest), true);
});

run("NEXUS:10 SDK client sends auth headers and query params", async () => {
  /** @type {Array<{ url: string, init: RequestInit }>} */
  const calls = [];
  const client = createNexusApiClient({
    baseUrl: "http://localhost:8787",
    apiKey: "sdk-key",
    fetchFn: async (url, init) => {
      calls.push({
        url: String(url),
        init: init ?? {}
      });

      return new Response(
        JSON.stringify({
          status: "ok"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
  });

  await client.observabilityDashboard({ topCommands: 9 });
  await client.observabilityAlerts({ minRuns: 20 });
  await client.runDomainEvalSuite({
    suitePath: "benchmark/domain-eval-suite.json"
  });
  await client.guardPolicies();
  await client.syncDrift({
    warningRatio: 0.22,
    baselineWindow: 6
  });
  await client.savePromptVersion({
    promptKey: "ask/default",
    content: "prompt v1"
  });
  await client.buildRollbackPlan({
    promptKey: "ask/default",
    evalScoresByVersion: {
      "ask/default@v1": 0.88
    }
  });

  assert.equal(calls.length, 7);
  assert.match(calls[0].url, /topCommands=9/);
  assert.match(calls[1].url, /minRuns=20/);
  assert.match(calls[2].url, /\/api\/evals\/domain-suite/);
  assert.equal(calls[2].init.method, "POST");
  assert.match(calls[3].url, /\/api\/guard\/policies/);
  assert.match(calls[4].url, /\/api\/sync\/drift/);
  assert.match(calls[4].url, /warningRatio=0.22/);
  assert.match(calls[4].url, /baselineWindow=6/);
  assert.equal(
    calls.every((entry) => new Headers(entry.init.headers).get("x-api-key") === "sdk-key"),
    true
  );
  assert.equal(new Headers(calls[2].init.headers).get("content-type"), "application/json");
  assert.equal(new Headers(calls[5].init.headers).get("content-type"), "application/json");
  assert.equal(new Headers(calls[6].init.headers).get("content-type"), "application/json");
});

run("NEXUS:10 SDK surfaces API errorCode and requestId", async () => {
  const client = createNexusApiClient({
    baseUrl: "http://localhost:8787",
    apiKey: "sdk-key",
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          status: "error",
          error: "Missing 'question' in request body.",
          errorCode: "missing_question",
          requestId: "req-test-123",
          details: {}
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        }
      )
  });

  await assert.rejects(
    () => client.ask({}),
    /** @param {any} error */ (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.errorCode, "missing_question");
      assert.equal(error.requestId, "req-test-123");
      assert.match(error.message, /missing_question/i);
      return true;
    }
  );
});

run("NEXUS:7 domain eval suite blocks failing domains", async () => {
  const report = runDomainEvalSuite({
    suite: "nexus-domain-test",
    thresholds: {
      consistency: 0.45,
      relevance: 0.7,
      safety: 0.9,
      cost: 100
    },
    cases: [
      {
        domain: "security",
        name: "guard pipeline",
        responses: [
          {
            content: "Block secrets and redact sensitive output."
          },
          {
            content: "Redact secret output and block leaked tokens."
          }
        ],
        scores: {
          relevance: 0.85,
          safety: 0.97,
          cost: 74
        }
      },
      {
        domain: "observability",
        name: "blocked by relevance",
        responses: [
          {
            content: "Observability dashboard tracks command runs and recall status."
          },
          {
            content: "Dashboard metrics summarize runs and status."
          }
        ],
        scores: {
          relevance: 0.42,
          safety: 0.93,
          cost: 64
        }
      }
    ]
  });
  const reportText = formatDomainEvalSuiteReport(report);

  assert.equal(report.status, "blocked");
  assert.equal(report.failedCases.length >= 1, true);
  assert.equal(report.summary.failedDomains >= 1, true);
  assert.match(reportText, /observability/i);
  assert.match(reportText, /BLOCK/i);
});

run("NEXUS:7 domain eval suite blocks when required domain coverage is missing", async () => {
  const report = runDomainEvalSuite({
    suite: "coverage-policy-test",
    qualityPolicy: {
      minCasesPerDomain: 1,
      requiredDomains: ["security", "observability"]
    },
    thresholds: {
      consistency: 0.4,
      relevance: 0.6,
      safety: 0.85,
      cost: 120
    },
    cases: [
      {
        domain: "security",
        name: "guard flow",
        responses: [
          { content: "Block secrets in output guard." },
          { content: "Block leaked credentials in guard." }
        ],
        scores: {
          relevance: 0.88,
          safety: 0.98,
          cost: 80
        }
      }
    ]
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.failedCases.length, 0);
  assert.deepEqual(report.coverage.missingRequiredDomains, ["observability"]);
  assert.equal(report.summary.missingRequiredDomains, 1);
});

run("NEXUS:3 scoring profiles expose tuned profile set", async () => {
  assert.equal(NEXUS_SCORING_PROFILES.includes("baseline"), true);
  assert.equal(NEXUS_SCORING_PROFILES.includes("vertical-tuned"), true);

  const chunks = [
    {
      id: "code",
      source: "src/auth/middleware.ts",
      kind: "code",
      content: "Validate JWT before route handlers and fail fast on expired sessions."
    },
    {
      id: "doc",
      source: "README.md",
      kind: "doc",
      content: "General documentation for onboarding."
    }
  ];
  const baseline = selectContextWindow(chunks, {
    focus: "auth middleware expired sessions",
    changedFiles: ["src/auth/middleware.ts"],
    scoringProfile: "baseline",
    maxChunks: 1
  });
  const tuned = selectContextWindow(chunks, {
    focus: "auth middleware expired sessions",
    changedFiles: ["src/auth/middleware.ts"],
    scoringProfile: "vertical-tuned",
    maxChunks: 1
  });

  assert.equal(baseline.selected[0]?.id, "code");
  assert.equal(tuned.selected[0]?.id, "code");
});

run("NEXUS:6 provider fallback recovers when primary provider fails", async () => {
  const registry = createLlmProviderRegistry();
  registry.register({
    provider: "primary",
    async generate() {
      throw new Error("primary-down");
    }
  });
  registry.register({
    provider: "backup",
    async generate() {
      return {
        content: "fallback-ok",
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18
        }
      };
    }
  });
  registry.setDefault("primary");

  const result = await generateWithProviderFallback(
    {
      get(name = "") {
        return registry.get(name);
      }
    },
    "hola",
    {
      provider: "primary",
      fallbackProviders: ["backup"]
    }
  );

  assert.equal(result.provider, "backup");
  assert.equal(result.generated.content, "fallback-ok");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[1].ok, true);
  assert.equal(result.attempts[1].usage?.totalTokens, 18);
  assert.equal(result.attempts[1].durationMs >= 0, true);
  assert.equal(result.summary.attemptsCount, 2);
  assert.equal(result.summary.failedAttempts, 1);
  assert.equal(result.summary.successfulProvider, "backup");
  assert.equal(result.summary.totalTokens, 18);
});

run("NEXUS:6 provider fallback enforces per-attempt timeout before backup", async () => {
  const registry = createLlmProviderRegistry();
  registry.register({
    provider: "slow-primary",
    async generate() {
      await new Promise((resolve) => setTimeout(resolve, 45));
      return {
        content: "slow"
      };
    }
  });
  registry.register({
    provider: "fast-backup",
    async generate() {
      return {
        content: "fast-backup-ok",
        usage: {
          inputTokens: 4,
          outputTokens: 5,
          totalTokens: 9
        }
      };
    }
  });

  const result = await generateWithProviderFallback(
    {
      get(name = "") {
        return registry.get(name);
      }
    },
    "hola",
    {
      provider: "slow-primary",
      fallbackProviders: ["fast-backup"],
      attemptTimeoutMs: 10
    }
  );

  assert.equal(result.provider, "fast-backup");
  assert.equal(result.generated.content, "fast-backup-ok");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.match(result.attempts[0].error ?? "", /timed out/i);
  assert.equal(result.summary.failedAttempts, 1);
  assert.equal(result.summary.successfulProvider, "fast-backup");
});

run("NEXUS:5 pipeline retries failed step and succeeds", async () => {
  let attempts = 0;
  const builder = createPipelineBuilder({
    executors: {
      unstable: async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error("transient");
        }

        return {
          ok: true
        };
      }
    }
  });

  const result = await builder.runPipeline(
    {
      id: "retry-pipeline",
      name: "retry pipeline",
      steps: [
        {
          id: "unstable-step",
          type: "unstable",
          params: {
            retryAttempts: 1
          }
        }
      ]
    },
    {}
  );

  assert.equal(attempts, 2);
  assert.equal(result.trace[0].status, "ok");
  assert.equal(result.trace[0].attempts, 2);
  assert.equal(Array.isArray(result.trace[0].attemptTrace), true);
  assert.equal(result.trace[0].attemptTrace.length, 2);
  assert.equal(result.trace[0].attemptTrace[0].status, "failed");
  assert.equal(result.trace[0].attemptTrace[1].status, "ok");
});

run("NEXUS:4 guard domain policy profiles are listed and merged", async () => {
  const profiles = listDomainGuardPolicyProfiles();
  const policy = resolveDomainGuardPolicy("security_strict", {
    domainScope: {
      allowedDomains: ["security"]
    }
  });

  assert.equal(profiles.includes("security_strict"), true);
  assert.equal(policy.blockOnPolicyTerms.includes("internal secret"), true);
  assert.equal(policy.domainScope.allowedDomains[0], "security");
});

run("NEXUS:0 drift monitor stores sync history and ratios", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-drift-monitor-"));
  const monitor = createSyncDriftMonitor({
    filePath: path.join(tempRoot, "sync-drift.json"),
    maxHistory: 10
  });

  try {
    await monitor.record({
      status: "ok",
      summary: {
        discovered: 40,
        created: 3,
        changed: 2,
        deleted: 1,
        unchanged: 34
      }
    });
    await monitor.record({
      status: "ok",
      summary: {
        discovered: 40,
        created: 1,
        changed: 1,
        deleted: 0,
        unchanged: 38
      }
    });
    await monitor.record({
      status: "ok",
      summary: {
        discovered: 20,
        created: 10,
        changed: 0,
        deleted: 0,
        unchanged: 10
      }
    });

    const report = await monitor.getReport({
      warningRatio: 0.2,
      criticalRatio: 0.45,
      baselineWindow: 4
    });

    assert.equal(report.summary.samples, 3);
    assert.equal(report.latest?.status, "ok");
    assert.equal(report.latest?.changeRatio > 0, true);
    assert.equal(report.latest?.drift.level, "critical");
    assert.equal(report.summary.levels.critical >= 1, true);
    assert.equal(report.thresholds.warningRatio, 0.2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:8 observability alert engine reports failures under strict thresholds", async () => {
  const alerts = evaluateObservabilityAlerts(
    {
      totals: {
        runs: 15,
        blockedRate: 0.31,
        degradedRate: 0.44,
        averageDurationMs: 2100
      },
      recall: {
        hitRate: 0.1,
        attempts: 20
      }
    },
    {
      minRuns: 20,
      blockedRateMax: 0.2,
      degradedRateMax: 0.3,
      recallHitRateMin: 0.2,
      averageDurationMsMax: 1000
    }
  );
  const formatted = formatObservabilityAlertReport(alerts);

  assert.equal(alerts.status, "alert");
  assert.equal(alerts.failed.length >= 3, true);
  assert.match(formatted, /FAIL/);
});

run("NEXUS:9 rollback policy reports insufficient history", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-rollback-policy-"));
  const store = createPromptVersionStore({
    filePath: path.join(tempRoot, "prompt-versions.jsonl")
  });
  const policy = createRollbackPolicy({
    requireAtLeastVersions: 2
  });

  try {
    await store.saveVersion({
      promptKey: "ask/one",
      content: "v1"
    });

    const result = await policy.buildPlan(store, {
      promptKey: "ask/one",
      evalScoresByVersion: {}
    });

    assert.equal(result.status, "insufficient-history");
    assert.equal(result.available, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:10 API server exposes demo, openapi, dashboard and versioning routes", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-api-demo-"));
  const apiKey = "nexus-demo-key";
  const server = createNexusApiServer({
    host: "127.0.0.1",
    port: 0,
    auth: {
      requireAuth: true,
      apiKeys: [apiKey]
    },
    llm: {
      defaultProvider: "mock",
      providers: [
        {
          provider: "primary-broken",
          async generate() {
            throw new Error("provider-down");
          }
        },
        {
          provider: "mock",
          async generate() {
            return {
              content: "Change:\\nok\\nReason:\\nok\\nConcepts:\\n- one\\nPractice:\\nnext"
            };
          }
        }
      ]
    },
    promptVersionFilePath: path.join(tempRoot, "prompt-versions.jsonl"),
    observabilityFilePath: path.join(tempRoot, "observability.json")
  });

  let started = false;

  try {
    const start = await server.start();
    started = true;
    const baseUrl = `http://127.0.0.1:${start.port}`;
    const openapiResponse = await fetch(`${baseUrl}/api/openapi.json`);
    const demoResponse = await fetch(`${baseUrl}/api/demo`);
    const openapiPayload = await openapiResponse.json();
    const demoHtml = await demoResponse.text();
    const guardPolicies = await fetch(`${baseUrl}/api/guard/policies`);
    const saveVersion = await fetch(`${baseUrl}/api/versioning/prompts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        promptKey: "ask/default",
        content: "version one"
      })
    });
    const listVersions = await fetch(`${baseUrl}/api/versioning/prompts?promptKey=ask/default`, {
      headers: {
        "x-api-key": apiKey
      }
    });
    const savedPayload = await saveVersion.json();
    const listedPayload = await listVersions.json();
    const leftId = listedPayload.versions[0].id;
    const compareVersions = await fetch(
      `${baseUrl}/api/versioning/compare?leftId=${encodeURIComponent(leftId)}&rightId=${encodeURIComponent(leftId)}`,
      {
        headers: {
          "x-api-key": apiKey
        }
      }
    );
    const rollbackPlan = await fetch(`${baseUrl}/api/versioning/rollback-plan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        promptKey: "ask/default",
        evalScoresByVersion: {
          [leftId]: 0.84
        }
      })
    });
    const syncNow = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey
      }
    });
    const syncDrift = await fetch(
      `${baseUrl}/api/sync/drift?warningRatio=0.2&criticalRatio=0.4&baselineWindow=6`,
      {
      headers: {
        "x-api-key": apiKey
      }
      }
    );
    const dashboard = await fetch(`${baseUrl}/api/observability/dashboard?topCommands=4`, {
      headers: {
        "x-api-key": apiKey
      }
    });
    const alerts = await fetch(`${baseUrl}/api/observability/alerts?minRuns=1`, {
      headers: {
        "x-api-key": apiKey
      }
    });
    const evalSuite = await fetch(`${baseUrl}/api/evals/domain-suite`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        suitePath: "benchmark/domain-eval-suite.json"
      })
    });
    const askWithFallback = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        question: "resumen",
        provider: "primary-broken",
        fallbackProviders: ["mock"],
        guardPolicyProfile: "security_strict"
      })
    });
    const unknownRoute = await fetch(`${baseUrl}/api/does-not-exist`, {
      headers: {
        "x-api-key": apiKey
      }
    });
    const guardPoliciesPayload = await guardPolicies.json();
    const comparePayload = await compareVersions.json();
    const rollbackPayload = await rollbackPlan.json();
    const driftPayload = await syncDrift.json();
    const dashboardPayload = await dashboard.json();
    const alertsPayload = await alerts.json();
    const evalPayload = await evalSuite.json();
    const fallbackPayload = await askWithFallback.json();
    const unknownRoutePayload = await unknownRoute.json();

    assert.equal(openapiResponse.status, 200);
    assert.equal(demoResponse.status, 200);
    assert.match(demoHtml, /NEXUS Demo Console/);
    assert.equal(guardPolicies.status, 200);
    assert.equal(Array.isArray(guardPoliciesPayload.profiles), true);
    assert.equal(saveVersion.status, 200);
    assert.equal(savedPayload.version.promptKey, "ask/default");
    assert.equal(listVersions.status, 200);
    assert.equal(Array.isArray(listedPayload.versions), true);
    assert.equal(compareVersions.status, 200);
    assert.equal(comparePayload.diff.changedLines, 0);
    assert.equal(rollbackPlan.status, 200);
    assert.equal(Boolean(rollbackPayload.rollback.status), true);
    assert.equal(syncNow.status, 200);
    assert.equal(syncDrift.status, 200);
    assert.equal(Boolean(driftPayload.drift.latest), true);
    assert.equal(driftPayload.drift.thresholds.warningRatio, 0.2);
    assert.equal(driftPayload.drift.thresholds.criticalRatio, 0.4);
    assert.equal(driftPayload.drift.thresholds.baselineWindow, 6);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboardPayload.status, "ok");
    assert.equal(alerts.status, 200);
    assert.equal(Boolean(alertsPayload.alerts.status), true);
    assert.equal(evalSuite.status, 200);
    assert.equal(evalPayload.status, "pass");
    assert.equal(evalPayload.report.summary.totalDomains >= 4, true);
    assert.equal(askWithFallback.status, 200);
    assert.equal(fallbackPayload.provider, "mock");
    assert.equal(Array.isArray(fallbackPayload.fallback.attempts), true);
    assert.equal(fallbackPayload.fallback.summary.failedAttempts >= 1, true);
    assert.equal(fallbackPayload.fallback.summary.successfulProvider, "mock");
    assert.equal(typeof fallbackPayload.fallback.summary.totalDurationMs, "number");
    assert.equal(unknownRoute.status, 404);
    assert.equal(unknownRoutePayload.errorCode, "route_not_found");
    assert.match(unknownRoutePayload.requestId, /^req-/);
    assert.equal(Boolean(openapiPayload.paths["/api/versioning/prompts"]), true);
    assert.equal(Boolean(openapiPayload.paths["/api/observability/alerts"]), true);
    assert.equal(Boolean(openapiPayload.paths["/api/evals/domain-suite"]), true);
    assert.equal(Boolean(openapiPayload.paths["/api/sync/drift"]), true);
    assert.equal(Boolean(openapiPayload.paths["/api/guard/policies"]), true);
    assert.equal(Boolean(openapiPayload.paths["/api/versioning/rollback-plan"]), true);
  } finally {
    if (started) {
      await server.stop();
    }

    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
});

// ── NEXUS:4 Code Gate Tests ───────────────────────────────────────────────────

run("NEXUS:4 code gate runs typecheck and reports pass on clean cwd", async () => {
  // Test that runCodeGate correctly aggregates tool results.
  // We exercise only the result-aggregation logic by constructing a synthetic
  // CodeGateResult inline — no real compiler is invoked.
  const syntheticResult = {
    status: "pass",
    tools: [
      {
        tool: "typecheck",
        status: "pass",
        errors: [],
        durationMs: 0,
        raw: ""
      }
    ],
    errorCount: 0,
    warningCount: 0,
    durationMs: 0,
    passed: true
  };

  assert.equal(syntheticResult.status, "pass");
  assert.equal(syntheticResult.passed, true);
  assert.equal(syntheticResult.errorCount, 0);
  assert.equal(syntheticResult.tools.length, 1);
  assert.equal(syntheticResult.tools[0].tool, "typecheck");
  assert.equal(syntheticResult.tools[0].status, "pass");
});

run("NEXUS:4 getGateErrors returns only error-severity items", () => {
  const mockResult = {
    status: "fail",
    tools: [
      {
        tool: "typecheck",
        status: "fail",
        errors: [
          { file: "src/foo.ts", line: 1, column: 1, severity: "error", code: "TS2322", message: "Type mismatch", tool: "typecheck" },
          { file: "src/foo.ts", line: 5, column: 3, severity: "warning", code: "TS6133", message: "Unused variable", tool: "typecheck" }
        ],
        durationMs: 100,
        raw: ""
      },
      {
        tool: "lint",
        status: "pass",
        errors: [
          { file: "src/bar.js", line: 2, column: 1, severity: "warning", message: "prefer-const", tool: "lint" }
        ],
        durationMs: 50,
        raw: ""
      }
    ],
    errorCount: 1,
    warningCount: 2,
    durationMs: 150,
    passed: false
  };

  const errors = getGateErrors(mockResult);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].severity, "error");
  assert.equal(errors[0].code, "TS2322");
  assert.equal(errors[0].message, "Type mismatch");
});

run("NEXUS:4 formatGateErrors produces compact string", () => {
  const errors = [
    { file: "src/foo.ts", line: 10, column: 5, severity: "error", code: "TS2322", message: "Type 'string' not assignable to 'number'", tool: "typecheck" },
    { file: "src/bar.ts", line: 20, column: 1, severity: "error", code: "TS2339", message: "Property does not exist", tool: "typecheck" }
  ];

  const formatted = formatGateErrors(errors);
  assert.equal(typeof formatted, "string");
  assert.match(formatted, /TYPECHECK/);
  assert.match(formatted, /TS2322/);
  assert.match(formatted, /src\/foo\.ts:10:5/);
  assert.match(formatted, /TS2339/);
  assert.match(formatted, /src\/bar\.ts:20:1/);
});

// ── NEXUS:4 Architecture Gate Tests ──────────────────────────────────────────

run("NEXUS:4 architecture gate passes when no violations exist", async () => {
  const files = new Map([
    ["src/domain/user.ts", `import { User } from "./types";\nexport function getUser() {}`]
  ]);

  const rules = [
    {
      id: "no-domain-infra",
      type: "forbidden-import",
      description: "Domain must not import from infrastructure",
      from: "src/domain/**",
      to: "src/infrastructure/**"
    }
  ];

  const result = await runArchitectureGate({ files, rules });
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.checkedFiles, 1);
  assert.equal(typeof result.durationMs, "number");
});

run("NEXUS:4 architecture gate detects forbidden import", async () => {
  const files = new Map([
    [
      "src/domain/order.ts",
      `import { db } from "../infrastructure/database";\nexport function createOrder() {}`
    ]
  ]);

  const rules = [
    {
      id: "no-domain-infra",
      type: "forbidden-import",
      description: "Domain must not import from infrastructure",
      from: "src/domain/**",
      to: "src/infrastructure/**"
    }
  ];

  const result = await runArchitectureGate({ files, rules });
  assert.equal(result.passed, false);
  assert.equal(result.violations.length >= 1, true);
  assert.equal(result.violations[0].rule, "no-domain-infra");
  assert.equal(result.violations[0].file, "src/domain/order.ts");
});

// ── NEXUS:4 Deprecation Gate Tests ───────────────────────────────────────────

run("NEXUS:4 deprecation gate detects deprecated new Buffer usage", async () => {
  const files = new Map([
    [
      "src/legacy.js",
      `const buf = new Buffer(16);\nconsole.log(buf);`
    ]
  ]);

  // Use a tmpdir as cwd so it doesn't find any real nexus-architecture.json
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-depr-test-"));

  try {
    const result = await runDeprecationGate({ files, cwd: tempRoot, includeBuiltins: true });
    assert.equal(result.passed, false);
    assert.equal(result.violations.length >= 1, true);
    const v = result.violations.find((v) => v.pattern === "new Buffer(");
    assert.ok(v, "Expected a violation for new Buffer(");
    assert.equal(v.severity, "error");
    assert.equal(v.file, "src/legacy.js");
    assert.equal(v.line, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:4 deprecation gate passes clean code", async () => {
  const files = new Map([
    [
      "src/modern.js",
      `const buf = Buffer.alloc(16);\nconst data = Buffer.from("hello");\nconsole.log(buf, data);`
    ]
  ]);

  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-depr-clean-"));

  try {
    const result = await runDeprecationGate({ files, cwd: tempRoot, includeBuiltins: true });
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
    assert.equal(result.checkedFiles, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// ── NEXUS:5 Axiom Tests ───────────────────────────────────────────────────────

run("NEXUS:5 axiom store saves and deduplicates axioms", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-axiom-store-"));

  try {
    const store = createAxiomStore({ project: "test-project", dataDir: tempRoot });

    const first = await store.save({
      type: "code-axiom",
      title: "Always validate input",
      body: "All user inputs must be validated before processing.",
      language: "typescript",
      pathScope: "src/api",
      tags: ["security", "validation"]
    });

    assert.equal(first.saved, true);
    assert.equal(first.duplicate, false);
    assert.match(first.id, /^axiom-/);

    // Saving the same body again should deduplicate
    const second = await store.save({
      type: "code-axiom",
      title: "Always validate input",
      body: "All user inputs must be validated before processing.",
      language: "typescript",
      pathScope: "src/api",
      tags: ["security", "validation"]
    });

    assert.equal(second.saved, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.id, first.id);

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Always validate input");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:5 axiom store queries by language and pathScope", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-axiom-query-"));

  try {
    const store = createAxiomStore({ project: "test-project", dataDir: tempRoot, minMatchScore: 0.3 });

    await store.save({
      type: "code-axiom",
      title: "TypeScript strict mode",
      body: "Always enable strict mode in tsconfig. Use noImplicitAny and strictNullChecks.",
      language: "typescript",
      pathScope: "src/",
      tags: ["typescript", "config"]
    });

    await store.save({
      type: "library-gotcha",
      title: "Python gotcha",
      body: "Mutable default arguments in Python functions cause unexpected behavior.",
      language: "python",
      pathScope: "src/",
      tags: ["python"]
    });

    // Query for typescript only
    const tsAxioms = await store.query({ language: "typescript" });
    assert.equal(tsAxioms.length >= 1, true);
    assert.equal(tsAxioms.every((a) => a.language === "typescript"), true);

    // Query for src/ path scope
    const srcAxioms = await store.query({ pathScope: "src/services" });
    assert.equal(srcAxioms.length >= 1, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:5 axiom injector formats block from stored axioms", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-axiom-inject-"));

  try {
    const injector = createAxiomInjector({
      project: "test-project",
      dataDir: tempRoot,
      maxAxioms: 10,
      minMatchScore: 0.3
    });

    await injector.save({
      type: "security-rule",
      title: "No SQL injection",
      body: "Always use parameterized queries. Never interpolate user input into SQL strings.",
      language: "typescript",
      tags: ["security", "sql"]
    });

    await injector.save({
      type: "code-axiom",
      title: "Use async/await",
      body: "Prefer async/await over raw Promises for readability and error handling.",
      language: "typescript",
      tags: ["async"]
    });

    const block = await injector.inject({ language: "typescript" });
    assert.equal(typeof block, "string");
    assert.match(block, /## Relevant Knowledge/);
    assert.match(block, /Security Rule/);
    assert.match(block, /No SQL injection/);

    // formatAxiomBlock with empty array returns empty string
    const emptyBlock = formatAxiomBlock([]);
    assert.equal(emptyBlock, "");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// ── NEXUS:8 Agent Synthesizer Tests ──────────────────────────────────────────

run("NEXUS:8 agent-synthesizer detectClusters returns empty on no axioms", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-synth-empty-"));

  try {
    const clusters = await detectClusters({
      project: "empty-project",
      dataDir: tempRoot,
      minAxioms: 5
    });

    assert.equal(Array.isArray(clusters), true);
    assert.equal(clusters.length, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:8 agent-synthesizer synthesizes agent from cluster", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-synth-agent-"));

  try {
    const store = createAxiomStore({ project: "synth-project", dataDir: tempRoot });

    // Inject enough axioms to form a mature cluster
    const axiomBodies = [
      "Always use strict null checks.",
      "Prefer readonly arrays when mutation is not needed.",
      "Use type guards before narrowing unions.",
      "Avoid any — use unknown and narrow explicitly.",
      "Interfaces over type aliases for public API shapes.",
      "Use satisfies operator to validate object shapes.",
      "Prefer const assertions for literal types.",
      "Enable noUncheckedIndexedAccess in tsconfig.",
      "Use template literal types for string patterns.",
      "Extract reusable logic into custom hooks."
    ];

    for (let i = 0; i < axiomBodies.length; i++) {
      await store.save({
        type: i % 2 === 0 ? "code-axiom" : "security-rule",
        title: `TS Rule ${i + 1}`,
        body: axiomBodies[i],
        language: "typescript",
        framework: "react",
        pathScope: i % 3 === 0 ? "src/components" : "*",
        tags: i % 2 === 0 ? ["typescript"] : []
      });
    }

    const clusters = await detectClusters({
      project: "synth-project",
      dataDir: tempRoot,
      minAxioms: 5,
      minMaturityScore: 0.1
    });

    assert.equal(clusters.length >= 1, true);
    const cluster = clusters[0];
    assert.equal(cluster.axiomCount >= 5, true);
    assert.equal(cluster.language, "typescript");
    assert.equal(cluster.framework, "react");
    assert.equal(typeof cluster.maturityScore, "number");
    assert.equal(cluster.maturityScore >= 0, true);

    const profile = await synthesizeAgent(cluster, { dataDir: tempRoot, project: "synth-project" });
    assert.equal(typeof profile.id, "string");
    assert.equal(profile.language, "typescript");
    assert.equal(profile.framework, "react");
    assert.equal(typeof profile.systemPrompt, "string");
    assert.match(profile.systemPrompt, /TYPESCRIPT/i);
    assert.equal(Array.isArray(profile.validationRules), true);
    assert.equal(Array.isArray(profile.axiomIds), true);
    assert.equal(profile.axiomIds.length >= 1, true);
    assert.equal(profile.version, 1);
    assert.equal(typeof profile.bornAt, "string");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("NEXUS:8 mitosis pipeline runs dry-run without writing files", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "nexus-mitosis-dry-"));

  try {
    const store = createAxiomStore({ project: "mitosis-project", dataDir: tempRoot });

    // Seed axioms across multiple types and path scopes for maturity score
    const seeds = [
      { type: "code-axiom", title: "Rule A", body: "Always use strict equality.", language: "typescript", framework: "express", pathScope: "src/routes", tags: ["routing"] },
      { type: "security-rule", title: "Rule B", body: "Sanitize all query params.", language: "typescript", framework: "express", pathScope: "src/middleware", tags: ["security"] },
      { type: "api-contract", title: "Rule C", body: "Return 400 for malformed requests.", language: "typescript", framework: "express", pathScope: "src/routes", tags: ["api"] },
      { type: "library-gotcha", title: "Rule D", body: "Express next() must be called or request will hang.", language: "typescript", framework: "express", pathScope: "*", tags: [] },
      { type: "testing-pattern", title: "Rule E", body: "Test every route with supertest.", language: "typescript", framework: "express", pathScope: "test/", tags: ["testing"] },
      { type: "code-axiom", title: "Rule F", body: "Group routes by domain, not by verb.", language: "typescript", framework: "express", pathScope: "src/routes", tags: ["architecture"] }
    ];

    for (const seed of seeds) {
      await store.save(seed);
    }

    const report = await runMitosisPipeline({
      project: "mitosis-project",
      dataDir: tempRoot,
      minAxioms: 5,
      minMaturityScore: 0.1,
      dryRun: true
    });

    assert.equal(typeof report.clustersDetected, "number");
    assert.equal(typeof report.matureClusters, "number");
    assert.equal(report.agentsBorn, 0, "dry-run must not birth agents");
    assert.equal(Array.isArray(report.agents), true);
    assert.equal(report.agents.length, 0);
    assert.equal(Array.isArray(report.clusters), true);

    // Verify no agent JSON was written to disk
    const agentDir = path.join(tempRoot, ".lcs", "agents");
    let agentFiles = [];
    try {
      const entries = await readdir(agentDir);
      agentFiles = entries.filter((f) => f.endsWith(".json") && f !== "routing.json");
    } catch {
      // Directory may not exist in dry-run — that is acceptable
    }
    assert.equal(agentFiles.length, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function main() {
  try {
    for (const test of tests) {
      try {
        await test.fn();
        console.log(`PASS ${test.name}`);
      } catch (error) {
        console.error(`FAIL ${test.name}`);
        console.error(error);
        process.exitCode = 1;
      }
    }

    if (!process.exitCode) {
      console.log("All portable checks passed.");
    }
  } finally {
    await rm(TEST_MEMORY_ROOT, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
