# LCS — Context Intelligence Layer: Scope Freeze

_Frozen: 2026-03-22 · v0.2.1 · Phase 0 deliverable_

## What LCS Is

LCS selects, prioritizes, and structures knowledge candidates to build the **active context** of a task. It takes retrieval candidates from memory and indexed knowledge, applies relevance scoring, redundancy filtering, and budget constraints, and emits:

- **Active context packet** — the minimal, high-signal set of chunks for the agent
- **Teaching packet** — pedagogical scaffolding built on top of the active context
- **Selection diagnostics** — traceability of what was selected, suppressed, and why

## What LCS Is Not

LCS is **not** an execution engine, knowledge ingestion pipeline, evaluation framework, or optimization layer. Those responsibilities belong to their respective layers.

---

## In-Scope / Out-of-Scope

| In-Scope (LCS owns) | Out-of-Scope (belongs elsewhere) |
|-----|-----|
| Relevance scoring (`scoreChunk`) | Execution control, plan enforcement → Guard |
| Redundancy filtering (Jaccard dedup) | Write gating, scope locks, rollback → Guard |
| Budget-constrained selection (`selectContextWindow`) | Budget governor (cost/tokens/steps) → Guard |
| Active context packet emission | Source connectors, raw extraction → Sync |
| Teaching packet assembly (`buildLearningPacket`) | Normalization, dedup upstream, chunking → Sync |
| Memory recall integration as **consumer** (`teach-recall.js`) | Knowledge versioning, lineage, trust → Sync |
| Degraded mode when memory fails | Benchmark harness, regression detection → Evals |
| CLI commands: `select`, `teach`, `recall`, `readme` | Quality/cost/latency longitudinal metrics → Evals |
| JSON contract stability (`schemaVersion: 1.0.0`) | Prompt optimization, routing tuning → Adapt |
| Compression of oversized chunks | Model-per-task selection, fine-tuning → Adapt |
| Chunk origin tracking (engram vs workspace) | Engram binary lifecycle, data format, sync |

---

## Layer Boundaries

### LCS ↔ Engram

| LCS responsibility | Engram responsibility |
|---|---|
| Consume memory via `resilient-memory-client.js` | Own binary, data directory, storage format |
| Build recall queries (`recall-queries.js`) | Execute searches, return stdout |
| Parse Engram output → chunks (`searchOutputToChunks`) | Maintain search index |
| Operate in degraded mode if Engram fails | Runtime health, availability |
| Local fallback store (`local-memory-store.js`) | — |

> **Contract**: LCS calls `searchMemories(query, options)` and receives `{ stdout: string }`. LCS never writes to Engram's data directory directly.

### LCS ↔ Guard (future layer)

| LCS responsibility | Guard responsibility |
|---|---|
| Emit context packets and diagnostics | Plan-before-execution enforcement |
| Respect `safety` config as pre-selection gate | Write gate, denylist/allowlist |
| — | Scope lock per task |
| — | Patch ledger, rollback |
| — | Risk digest, CI gate |

> **Contract**: LCS produces context. Guard governs what the agent does with it.

### LCS ↔ Sync (future layer)

| LCS responsibility | Sync responsibility |
|---|---|
| Receive `Chunk[]` as input | Source connectors (Notion, Git, etc.) |
| Score and select from received chunks | Normalization, dedup upstream |
| — | Chunking strategy |
| — | Metadata enrichment, versioning |
| — | Incremental sync, invalidation |

> **Contract**: LCS consumes `Chunk[]` conforming to `core-contracts.d.ts`. Sync owns everything before that array exists.

### LCS ↔ Evals (future layer)

| LCS responsibility | Evals responsibility |
|---|---|
| Emit `diagnostics` in every output | Benchmark harness, golden fixtures |
| Provide `summary` counts (selected/suppressed) | Regression detection across versions |
| Support `--debug` mode for full diagnostics | Trace analysis, incident review |
| — | Longitudinal quality/cost metrics |

> **Contract**: LCS emits structured diagnostics. Evals collects and analyzes them.

---

## Critical Path (semantic)

```
task/query
  → retrieval candidates     (teach-recall.js, engram-auto-orchestrator.js)
  → relevance ranking        (noise-canceler.js:scoreChunk)
  → redundancy filtering     (noise-canceler.js:selectContextWindow)
  → budget-constrained selection
  → active context packet    (ContextSelectionResult)
  → teaching packet          (mentor-loop.js:buildLearningPacket)
```

## Modules Owned by LCS

| Module | Role |
|---|---|
| `src/context/noise-canceler.js` | Scoring, ranking, selection, compression |
| `src/learning/mentor-loop.js` | Teaching packet builder |
| `src/memory/teach-recall.js` | Memory recall with retry/backoff |
| `src/memory/recall-queries.js` | Query building from task signals |
| `src/memory/engram-client.js` | Engram binary interface |
| `src/memory/engram-auto-orchestrator.js` | Auto-recall/auto-remember orchestration |
| `src/memory/resilient-memory-client.js` | Engram ↔ local fallback |
| `src/memory/local-memory-store.js` | JSONL local fallback store |
| `src/cli/teach-command.js` | CLI teach command |
| `src/cli/formatters.js` | Output formatting |
| `src/contracts/context-contracts.js` | Context chunk contracts |
| `src/types/core-contracts.d.ts` | TypeScript type definitions |

## Scope Decision Rule

Any new feature can be classified by asking:

1. Does it **select or structure context** for a task? → LCS
2. Does it **control what the agent executes**? → Guard
3. Does it **ingest, normalize, or version knowledge**? → Sync
4. Does it **measure quality or detect regression**? → Evals
5. Does it **optimize the system from evidence**? → Adapt

If ambiguous, it does **not** belong in LCS until explicitly reclassified.
