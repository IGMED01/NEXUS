# Roadmap

## Current status

The repository already has:

- context selection
- teaching packets
- Engram-backed memory recall and writes
- NEXUS processing/storage/guard foundations implemented
- NEXUS LLM layer + API/auth + orchestration pipeline base
- NEXUS sync/eval/versioning/observability quality base
- selector benchmark
- recall benchmark
- TypeScript backend vertical
- `doctor`, `init`, stable JSON contracts, and incremental typecheck

See `NEXUS-PLAN.md` for phase/capa checklist with dependencies and priorities.

## Roadmaps by section

- [Core TypeScript](./docs/roadmaps/core-typescript.md)
- [Memory and Engram](./docs/roadmaps/memory-and-engram.md)
- [CLI and Operability](./docs/roadmaps/cli-and-operability.md)
- [Privacy and Security](./docs/roadmaps/privacy-and-security.md)
- [Quality and Benchmarks](./docs/roadmaps/quality-and-benchmarks.md)
- [Open Source Adoption](./docs/roadmaps/open-source-adoption.md)

## Current next focus

1. strengthen shared core typing inside the current one-repo ecosystem
2. close FASE 4 polish items (SDK, OpenAPI, dashboard UI, full demo)
3. keep internal domain boundaries explicit before any future multi-repo extraction
4. migrate more core logic under strict type checks

## Non-goals for now

- browser UI
- splitting the system into multiple physical repos before contracts are stable
- multi-agent orchestration as the main path
- framework-specific adapters before the core is harder
