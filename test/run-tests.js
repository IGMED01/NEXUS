import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { buildLearningReadme } from "../src/analysis/readme-generator.js";
import { runCli } from "../src/cli/app.js";
import { defaultProjectConfig, parseProjectConfig } from "../src/contracts/config-contracts.js";
import { parseChunkFile } from "../src/contracts/context-contracts.js";
import { loadWorkspaceChunks } from "../src/io/workspace-chunks.js";
import { buildLearningPacket } from "../src/learning/mentor-loop.js";
import { initProjectConfig, runProjectDoctor } from "../src/system/project-ops.js";
import {
  getObservabilityReport,
  recordCommandMetric
} from "../src/observability/metrics-store.js";
import {
  buildCloseSummaryContent,
  createEngramClient,
  searchOutputToChunks
} from "../src/memory/engram-client.js";
import { createLocalMemoryStore } from "../src/memory/local-memory-store.js";
import { createResilientMemoryClient } from "../src/memory/resilient-memory-client.js";
import { buildTeachRecallQueries } from "../src/memory/recall-queries.js";
import { resolveTeachRecall } from "../src/memory/teach-recall.js";
import {
  buildKnowledgeBlocks,
  createNotionSyncClient,
  resolveNotionConfig
} from "../src/integrations/notion-sync.js";
import { compressContent, selectContextWindow } from "../src/context/noise-canceler.js";
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

