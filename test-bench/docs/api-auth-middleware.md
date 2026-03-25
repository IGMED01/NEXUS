# Auth Middleware — API Gateway

## Overview
The authentication middleware validates JWT tokens on every protected route before reaching the handler. It uses RS256 asymmetric signing with key rotation every 90 days.

## Flow
1. Extract `Authorization: Bearer <token>` header
2. Decode JWT header to get `kid` (key ID)
3. Fetch public key from JWKS endpoint (cached 1h)
4. Verify signature + expiration
5. Attach `req.user = { id, role, scope }` to request
6. Call `next()` or return 401

## Rate Limiting
- Authenticated users: 1000 req/min per user ID
- Unauthenticated: 60 req/min per IP
- Burst: allows 2x limit for 5 seconds, then throttle
- Rate limit headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Error Responses
| Status | Code | Description |
|--------|------|-------------|
| 401 | `TOKEN_MISSING` | No Authorization header |
| 401 | `TOKEN_EXPIRED` | JWT exp claim is past |
| 401 | `TOKEN_INVALID` | Signature verification failed |
| 403 | `INSUFFICIENT_SCOPE` | User lacks required scope |
| 429 | `RATE_LIMITED` | Too many requests |

## Scopes
- `read:data` — Read access to resources
- `write:data` — Create/update resources
- `admin:manage` — Administrative operations
- `api:full` — Unrestricted API access

## Configuration
```js
const authConfig = {
  jwksUri: process.env.JWKS_URI || 'https://auth.example.com/.well-known/jwks.json',
  audience: process.env.API_AUDIENCE || 'api.nexus.dev',
  issuer: process.env.TOKEN_ISSUER || 'https://auth.example.com',
  cacheTTL: 3600,
  rateLimits: {
    authenticated: { window: 60, max: 1000 },
    anonymous: { window: 60, max: 60 }
  }
}
```

## Middleware Stack Order
1. `cors()` — CORS headers
2. `requestId()` — Attach UUID to each request
3. `authMiddleware()` — JWT validation (this module)
4. `scopeGuard(required)` — Check user scopes
5. `rateLimiter()` — Apply rate limits
6. Route handler
