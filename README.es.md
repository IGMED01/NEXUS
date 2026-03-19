# Learning Context System - Resumen en espanol

Learning Context System es una CLI experimental para **programar, ensenar y controlar contexto al mismo tiempo**.

## Que hace este proyecto

Este repo hace tres cosas juntas:

1. **selecciona contexto util**
2. **explica el codigo y el cambio**
3. **recuerda decisiones duraderas**

Ademas, ya puede sincronizar aprendizajes de PR mergeados hacia Notion como capa opcional de conocimiento de equipo.

La idea central es simple:

- no mandar todo al modelo
- filtrar ruido antes de construir el contexto
- ensenar sobre el codigo mientras se trabaja
- mantener la memoria de largo plazo separada del contexto inmediato

## Que problema intenta resolver

Cuando un asistente de codigo recibe demasiado material:

- entra ruido
- se mezclan logs, chat y documentacion irrelevante
- baja la calidad de la respuesta
- se pierde valor pedagogico

Este proyecto intenta resolver eso con tres capas:

1. **selector de contexto**: decide que merece entrar
2. **capa pedagogica**: ordena el material para ensenar
3. **memoria durable**: recupera decisiones utiles de sesiones anteriores

## Que usamos de Engram y para que

Usamos **[Engram](https://github.com/Gentleman-Programming/engram)** de Gentleman-Programming **unicamente para la capa de memoria durable**.

En este repo, Engram se usa solo para:

- guardar memorias importantes del proyecto
- recuperar decisiones y resumenes previos
- separar la memoria historica del contexto actual

Engram **no** se usa aqui para:

- generar codigo
- rankear chunks del selector
- construir la parte pedagogica
- reemplazar la logica principal de la CLI

## Lenguajes usados en este repositorio

Este repo **no es solo JavaScript**.

Hoy usa:

- **JavaScript (ESM)** para la CLI principal, el selector, el recall y la capa pedagógica
- **TypeScript** en el vertical real de backend dentro de `examples/typescript-backend/`
- **Markdown** para documentación, contratos de agentes y skills
- **JSON** para fixtures, benchmarks, manifiestos y entradas estructuradas
- **YAML** para la CI de GitHub Actions

## Runtimes y dependencias

### Runtime principal

- **Node.js** es el runtime requerido para la CLI principal
- **Engram** es el runtime externo usado solo para memoria durable en `recall`, `remember` y `close`

### Dependencias del paquete raíz

El paquete raíz fue dejado **sin dependencias npm externas de runtime**.

Eso es intencional:

- menos fricción de instalación
- superficie de dependencias más chica
- iteración local más simple

### Dependencias del vertical TypeScript

El vertical `examples/typescript-backend/` usa:

#### Dependencia de runtime

- `zod`

#### Dependencias de desarrollo

- `typescript`
- `vitest`
- `@types/node`

### Herramientas usadas en el repo

- **GitHub Actions** para CI
- **Git** para control de versiones
- **Engram** solo para memoria durable

## Creditos y referencias

Este repositorio fue implementado como trabajo original, pero deja explicitas las referencias externas que inspiraron partes concretas de la arquitectura.

- **[Engram](https://github.com/Gentleman-Programming/engram)** de Gentleman-Programming: referencia y runtime local solo para persistencia y recall de memoria durable
- **[gentleman-architecture-agents](https://github.com/Gentleman-Programming/gentleman-architecture-agents)**: referencia para contratos de agentes, disciplina de alcance y estructura de `AGENTS.md`
- **[Gentle-Learning](https://github.com/Gentleman-Programming/Gentle-Learning)**: referencia para el enfoque pedagogico y el flujo de aprendizaje

Estos proyectos aparecen como creditos e inspiracion arquitectonica. No deben figurar como contributors de este repo salvo que hagan commits aqui.

## Que no es este proyecto

No es todavia:

- un framework maduro
- una plataforma multiagente cerrada
- un producto terminado

Si es hoy:

- un prototipo serio
- una herramienta local usable
- un experimento medible con benchmarks

## Mapa rapido del repo

- `README.md`: overview en ingles
- `README.es.md`: resumen explicito en espanol
- `AGENTS.md`: contrato operativo del proyecto
- `CHANGELOG.md`: historial de cambios de cada release
- `docs/repo-analysis.md`: por que se eligio Engram como referencia principal
- `docs/context-noise-cancellation.md`: diseno del filtro de contexto
- `docs/security-model.md`: modelo de seguridad, redaccion y limites del escaneo
- `docs/skills-governance.md`: politica para aprobar o bloquear skills con niveles de riesgo y rollback
- `docs/ops-runbook.md`: checklist operativo para validacion, modo degradado y releases
- `docs/status-actual.md`: estado operativo actual y hitos cerrados
- `docs/usage.md`: como usar la CLI
- `learning-context.config.json`: defaults versionados del proyecto
- `VERSIONING.md`: politica para alinear version de paquete, tags y releases
- `src/ci/pr-learnings.js`: mapeador de metadata de PR mergeada hacia payload de aprendizaje durable
- `src/context/noise-canceler.js`: selector de contexto
- `src/learning/mentor-loop.js`: paquete pedagogico
- `src/memory/engram-client.js` / `src/memory/engram-client.ts`: adaptador local a Engram (runtime JS + pista de build TS)
- `src/observability/metrics-store.js`: almacenamiento local de metricas de comandos y reporte agregado
- `src/security/prowler-ingest.js`: convertidor de findings JSON de Prowler a JSON de chunks compatible con la CLI
- `scripts/sync-pr-learnings.js`: helper de CI para sincronizar aprendizajes de PR mergeadas hacia Notion usando `sync-knowledge`
- `examples/typescript-backend/`: vertical real de TypeScript backend

## Prerrequisitos de instalacion

Para usar el proyecto con seriedad localmente necesitás:

- **Node.js** para la CLI y los benchmarks
- **Git** para el flujo normal de desarrollo
- **Engram** si querés usar memoria durable en `recall`, `remember`, `close` o `teach` con memoria

Tambien podés usar partes del sistema sin Engram:

- `select`
- `readme`
- `teach --no-recall`
- `recall`, `remember`, `close` usando fallback local (`.lcs/local-memory-store.jsonl`)

## Inicio rapido

```bash
npm run doctor
npm run init:config
npm test
npm run typecheck
npm run build
npm run release:check
npm run benchmark
npm run benchmark:recall
npm run benchmark:vertical
npm run security:pipeline:example
```

`security:pipeline:example` incluye un gate de calidad por defecto (`min-included-findings=1`, `min-selected-teach-chunks=1`, `min-priority=0.84`).

## Demo principal hoy

La demo mas fuerte hoy es el vertical de middleware TypeScript:

```bash
npm run vertical:ts:teach
npm run vertical:ts:seed-memory
npm run vertical:ts:teach:memory
npm run sync:pr-learnings -- --event "$GITHUB_EVENT_PATH" --dry-run true
```

## Configuracion oficial del proyecto

La CLI ahora carga automaticamente `learning-context.config.json` cuando existe.

Ese archivo es el lugar oficial para definir:

- proyecto por defecto
- workspace por defecto
- budgets de seleccion
- defaults de recall
- defaults de automatizacion de memoria (`memory.autoRecall`, `memory.autoRemember`)
- modo de backend de memoria (`memory.backend`: `resilient`, `engram-only`, `local-only`)
- rutas de Engram
- defaults y overrides de seguridad del escaneo

Nota de costo: `teach` puede saltear el recall automatico cuando la senal es baja (task/objective muy cortos y sin `--changed-files`). Si queres forzar recall, agrega `--changed-files` o `--recall-query`.

Nota de resiliencia: los comandos de memoria usan fallback local por defecto cuando Engram no esta disponible. Para desactivarlo: `--local-memory-fallback false`.

Nota de backend: podes fijar `memory.backend` (o `--memory-backend`) para elegir modo de ejecucion:
- `resilient` = Engram primario + fallback local
- `engram-only` = solo Engram
- `local-only` = solo store local

Si pasás flags en CLI, esos flags pisan el valor del config.

Nota de seguridad: cuando `teach` usa auto-remember, el contenido se sanea antes de guardar en Engram (rutas sensibles enmascaradas y valores tipo secreto redactados).

Para revisar si la instalacion local esta bien:

```bash
npm run doctor
```

Para generar el config base:

```bash
npm run init:config
```

Campos importantes de `config.security`:

- `ignoreSensitiveFiles`
- `redactSensitiveContent`
- `ignoreGeneratedFiles`
- `allowSensitivePaths`
- `extraSensitivePathFragments`

El `typecheck` actual es incremental a proposito: primero endurece config/bootstrap y el scanner de workspace, en vez de fingir que todo el repo ya esta migrado a TypeScript estricto.

## Build y estrategia de migracion a TypeScript

Ahora el repo tiene dos flujos distintos a proposito:

1. `npm run typecheck`
   - control estricto incremental sobre la parte endurecida del core
2. `npm run build`
   - emite una CLI runnable en `dist/` a partir del runtime actual sin mentir diciendo que todo ya esta migrado

Comandos utiles:

```bash
npm run build
npm run build:smoke
npm run pack:check
npm run release:check
```

La idea conceptual es:

- **typecheck** = donde ya exigimos contratos mas duros
- **build** = salida publicable para CI y futura distribucion
- **pack:check** = valida que `npm pack` incluya los artefactos minimos requeridos para publicacion

El entrypoint de desarrollo sigue siendo `src/cli.js`. El build `dist/` es el puente hacia una migracion total, no una excusa para fingir que ya llegamos.

### Que significa "migracion real" en este repo

Una migracion se considera real solo cuando se cumplen las 3 cosas:

1. el modulo fuente pasa a `.ts`
2. el comportamiento se valida por runtime en `dist/`
3. la distribucion del paquete usa `dist` como superficie ejecutable

Hoy ya quedaron forzados el punto (2) y (3) con build+smoke en CI y `bin` apuntando a `dist/cli.js`.

Migraciones reales actuales a `.ts` dentro de `src/`:

- `src/security/secret-redaction.ts`
- `src/io/text-file.ts`
- `src/contracts/config-contracts.ts`
- `src/io/config-file.ts`
- `src/io/workspace-chunks.ts`
- `src/system/project-ops.ts`
- `src/cli/arg-parser.ts`
- `src/contracts/cli-contracts.ts`
- `src/cli/teach-command.ts`
- `src/memory/recall-queries.ts`
- `src/memory/teach-recall.ts`
- `src/memory/engram-auto-orchestrator.ts`
- `src/memory/engram-client.ts`

Nota de compatibilidad:

- en runtime local Node 20/22 se mantienen entradas `.js` en `src/`
- el build `dist/` se emite desde la pista migrada `.ts` para packaging y validacion en CI

## Privacidad y politica de escaneo

El scanner del workspace no hace un volcado ciego.

Hoy:

- ignora contenedores de credenciales de alto riesgo como:
  - `.env*`
  - `.npmrc`, `.pypirc`, `.netrc`
  - `.aws/credentials`, `.docker/config.json`, `.kube/config`
  - `id_rsa`, `id_dsa`, `id_ed25519`
  - `.pem`, `.key`, `.pfx`, `.crt`, `.cer`, `.tfvars`
- redacta fragmentos sensibles dentro de archivos que sí conviene leer:
  - bloques de llaves privadas
  - API keys y access tokens
  - bearer tokens
  - tokens tipo JWT
  - connection strings y DSNs
  - asignaciones comunes de password/secret
- cuenta archivos redactados, archivos sensibles ignorados y categorias de redaccion en las estadisticas del escaneo
- permite overrides por proyecto desde `learning-context.config.json`

Eso significa que la CLI ya no solo muestra contexto seleccionado, sino tambien **cuanto se ignoro, trunc? o redact?**.

Los overrides de seguridad deben usarse con criterio:

- `allowSensitivePaths` solo para fixtures o ejemplos que sabes que son seguros
- `extraSensitivePathFragments` para marcar zonas sensibles propias del repo que nunca deberian entrar al contexto
- `safety.requirePlanForWrite` + `--plan-approved true` para forzar disciplina Plan/Execute en comandos de escritura
- `safety.allowedScopePaths` para bloquear cambios/salidas fuera de alcance
- `safety.maxTokenBudget` para bloquear ejecuciones por encima del presupuesto de tokens

La explicacion de seguridad y limites operativos esta en `docs/security-model.md`.

## Superficies open source para colaborar

Para que el repo sea mas usable por terceros, GitHub ya tiene:

- templates de Issues:
  - bug report
  - feature request
  - usage question
- template de Pull Request con checklist de validacion
- pipeline de CI con typecheck/build/tests/benchmarks y escaneo de secretos
- workflow opcional `PR Learnings Sync` para exportar aprendizajes de PR mergeados a Notion (`sync:pr-learnings`)
- workflow de CodeQL para analisis estatico de JavaScript/TypeScript
- configuracion de Dependabot para npm y GitHub Actions
- politica de seguridad en `SECURITY.md`

## Contrato JSON estable

Cuando usás `--format json`, la CLI ahora devuelve un contrato versionado con:

- `schemaVersion`
- `command`
- `status`
- `degraded`
- `warnings`
- `config`
- `meta`

y después el payload del comando.

Eso vuelve más seguro consumir la CLI desde scripts u otras herramientas.

## Estado real

Estado actual:

- el proyecto ya funciona
- ya tiene benchmarks
- ya tiene CI
- ya tiene un vertical real

## Roadmaps por area

Usa `ROADMAP.md` como indice y `docs/roadmaps/` cuando quieras ver los siguientes pasos separados por seccion en vez de mezclados.

Pero todavia le falta:

- mas dureza en algunos casos reales
- mas polish en documentacion y ergonomia
- mas validacion antes de venderlo como framework serio
