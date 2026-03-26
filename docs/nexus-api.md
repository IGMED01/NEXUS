# NEXUS API (NEXUS:10)

## Surface

The API now includes:

- `GET /api/health`
- `GET /api/openapi.json`
- `GET /api/demo` (visual dashboard + playground)
- `GET /api/routes`
- `GET /api/metrics`
- `GET /api/guard/policies`
- `GET /api/sync/status`
- `GET /api/sync/drift`
- `POST /api/sync`
- `POST /api/remember`
- `POST /api/recall`
- `POST /api/chat`
- `POST /api/guard/output`
- `POST /api/pipeline/run`
- `POST /api/ask`
- `GET /api/observability/dashboard`
- `GET /api/observability/alerts`
- `POST /api/evals/domain-suite`
- `GET /api/versioning/prompts`
- `POST /api/versioning/prompts`
- `GET /api/versioning/compare`
- `POST /api/versioning/rollback-plan`

Auth uses `x-api-key` or `Authorization: Bearer <jwt>` when enabled.

## OpenAPI

Export static spec:

```bash
npm run openapi:export
```

Generated file: `docs/openapi/nexus-openapi.json`.

Live spec from running server:

```bash
curl http://127.0.0.1:8787/api/openapi.json
```

## SDK client

`src/sdk/nexus-api-client.js`

```js
import { createNexusApiClient } from "../src/sdk/nexus-api-client.js";

const client = createNexusApiClient({
  baseUrl: "http://127.0.0.1:8787",
  apiKey: process.env.NEXUS_API_KEY
});

const health = await client.health();
const guardProfiles = await client.guardPolicies();
const syncDrift = await client.syncDrift();
const dashboard = await client.observabilityDashboard({ topCommands: 8 });
const alerts = await client.observabilityAlerts({ minRuns: 20 });
const evalReport = await client.runDomainEvalSuite({
  suitePath: "benchmark/domain-eval-suite.json"
});
const version = await client.savePromptVersion({
  promptKey: "ask/default",
  content: "Prompt baseline"
});
const rollback = await client.buildRollbackPlan({
  promptKey: "ask/default",
  evalScoresByVersion: {
    "ask/default@v1": 0.81,
    "ask/default@v2": 0.62
  }
});
```

## Domain evals endpoint

Run the default suite:

```bash
curl -X POST http://127.0.0.1:8787/api/evals/domain-suite \
  -H "x-api-key: <key>" \
  -H "content-type: application/json" \
  -d '{}'
```

You can also send an inline suite payload under `suite`.

## Visual dashboard / demo

Launch API:

```bash
npm run api:nexus
```

Open:

- `http://127.0.0.1:8787/api/demo`

This UI covers:

- NEXUS:8 visual observability dashboard
- NEXUS:9 prompt version compare flow
- NEXUS:10 ask/sync/openapi playground

## Guard policy profiles

Use `guardPolicyProfile` in `POST /api/ask` or `POST /api/guard/output`:

- `default`
- `security_strict`
- `public_docs`
- `observability_safe`

List them with:

```bash
curl http://127.0.0.1:8787/api/guard/policies
```

## Fallback and drift hardening (operational)

- `POST /api/ask` now accepts optional `attemptTimeoutMs` to cap each provider attempt before moving to fallback providers.
- `POST /api/ask` and `POST /api/chat` now include `impact` in response:
  - `withoutNexus` (raw chunks/tokens),
  - `withNexus` (selected chunks/tokens),
  - `suppressed`,
  - `savings.percent`.
- `POST /api/ask` now degrades gracefully when provider is unavailable (status `degraded`, offline fallback content).
- `POST /api/ask` response now includes `fallback.summary` with:
  - `attemptsCount`
  - `failedAttempts`
  - `totalDurationMs`
  - token totals (`totalInputTokens`, `totalOutputTokens`, `totalTokens`)
  - `successfulProvider`

- `GET /api/sync/drift` now accepts optional query parameters:
  - `warningRatio`
  - `criticalRatio`
  - `spikeMultiplier`
  - `baselineWindow`

The drift report includes `thresholds`, per-run drift level (`stable|warning|critical`), and spike detection metadata.

## End-to-end smoke (FASE 4)

```bash
npm run e2e:nexus
```

Covers: `remember -> recall -> chat -> ask -> guard` with impact metrics assertion.

## Error contract (NEXUS:10 hardening)

Error responses now follow a consistent envelope:

```json
{
  "status": "error",
  "error": "Human-readable message",
  "errorCode": "machine_readable_code",
  "requestId": "req-...",
  "details": {}
}
```

- Response header `x-request-id` is always included.
- SDK errors now expose `errorCode`, `requestId`, and `apiMessage`.

## Pipeline traceability (NEXUS:5 hardening)

`POST /api/pipeline/run` now returns richer trace metadata:

- `runId`
- `startedAt` / `finishedAt` / `durationMs`
- `summary` (`okSteps`, `failedSteps`, `skippedSteps`, etc.)
- per-step `attemptTrace` for retry visibility
