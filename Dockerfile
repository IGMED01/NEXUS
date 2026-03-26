# ── Stage 1: Build UI ──────────────────────────────────────
FROM node:22-alpine AS ui-build
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY demo/ ./demo/
COPY eval/ ./eval/
COPY test-bench/ ./test-bench/
COPY scripts/ ./scripts/
COPY learning-context.config.json ./
COPY --from=ui-build /app/ui/dist ./ui/dist

ENV LCS_API_HOST=0.0.0.0
ENV LCS_API_PORT=3100
EXPOSE 3100

CMD ["node", "src/api/start.js"]
