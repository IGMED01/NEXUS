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
```

## What NEXUS does today

- Context selection with noise suppression.
- Teaching packet generation tied to changed files and tests.
- Durable memory via Engram with resilient fallback.
- HTTP API + SDK + OpenAPI + demo UI.
- Guard, observability, versioning, and eval gates in CI.

## Docs

- [Docs index](docs/README.md)
- [NEXUS plan](docs/planning/nexus-plan.md)
- [NEXUS API guide](docs/nexus-api.md)
- [Integration guide](docs/integration.md)
- [Release checklist](docs/release-checklist.md)

## OSS

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Versioning](VERSIONING.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
