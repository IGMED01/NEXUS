# Memory and Engram Roadmap

## Goal

Use Engram as a durable memory layer while keeping this project responsible for context shaping and teaching.

## Scope

- recall flow
- durable writes
- degraded mode
- historical memory quality
- stable integration contracts

## Current state

- recall, remember, and close exist
- `teach` already consumes recalled memory automatically
- degraded mode exists when Engram fails
- initial skill contract exists at `skills/engram-auto-orchestrator/SKILL.md` to standardize automatic recall/save behavior
- initial runtime orchestration exists through `src/memory/engram-auto-orchestrator.js` with config-driven auto recall and optional auto remember
- TypeScript build-track sources now mirror memory orchestration logic in `src/memory/teach-recall.ts` and `src/memory/engram-auto-orchestrator.ts`
- Engram adapter also has a `.ts` build-track source in `src/memory/engram-client.ts`
- auto-remember now sanitizes sensitive paths and redacts secret-like fragments before persisting

## Milestones

### Milestone 1 - Better memory contracts

- stop depending on human-shaped parsing where a structured path exists
- tighten memory result shapes
- reduce ambiguity between technical memory and narrative memory

### Milestone 2 - Better historical pedagogy

- distinguish architecture / decision / pattern / bugfix in output
- surface memory intent more clearly in `teach`
- show why a memory was selected

### Milestone 3 - Recovery and lifecycle

- stronger session semantics
- clearer recovery after compacted context
- better operator guidance when Engram is unavailable or stale

### Milestone 4 - Skill-driven automation

- [x] wire skill rules to operational commands/scripts so automatic Engram usage is consistent
- [x] add tests that assert auto recall/save guardrails from the skill contract

## Done means

- memory is useful, explainable, and never silently dominates code context
- failures degrade clearly instead of confusing the user

## Non-goals

- trying to replace Engram as a pure memory product
- storing raw chat history as the primary memory model
