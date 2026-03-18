# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) at the package level.

## [Unreleased]

### Changed
- Added `.ts` build-track sources for memory teach orchestration (`src/memory/teach-recall.ts`, `src/memory/engram-auto-orchestrator.ts`) and wired TypeScript configs to prefer those sources during typecheck/build.
- Added `.ts` build-track source for Engram adapter execution/parsing (`src/memory/engram-client.ts`) and wired TypeScript configs to prefer it during typecheck/build.
- Added Notion team-knowledge sync command (`sync-knowledge`) that appends structured notes to a target page using token + page-id configuration.
- Added merged-PR knowledge sync automation (`scripts/sync-pr-learnings.js` + `.github/workflows/pr-learnings-sync.yml`) that transforms PR metadata into `sync-knowledge` notes with degraded skip mode when Notion secrets are missing.

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
- Initial experimental CLI for context selection, teaching packet generation, and Engram-backed memory commands.
- Selector and recall benchmark harnesses.
- TypeScript backend vertical example for middleware/auth teaching flows.
