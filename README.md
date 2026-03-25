# NEXUS

[![CI](https://img.shields.io/github/actions/workflow/status/IGMED01/NEXUS/ci.yml?branch=main&label=CI)](https://github.com/IGMED01/NEXUS/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/IGMED01/NEXUS/codeql.yml?branch=main&label=CodeQL)](https://github.com/IGMED01/NEXUS/actions/workflows/codeql.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=nodedotjs&logoColor=white)
![NEXUS](https://img.shields.io/badge/platform-NEXUS-2563eb)

NEXUS is a CLI-first platform to **select context, teach from code changes, and persist durable memory** in one workflow.

## What NEXUS does today

- Selects high-signal context and suppresses noise (`select`).
- Builds teaching packets tied to real code and tests (`teach`).
- Recalls/saves durable memory via Engram with resilient fallback (`recall`, `remember`, `close`).
- Exposes HTTP API + SDK + OpenAPI + visual demo for operational use.
- Enforces security, observability, versioning, and quality gates in CI.

## Naming convention

- **NEXUS** = full platform (11 layers)
- **LCS** = context engine layer (`NEXUS:3`)
- **NEXUS:N** = layer reference (example: `NEXUS:6` = LLM layer)

---

## Installation

```bash
git clone https://github.com/IGMED01/NEXUS.git
cd NEXUS
npm install
npm run doctor:json
```

Minimum requirements:

- Node.js 20+
- Git
- Engram binary only if you want durable-memory commands without local fallback mode

---

## Quick start

### 1) Select context

```bash
node src/cli.js select \
  --workspace . \
  --focus "auth middleware request-boundary validation" \
  --format json
```

### 2) Generate teaching packet

```bash
node src/cli.js teach \
  --workspace . \
  --task "Harden auth middleware" \
  --objective "Teach request-boundary validation" \
  --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" \
  --format json
```

### 3) Run API demo

```bash
npm run api:nexus
# Open http://127.0.0.1:8787/api/demo
```

---

## API and SDK snapshot (today)

Main routes:

- `GET /api/health`
- `POST /api/ask`
- `POST /api/pipeline/run`
- `POST /api/sync`
- `GET /api/observability/dashboard`
- `POST /api/evals/domain-suite`
- `GET /api/openapi.json`
- `GET /api/demo`

Recent hardening already in place:

- Standard error envelope: `errorCode`, `requestId`, `details`
- Response header: `x-request-id`
- Pipeline traceability: `runId`, `summary`, `attemptTrace`

---

## Current maturity snapshot

| Area | Maturity |
|---|---:|
| Sync | 60% |
| Processing | 75% |
| Storage | 75% |
| LCS Core | 92% |
| Guard | 88% |
| Orchestration | 90% |
| LLM Layer | 65% |
| Evals | 85% |
| Observability | 90% |
| Versioning | 90% |
| Interface | 75% |

Interpretation: the core and ops layers are strong; LLM/platform expansion is still maturing.

---

## Repository structure (professional view)

NEXUS is currently **one repository** with five internal domains:

1. **Core** (`src/context`, `src/learning`, contracts/types)
2. **Memory + Sync** (`src/memory`, `src/sync`, integrations)
3. **Ops + Safety** (`src/security`, `src/observability`, CI scripts)
4. **Runtime** (CLI, orchestration, API, SDK, interface)
5. **Platform** (`docs`, `examples`, `benchmark`, `skills`)

Strategy today: modularize inside one repo first; split into multiple repos only when boundaries are truly stable.

---

## Documentation

- Docs index: [`docs/README.md`](docs/README.md)
- NEXUS plan: [`docs/planning/nexus-plan.md`](docs/planning/nexus-plan.md)
- NEXUS API guide: [`docs/nexus-api.md`](docs/nexus-api.md)
- Integration guide: [`docs/integration.md`](docs/integration.md)
- Evidence of value: [`docs/evidence-of-value.md`](docs/evidence-of-value.md)
- Release checklist: [`docs/release-checklist.md`](docs/release-checklist.md)

---

## OSS surfaces

- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security policy: [`SECURITY.md`](SECURITY.md)
- Versioning policy: [`VERSIONING.md`](VERSIONING.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT — see [`LICENSE`](LICENSE).
