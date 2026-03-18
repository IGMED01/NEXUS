# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) at the package level.

## [Unreleased]

## [0.2.1] - 2026-03-18

### Added
- `CodeQL` is now enforced as a required branch protection check on `main`.
- CI and CodeQL workflows now force JavaScript-based actions onto Node 24 runtime.

### Changed
- Completed dependency maintenance batch from Dependabot (GitHub Actions + npm root + TypeScript vertical).
- Hardened `src/memory/engram-client.js` to normalize `stdout/stderr` from `string | Buffer`, preventing strict typecheck failures after Node type upgrades.

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

## [0.1.0] - 2026-03-17

### Added
- Initial experimental CLI for context selection, teaching packet generation, and Engram-backed memory commands.
- Selector and recall benchmark harnesses.
- TypeScript backend vertical example for middleware/auth teaching flows.
