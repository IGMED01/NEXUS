# Learning Context System

Learning Context System is an experimental CLI for **coding with teaching, memory, and context control at the same time**.

> Spanish summary available in [README.es.md](README.es.md).

It does three things together:

1. selects useful context
2. teaches from that context
3. remembers durable decisions through Engram

## Status

This repository is **experimental but serious**.

It is already usable as:

- a local research CLI
- a context-selection prototype
- a teaching-oriented coding assistant scaffold
- a durable-memory playground backed by Engram
- an optional PR-to-Notion learnings sync flow after merges

It is **not** yet a mature framework.

## What this project is trying to solve

- Generate code and explanations in the same loop.
- Adapt the teaching style to the active language through skills.
- Preserve useful probability mass inside the context window by filtering noise, duplicates, and stale material.
- Keep memory and prompt context separate but cooperative.

## Resumen rapido en espanol

Este proyecto es una CLI experimental para:

- filtrar contexto antes de usar un LLM
- ensenar sobre el codigo mientras se trabaja
- recordar decisiones duraderas del proyecto

La idea no es mandar todo al modelo, sino elegir mejor:

- que codigo entra
- que test importa
- que memoria historica vale recuperar
- que ruido debe quedar afuera

## External repo decision

The primary repo to use as the architectural base is `engram`.

Why:

- it is the strongest fit for persistent memory and context retrieval
- it already thinks in terms of durable knowledge for agents
- it is a better foundation for context hygiene than a UI-first or transport-first repo

Use these other repositories as complementary references:

- `gentleman-architecture-agents` for agent contracts and scope control
- `Gentle-Learning` for the learning experience and pedagogical flow
- `Gentleman-MCP` later, if we need external tool orchestration

Full analysis lives in `docs/repo-analysis.md`.

## Exact use of Engram in this repository

