# NEXUS — Network of EXpertise Unified System

## Arquitectura de 11 Capas

> **LCS** = Motor de contexto (cerebro)
> **NEXUS** = Plataforma completa (las 11 capas)

## Tabla maestra de arquitectura

### Convención oficial

| Referencia | Significa |
|------------|-----------|
| `NEXUS` | La plataforma completa (11 capas) |
| `LCS` | El motor de contexto |
| `NEXUS:N` | Referencia directa a una capa específica |

### Mapa oficial de capas

| ID | Nombre | Rol real en NEXUS |
|---|---|---|
| `NEXUS:0` | SYNC | Sincronización de conocimiento, cambios y fuentes externas |
| `NEXUS:1` | PROCESSING | Procesamiento, parsing, chunking y metadata |
| `NEXUS:2` | STORAGE | Persistencia, índices y retrieval base |
| `NEXUS:3` | LCS CORE | Motor de contexto: selección, ranking, compresión y teaching packet |
| `NEXUS:4` | GUARD | Guardrails de entrada y salida |
| `NEXUS:5` | ORCHESTRATION | Flujos, pipelines y ejecución coordinada |
| `NEXUS:6` | LLM LAYER | Providers, prompts, inyección de contexto y parsing de respuesta |
| `NEXUS:7` | EVALS | Evaluación de calidad y gates de decisión |
| `NEXUS:8` | OBSERVABILITY | Métricas, trazas, dashboarding y diagnóstico |
| `NEXUS:9` | VERSIONING | Versionado de prompts, snapshots y rollback |
| `NEXUS:10` | INTERFACE | CLI, API, demo y superficie de uso |

### Relación entre NEXUS y LCS

- **NEXUS** = el sistema completo
- **LCS** = **`NEXUS:3`**
- LCS no reemplaza a NEXUS: es una de sus capas centrales

---

## Fases oficiales de ejecución

| Fase | Capas | Objetivo real |
|---|---|---|
| **FASE 1** | `NEXUS:1` + `NEXUS:2` + `NEXUS:4` | **Foundations** — procesamiento, storage y guard de output |
| **FASE 2** | `NEXUS:6` + `NEXUS:10` + `NEXUS:5` | **Intelligence** — LLM layer, auth/interface y orquestación real |
| **FASE 3** | `NEXUS:0` + `NEXUS:7` + `NEXUS:9` + `NEXUS:8` | **Quality** — sync, evals, versioning y observabilidad |
| **FASE 4** | `NEXUS:3` + `NEXUS:10` + `NEXUS:5` | **Polish** — plugins, demo completa, integración final y tests e2e |

### Lectura correcta de las fases

- **FASE 1** construye la base del sistema
- **FASE 2** habilita respuestas reales y ejecución útil
- **FASE 3** endurece la calidad operacional
- **FASE 4** pule la experiencia completa

### Nota sobre capas repetidas

`NEXUS:10` y `NEXUS:5` aparecen en más de una fase a propósito:

- en una fase se implementa su base funcional
- en otra se cierran integración, endurecimiento y experiencia final

Eso significa:

- **FASE 2 = habilitación operativa**
- **FASE 4 = polish / cierre de producto**

---

## Ejecución operativa actual (actualizado: 26 marzo 2026)

### Avance por fase

- [x] **FASE 1 (NEXUS:1 + NEXUS:2 + NEXUS:4)**  
  Processing + storage + guard en runtime y en tests de regresión.
- [x] **FASE 2 (NEXUS:6 + NEXUS:10 + NEXUS:5)**  
  LLM/pipeline/API activos; fallback degradado para `/api/chat` y `/api/ask`; auth y OpenAPI operativos.
- [x] **FASE 3 (NEXUS:0 + NEXUS:7 + NEXUS:9 + NEXUS:8)**  
  SYNC interno consolidado, eval suites, versioning/rollback y observabilidad con dashboard/alerts.
- [~] **FASE 4 (NEXUS:3 + NEXUS:10 + NEXUS:5)**  
  LCS core estable + shell interactiva + demo web; quedan ajustes finos de UX y endurecimiento e2e para cierre final.

### Cierre incremental aplicado en esta iteración

- [x] Ingest por adapters integrado al pipeline default (`markdown`/`pdf`) para aligerar carga operativa.
- [x] Comparativa explícita de impacto de contexto (`withNexus` vs `withoutNexus`) en respuestas API.
- [x] Degradación segura de `/api/ask` cuando no hay proveedor LLM disponible (sin romper flujo).

---

## Estado Actual por Capa

