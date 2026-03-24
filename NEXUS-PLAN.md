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

### NEXUS:1 — PROCESSING
**Prioridad:** Alta

- [x] `src/processing/structure-parser.js`
- [x] `src/processing/entity-extractor.js`
- [x] `src/processing/metadata-tagger.js`
- [x] `src/processing/chunker.js`
- [x] Integracion en adapters de workspace (`src/io/workspace-chunks.js/.ts`)

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
- [ ] ajuste fino de pesos por benchmark de verticales reales

### NEXUS:4 — GUARD
**Prioridad:** Alta

- [x] `src/guard/output-guard.js`
- [x] `src/guard/output-auditor.js`
- [x] `src/guard/compliance-checker.js`
- [x] regla `domain-scope` funcional
- [x] API: `POST /api/guard/output`

### NEXUS:5 — ORCHESTRATION
**Prioridad:** Media

- [x] `src/orchestration/pipeline-builder.js`
- [x] `src/orchestration/default-executors.js` conectado a pasos reales
- [x] pipeline default ingest → process → store → recall
- [x] test de integracion end-to-end (pipeline + API route)

### NEXUS:6 — LLM LAYER
**Prioridad:** Critica

- [x] `src/llm/provider.js`
- [x] `src/llm/claude-provider.js`
- [x] `src/llm/prompt-builder.js`
- [x] `src/llm/context-injector.js`
- [x] `src/llm/response-parser.js`
- [x] API: `POST /api/ask`
- [x] config LLM en `learning-context.config.json` + contratos

### NEXUS:7 — EVALS
**Prioridad:** Media

- [x] `src/eval/consistency-scorer.js`
- [x] `src/eval/ci-gate.js`
- [x] tests de gate/consistencia en suite portable
- [ ] ampliar suites de eval por dominio
- [ ] conectar gate a deploy CI como bloqueo obligatorio

### NEXUS:8 — OBSERVABILITY
**Prioridad:** Baja

- [x] persistencia de metricas a disco (`src/observability/metrics-store.js`)
- [x] `src/observability/dashboard-data.js`
- [x] cobertura de trazas para nuevos flujos API/pipeline en tests
- [ ] dashboard UI visual

### NEXUS:9 — VERSIONING
**Prioridad:** Baja

- [x] persistencia de versiones de prompts (`src/versioning/prompt-version-store.js`)
- [x] `src/versioning/rollback-engine.js` con scores reales de eval
- [ ] UI comparativa de versiones

### NEXUS:10 — INTERFACE
**Prioridad:** Media

- [x] `src/api/auth-middleware.js` (API key/JWT)
- [x] `src/api/server.js`
- [x] script `npm run api:nexus` (`scripts/run-nexus-api.js`)
- [x] endpoints operativos (`/api/health`, `/api/sync`, `/api/guard/output`, `/api/pipeline/run`, `/api/ask`)
- [ ] SDK cliente de API
- [ ] OpenAPI spec
- [ ] demo UI completa

---

## Estado de fase (ejecucion)

- **FASE 1 (Foundations):** `COMPLETADA`
- **FASE 2 (Intelligence):** `BASE COMPLETADA`, faltan SDK/OpenAPI/demo
- **FASE 3 (Quality):** `AVANZADA`, faltan gate obligatorio en CI y dashboard visual
- **FASE 4 (Polish):** `EN CURSO`, enfocar en UX final + artefactos de consumo externo

---

## Validaciones de cierre (operativas)

- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run build:smoke`
- [x] `npm run release:check`
