# Skills Governance Policy

## Goal

Control how external and local skills are introduced so the project gains speed **without** increasing hidden security or quality risk.

## Scope

This policy applies to:

- skill usage during development and code review
- skill installation in local agent environments
- skill references used by this repository documentation and workflows

It does **not** replace `docs/security-model.md`; it complements it for agent-skill supply chain control.

## Principles

1. **Default deny**: a skill is not allowed until reviewed.
2. **Least privilege**: prefer skills that only provide instructions, not opaque executables.
3. **Determinism first**: skills must not introduce random or non-reproducible behavior in core validation flows.
4. **Traceability**: every approved skill must have owner, source, version/ref, and review date.
5. **Fast rollback**: any approved skill must be removable in one change without breaking core commands.

## Risk tiers

### Tier A (Low risk)

- local project skills stored in `skills/`
- read-only guidance skills with no remote command execution

### Tier B (Medium risk)

- external open-source skills from known maintainers
- skills that include scripts but are transparent and auditable

### Tier C (High risk)

- unknown-source skills
- skills that auto-execute remote actions
- skills with unclear license, unclear ownership, or no update history

Tier C is blocked by default.

## Initial allowlist policy

Allowed by default:

- repository-local skills under `skills/`
- system skills already bundled in the local Codex environment after manual review

Conditionally allowed (requires review ticket):

- third-party skills discovered via registries/websites (for example skills directories/leaderboards)

Blocked:

- any skill that cannot be pinned to a specific source + revision
- any skill that requests privileged behavior without clear need

## Admission checklist (required)

Before approving a non-local skill:

1. source repository is identified and pinned (commit/tag)
2. license is compatible with this repository usage
3. maintainer activity is recent enough for risk tolerance
4. instructions/scripts are inspected for unsafe behavior
5. skill value is explicit (what problem it solves better than current setup)
6. rollback path is documented

If any point fails, the skill stays blocked.

## Change process

1. Open a proposal (issue or PR note) with:
   - skill source
   - intended use
   - risk tier
   - rollback plan
2. Trial in isolated branch
3. Validate with standard project checks (`doctor`, `test`, `typecheck`, `build`, benchmarks if relevant)
4. Merge only after documented approval

## Telemetry and privacy

- treat external skill telemetry as untrusted by default
- do not enable extra telemetry in team environments without explicit decision
- never include secrets or sensitive project data in skill-specific prompts

## Operational guardrails

- do not make core project behavior depend on one external skill
- keep a documented fallback path without that skill
- review approved skills periodically (recommended: monthly)

## Incident response

If a skill is suspected unsafe:

1. disable usage immediately
2. remove references from active workflows/docs
3. run security checks and repository validation
4. document incident and final decision (restore vs ban)

## Minimal audit record template

Use this record in PR/issue comments when approving a skill:

- Skill:
- Source:
- Pinned revision:
- Risk tier:
- Reviewer:
- Date:
- Decision:
- Rollback step:

## Resumen rapido en espanol

- Politica base: **deny by default**
- Solo se habilitan skills revisadas y trazables
- Toda skill externa necesita fuente, revision fija, riesgo y rollback
- Si hay sospecha de riesgo: se desactiva primero, se investiga despues
