# NEXUS

[![CI](https://img.shields.io/github/actions/workflow/status/IGMED01/NEXUS/ci.yml?branch=main&label=CI)](https://github.com/IGMED01/NEXUS/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/IGMED01/NEXUS/codeql.yml?branch=main&label=CodeQL)](https://github.com/IGMED01/NEXUS/actions/workflows/codeql.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=nodedotjs&logoColor=white)
![NEXUS](https://img.shields.io/badge/platform-NEXUS-2563eb)

NEXUS es una plataforma CLI-first para **seleccionar contexto, enseñar desde cambios de código y persistir memoria durable** en un solo flujo.

## Qué hace NEXUS hoy

- Selecciona contexto de alta señal y suprime ruido (`select`).
- Genera paquetes de enseñanza ligados a código y tests reales (`teach`).
- Recupera/guarda memoria durable con Engram + fallback resiliente (`recall`, `remember`, `close`).
- Expone API HTTP + SDK + OpenAPI + demo visual para uso operativo.
- Aplica seguridad, observabilidad, versionado y quality gates en CI.

## Convención de nombres

- **NEXUS** = plataforma completa (11 capas)
- **LCS** = motor de contexto (`NEXUS:3`)
- **NEXUS:N** = referencia de capa (ejemplo: `NEXUS:6` = LLM layer)

---

## Instalación

```bash
git clone https://github.com/IGMED01/NEXUS.git
cd NEXUS
npm ci --ignore-scripts
npm run doctor:json
```

Requisitos mínimos:

- Node.js 20+
- Git
- Binario de Engram solo si quieres memoria durable sin modo fallback local

---

## Inicio rápido

### 1) Seleccionar contexto

```bash
node src/cli.js select \
  --workspace . \
  --focus "auth middleware request-boundary validation" \
  --format json
```

### 2) Generar paquete de enseñanza

```bash
node src/cli.js teach \
  --workspace . \
  --task "Harden auth middleware" \
  --objective "Teach request-boundary validation" \
  --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" \
  --format json
```

### 3) Levantar demo API

```bash
npm run api:nexus
# Abrir http://127.0.0.1:8787/api/demo
```

---

## API y SDK (estado actual)

Rutas principales:

- `GET /api/health`
- `POST /api/ask`
- `POST /api/pipeline/run`
- `POST /api/sync`
- `GET /api/observability/dashboard`
- `POST /api/evals/domain-suite`
- `GET /api/openapi.json`
- `GET /api/demo`

Hardening ya implementado:

- Contrato de error estándar: `errorCode`, `requestId`, `details`
- Header de respuesta: `x-request-id`
- Trazabilidad de pipeline: `runId`, `summary`, `attemptTrace`

---

## Snapshot de madurez actual

| Área | Madurez |
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

Lectura rápida: el core y la capa operativa están fuertes; la expansión LLM/platform sigue madurando.

---

## Estructura del repositorio (visión profesional)

NEXUS hoy es **un solo repositorio** con cinco dominios internos:

1. **Core** (`src/context`, `src/learning`, contratos/tipos)
2. **Memory + Sync** (`src/memory`, `src/sync`, integraciones)
3. **Ops + Safety** (`src/security`, `src/observability`, scripts de CI)
4. **Runtime** (CLI, orquestación, API, SDK, interfaz)
5. **Platform** (`docs`, `examples`, `benchmark`, `skills`)

Estrategia actual: modularizar primero dentro de un repo; extraer a multi-repo solo cuando las fronteras estén realmente estables.

---

## Documentación

- Índice de docs: [`docs/README.md`](docs/README.md)
- Plan NEXUS: [`docs/planning/nexus-plan.md`](docs/planning/nexus-plan.md)
- Guía API NEXUS: [`docs/nexus-api.md`](docs/nexus-api.md)
- Guía de integración: [`docs/integration.md`](docs/integration.md)
- Evidencia de valor: [`docs/evidence-of-value.md`](docs/evidence-of-value.md)
- Checklist de release: [`docs/release-checklist.md`](docs/release-checklist.md)

---

## Superficies OSS

- Contribución: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Política de seguridad: [`SECURITY.md`](SECURITY.md)
- Política de versionado: [`VERSIONING.md`](VERSIONING.md)
- Historial de cambios: [`CHANGELOG.md`](CHANGELOG.md)

## Licencia

MIT — ver [`LICENSE`](LICENSE).
