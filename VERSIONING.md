# Versioning policy

## Goal

Keep package metadata, Git tags, and GitHub releases aligned.

## Rules

1. `package.json` `version` is the canonical SemVer core (for example `0.2.0`).
2. Git tags for stable cuts may include a suffix when needed (for example `v0.2.0-stable-day1`), but the SemVer core must match `package.json`.
3. Every stable release must update:
   - `package.json` (and lockfile)
   - `CHANGELOG.md`
   - GitHub release notes
4. No release tag should be created from a dirty working tree.
5. Do not skip changelog entries for user-visible CLI, CI, contract, security, or memory behavior changes.

## Contract compatibility policy (CLI JSON)

- **Patch**: non-breaking internal changes, docs, or optional JSON fields added.
- **Minor**: additive JSON contract evolution that keeps existing required v1 paths/types valid.
- **Major**: any breaking contract change (remove/rename required path, change required type, or semantic break in required field meaning).

For every release, include a contract-impact note in `CHANGELOG.md` (`Contracts` subsection when relevant).

## Release checklist (minimum)

1. `npm.cmd test`
2. `npm.cmd run typecheck`
3. `npm.cmd run build`
4. `npm.cmd run build:smoke`
5. `npm.cmd run security:pipeline:example`
6. update `CHANGELOG.md`
7. create tag and GitHub release