This project uses **[Engram](https://github.com/Gentleman-Programming/engram)** from Gentleman-Programming **only for the durable memory layer**.

In concrete terms, Engram is used to:

- save durable project memories
- recall past decisions and summaries
- keep historical memory separate from the current prompt context

Engram is **not** used here as:

- the code-generation engine
- the context selector
- the pedagogical layer
- the general orchestration layer

## Uso exacto de Engram en espanol

En este repo usamos **Engram de Gentleman-Programming unicamente para la memoria durable**.

Se usa solo para:

- guardar memorias importantes
- recuperar decisiones previas
- traer resumenes utiles de sesiones anteriores

No se usa aqui para:

- generar codigo
- rankear chunks
- ensenar el contenido
- reemplazar la logica principal de la CLI

## Languages used in this repository

This repository is not JavaScript-only.

It currently uses:

- **JavaScript (ESM)** for the core CLI, selector, recall flow, and teaching packet logic
- **TypeScript** in the real backend vertical under `examples/typescript-backend/`
- **Markdown** for documentation, agent contracts, and skills
- **JSON** for fixtures, benchmarks, package manifests, and structured inputs
- **YAML** for GitHub Actions CI

## Runtimes and dependencies

### Core runtime

- **Node.js** is the required runtime for the main CLI
- **Engram binary** is the external memory runtime used for durable memory features such as `recall`, `remember`, and `close`

### Root package dependencies

The root package intentionally has **no external npm runtime dependencies**.

That is deliberate:

- easier local iteration
- lower installation friction
- smaller dependency surface

### Example TypeScript vertical dependencies

The TypeScript backend vertical under `examples/typescript-backend/` uses:

#### Runtime dependencies

- `zod`

#### Dev dependencies

- `typescript`
- `vitest`
- `@types/node`

### Tooling used in the repository

- **GitHub Actions** for CI
- **Git** for version control
- **Engram** for durable memory only

## Acknowledgements

This repository was built as an original implementation, but it openly credits external references that shaped specific parts of the architecture.

- **[Engram](https://github.com/Gentleman-Programming/engram)** from Gentleman-Programming: reference and local runtime only for durable memory persistence and recall
- **[gentleman-architecture-agents](https://github.com/Gentleman-Programming/gentleman-architecture-agents)**: reference for agent contracts, scope discipline, and `AGENTS.md` structure
- **[Gentle-Learning](https://github.com/Gentleman-Programming/Gentle-Learning)**: reference for the teaching-oriented framing and learning flow

These projects are credited as architectural inspiration. They are not listed as direct contributors to this repository unless they contribute commits here.

## Project layout

- `AGENTS.md`: operating contract for future agents
- `benchmark/recall-benchmark.json`: fixed benchmark cases for durable-memory recall quality
- `benchmark/selector-benchmark.json`: fixed benchmark cases for context selection quality
- `CHANGELOG.md`: release history and user-visible changes
- `CONTRIBUTING.md`: contributor rules and local validation checklist
- `docs/context-noise-cancellation.md`: design of the context filtering system
- `docs/benchmark.md`: benchmark method and metrics
- `docs/security-model.md`: scan safety model, secret redaction policy, and limits
- `docs/skills-governance.md`: policy to approve/block skills with risk tiers and rollback rules
- `docs/ops-runbook.md`: operational checklist for validation, degraded mode, and release hygiene
- `docs/status-actual.md`: current operational status and closed milestones
- `docs/typescript-backend-vertical.md`: end-to-end TypeScript backend demo flow
- `docs/usage.md`: CLI usage and input contract
- `examples/typescript-backend/`: realistic TypeScript middleware workspace
- `learning-context.config.json`: tracked project defaults for selection, memory, and Engram paths
- `ROADMAP.md`: next priorities
- `VERSIONING.md`: package/tag/release alignment policy
- `src/analysis/readme-generator.js`: generated learning README builder
- `src/ci/pr-learnings.js`: merged-PR metadata to durable learning-note payload mapper
- `src/context/noise-canceler.js`: prototype signal-over-noise selector
- `src/learning/mentor-loop.js`: learning packet builder
- `src/memory/engram-client.js` / `src/memory/engram-client.ts`: local Engram adapter for recall and durable memory writes (JS runtime + TS build track)
- `src/observability/metrics-store.js`: local command metrics store and aggregated observability report
- `src/security/prowler-ingest.js`: converter from Prowler findings JSON to LCS-compatible chunk JSON
- `scripts/sync-pr-learnings.js`: CI helper that syncs merged PR learnings to Notion through `sync-knowledge`
- `src/cli.js`: local CLI entrypoint
- `skills/`: language-specific and workflow-specific teaching skills

## Installation prerequisites

To use the project locally in a serious way, you need:

- **Node.js** for the CLI and benchmarks
- **Git** for normal development workflow
- **Engram binary** if you want durable-memory commands such as `recall`, `remember`, `close`, or memory-backed `teach`

You can still use parts of the system without Engram:

- `select`
- `readme`
- `teach --no-recall`

## Quick start

```bash
npm run doctor
npm run init:config
npm test
npm run typecheck
npm run build
npm run release:check
npm run benchmark
npm run benchmark:recall
npm run benchmark:vertical
npm run security:pipeline:example
```

`security:pipeline:example` includes a default quality gate (`min-included-findings=1`, `min-selected-teach-chunks=1`, `min-priority=0.84`).

## Project configuration

The CLI now auto-loads `learning-context.config.json` when present.

That file is the official place for:

- default project name
- default workspace
- selection budgets
- recall defaults
- memory automation defaults (`memory.autoRecall`, `memory.autoRemember`)
- Engram binary and data directory paths
- scan safety defaults and per-project overrides

CLI flags still win over config values when both are present.

Security note: when auto-remember is enabled for `teach`, saved memory content is sanitized (sensitive paths masked, secret-like values redacted) before writing to Engram.

To inspect the local setup:

```bash
npm run doctor
```

To generate the base config file:

```bash
npm run init:config
```

Key `config.security` fields:

- `ignoreSensitiveFiles`
- `redactSensitiveContent`
- `ignoreGeneratedFiles`
- `allowSensitivePaths`
- `extraSensitivePathFragments`

Current `typecheck` scope is intentionally incremental: it hardens the config/bootstrap and workspace-scan layer first, instead of pretending the whole repo is already fully migrated to strict TypeScript.

## Build and TypeScript migration strategy

The repo now has two different TypeScript-related flows on purpose:

1. `npm run typecheck`
   - strict incremental safety gate for the hardened core chain
2. `npm run build`
   - emits a runnable `dist/` CLI from the current runtime without pretending every file is fully migrated

Useful commands:

```bash
npm run build
npm run build:smoke
npm run pack:check
npm run release:check
```

Conceptually:

- **typecheck** = where we already enforce stronger contracts
- **build** = publishable runtime output for packaging and CI smoke tests
- **pack:check** = validates `npm pack` includes required package assets before publication work

The local developer entrypoint stays `src/cli.js` for now. The `dist/` build is the bridge toward a later full `.ts` migration, not a fake claim that migration is already done.

### What "real migration" means here

In this repo, migration is considered real only when all three happen:

1. module source moves to `.ts`
2. runtime behavior is validated through `dist/`
3. package distribution uses `dist` as the executable surface

The project now enforces step (2) and step (3) through CI build + smoke and `bin` pointing to `dist/cli.js`.

Current real `.ts` migrations in `src/`:

- `src/security/secret-redaction.ts`
- `src/io/text-file.ts`
- `src/contracts/config-contracts.ts`
- `src/io/config-file.ts`
- `src/io/workspace-chunks.ts`
- `src/system/project-ops.ts`
- `src/cli/arg-parser.ts`
- `src/contracts/cli-contracts.ts`
- `src/cli/teach-command.ts`
- `src/memory/recall-queries.ts`
- `src/memory/teach-recall.ts`
- `src/memory/engram-auto-orchestrator.ts`
- `src/memory/engram-client.ts`

Compatibility note:

- Node 20/22 local runtime still uses `.js` entry modules in `src/`
- `dist/` build emits from the `.ts` migration track for packaging and CI smoke validation

## Privacy and scan policy

The workspace scanner is not a blind dump.

It currently:

- ignores high-risk credential containers such as:
  - `.env*`
  - `.npmrc`, `.pypirc`, `.netrc`
  - `.aws/credentials`, `.docker/config.json`, `.kube/config`
  - `id_rsa`, `id_dsa`, `id_ed25519`
  - `.pem`, `.key`, `.pfx`, `.crt`, `.cer`, `.tfvars`
- redacts secret-like fragments inside otherwise useful files:
  - private key blocks
  - API keys and access tokens
  - bearer tokens
  - JWT-like tokens
  - connection strings and DSNs
  - common password/secret assignments
- counts redacted files, ignored sensitive files, and redaction categories in scan statistics
- allows project-level security overrides through `learning-context.config.json`

That means the CLI now exposes not only selected context, but also **how much data was ignored, truncated, or redacted**.

Security overrides are deliberately explicit:

- use `allowSensitivePaths` only for known-safe fixtures such as examples
- use `extraSensitivePathFragments` when a repo has custom sensitive areas that should never enter context

Security model details live in [docs/security-model.md](docs/security-model.md).

## Open-source collaboration surfaces

To make the repository usable by others, GitHub surfaces are now explicitly wired:

- Issue templates:
  - bug report
  - feature request
  - usage question
- Pull request template with mandatory validation checklist
- CI workflow with typecheck/build/tests/benchmarks plus secret scan gate
- PR Learnings Sync workflow that can export merged PR learnings to Notion (`sync:pr-learnings`) when secrets are configured
- CodeQL workflow for JavaScript/TypeScript static analysis
- Dependabot configuration for npm and GitHub Actions updates
- Security policy in [`SECURITY.md`](SECURITY.md)

## Best demo right now

The strongest current demo is the TypeScript backend middleware vertical:

```bash
npm run vertical:ts:teach
npm run vertical:ts:seed-memory
npm run vertical:ts:teach:memory
```

That flow shows:

- changed code and related tests
- controlled noise suppression
- pedagogical teaching sections
- durable memory entering the final packet

## Example usage

```bash
node src/cli.js select --input examples/auth-context.json --focus "jwt middleware expired session validation" --min-score 0.25 --format text
node src/cli.js teach --input examples/auth-context.json --task "Improve auth middleware" --objective "Teach why validation runs before route handlers" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --project learning-context-system --min-score 0.25 --format text
node src/cli.js ingest-security --input examples/prowler-findings.sample.json --status-filter non-pass --output ./security-chunks.json --format text
node src/cli.js readme --workspace . --focus "learning context cli noise cancellation" --output README.LEARN.md --format text
node src/cli.js recall --project learning-context-system --query "auth middleware" --type decision --scope project --limit 5 --format text
node src/cli.js remember --title "JWT order" --content "Validation runs before route handlers." --project learning-context-system --type decision --topic architecture/auth-order --format text
node src/cli.js close --summary "Integrated recall and remember commands." --learned "Context retrieval and durable memory are different layers." --next "Connect recall to the teaching flow." --project learning-context-system --format text
node src/cli.js sync-knowledge --title "PR #39 learnings" --content "Migrated Engram adapter to TS build track." --project learning-context-system --source "pr-39" --tags "typescript,memory,engram" --notion-page-id "<page-id>" --notion-token "<token>" --format text
npm run sync:pr-learnings -- --event "$GITHUB_EVENT_PATH" --dry-run true
```

## Stable JSON contract

When you use `--format json`, the CLI now returns a versioned JSON contract with:

- `schemaVersion`
- `command`
- `status`
- `degraded`
- `warnings`
- `config`
- `meta`

and then the command payload itself.

That makes the CLI safer to consume from scripts and future tooling.

## Benchmark coverage

This repo now has three benchmark layers:

- selector benchmark
- recall benchmark
- vertical benchmark

The goal is not only to say "it feels better", but to show when behavior improves or regresses.

## Initial direction

The prototype is intentionally dependency-light and runs on plain Node so we can iterate even in a minimal local environment. The only external runtime it now leans on is a locally installed Engram binary for durable memory, and `teach` now uses that memory automatically before building the teaching packet with a smarter multi-query recall strategy.

## Roadmaps by area

Use `ROADMAP.md` as the index and the section roadmaps under `docs/roadmaps/` when you want the next steps split by concern instead of mixed in one list.
