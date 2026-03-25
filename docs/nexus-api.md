# NEXUS API (NEXUS:10)

## Surface

The API now includes:

- `GET /api/health`
- `GET /api/openapi.json`
- `GET /api/demo` (visual dashboard + playground)
- `GET /api/sync/status`
- `POST /api/sync`
- `POST /api/guard/output`
- `POST /api/pipeline/run`
- `POST /api/ask`
- `GET /api/observability/dashboard`
- `GET /api/versioning/prompts`
- `POST /api/versioning/prompts`
- `GET /api/versioning/compare`

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
const dashboard = await client.observabilityDashboard({ topCommands: 8 });
const version = await client.savePromptVersion({
  promptKey: "ask/default",
  content: "Prompt baseline"
});
```

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