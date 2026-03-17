# TypeScript Backend Vertical

## Qué es

Este vertical convierte el proyecto en una demo concreta de backend HTTP con middleware de autenticación.

## Workspace

- `examples/typescript-backend/src/auth/middleware.ts` -> límite de autenticación
- `examples/typescript-backend/test/auth/middleware.test.ts` -> prueba del comportamiento
- `examples/typescript-backend/docs/adr/auth-order.md` -> decisión de arquitectura
- `examples/typescript-backend/logs/server.log` -> ruido intencional
- `examples/typescript-backend/chat/history.md` -> chat viejo intencional

## Flujos

### 1. Flujo determinista

No depende de Engram.

```bash
node src/cli.js teach --workspace examples/typescript-backend --task "Harden auth middleware" --objective "Teach request-boundary validation in a TypeScript server" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --no-recall --format text
```

### 2. Flujo con memoria durable

Primero sembrás memorias:

```bash
node scripts/seed-typescript-vertical-memory.js
```

Después corrés:

```bash
node src/cli.js teach --workspace examples/typescript-backend --task "Harden auth middleware" --objective "Teach request-boundary validation in a TypeScript server" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --project typescript-backend-vertical --recall-query "auth validation order" --token-budget 520 --max-chunks 6 --format text
```

## Qué deberías ver

- `src/auth/middleware.ts` como código principal
- `test/auth/middleware.test.ts` como test relacionado
- la ADR como soporte
- si sembraste memoria, una decisión o patrón histórico útil