| # | Capa | Completitud | Estado |
|---|------|-------------|--------|
| 0 | SYNC | 35% | Parcial — solo Notion, falta ChangeDetector |
| 1 | PROCESSING | 30% | Parcial — solo chunking básico, falta NLP |
| 2 | STORAGE | 45% | Local store + Engram, falta vector DB |
| 3 | LCS CORE | 90% | Noise-canceler, selector, mentor-loop |
| 4 | GUARD | 65% | Input guard completo, falta output guard |
| 5 | ORCHESTRATION | 80% | Workflows, conversations, actions, retry |
| 6 | LLM LAYER | 10% | No existe — Claude es el LLM externo |
| 7 | EVALS | 70% | Runner + scoring, falta CI gate real |
| 8 | OBSERVABILITY | 85% | Traces, métricas, alertas |
| 9 | VERSIONING | 85% | Prompts, snapshots, model-config, rollback |
| 10 | INTERFACE | 40% | CLI + API + demo básica, falta auth |

---

## Plan de Ejecución por Capa

### CAPA 0 — SYNC (35% → 80%)
**Qué falta:**
- [ ] `src/sync/change-detector.ts` — Detectar cambios en archivos del workspace (hash + mtime)
- [ ] `src/sync/version-tracker.ts` — Rastrear versiones de documentos ingestados
- [ ] `src/sync/sync-scheduler.ts` — Scheduler para re-sync periódico
- [ ] Ampliar `src/integrations/notion-sync.js` con paginación y delta sync
- [ ] API endpoints: `POST /api/sync`, `GET /api/sync/status`

**Dependencias:** Ninguna (puede ejecutarse independiente)
**Prioridad:** MEDIA

---

### CAPA 1 — PROCESSING (30% → 75%)
**Qué falta:**
- [x] `src/processing/structure-parser.js` — Detectar estructura de documentos (headings, sections)
- [x] `src/processing/entity-extractor.js` — Extraer entidades nombradas (personas, fechas, artículos, orgs)
- [x] `src/processing/metadata-tagger.js` — Tagging automático de chunks (tema, dominio, tipo)
- [x] `src/processing/chunker.js` — Chunking inteligente (por sección, no solo por líneas)
- [ ] Integrar con adapters existentes (markdown-adapter, pdf-adapter, source-adapter)

**Dependencias:** source-adapter, pdf-adapter (ya existen)
**Prioridad:** ALTA — mejora directamente la calidad de LCS

---

### CAPA 2 — STORAGE (45% → 75%)
**Qué falta:**
- [ ] `src/storage/vector-store.ts` — Interface para almacenamiento vectorial (embeddings)
- [x] `src/storage/bm25-index.js` — Índice BM25 para búsqueda léxica local
- [x] `src/storage/hybrid-retriever.js` — Combinar BM25 + keyword
- [x] `src/storage/chunk-repository.js` — CRUD unificado de chunks persistidos
- [ ] Migrar `local-memory-store.js` a usar el chunk-repository

**Dependencias:** PROCESSING (los chunks llegan del procesamiento)
**Prioridad:** ALTA — backbone de todo el recall

---

### CAPA 3 — LCS CORE (90% → 95%)
**Qué falta:**
- [ ] Integrar scoring con BM25/vector scores cuando estén disponibles
- [ ] Exponer hook para custom scorers (plugin de scoring)

**Dependencias:** STORAGE (para nuevos score signals)
**Prioridad:** BAJA — ya funciona bien

---

### CAPA 4 — GUARD (65% → 90%)
**Qué falta:**
- [x] `src/guard/output-guard.js` — Validar respuestas ANTES de enviarlas al usuario
- [x] `src/guard/output-auditor.js` — Log de respuestas bloqueadas/modificadas
- [x] `src/guard/compliance-checker.js` — Reglas de compliance (PII, datos sensibles en output)
- [ ] Regla de guard tipo `domain-scope` funcional (actualmente solo keyword-block y rate-limit)
- [ ] API endpoint: `POST /api/guard/output`

**Dependencias:** LCS CORE (necesita el output para validarlo)
**Prioridad:** ALTA — seguridad del sistema

---

### CAPA 5 — ORCHESTRATION (80% → 95%)
**Qué falta:**
- [ ] `src/orchestration/pipeline-builder.ts` — Construir pipelines dinámicos (ingest→process→store→recall)
- [ ] Conectar workflow-engine con los step executors reales (actualmente solo interfaz)
- [ ] Registrar executors default para cada WorkflowStepType
- [ ] Tests de integración de workflows end-to-end

