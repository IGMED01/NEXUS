# NEXUS Documentation Index

Central index for all repository documentation.

## Start here

1. [README](../README.md) — product overview, architecture map, quick start
2. [NEXUS Plan](./planning/nexus-plan.md) — phase/layer checklist and execution status
3. [Planning index](./planning/roadmap.md) — current priorities by section
4. [NEXUS API guide](./nexus-api.md) — API, OpenAPI, SDK, and demo UI
5. [Usage guide](./usage.md) — CLI contracts and command workflows

## Architecture and operations

- [Context noise cancellation](./context-noise-cancellation.md)
- [Security model](./security-model.md)
- [Ops runbook](./ops-runbook.md)
- [SYNC ownership](./sync-ownership.md)
- [Benchmark strategy](./benchmark.md)
- [Status actual](./status-actual.md)
- [NEXUS:3 (LCS) scope](./lcs-scope.md)

## NEXUS by phase

### FASE 1 — Foundations

- Processing / storage / guard implementation details in `src/processing`, `src/storage`, `src/guard`
- Foundations stress benchmark: `npm run benchmark:foundations`

### FASE 2 — Intelligence

- LLM + orchestration + interface (SDK/OpenAPI/demo)
- See [NEXUS API guide](./nexus-api.md)

### FASE 3 — Quality

- Domain eval gate: `npm run eval:domains`
- Selector tuning: `npm run benchmark:tune`
- Observability alerts endpoint: `GET /api/observability/alerts`

### FASE 4 — Polish

- [Zero-to-demo guide](./zero-to-demo.md)
- [Release hardening checklist](./release-checklist.md)
- API smoke e2e (remember→recall→chat→ask→guard): `npm run e2e:nexus`

## Guides and governance

- [Integration guide](./integration.md)
- [Skill auto-generator (MVP)](./skills-auto-generator.md)
- [Repo split rationale](./repo-split-5-repos.md)
- [Repo analysis](./repo-analysis.md)
- [Skills governance](./skills-governance.md)
- [ADR: tight window rebalance](./adr-tight-window-rebalance.md)

## Roadmaps

- [Roadmaps index](./roadmaps)
- [Production readiness matrix](./roadmaps/production-readiness-matrix.md)
- [Quality and benchmarks](./roadmaps/quality-and-benchmarks.md)
- [Core TypeScript](./roadmaps/core-typescript.md)
- [Memory and Engram](./roadmaps/memory-and-engram.md)
- [CLI and operability](./roadmaps/cli-and-operability.md)
- [Privacy and security](./roadmaps/privacy-and-security.md)
- [Open-source adoption](./roadmaps/open-source-adoption.md)
