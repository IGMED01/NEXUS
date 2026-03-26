# SYNC ownership (NEXUS canonical runtime)

## Decision

From this iteration onward, **SYNC runtime is canonical inside NEXUS**:

- runtime: `src/sync/sync-runtime.js`
- scheduler/orchestration: `src/sync/sync-scheduler.js`
- drift/reporting: `src/sync/drift-monitor.js`
- versioning: `src/sync/version-tracker.js`

## What changed

The internal runtime now executes the full pipeline:

1. detect changes
2. chunk changed files
3. deduplicate chunks
4. resolve versions
5. persist chunks + tombstones

This keeps `/api/sync`, `/api/sync/status`, and `/api/sync/drift` stable while consolidating execution into one internal flow.

## Role of the external `sync` repository

`C:/Users/Admin/Desktop/sync` is now treated as **reference/historical input**, not runtime dependency.

- NEXUS does not import or execute code from that repository at runtime.
- Future extraction can happen later if boundaries become stable.

## Storage + memory

- Chunk persistence remains internal through NEXUS storage (`.lcs/chunks` by project).
- Memory backend remains unchanged (`resilient`: Engram primary + local fallback).

## Compatibility

- No breaking API changes in this consolidation.
- Existing CLI commands and API routes keep the same public contract.
