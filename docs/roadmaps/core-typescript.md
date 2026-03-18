# Core TypeScript Roadmap

## Goal

Move the core from "disciplined JavaScript" to "strictly typed and safer to refactor" without breaking the local CLI.

## Scope

- context selection
- mentor loop
- recall strategy
- Engram adapter contracts
- shared type contracts

## Current state

- incremental `typecheck` exists
- config/bootstrap/scanner already pass strict checking
- shared core contracts already exist in `src/types/core-contracts.d.ts`
- selector, mentor loop, and memory recall now share typed shapes instead of ad-hoc inline objects
- memory teach orchestration modules now have `.ts` build-track sources (`src/memory/teach-recall.ts`, `src/memory/engram-auto-orchestrator.ts`)
- enforced `typecheck` already covers:
  - `src/analysis/readme-generator.js`
  - `src/cli/app.js`
  - `src/cli/arg-parser.js`
  - `src/cli/formatters.js`
  - `src/context/noise-canceler.js`
  - `src/learning/mentor-loop.js`
  - `src/memory/recall-queries.ts`
  - `src/memory/engram-client.ts`
  - `src/memory/teach-recall.ts`
- core runtime still lives mostly in `.js`

## Milestones

### Milestone 1 - Shared contracts

- [x] define shared core types for chunks, packets, memory recall, doctor checks, and CLI metadata
- [x] replace repeated ad-hoc JSDoc object shapes
- [x] keep runtime behavior unchanged

### Milestone 2 - Core modules under strict typing

- [x] harden:
  - `src/analysis/readme-generator.js`
  - `src/cli/app.js`
  - `src/cli/arg-parser.js`
  - `src/cli/formatters.js`
  - `src/context/noise-canceler.js`
  - `src/learning/mentor-loop.js`
  - `src/memory/teach-recall.ts`
  - `src/memory/engram-client.ts`
  - `src/memory/recall-queries.js`
- [x] eliminate the most fragile implicit `any` paths
- [x] widen strict typing to CLI orchestration and formatter edges
- [ ] move typed JS modules to publishable `.ts` build targets

### Milestone 3 - Real `.ts` migration

- [x] start real `.ts` migration with leaf modules (`src/security/secret-redaction.ts`, `src/io/text-file.ts`, `src/contracts/config-contracts.ts`, `src/io/config-file.ts`)
- [x] migrate scanner/ops modules to `.ts` track (`src/io/workspace-chunks.ts`, `src/system/project-ops.ts`) while preserving Node 20/22 source runtime compatibility
- [x] migrate CLI edge contracts/parsing to `.ts` track (`src/cli/arg-parser.ts`, `src/contracts/cli-contracts.ts`) for safer tool-facing interfaces
- [x] extract and migrate teach orchestration handler to `.ts` track (`src/cli/teach-command.ts`) to reduce `app.js` complexity
- [x] migrate recall query heuristics to `.ts` track (`src/memory/recall-queries.ts`) to keep memory strategy rules refactor-safe
- [x] migrate teach memory orchestration to `.ts` track (`src/memory/teach-recall.ts`, `src/memory/engram-auto-orchestrator.ts`) to reduce risk in retry/degraded recall logic
- [x] migrate Engram adapter to `.ts` track (`src/memory/engram-client.ts`) so command execution and parse normalization are type-safe
- [x] add build output strategy for publishable CLI use
- preserve current command behavior and benchmark outputs

## Done means

- typecheck covers the core, not only bootstrap
- refactors of scoring/packet/memory shape are safer
- CI fails on type regressions before runtime breaks

## Non-goals

- rewriting the whole repo to TS in one shot
- changing the product flow just to satisfy the compiler
