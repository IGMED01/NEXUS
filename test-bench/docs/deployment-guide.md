# Deployment Guide

## Environments

| Environment | Branch | URL | Auto-deploy |
|-------------|--------|-----|-------------|
| Development | `dev` | localhost:3100 | No |
| Staging | `staging` | staging.nexus.dev | Yes (on push) |
| Production | `main` | app.nexus.dev | Yes (after approval) |

## Docker Build

### Multi-stage Dockerfile
- **Stage 1** (`ui-build`): Node 22 Alpine, builds React UI with Vite
- **Stage 2** (`production`): Node 22 Alpine, copies built assets + server code
- Final image size: ~180MB

### Build Commands
```bash
# Local build
docker build -t nexus:latest .

# With build args
docker build --build-arg NODE_ENV=production --build-arg API_PORT=3100 -t nexus:latest .

# Multi-platform (for cloud deploy)
docker buildx build --platform linux/amd64,linux/arm64 -t nexus:latest .
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LCS_API_PORT` | No | 3100 | Server port |
| `LCS_API_HOST` | No | 0.0.0.0 | Bind address |
| `GROQ_API_KEY` | Yes* | — | Groq LLM API key |
| `OPENROUTER_API_KEY` | Yes* | — | OpenRouter API key |
| `CEREBRAS_API_KEY` | Yes* | — | Cerebras API key |
| `NODE_ENV` | No | development | Environment mode |

*At least one LLM API key is required for AI responses.

## Health Checks

### Endpoints
- `GET /api/health` — Returns `{ status: "ok", uptime, version }`
- `GET /api/metrics` — System metrics (latency, errors, throughput)

### Docker health check
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/api/health').then(r => process.exit(r.ok ? 0 : 1))"
```

## CI/CD Pipeline

### GitHub Actions Workflow
1. **Validate** — Lint + typecheck on Node 20 and 22
2. **CodeQL** — Security analysis (JavaScript)
3. **Gitleaks** — Secret scanning on all commits
4. **Build** — Docker build + push to registry
5. **Deploy** — Auto-deploy to staging; manual approval for production

### Required Checks for `main`
- `validate` must pass
- `codeql` must pass
- `gitleaks` must pass
- PR review required (1 approver)

## Monitoring

### Logs
- Structured JSON logging via `pino`
- Log levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- Request logs include: method, path, status, duration, requestId

### Alerts
- Error rate > 5% for 5 min → Slack notification
- p95 latency > 2000ms for 10 min → Slack notification
- Memory usage > 90% → auto-restart container
- Disk usage > 85% → warning alert

## Rollback
```bash
# Quick rollback to previous version
docker compose pull && docker compose up -d

# Manual rollback to specific tag
docker pull nexus:v1.2.3
docker compose up -d
```

## Scaling
- Horizontal: run N containers behind load balancer
- Vertical: increase container memory/CPU limits
- Recommended: 2 replicas minimum for zero-downtime deploys
