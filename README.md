# NEXUS

[![CI](https://img.shields.io/github/actions/workflow/status/IGMED01/NEXUS/ci.yml?branch=main&label=CI)](https://github.com/IGMED01/NEXUS/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/IGMED01/NEXUS/codeql.yml?branch=main&label=CodeQL)](https://github.com/IGMED01/NEXUS/actions/workflows/codeql.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=nodedotjs&logoColor=white)

CLI platform for **context selection, teaching packets, and durable memory**.

- **NEXUS** = complete platform (11 layers)
- **LCS** = context engine layer (`NEXUS:3`)

## Installation

```bash
git clone https://github.com/IGMED01/NEXUS.git
cd NEXUS
npm ci --ignore-scripts
npm run doctor:json
# strict production safety profile (plan gate + scope lock)
npm run doctor:json -- --config learning-context.config.production.json
```

## Quick start

```bash
# 1) Select high-signal context
node src/cli.js select --workspace . --focus "auth middleware validation" --format json

# 2) Build teaching packet from real code changes
node src/cli.js teach --workspace . --task "Harden auth middleware" --objective "Teach request-boundary validation" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --format json

# 3) Run API + visual demo
npm run api:nexus
# http://127.0.0.1:8787/api/demo

# 4) Open interactive shell (tabs: recall/teach/remember/doctor/select)
node src/cli.js shell --workspace . --project nexus
# menu controls: ↑/↓ move • Enter run • /skills skills manager • /menu toggle
# requires a real TTY terminal (not piped stdin)
# in Skills Manager, select a skill to open per-skill actions (preview, promote, archive)

# 5) Generate draft skills from repetitive shell tasks (interactive proposal)
npm run skills:auto

# 6) Promote healthy drafts to experimental when token/time/error thresholds pass
npm run skills:promote

# 7) Audit duplicates/similar skills installed in repo + system catalogs
npm run skills:doctor
# deterministic strict check (repo scope only)
npm run skills:doctor:strict
# extended strict audit (repo + system catalogs)
npm run skills:doctor:strict:full

# 8) End-to-end API smoke (remember -> recall -> chat -> ask -> guard)
npm run e2e:nexus
```

## Shell troubleshooting

- Run shell from repository root:
  - `cd NEXUS`
  - `node src/cli.js shell --workspace . --project nexus`
- If your terminal shows redraw loops, use safe render mode:
  - PowerShell: `$env:NEXUS_SHELL_RENDER_MODE='safe'`
  - Bash: `export NEXUS_SHELL_RENDER_MODE=safe`
- Recommended validation after install:
  - `npm run doctor && npm run skills:doctor`
- Write-mode commands (`remember`, `close`, `sync-knowledge`, `readme --output`, `ingest-security --output`) require:
  - `--plan-approved true`

## What NEXUS does today

- Context selection with noise suppression.
- Teaching packet generation tied to changed files and tests.
- Durable memory via Engram with resilient fallback.
- Internal SYNC runtime (detect → chunk → dedup → version → persist) via `src/sync`.
- HTTP API + SDK + OpenAPI + demo UI.
- Guard, observability, versioning, and eval gates in CI.

## Docs

- [Docs index](docs/README.md)
- [NEXUS plan](docs/planning/nexus-plan.md)
- [NEXUS API guide](docs/nexus-api.md)
- [Integration guide](docs/integration.md)
- [Skill auto-generator (MVP)](docs/skills-auto-generator.md)
- [Release checklist](docs/release-checklist.md)

## OSS

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Versioning](VERSIONING.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
