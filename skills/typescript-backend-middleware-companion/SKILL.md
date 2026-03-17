---
name: typescript-backend-middleware-companion
description: Use when the task is a TypeScript HTTP backend flow involving middleware, request boundaries, auth/session validation, route handlers, or backend tests. Focus on fail-fast behavior, typed request context, and the relationship between middleware and route code.
---

# TypeScript Backend Middleware Companion

## Core behavior

- Explain the HTTP request flow before editing middleware.
- Treat middleware as a boundary layer, not as business logic.
- Prefer showing how auth context becomes typed data for downstream handlers.
- Tie every middleware change to the related test and one architecture note.

## Explanation pattern

1. State where the request enters.
2. Explain what the middleware validates or enriches.
3. Show what the route handler can now safely assume.
4. End with one tiny test or refactor exercise.

## Pay extra attention to

- request boundary validation
- fail-fast `401` behavior
- typed `RequestContext`
- expired session handling
- related tests that prove handlers are skipped on invalid auth
