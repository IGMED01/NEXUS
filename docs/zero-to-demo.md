# NEXUS Zero-to-Demo (E2E)

Goal: go from clean checkout to a live NEXUS demo with API, dashboard, versioning, and ask flow.

## 1) Bootstrap

```bash
npm ci --ignore-scripts
npm run doctor
npm run init:config
```

## 2) Quality baseline

```bash
npm test
npm run typecheck
npm run build
npm run build:smoke
npm run eval:domains
```

## 3) API + demo UI

```bash
npm run api:nexus
```

Open:

- `http://127.0.0.1:8787/api/demo`
- `http://127.0.0.1:8787/api/openapi.json`

## 4) Validate key flows in demo UI

- Health check (`/api/health`)
- Observability dashboard (`/api/observability/dashboard`)
- Save/list/compare versions (`/api/versioning/*`)
- Ask flow with guard (`/api/ask`)

## 5) Optional API checks from terminal

```bash
curl http://127.0.0.1:8787/api/guard/policies
curl -H "x-api-key: <key>" http://127.0.0.1:8787/api/sync/drift
curl -H "x-api-key: <key>" "http://127.0.0.1:8787/api/observability/alerts?minRuns=20"
```

## 6) Packaging/release discipline

```bash
npm run pack:check
npm run release:check
npm run openapi:export
```

## Done criteria

- All quality gates pass
- Demo UI renders and can execute ask/versioning/dashboard flows
- OpenAPI is exportable and reachable from API endpoint
- Domain eval gate is green
