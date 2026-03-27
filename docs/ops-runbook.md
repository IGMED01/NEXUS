# Ops Runbook

## Goal

Operate the CLI safely in day-to-day work with reproducible validation and memory safeguards.

## 1) Daily startup checks

```bash
npm.cmd ci
npm.cmd run doctor
```

Expected:

- `doctor` has no `fail`
- `warn` is acceptable only for optional semantic/fallback runtimes in clean environments

## 2) Core validation gate (before push)

```bash
npm.cmd run typecheck
npm.cmd run build
npm.cmd run build:smoke
npm.cmd run release:check
npm.cmd test
npm.cmd run benchmark
npm.cmd run benchmark:recall
npm.cmd run benchmark:vertical
```

Push only when all pass.

## 2b) Observability baseline check

```bash
node src/cli.js doctor --format json
```

Verify in JSON:

- `observability.totals.runs`
- `observability.totals.degradedRate`
- `observability.recall.hitRate`
- `observability.commands` (per-command duration/degraded trends)

## 2c) Security pipeline quality gate

```bash
npm.cmd run security:pipeline:example
```

Expected:

- command exits `0`
- output includes `quality gate: PASS`
- in CI, artifacts are uploaded per Node version:
  - `security-chunks.json`
  - `security-teach.json`
- on pull requests (Node 20 lane), CI updates a PR comment summary with:
  - included findings
  - selected teach chunks
  - max finding priority
  - delta vs previous CI comment (same PR)
  - gate status (`PASS`/`FAIL`)
  - implementation source: `src/ci/security-pr-summary.js` (portable tests)
  - golden fixtures: `test/fixtures/ci/security-pr-summary.baseline.md` and `security-pr-summary.delta.md`

## 3) Memory safety operating rules

- Keep `memory.autoRecall=true` for normal teach flows.
- Keep `memory.autoRemember=false` by default unless explicitly needed.
- When `autoRemember=true`, verify `autoMemory.rememberRedactionCount` and `autoMemory.rememberSensitivePathCount` in output.
- Treat any `Auto remember failed:` warning as degraded output and investigate before relying on persisted memory.

## 4) Incident / degraded mode response

Orden operativo de memoria:

1. local JSONL
2. Ruflo / semantic tier
3. Engram solo como bateria externa de contingencia

Ver politica completa en `docs/memory-battery-policy.md`.

If Engram is unavailable:

1. Run `node src/cli.js doctor --format text`.
2. Continue with `teach` in degraded mode (no hard stop unless `strictRecall=true`).
3. Fix Engram path/runtime and rerun `doctor`.

### Failure matrix (Engram)

| Failure kind | Typical signal | CLI behavior | Immediate recovery |
| --- | --- | --- | --- |
| `binary-missing` | `ENOENT`, file not found | `recall` can return degraded contract (if enabled) with `failureKind` + `fixHint` | set `--engram-bin` correctly or update `learning-context.config.json` |
| `timeout` | `ETIMEDOUT`, request timed out | `teach` retries transient provider failures deterministically (default: 2 attempts, linear backoff 40ms) before degrading | retry with narrower query/scope, verify Engram process health |
| `malformed-output` | parse/format mismatch from provider output | degraded recall if enabled; explicit classification in output | update Engram, run `doctor`, then `recall --debug` |
| strict recall mode | `teach --strict-recall true` with provider failure | command fails fast (non-degraded) | disable strict mode for continuity or fix provider immediately |

Validation notes:

- CI tests now assert contract-safe degraded behavior for missing binary and timeout classification.
- CI tests now also assert degraded `malformed-output` classification for parse/format failures.
- CI tests assert deterministic retry/backoff behavior for transient `teach` recall failures.
- CI tests also assert strict recall throws instead of silently degrading.

## 5) Release checkpoint

For a stable cut:

1. Ensure CI is green on `main`.
2. Create annotated tag.
3. Publish GitHub release.
4. Update `CHANGELOG.md` and keep `package.json` version aligned with release SemVer core.
5. Record validation evidence in release notes.

## 6) Branch safety

`main` is branch-protected with required CI checks:

- `validate (20)`
- `validate (22)`

Do not bypass protections for routine changes.
