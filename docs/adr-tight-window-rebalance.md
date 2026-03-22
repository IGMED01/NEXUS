# ADR: Tight-Window Recall Rebalance in Selector

_Date: 2026-03-22_

## Context

After introducing two-pass selection (recall-first with reserved budget), CI surfaced two conflicting expectations:

1. In selector benchmark, top-ranked output must reflect final relevance score (`topPrefixPass`).
2. In vertical benchmark with tight chunk limits, recalled memory may be recovered but should be suppressible when workspace implementation context is denser.

The issue was not recall retrieval quality. The issue was selection ordering and replacement behavior under strict `maxChunks` windows.

## Decision

We keep two-pass selection and add two balancing rules in `selectContextWindow`:

1. **Final relevance ordering**: sort `selected` by final `score` before returning.
2. **Tight-window workspace rebalance**:
   - consider recalled chunks selected in pass 1 as replaceable,
   - allow replacement by suppressed workspace candidates (`max-chunks-reached` or `token-budget-exceeded`),
   - only in tight implementation windows (`changedFiles` present, `maxChunks <= 5`, strong workspace presence),
   - keep token budget constraints intact.

This preserves recall reserve behavior while preventing implementation starvation when the context window is very small.

## Why this approach

- Smallest valid change: no rollback of two-pass architecture.
- Root-cause fix: ranking order and tight-window trade-off are handled explicitly.
- Backward-compatible contract: no breaking JSON schema changes.

## Behavioral outcome

- Broad budgets: recalled memory remains highly retained.
- Tight budgets: workspace code/test context can displace lower-priority recalled memory.
- Output order matches relevance score, not pass insertion order.

## Validation

```bash
npm run benchmark
npm run benchmark:vertical
node test/run-tests.js
npm run typecheck
```

Expected: all commands pass.

## Teaching notes

- **Concept**: two-phase selection needs a final global ordering pass.
- **Concept**: reserve policies should be adaptive to operational constraints (`maxChunks`, changed-file anchoring).
- **Practice**: add one benchmark case where two recalled memories compete with three changed-file workspace chunks under `maxChunks=4`, and define explicit expected suppression behavior.
