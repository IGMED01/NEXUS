# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) at the package level.

## [Unreleased]

### Performance
- Cached `focusTokens` once per `selectContextWindow` call instead of re-tokenizing per chunk, eliminating O(n) redundant tokenizations.
- Cached `chunkTokens` in `PreparedChunk.tokens` field and propagated through all `scoreChunk` call sites (initial ranking, incremental rescoring, rebalance) and Jaccard redundancy checks.
- Bounded the recall↔workspace rebalance loop to `maxChunks` iterations to prevent unbounded execution.
- Extended `Chunk` interface with optional `tokens` field and `SelectionOptions` with internal cache hints (`_cachedFocusTokens`, `_cachedChunkTokens`).

### Changed
- Added `.ts` build-track sources for memory teach orchestration (`src/memory/teach-recall.ts`, `src/memory/engram-auto-orchestrator.ts`) and wired TypeScript configs to prefer those sources during typecheck/build.
- Added `.ts` build-track source for Engram adapter execution/parsing (`src/memory/engram-client.ts`) and wired TypeScript configs to prefer it during typecheck/build.
- Added Notion team-knowledge sync command (`sync-knowledge`) that appends structured notes to a target page using token + page-id configuration.
- Added merged-PR knowledge sync automation (`scripts/sync-pr-learnings.js` + `.github/workflows/pr-learnings-sync.yml`) that transforms PR metadata into `sync-knowledge` notes with degraded skip mode when Notion secrets are missing.
- Hardened Notion config normalization so `NOTION_PARENT_PAGE_ID` accepts full Notion page URLs (auto-extracts page id) to avoid invalid request URL failures.
- Notion page-id normalization now converts 32-hex IDs into canonical UUID format for `/blocks/{page_id}/children` requests.
- Notion sync now retries alternate page-id formats (UUID and compact 32-hex) when Notion returns `Invalid request URL`.
- Fixed Notion append transport to use `PATCH /blocks/{page_id}/children` (was `POST`), matching the official Notion API contract.
- Notion sync now renders markdown-like note content as native Notion blocks (`heading_*`, `bulleted_list_item`, `numbered_list_item`, `paragraph`) so PR learnings are readable without raw markdown markers.
- Added npm packaging gate (`npm run pack:check`) plus CI enforcement on Node 20 to verify tarball includes required publishable assets (`package.json`, `README.md`, `dist/cli.js`).
- Added configurable task safety gate (`config.safety`) with pre-execution blocking for write-mode without plan approval, out-of-scope paths, and over-budget token windows; observability now tracks blocked/prevented events.
- `teach` now skips automatic Engram recall for low-signal tasks (very short task/objective with no `--changed-files`) to avoid unnecessary memory/token cost unless the user provides stronger signals (`--changed-files` or `--recall-query`).
- Added resilient memory fallback path: when Engram is unavailable, `recall`/`remember`/`close` (and memory-backed `teach`) can continue via local store `.lcs/local-memory-store.jsonl` with explicit degraded metadata/warnings.
- Added explicit memory backend strategy (`memory.backend` / `--memory-backend`) with `resilient` (default), `engram-only`, and `local-only` modes; `doctor` now reports backend mode and skips Engram path warnings when backend is `local-only`.
- Added formal North Star quality gate (`npm run northstar:check`) backed by observability metrics to enforce minimum prevented-error signal in CI.
- Added cost-safety enforcement for workspace scans: explicit focus requirement, minimum focus length, and weak-focus debug blocking (`safety.requireExplicitFocusForWorkspaceScan`, `safety.minWorkspaceFocusLength`, `safety.blockDebugWithoutStrongFocus`).

### Contracts
- Added v1 compatibility fixtures/tests for all JSON CLI commands (`version`, `doctor`, `init`, `sync-knowledge`, `ingest-security`, `select`, `teach`, `readme`, `recall`, `remember`, `close`).
- Added degraded recall contract coverage for `malformed-output` classification in `recall --format json`.
- No breaking JSON contract change.

## [0.2.1] - 2026-03-18

### Added
- `CodeQL` is now enforced as a required branch protection check on `main`.
- CI and CodeQL workflows now force JavaScript-based actions onto Node 24 runtime.

### Changed
- Completed dependency maintenance batch from Dependabot (GitHub Actions + npm root + TypeScript vertical).
- Hardened `src/memory/engram-client.js` to normalize `stdout/stderr` from `string | Buffer`, preventing strict typecheck failures after Node type upgrades.

### Contracts
- No breaking JSON contract change.

## [0.2.0] - 2026-03-18

### Added
- `doctor` and `init` commands for setup validation and baseline config generation.
- Stable JSON contracts for CLI output (`schemaVersion: 1.0.0`) with compatibility tests.
- Security ingestion flow (`ingest-security`) from Prowler findings to LCS chunks.
- Security pipeline quality gate (`security:pipeline:example`) with CI artifact upload and PR summary comments.
- Observability baseline (`.lcs/observability.json`) and doctor observability report.
- Secret scanning gate in CI and expanded scan/redaction safety controls.

### Changed
- Teach flow now supports automatic Engram recall integration and degraded-mode classification.
- Incremental TypeScript migration track expanded for critical modules with build smoke checks.

### Contracts
- Established initial `schemaVersion: 1.0.0` JSON contract baseline for CLI outputs.

## [0.1.0] - 2026-03-17

### Added
- Initial CLI for context selection, teaching packet generation, and Engram-backed memory commands.
- Selector and recall benchmark harnesses.
- TypeScript backend vertical example for middleware/auth teaching flows.
