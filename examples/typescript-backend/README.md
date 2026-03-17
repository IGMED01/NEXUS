# TypeScript Backend Vertical

This example workspace simulates a small HTTP backend focused on authentication middleware.

Use it to evaluate the Learning Context System in a realistic TypeScript flow:

- request boundary validation
- auth middleware ordering
- related tests
- architectural notes
- noisy logs and stale chat

The important behavior is intentionally narrow:

1. parse the bearer token at the boundary
2. verify the session before route handlers run
3. attach auth context when valid
4. return `401` early when the request is invalid
