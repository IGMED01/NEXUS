# NEXUS Skill Auto-Generator (MVP)

Generate and promote skills from repetitive tasks, with strict health gates.

## Goal

Turn repeated workflows into reusable `skills/` drafts so NEXUS can grow continuously while keeping human review control.

## Current MVP flow

1. Read shell history (`.lcs/shell-history` by default).
2. Detect repeated task patterns (default threshold: `3`).
3. Apply **health filter** (block dangerous/low-signal tasks).
4. Scan installed skills catalog (**repo + system paths**) to detect exact/similar overlaps.
5. Propose each candidate to the user before creation.
6. Generate draft skill files in `skills/generated/<skill>/SKILL.md`.
7. Upsert `skills/generated/registry.json` with health and baseline metrics.
8. Promote `draft -> experimental` only when token/time/error thresholds pass.

## Usage

```bash
# Interactive proposal (recommended)
npm run skills:auto

# Unattended creation (CI/manual automation)
npm run skills:auto:yes

# Audit installed/repo skill conflicts only (no generation)
npm run skills:doctor
```

By default, creation is blocked when:

- an exact installed skill already exists
- a similar skill is found above the similarity threshold (`0.72`)

Override only when truly needed:

```bash
# allow creating even if similar skills exist
node scripts/auto-generate-skills.js --allow-similar

# allow creating even if an exact installed duplicate exists
node scripts/auto-generate-skills.js --allow-installed
```

Dry run:

```bash
npm run skills:auto:dry
```

Overwrite existing generated drafts:

```bash
node scripts/auto-generate-skills.js --force --yes --history .lcs/shell-history
```

Promotion:

```bash
# Evaluate and promote eligible skills to experimental
npm run skills:promote

# Review-only mode
npm run skills:promote:dry
```

Doctor in JSON mode (for CI/reporting):

```bash
npm run skills:doctor:json
```

Strict mode (treat mirror duplicates as conflicts too):

```bash
node scripts/doctor-skills.js --include-mirror-duplicates --fail-on-conflicts
```

## Recommended operating policy

- Keep strict health filter enabled.
- Do not bypass user proposal in normal workflow.
- Promotion thresholds (defaults):
  - token improvement >= 20%
  - time improvement >= 25%
  - error improvement >= 30%
  - minimum runs after draft creation >= 3
- Keep `stable` promotion manual after repeated safe wins.

## Security + governance

- Secret-like fragments are redacted in normalized task lines.
- Navigation commands (`/help`, `/status`, `/tab`, etc.) are ignored for generation.
- Dangerous system-impact patterns are blocked before generation.
- Missing token metrics blocks promotion by default (can be relaxed with explicit flag).
- External skills remain governed by [Skills governance](./skills-governance.md).
- System scan paths include: `CODEX_HOME/skills`, `~/.codex/skills`, platform defaults, and optional `--system-skills-dir`.
- `skills:doctor` auto-resolves exact mirror duplicates when content is identical across different sources (for example repo + system copy).
