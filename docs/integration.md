# LCS Integration Guide (Quick Start)

_For operators and integrators who want to run LCS without reading source code._

## Prerequisites

```bash
node --version    # >= 20
npm install       # from the project root
node src/cli.js doctor --format json
```

Doctor must return `"status": "ok"` on all critical checks. Fix any `fail` before proceeding.

## 1. Select context (minimum viable flow)

```bash
# From a prepared chunk file:
node src/cli.js select \
  --input examples/auth-context.json \
  --focus "jwt middleware validation" \
  --format json

# From the workspace directly:
node src/cli.js select \
  --workspace . \
  --focus "auth middleware" \
  --format json
```

**Output**: JSON with `selectedContext[]` (ranked chunks), `suppressedContext[]`, and `summary`.

## 2. Build a teaching packet

```bash
node src/cli.js teach \
  --workspace . \
  --task "Harden auth middleware" \
  --objective "Teach request-boundary validation" \
  --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" \
  --project my-project \
  --format json
```

**Output**: JSON with `selectedContext[]`, `teachingSections` (codeFocus, relatedTests, historicalMemory, supportingContext), `teachingChecklist[]`, and `memoryRecall` state.

### Memory recall

By default, `teach` auto-recalls from Engram. Disable with `--no-recall`. Force a specific query with `--recall-query "auth validation"`.

## 3. JSON contract shape

All `--format json` outputs follow this envelope:

```json
{
  "schemaVersion": "1.0.0",
  "command": "<command-name>",
  "status": "ok",
  "degraded": false,
  "warnings": [],
  "config": { "found": true, "path": "..." },
  "meta": { "generatedAt": "...", "durationMs": 42, "scanStats": null },
  "observability": { "event": { "command": "...", "degraded": false } },
  ...commandSpecificFields
}
```

- `degraded: true` means something failed non-fatally (e.g., Engram unavailable)
- `warnings[]` lists human-readable problem descriptions
- `status` is always `"ok"` for successful execution, even when degraded
- Schema version follows semver; new fields are additive, breaking changes bump version

## 4. Degraded mode behavior

| Failure | CLI behavior | JSON signal |
|---------|-------------|-------------|
| Engram binary missing | Falls back to local `.lcs/local-memory-store.jsonl` | `degraded: true`, `memoryRecall.failureKind: "binary-missing"` |
| Engram timeout | Falls back to local store or empty recall | `degraded: true`, `memoryRecall.failureKind: "timeout"` |
| Malformed Engram output | Treats as empty recall | `degraded: true`, `memoryRecall.failureKind: "parse-error"` |
| Safety gate blocked | Command exits with structured error | `status: "blocked"`, `safety.reason: "safety-gate"` |

LCS **never crashes** on memory failures. It degrades and continues with workspace-only context.

## 5. Project config

Create `learning-context.config.json` at the repo root:

```bash
node src/cli.js init --format text
```

Key defaults you can override:

| Key | Default | Purpose |
|-----|---------|---------|
| `project` | from `package.json` name | Engram project namespace |
| `selection.tokenBudget` | `350` | Max tokens for context window |
| `selection.maxChunks` | `6` | Max chunks selected |
| `selection.minScore` | `0.25` | Score floor for selection |
| `memory.autoRecall` | `true` | Auto-recall from Engram in teach |
| `memory.backend` | `"resilient"` | `resilient` / `engram-only` / `local-only` |

## 6. Available commands

| Command | Purpose | Needs Engram? |
|---------|---------|---------------|
| `select` | Rank and filter context chunks | No |
| `teach` | Build teaching packet with selected context | Optional (auto-recall) |
| `readme` | Generate learning README from workspace | No |
| `recall` | Query Engram memory | Yes (degrades gracefully) |
| `remember` | Save a durable memory | Yes (degrades to local) |
| `close` | Save session-close summary | Yes (degrades to local) |
| `doctor` | Check local setup health | No |
| `init` | Create project config | No |
| `ingest-security` | Convert Prowler findings to chunks | No |
| `sync-knowledge` | Append learning note to Notion | No (needs Notion token) |
| `version` | Print CLI version | No |

## 7. Exit codes

- `0` = success (may be degraded, check `degraded` field)
- `1` = error or safety-blocked
