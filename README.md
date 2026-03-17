# Learning Context System

This workspace bootstraps a system that teaches while it codes and reduces noise before information reaches a model context window.

## What this project is trying to solve

- Generate code and explanations in the same loop.
- Adapt the teaching style to the active language through skills.
- Preserve useful probability mass inside the context window by filtering noise, duplicates, and stale material.

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

## Project layout

- `AGENTS.md`: operating contract for future agents
- `benchmark/selector-benchmark.json`: fixed benchmark cases for context selection quality
- `docs/context-noise-cancellation.md`: design of the context filtering system
- `docs/benchmark.md`: benchmark method and metrics
- `docs/usage.md`: CLI usage and input contract
- `src/analysis/readme-generator.js`: generated learning README builder
- `src/context/noise-canceler.js`: prototype signal-over-noise selector
- `src/learning/mentor-loop.js`: learning packet builder
- `src/memory/engram-client.js`: local Engram adapter for recall and durable memory writes
- `src/cli.js`: local CLI entrypoint
- `skills/`: language-specific teaching skills

## Run

```bash
node test/run-tests.js
npm run benchmark
```

## Example usage

```bash
node src/cli.js select --input examples/auth-context.json --focus "jwt middleware expired session validation" --min-score 0.25 --format text
node src/cli.js teach --input examples/auth-context.json --task "Improve auth middleware" --objective "Teach why validation runs before route handlers" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --project learning-context-system --min-score 0.25 --format text
node src/cli.js readme --workspace . --focus "learning context cli noise cancellation" --output README.LEARN.md --format text
node src/cli.js recall --project learning-context-system --query "auth middleware" --type decision --scope project --limit 5 --format text
node src/cli.js remember --title "JWT order" --content "Validation runs before route handlers." --project learning-context-system --type decision --topic architecture/auth-order --format text
node src/cli.js close --summary "Integrated recall and remember commands." --learned "Context retrieval and durable memory are different layers." --next "Connect recall to the teaching flow." --project learning-context-system --format text
```

## Initial direction

The prototype is intentionally dependency-light and runs on plain Node so we can iterate even in a minimal local environment. The only external runtime it now leans on is a locally installed Engram binary for durable memory, and `teach` now uses that memory automatically before building the teaching packet with a smarter multi-query recall strategy.
