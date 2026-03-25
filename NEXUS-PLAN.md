# NEXUS-PLAN.md

## Convencion oficial

- **NEXUS** = plataforma completa (11 capas)
- **LCS** = motor de contexto (`NEXUS:3`)
- **NEXUS:N** = referencia directa por capa

## Fases de ejecucion

| Fase | Capas | Objetivo |
|---|---|---|
| **FASE 1** | `NEXUS:1` + `NEXUS:2` + `NEXUS:4` | Foundations |
| **FASE 2** | `NEXUS:6` + `NEXUS:10` + `NEXUS:5` | Intelligence |
| **FASE 3** | `NEXUS:0` + `NEXUS:7` + `NEXUS:9` + `NEXUS:8` | Quality |
| **FASE 4** | `NEXUS:3` + `NEXUS:10` + `NEXUS:5` | Polish |

---

## Checklist operativo por capa

### NEXUS:0 — SYNC
**Prioridad:** Media

- [x] `src/sync/change-detector.js` (hash + mtime)
- [x] `src/sync/version-tracker.js` (versionado de documentos)
- [x] `src/sync/sync-scheduler.js` (scheduler periodico)
- [x] `src/integrations/notion-sync.js` con `listChildren` (paginacion) y `appendKnowledgeEntryDelta` (delta sync)
- [x] API: `POST /api/sync`
- [x] API: `GET /api/sync/status`
- [x] monitor de drift entre corridas (`src/sync/drift-monitor.js`, `GET /api/sync/drift`)
- [x] clasificacion operativa de drift por niveles (`stable|warning|critical`) con deteccion de spike y umbrales configurables por query

### NEXUS:1 — PROCESSING
**Prioridad:** Alta

- [x] `src/processing/structure-parser.js`
- [x] `src/processing/entity-extractor.js`
- [x] `src/processing/metadata-tagger.js`
- [x] `src/processing/chunker.js`
- [x] Integracion en adapters de workspace (`src/io/workspace-chunks.js/.ts`)
- [x] stress benchmark de foundations (`npm run benchmark:foundations`)

### NEXUS:2 — STORAGE
**Prioridad:** Alta

- [x] `src/storage/chunk-repository.js`
- [x] `src/storage/bm25-index.js`
- [x] `src/storage/hybrid-retriever.js`
- [x] `src/storage/vector-store.ts` (interface + in-memory adapter)
- [x] `src/memory/local-memory-store.js` migrado a `chunk-repository`

### NEXUS:3 — LCS CORE
**Prioridad:** Baja

- [x] scoring integrado con señales de retrieval (`retrievalScore` + `vectorScore`)
- [x] hook para custom scorers (`SelectionOptions.customScorers`)
- [x] ajuste fino de pesos por benchmark de verticales reales (`benchmark/run-weight-tuning.js`, perfiles `baseline` vs `vertical-tuned`)

### NEXUS:4 — GUARD
**Prioridad:** Alta

- [x] `src/guard/output-guard.js`
- [x] `src/guard/output-auditor.js`
- [x] `src/guard/compliance-checker.js`
- [x] regla `domain-scope` funcional
- [x] API: `POST /api/guard/output`
- [x] perfiles de politica por dominio (`src/guard/domain-policy-profiles.js`, `GET /api/guard/policies`)

### NEXUS:5 — ORCHESTRATION
**Prioridad:** Media

- [x] `src/orchestration/pipeline-builder.js`
- [x] `src/orchestration/default-executors.js` conectado a pasos reales
- [x] pipeline default ingest → process → store → recall
- [x] test de integracion end-to-end (pipeline + API route)
- [x] recuperacion por retries en pasos (`retryAttempts`, `retryDelayMs` en pipeline builder)

### NEXUS:6 — LLM LAYER
**Prioridad:** Critica

- [x] `src/llm/provider.js`
- [x] `src/llm/claude-provider.js`
- [x] `src/llm/prompt-builder.js`
- [x] `src/llm/context-injector.js`
- [x] `src/llm/response-parser.js`
- [x] API: `POST /api/ask`
- [x] config LLM en `learning-context.config.json` + contratos
- [x] fallback multi-provider (`generateWithProviderFallback`, `fallbackProviders` en `/api/ask`)
- [x] hardening de fallback con timeout por intento (`attemptTimeoutMs`) y telemetria de latencia/tokens por intento (`fallback.summary`)

### NEXUS:7 — EVALS
**Prioridad:** Media

- [x] `src/eval/consistency-scorer.js`
- [x] `src/eval/ci-gate.js`
- [x] tests de gate/consistencia en suite portable
- [x] ampliar suites de eval por dominio (`src/eval/domain-eval-suite.js` + `benchmark/domain-eval-suite.json`)
- [x] conectar gate a deploy CI como bloqueo obligatorio (`npm run eval:domains` en `.github/workflows/ci.yml`)

### NEXUS:8 — OBSERVABILITY
**Prioridad:** Baja

- [x] persistencia de metricas a disco (`src/observability/metrics-store.js`)
- [x] `src/observability/dashboard-data.js`
- [x] cobertura de trazas para nuevos flujos API/pipeline en tests
- [x] dashboard UI visual (`GET /api/demo` con panel de observabilidad)
- [x] alertas operativas (`src/observability/alert-engine.js`, `GET /api/observability/alerts`)

### NEXUS:9 — VERSIONING
**Prioridad:** Baja

- [x] persistencia de versiones de prompts (`src/versioning/prompt-version-store.js`)
- [x] `src/versioning/rollback-engine.js` con scores reales de eval
- [x] UI comparativa de versiones (`/api/demo` + endpoints `/api/versioning/*`)
- [x] politica de rollback (`src/versioning/rollback-policy.js`, `POST /api/versioning/rollback-plan`)

### NEXUS:10 — INTERFACE
**Prioridad:** Media

- [x] `src/api/auth-middleware.js` (API key/JWT)
- [x] `src/api/server.js`
- [x] script `npm run api:nexus` (`scripts/run-nexus-api.js`)
- [x] endpoints operativos (`/api/health`, `/api/sync`, `/api/guard/output`, `/api/pipeline/run`, `/api/ask`)
- [x] SDK cliente de API (`src/sdk/nexus-api-client.js`)
- [x] OpenAPI spec (`src/interface/nexus-openapi.js`, `docs/openapi/nexus-openapi.json`)
- [x] demo UI completa (`/api/demo`, dashboard + versioning + ask playground)
- [x] surface profesional unificada (openapi + sdk + guard profiles + drift + alerts + rollback plan)

---

## Estado de fase (ejecucion)

- **FASE 1 (Foundations):** `COMPLETADA + HARDENING`
- **FASE 2 (Intelligence):** `COMPLETADA + HARDENING`
- **FASE 3 (Quality):** `COMPLETADA + HARDENING`
- **FASE 4 (Polish):** `COMPLETADA + HARDENING`

---

## Validaciones de cierre (operativas)

- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run build:smoke`
- [x] `npm run release:check`
- [x] `npm run eval:domains`
- [x] `npm run benchmark:tune`
- [x] `npm run benchmark:foundations`
