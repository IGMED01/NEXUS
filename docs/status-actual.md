# Estado actual del proyecto

_Ultima actualizacion: 25 de marzo de 2026_

## Resumen ejecutivo

Este ecosistema hoy es **un solo repositorio de NEXUS con cinco dominios internos**, no una suite multi-repo.

El repo esta en estado **operativo serio** para uso open source:

- CI estable en `main`
- CodeQL activo
- Dependabot habilitado
- secret scanning habilitado
- release publica actual: [`v0.2.1`](https://github.com/IGMED01/learning-context-system/releases/tag/v0.2.1)

## Que es realmente este ecosistema

Este repo combina cinco responsabilidades:

1. **Core**
   - seleccion de contexto
   - ranking y compresion
   - paquete pedagogico

2. **Memory + Sync**
   - recall de memoria durable
   - fallback local
   - sync opcional de conocimiento

3. **Ops + Safety**
   - observabilidad
   - guardrails
   - redaccion de secretos
   - quality gates
   - disciplina de release

4. **Runtime**
   - CLI
   - configuracion
   - ejecucion de comandos
   - flujo operativo

5. **Platform**
   - documentacion
   - ejemplos
   - benchmarks
   - skills

## Foto real de madurez

| Area | Madurez |
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

## Interpretacion correcta

- el **core** ya esta fuerte
- la **capa operativa** ya esta fuerte
- la base de **FASE 1, FASE 2 y buena parte de FASE 3** ya esta implementada
- quedan pendientes de cierre de producto: **SDK, OpenAPI, dashboard UI y hard-gate final en CI**

## Que ya esta cerrado

1. Contratos JSON estables (`schemaVersion: 1.0.0`) para la superficie CLI.
2. Benchmarks formales de seleccion, recall y vertical integrado.
3. Ingesta de findings de seguridad con gate de calidad.
4. Observabilidad con metricas de recall, seleccion, bloqueos y degradado.
5. Safety North Star baseline con bloqueos preventivos.
6. Modo degradado y fallback local para memoria.
7. Sync de conocimiento de equipo hacia Notion.
8. Disciplina de release y checks de CI endurecidos.

## Decision de repositorio

La decision correcta hoy es:

- **mantener un solo repo**
- **organizarlo por dominios internos**
- **extraer repos fisicos solo mas adelante si las fronteras se estabilizan**

No conviene abrir varios repos ahora porque:

- muchas piezas todavia cambian juntas
- el costo de versionado y CI cruzado seria alto
- primero conviene modularizar dentro de NEXUS (manteniendo LCS como capa `NEXUS:3`) y despues extraer

Ver `docs/repo-split-5-repos.md`.

## Snapshot operativo

- `main` es la base canonica
- el repo sigue siendo el centro del ecosistema
- SYNC operativo canonico: `src/sync` dentro de NEXUS (`docs/sync-ownership.md`)
- la arquitectura actual es modular, pero no fragmentada
- el estado real no es “muchos productos”; es “un sistema con dominios claros”
