import test from "node:test";
import assert from "node:assert/strict";

import { buildLearningPacket } from "../src/learning/mentor-loop.js";
import { compressContent, selectContextWindow } from "../src/context/noise-canceler.js";

test("selectContextWindow prioritizes relevant code and filters noisy logs", () => {
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

test("selectContextWindow suppresses highly redundant chunks", () => {
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

test("compressContent keeps the most focus-heavy sentences", () => {
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

test("buildLearningPacket returns teaching scaffolding with selected context", () => {
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
});

// --- Phase 1: recall → selection → teaching sections costura ---

test("memory recall chunks enter teachingSections.historicalMemory", () => {
  const packet = buildLearningPacket({
    task: "Harden auth middleware",
    objective: "Teach request-boundary validation",
    changedFiles: ["src/auth/middleware.ts"],
    chunks: [
      {
        id: "code-mw",
        source: "src/auth/middleware.ts",
        kind: "code",
        content: "Auth middleware validates JWT before routing. Expired tokens trigger 401.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.85,
        priority: 0.9
      },
      {
        id: "engram-memory-abc",
        source: "engram://project/learning-context-system/memory/auth-validation-order",
        kind: "memory",
        content: "Memory type: learning. Auth validation must run before route handlers to prevent unauthorized data access.",
        certainty: 0.8,
        recency: 0.7,
        teachingValue: 0.75,
        priority: 0.7
      }
    ],
    tokenBudget: 200,
    minScore: 0.1
  });

  const historicalMemory = packet.teachingSections.historicalMemory;
  assert.ok(historicalMemory.length >= 1, "historicalMemory should contain at least 1 memory chunk");
  assert.equal(historicalMemory[0].kind, "memory");
  assert.match(historicalMemory[0].source, /engram:\/\//);
  assert.ok(packet.teachingSections.codeFocus, "codeFocus should be set");
  assert.equal(packet.teachingSections.codeFocus.kind, "code");
});

test("teaching sections route all chunk kinds correctly", () => {
  const packet = buildLearningPacket({
    task: "Refactor validation pipeline",
    objective: "Teach middleware ordering and test coverage",
    changedFiles: ["src/validation.js"],
    chunks: [
      {
        id: "code-val",
        source: "src/validation.js",
        kind: "code",
        content: "Validation pipeline checks input schema, sanitizes fields, and rejects malformed payloads.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.9,
        priority: 0.95
      },
      {
        id: "test-val",
        source: "test/validation.test.js",
        kind: "test",
        content: "Tests cover malformed payload rejection and field sanitization edge cases.",
        certainty: 0.9,
        recency: 0.85,
        teachingValue: 0.8,
        priority: 0.85
      },
      {
        id: "mem-val",
        source: "engram://project/learning-context-system/memory/validation-patterns",
        kind: "memory",
        content: "Memory type: decision. Input validation should happen at the boundary, not deep in business logic.",
        certainty: 0.8,
        recency: 0.6,
        teachingValue: 0.7,
        priority: 0.65
      },
      {
        id: "spec-val",
        source: "docs/validation-spec.md",
        kind: "spec",
        content: "Validation spec requires all inputs to be schema-checked before processing.",
        certainty: 0.85,
        recency: 0.5,
        teachingValue: 0.6,
        priority: 0.6
      }
    ],
    tokenBudget: 400,
    minScore: 0.1
  });

  assert.ok(packet.teachingSections.codeFocus, "codeFocus should be populated");
  assert.equal(packet.teachingSections.codeFocus.id, "code-val");
  assert.ok(packet.teachingSections.relatedTests.length >= 1, "relatedTests should have entries");
  assert.equal(packet.teachingSections.relatedTests[0].kind, "test");
  assert.ok(packet.teachingSections.historicalMemory.length >= 1, "historicalMemory should have entries");
  assert.equal(packet.teachingSections.historicalMemory[0].kind, "memory");
  assert.ok(packet.teachingSections.supportingContext.length >= 1, "supportingContext should have entries");
  assert.ok(packet.teachingSections.flow.length >= 2, "flow should have at least 2 teaching steps");
});

test("mixed workspace+engram chunks respect budget without origin bias", () => {
  const workspaceChunk = {
    id: "ws-code",
    source: "src/service.js",
    kind: "code",
    content: "Service layer orchestrates validation and persistence in a single transaction boundary.",
    certainty: 0.9,
    recency: 0.85,
    teachingValue: 0.8,
    priority: 0.85
  };
  const engramChunk = {
    id: "engram-memory-svc",
    source: "engram://project/learning-context-system/memory/service-patterns",
    kind: "memory",
    content: "Memory type: learning. Transaction boundaries should wrap both validation and persistence to prevent partial writes.",
    certainty: 0.85,
    recency: 0.7,
    teachingValue: 0.75,
    priority: 0.75
  };

  const result = selectContextWindow([workspaceChunk, engramChunk], {
    focus: "service transaction boundary validation persistence",
    tokenBudget: 200,
    minScore: 0.1
  });

  assert.ok(result.selected.length >= 1, "should select at least 1 chunk");
  assert.ok(
    result.selected.length + result.suppressed.length === 2,
    "all input chunks should be accounted for"
  );
  assert.ok(result.usedTokens <= 200, "should respect token budget");

  const origins = result.selected.map((c) => c.origin);
  if (result.selected.length === 2) {
    assert.ok(origins.includes("workspace"), "workspace chunk should be included");
    assert.ok(origins.includes("engram"), "engram chunk should be included");
  }
});

test("two-pass selection reserves room for recalled memory", () => {
  const chunks = [
    {
      id: "ws-teach",
      source: "src/cli/teach-command.js",
      kind: "code",
      content:
        "Teach command builds packet output, validates options, and serializes observability metadata.",
      certainty: 0.95,
      recency: 0.92,
      teachingValue: 0.9,
      priority: 0.94
    },
    {
      id: "ws-loop",
      source: "src/learning/mentor-loop.js",
      kind: "code",
      content:
        "Mentor loop maps selected context to teaching sections and highlights code focus plus related tests.",
      certainty: 0.93,
      recency: 0.9,
      teachingValue: 0.88,
      priority: 0.9
    },
    {
      id: "engram-memory-critical-path",
      source: "engram://project/learning-context-system/memory/critical-path-hardening",
      kind: "memory",
      content:
        "Memory type: decision. Preserve recall disposition in teach outputs and keep memory context visible during selection.",
      certainty: 0.92,
      recency: 0.8,
      teachingValue: 0.86,
      priority: 0.88
    }
  ];

  const result = selectContextWindow(chunks, {
    focus: "teach command recall disposition memory context",
    tokenBudget: 180,
    maxChunks: 2,
    minScore: 0.2,
    changedFiles: ["src/cli/teach-command.js", "src/learning/mentor-loop.js"],
    recallReserveRatio: 0.15
  });

  assert.equal(result.selected.length, 2, "should select exactly maxChunks");
  assert.ok(
    result.selected.some((chunk) => chunk.origin === "engram"),
    "should keep at least one recalled memory chunk"
  );
  assert.ok(
    result.selected.some((chunk) => chunk.origin === "workspace"),
    "should still include workspace implementation context"
  );
});

test("buildLearningPacket always exposes chunk origin in JSON output", () => {
  const packet = buildLearningPacket({
    task: "Harden selection output",
    objective: "Expose stable origin metadata without debug mode",
    changedFiles: ["src/learning/mentor-loop.js"],
    maxChunks: 1,
    chunks: [
      {
        id: "code-origin",
        source: "src/learning/mentor-loop.js",
        kind: "code",
        content: "Packet builder maps selected context into JSON output contracts.",
        certainty: 0.95,
        recency: 0.9,
        teachingValue: 0.85,
        priority: 0.92
      },
      {
        id: "engram-origin",
        source: "engram://project/learning-context-system/memory/output-origin",
        kind: "memory",
        content:
          "Memory type: architecture. Selected and suppressed entries should keep origin metadata for downstream analytics.",
        certainty: 0.85,
        recency: 0.7,
        teachingValue: 0.8,
        priority: 0.8
      }
    ]
  });

  assert.ok(packet.selectedContext.length >= 1, "selected context should not be empty");
  assert.ok(
    packet.selectedContext.every((chunk) => chunk.origin === "workspace" || chunk.origin === "engram"),
    "selected chunk origin should always be present"
  );
  assert.ok(packet.suppressedContext.length >= 1, "suppressed context should include at least one item");
  assert.ok(
    packet.suppressedContext.every(
      (chunk) => chunk.origin === "workspace" || chunk.origin === "engram"
    ),
    "suppressed chunk origin should always be present"
  );
});

test("recalled memory survives selection against workspace scan noise", () => {
  const workspaceChunks = [
    {
      id: "code-cli-app",
      source: "src/cli/app.js",
      kind: "code",
      content: "CLI application entry point handles command routing and option parsing for all LCS commands.",
      certainty: 0.9,
      recency: 0.85,
      teachingValue: 0.7,
      priority: 0.8
    },
    {
      id: "code-engram-client",
      source: "src/memory/engram-client.js",
      kind: "code",
      content: "Engram client wraps binary execution for search, save, and context commands.",
      certainty: 0.9,
      recency: 0.85,
      teachingValue: 0.75,
      priority: 0.8
    },
    {
      id: "test-engram",
      source: "test/engram-client.test.js",
      kind: "test",
      content: "Tests verify engram client search command builds correct arguments and handles errors.",
      certainty: 0.88,
      recency: 0.8,
      teachingValue: 0.7,
      priority: 0.75
    },
    {
      id: "doc-readme",
      source: "README.md",
      kind: "doc",
      content: "Learning Context System documentation describes the project architecture and CLI usage.",
      certainty: 0.7,
      recency: 0.5,
      teachingValue: 0.5,
      priority: 0.5
    }
  ];
  const recalledMemory = {
    id: "engram-memory-8",
    source: "engram://learning-context-system/8",
    kind: "memory",
    content: "CLI Engram integration. Durable memory now enters the teach packet automatically. Memory type: architecture.",
    certainty: 0.93,
    recency: 0.72,
    teachingValue: 0.92,
    priority: 0.9
  };

  const result = selectContextWindow([...workspaceChunks, recalledMemory], {
    focus: "Integrate Engram CLI Teach how durable memory feeds the packet",
    tokenBudget: 520,
    maxChunks: 8,
    minScore: 0.25,
    changedFiles: ["src/cli/app.js", "src/memory/engram-client.js"]
  });

  const selectedSources = result.selected.map((c) => c.source);
  assert.ok(
    selectedSources.some((s) => s.startsWith("engram://")),
    `recalled memory should survive selection. Selected: ${selectedSources.join(", ")}`
  );

  const recalledChunk = result.selected.find((c) => c.source.startsWith("engram://"));
  assert.ok(recalledChunk, "recalled memory chunk should be in selected");
  assert.ok(recalledChunk.diagnostics.recallOriginBoost > 0, "recallOriginBoost should be positive");
});