const tests = [];
const execFile = promisify(execFileCallback);

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
  "init",
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
    task: "Integrate Engram recall",
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
          "CLI Engram integration. Durable memory now enters the teach packet automatically. Memory type: architecture. Memory scope: project",
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
          "CLI Engram integration. Added an Engram adapter and new CLI commands recall, remember, and close for durable memory.",
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
    async searchMemories(query, options) {
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
    async saveMemory() {
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
    await rm(tempRoot, { recursive: true, force: true });
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
    await rm(tempRoot, { recursive: true, force: true });
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
    await rm(tempRoot, { recursive: true, force: true });
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
        maxTokenBudget: 420
      }
    }),
    "inline"
  );

  assert.equal(parsed.memory.autoRecall, false);
  assert.equal(parsed.memory.autoRemember, true);
  assert.equal(parsed.memory.backend, "engram-only");
  assert.equal(parsed.security.ignoreSensitiveFiles, false);
  assert.equal(parsed.security.redactSensitiveContent, false);
  assert.equal(parsed.security.ignoreGeneratedFiles, false);
  assert.deepEqual(parsed.security.allowSensitivePaths, [".env.example"]);
  assert.deepEqual(parsed.security.extraSensitivePathFragments, ["fixtures/private"]);
  assert.deepEqual(parsed.scan.ignoreDirs, [".cache", "vendor-cache"]);
  assert.equal(parsed.safety.requirePlanForWrite, true);
  assert.deepEqual(parsed.safety.allowedScopePaths, ["src/auth", "docs"]);
  assert.equal(parsed.safety.maxTokenBudget, 420);
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
    /memory\.backend must be 'resilient', 'engram-only', or 'local-only'/i
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
    "init",
    "sync-knowledge",
    "ingest-security",
    "select",
    "teach",
    "readme",
    "recall",
    "remember",
    "close"
  ]) {
    assert.match(result.stdout, new RegExp(`node src/cli\\.js ${command}`));
  }
  assert.match(result.stdout, /doctor\s+-> checks runtime, config, workspace, and Engram health/);
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
    const memoryBackendCheck = result.checks.find((check) => check.id === "memory-backend");

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
    assert.ok(memoryBackendCheck);
    assert.equal(memoryBackendCheck.status, "pass");
    assert.match(memoryBackendCheck.detail, /engram primary \+ local fallback/i);
  } finally {
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

run("doctor reports local-only backend and skips Engram path warnings", async () => {
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
    const binaryCheck = result.checks.find((check) => check.id === "engram-binary");
    const dataCheck = result.checks.find((check) => check.id === "engram-data");

    assert.ok(backendCheck);
    assert.equal(backendCheck.status, "warn");
    assert.match(backendCheck.detail, /local-only/i);
    assert.ok(binaryCheck);
    assert.equal(binaryCheck.status, "pass");
    assert.match(binaryCheck.detail, /skipped because memory\.backend='local-only'/i);
    assert.ok(dataCheck);
    assert.equal(dataCheck.status, "pass");
    assert.match(dataCheck.detail, /skipped because memory\.backend='local-only'/i);
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

  await client.searchMemories("jwt middleware", {
    project: "learning-context-system",
    scope: "project",
    type: "learning",
    limit: 3
  });
  await client.saveMemory({
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
      client.searchMemories("auth middleware", {
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
      client.searchMemories("auth middleware", {
        project: "learning-context-system"
      }),
    /query timed out after 10s/
  );
});

run("local memory store saves and searches memories with engram-like output", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-local-memory-store-"));
  const store = createLocalMemoryStore({
    filePath: path.join(tempRoot, "memory-store.jsonl")
  });

  try {
    await store.saveMemory({
      title: "Auth validation order",
      content: "Reject invalid tokens before route handlers.",
      type: "decision",
      project: "learning-context-system",
      scope: "project"
    });
    await store.saveMemory({
      title: "Rate-limit middleware",
      content: "Throttle abusive IP ranges to protect auth endpoints.",
      type: "architecture",
      project: "learning-context-system",
      scope: "project"
    });

    const result = await store.searchMemories("auth validation", {
      project: "learning-context-system",
      scope: "project",
      limit: 5
    });

    assert.match(result.stdout, /Found 1 memories:/);
    assert.match(result.stdout, /Auth validation order/);
    const chunks = searchOutputToChunks(result.stdout, {
      query: "auth validation",
      project: "learning-context-system"
    });
    assert.equal(chunks.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

run("resilient memory client falls back to local store when Engram search fails", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lcs-resilient-memory-"));
  const fallback = createLocalMemoryStore({
    filePath: path.join(tempRoot, "memory-store.jsonl")
  });
  await fallback.saveMemory({
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
      async searchMemories() {
        throw new Error("engram offline");
      },
      async saveMemory() {
        throw new Error("engram offline");
      },
      async closeSession() {
        throw new Error("engram offline");
      }
    },
    fallback
  });

  try {
    const result = await resilient.searchMemories("cli integration", {
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

run("close summary builder captures summary, learning, and next step", () => {
  const content = buildCloseSummaryContent({
    summary: "Integrated Engram into the CLI",
    learned: "Recent context and durable memory are different layers.",
    next: "Wire recall output into the teaching flow.",
    workspace: "C:/repo",
    closedAt: "2026-03-17T18:00:00.000Z"
  });

  assert.match(content, /Session Close Summary/);
  assert.match(content, /Integrated Engram into the CLI/);
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
    task: "Integrate Engram CLI",
    objective: "Teach how durable memory feeds the packet",
    focus: "CLI Engram integration durable memory recall remember close",
    changedFiles: ["src/cli/app.js", "src/memory/engram-client.js"]
  });

  assert.ok(queries.length >= 3);
  assert.ok(queries.some((query) => /engram/u.test(query) && /cli/u.test(query)));
  assert.ok(queries.some((query) => /integration/u.test(query)));
  assert.equal(queries.some((query) => query.split(/\s+/u).length <= 4), true);
});

run("teach recall strategy retries queries and deduplicates repeated memories", async () => {
  const seenQueries = [];
  const result = await resolveTeachRecall({
    task: "Integrate Engram CLI",
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
    async searchMemories(query) {
      seenQueries.push(query);

      if (!/integration/u.test(query) && !/engram\s+cli/u.test(query)) {
        return {
          stdout: "No memories found for that query."
        };
      }

      return {
        stdout: [
          "Found 1 memories:",
          "",
          "[1] #8 (architecture) — CLI Engram integration",
          "    Durable memory now enters the teach packet automatically.",
          "    2026-03-17 18:15:00 | project: learning-context-system | scope: project"
        ].join("\n")
      };
    }
  });

  assert.equal(result.memoryRecall.status, "recalled");
  assert.equal(result.memoryRecall.recoveredChunks, 1);
  assert.equal(result.memoryRecall.firstMatchIndex >= 0, true);
  assert.equal(result.memoryRecall.matchedQueries.length >= 1, true);
  assert.equal(result.chunks.filter((chunk) => chunk.source.startsWith("engram://")).length, 1);
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
    async searchMemories() {
      throw new Error("temporary Engram failure");
    }
  });

  assert.equal(result.memoryRecall.status, "failed");
  assert.match(result.memoryRecall.error, /temporary Engram failure/);
  assert.match(result.memoryRecall.error, /retryAttempts=2/);
  assert.equal(result.chunks.length, 0);
});

run("teach recall retries transient failures before succeeding", async () => {
  let attempts = 0;
  const result = await resolveTeachRecall({
    task: "Integrate Engram CLI",
    objective: "Teach memory flow",
    focus: "engram cli memory retry",
    changedFiles: ["src/memory/teach-recall.js"],
    project: "learning-context-system",
    explicitQuery: "engram cli integration",
    limit: 2,
    retryAttempts: 3,
    retryBackoffMs: 0,
    baseChunks: [],
    async searchMemories() {
      attempts += 1;

      if (attempts < 3) {
        throw new Error("ETIMEDOUT while querying Engram");
      }

      return {
        stdout: [
          "Found 1 memories:",
          "",
          "[1] #11 (architecture) â€” CLI Engram integration",
          "    Memory retry recovered and produced a stable recall payload.",
          "    2026-03-18 17:00:00 | project: learning-context-system | scope: project"
        ].join("\n")
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
    task: "Integrate Engram CLI",
    objective: "Teach memory flow",
    focus: "engram cli binary path",
    changedFiles: ["src/memory/engram-client.js"],
    project: "learning-context-system",
    explicitQuery: "engram cli binary",
    retryAttempts: 4,
    retryBackoffMs: 0,
    baseChunks: [],
    async searchMemories() {
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
    task: "Integrate Engram CLI",
    objective: "Teach memory flow",
    focus: "engram cli memory",
    changedFiles: ["src/memory/teach-recall.js"],
    project: "learning-context-system",
    limit: 2,
    baseChunks: [],
    async searchMemories() {
      return {
        stdout: "Found memory entries but output format is malformed"
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
        async searchMemories() {
          throw new Error("ETIMEDOUT while querying Engram");
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
    async searchMemories(query, options) {
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
    async saveMemory() {
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
    async searchMemories(query, options) {
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
    async saveMemory() {
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
    async searchMemories() {
      throw new Error("engram offline");
    },
    async saveMemory() {
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

  try {
    const store = createLocalMemoryStore({
      filePath: fallbackFile
    });
    await store.saveMemory({
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

  try {
    const store = createLocalMemoryStore({
      filePath: fallbackFile
    });
    await store.saveMemory({
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
    async searchMemories() {
      throw new Error("ETIMEDOUT: query timed out after 8s");
    },
    async saveMemory() {
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
    async searchMemories() {
      throw new Error("Unexpected token } in JSON at position 12");
    },
    async saveMemory() {
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
    "--degraded-recall",
    "true",
    "--format",
    "json"
  ]);

  const parsed = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(parsed.degraded, true);
  assert.equal(parsed.failureKind, "binary-missing");
  assert.match(parsed.fixHint, /--engram-bin/);
});

run("cli recall debug shows active filter state", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async searchMemories(query, options) {
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
    async saveMemory() {
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
    async searchMemories() {
      throw new Error("not used");
    },
    async saveMemory() {
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
      "Fallback memory write",
      "--content",
      "Store this even when engram is down.",
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

run("cli teach can be blocked when token budget exceeds safety max", async () => {
  const configPath = path.join(process.cwd(), "test-safety-budget-config.json");
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async searchMemories() {
      throw new Error("not used");
    },
    async saveMemory() {
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

run("cli remember saves a durable memory through Engram", async () => {
  /** @type {Array<unknown>} */
  const calls = [];
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async searchMemories() {
      throw new Error("not used");
    },
    async saveMemory(input) {
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
  assert.deepEqual(calls[0], {
    title: "JWT order",
    content: "Validation now runs before route handlers.",
    type: "decision",
    project: "learning-context-system",
    scope: "project",
    topic: "architecture/auth-order"
  });
  assert.match(result.stdout, /Memory saved/);
  assert.match(result.stdout, /architecture\/auth-order/);
});

run("cli remember emits a stable JSON contract", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async searchMemories() {
      throw new Error("not used");
    },
    async saveMemory(input) {
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
    async searchMemories() {
      throw new Error("not used");
    },
    async saveMemory() {
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
  assert.deepEqual(calls[0], {
    summary: "Integrated recall and remember commands.",
    learned: "Context retrieval and durable memory must stay separate.",
    next: "Connect recall output to the teaching packet.",
    title: undefined,
    project: "learning-context-system",
    scope: "project",
    type: "learning"
  });
  assert.match(result.stdout, /Session close note saved/);
});

run("cli close emits a stable JSON contract", async () => {
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async searchMemories() {
      throw new Error("not used");
    },
    async saveMemory() {
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
    async searchMemories(query, options) {
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
    async saveMemory() {
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
  assert.equal(parsed.selectedContext.some((chunk) => chunk.source.startsWith("engram://")), true);
});

run("cli teach can persist an automatic memory summary when enabled", async () => {
  /** @type {Array<{ content: string, title: string, type?: string, scope?: string, project?: string }>} */
  const saveCalls = [];
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async searchMemories(query, options) {
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: "No memories found for that query.",
        dataDir: ".engram"
      };
    },
    async saveMemory(input) {
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
    async searchMemories(query, options) {
      return {
        mode: "search",
        project: options?.project ?? "",
        query,
        stdout: "No memories found for that query.",
        dataDir: ".engram"
      };
    },
    async saveMemory() {
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
    async searchMemories() {
      called = true;
      throw new Error("not used");
    },
    async saveMemory() {
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
    async searchMemories() {
      called = true;
      throw new Error("not used");
    },
    async saveMemory() {
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
    async searchMemories() {
      throw new Error("temporary Engram failure");
    },
    async saveMemory() {
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
    async searchMemories(query, options) {
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
          "[1] #8 (architecture) â€” CLI Engram integration",
          "    Durable memory now enters the teach packet automatically.",
          "    2026-03-17 18:15:00 | project: learning-context-system | scope: project"
        ].join("\n"),
        dataDir: ".engram"
      };
    },
    async saveMemory() {
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
      "Integrate Engram CLI",
      "--objective",
      "Teach how durable memory feeds the packet",
      "--changed-files",
      "src/cli/app.js,src/memory/engram-client.js",
      "--project",
      "learning-context-system",
      "--recall-query",
      "CLI Engram integration",
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
  assert.equal(parsed.selectedContext.some((chunk) => chunk.source.startsWith("engram://")), true);
});

run("cli teach can disable automatic recall", async () => {
  let called = false;
  const fakeClient = {
    async recallContext() {
      throw new Error("not used");
    },
    async searchMemories() {
      called = true;
      throw new Error("not used");
    },
    async saveMemory() {
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

async function main() {
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