**Dependencias:** Todas las capas anteriores (orquesta todo)
**Prioridad:** MEDIA

---

### CAPA 6 — LLM LAYER (10% → 70%)
**Qué falta:**
- [ ] `src/llm/provider.ts` — Interface LLMProvider con métodos generate/stream/embed
- [ ] `src/llm/claude-provider.ts` — Implementación para Claude API
- [ ] `src/llm/prompt-builder.ts` — Construir prompts con contexto inyectado
- [ ] `src/llm/context-injector.ts` — Inyectar chunks seleccionados en el prompt
- [ ] `src/llm/response-parser.ts` — Parsear y estructurar respuestas del LLM
- [ ] API endpoint: `POST /api/ask` (query completa end-to-end)
- [ ] Config en `learning-context.config.json` para LLM settings

**Dependencias:** LCS CORE + GUARD (contexto + validación)
**Prioridad:** CRÍTICA — sin esto no hay respuesta autónoma

---

### CAPA 7 — EVALS (70% → 90%)
**Qué falta:**
- [ ] `src/eval/consistency-scorer.ts` — Medir consistencia entre respuestas
- [ ] `src/eval/ci-gate.ts` — Gate real que bloquea deploys si score < threshold
- [ ] Más eval suites (no solo legal-basics)
- [ ] Integrar evals con el LLM layer cuando exista

**Dependencias:** LLM LAYER (para evaluar respuestas reales)
**Prioridad:** MEDIA

---

### CAPA 8 — OBSERVABILITY (85% → 95%)
**Qué falta:**
- [ ] `src/observability/dashboard-data.ts` — Agregar datos para dashboard UI
- [ ] Persistir métricas a disco (actualmente solo en memoria)
- [ ] Integrar traces con todos los flujos reales

**Dependencias:** Ninguna
**Prioridad:** BAJA

---

### CAPA 9 — VERSIONING (85% → 95%)
**Qué falta:**
- [ ] Conectar rollback-engine con evals reales (actualmente usa scores simulados)
- [ ] UI para comparar versiones de prompts
- [ ] Persistencia a disco de prompt versions (actualmente en memoria)

**Dependencias:** EVALS (para scores reales)
**Prioridad:** BAJA

---

### CAPA 10 — INTERFACE (40% → 75%)
**Qué falta:**
- [ ] `src/api/auth-middleware.ts` — Autenticación API key / JWT
- [ ] Mejorar `demo/index.html` con todas las rutas disponibles
- [ ] `src/api/server.ts` — Verificar que arranca correctamente
- [ ] SDK/client library para consumir la API programáticamente
- [ ] Documentación de API (OpenAPI spec o similar)

**Dependencias:** API (ya existe), AUTH (nuevo)
**Prioridad:** MEDIA

---

## Orden de ejecución recomendado

### FASE 1 — Foundations

1. `NEXUS:1` — PROCESSING
   - chunker
   - structure-parser
   - entity-extractor
2. `NEXUS:2` — STORAGE
   - chunk-repository
   - bm25-index
   - hybrid retrieval base
3. `NEXUS:4` — GUARD
   - output-guard
   - compliance-checker
   - output-auditor

### FASE 2 — Intelligence

1. `NEXUS:6` — LLM LAYER
   - provider
   - prompt-builder
   - context-injector
   - response-parser
2. `NEXUS:10` — INTERFACE
   - auth
   - API usable
   - surface real de consumo
3. `NEXUS:5` — ORCHESTRATION
   - executors reales
   - pipeline funcional de punta a punta

### FASE 3 — Quality

1. `NEXUS:0` — SYNC
   - change-detector
   - version-tracker
   - sync status
2. `NEXUS:7` — EVALS
   - consistency-scorer
   - ci-gate
   - suites nuevas
3. `NEXUS:9` — VERSIONING
   - persistencia
   - rollback real
4. `NEXUS:8` — OBSERVABILITY
   - persistencia de métricas
   - dashboard data
   - trazas completas

### FASE 4 — Polish

1. `NEXUS:3` — LCS CORE
   - plugin scorers
   - refinamiento del motor
2. `NEXUS:10` — INTERFACE
   - demo completa
   - OpenAPI
   - SDK
3. `NEXUS:5` — ORCHESTRATION
   - pipeline-builder
   - tests e2e
   - cierre de integración total

---

## Uso de la convención

- “avanza con `NEXUS:6`” = trabajar en **LLM Layer**
- “cerrar `NEXUS:4`” = cerrar **GUARD**
- “pulir `LCS`” = trabajar solo en **`NEXUS:3`**
