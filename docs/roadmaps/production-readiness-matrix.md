# Production Readiness Matrix

## Goal

Move the project from "strong demo" to "production-grade open-source CLI" with explicit gates.

## BLOQUEANTE (must be done before production claim)

1. **Stable contract policy (JSON + CLI)**
   - Problem: outputs can still drift between iterations.
   - Done when:
     - every command contract has versioned schema tests
     - compatibility policy is documented (`major/minor/patch` impact)
     - one contract changelog section exists per release

2. **Real Engram E2E reliability (happy path + failures)**
   - Problem: production depends on Engram availability and degraded behavior quality.
   - Status (2026-03-18): **in progress** (failure matrix + degraded tests + deterministic teach retry/backoff added)
   - Done when:
     - E2E tests cover binary missing, timeout, malformed output, degraded recall fallback
     - retry/backoff behavior is deterministic and tested
     - doctor + teach + recall failure modes are documented with exact recovery steps

3. **Workspace scan hardening by policy**
   - Problem: local noise can pollute ranking if not excluded by default.
   - Done when:
     - default ignores include temp/cache/build artifacts
     - ignore/include policy is configurable and validated
     - regression suite proves noisy folders do not rank into context

4. **Observability baseline**
   - Problem: no operational SLO visibility yet.
   - Done when:
     - run-time metrics are emitted (duration, selected/suppressed, degraded mode usage, recall hit rate)
     - metrics are documented and stable
     - one "operational health" report command exists (`doctor --format json` extended or similar)

5. **Release discipline and governance**
   - Problem: repo is stable but process is not fully hardened.
   - Done when:
     - semantic versioning + changelog gate in CI
     - release checklist is mandatory and versioned
     - branch protection requires review + passing checks for all production changes

## IMPORTANTE (high value, can run in parallel)

1. **Complete TS migration of critical path**
   - Done when CLI orchestration, selector core, memory orchestration, and scanner run in strict TS as source of truth.

2. **Stronger benchmark corpus**
   - Done when benchmarks include medium and large real repos (not only synthetic cases) and trend history is tracked.

3. **Security depth**
   - Done when secret handling has negative tests for false positives/false negatives and dependency/security checks are expanded.

4. **Open-source onboarding quality**
   - Done when external user can install, run, debug, and contribute without private context.

## NICE TO HAVE (post-production acceleration)

1. **Skill-trigger automation**
   - Auto-run safe recall/teach helpers on specific command patterns.

2. **DX dashboard/reporting**
   - lightweight HTML/markdown operational report generated from benchmark + doctor + CI metadata.

3. **Provider abstraction**
   - optional memory provider interface beyond Engram (without changing core contracts).

## Suggested execution order (short cycles)

1. Contract policy + tests  
2. Engram E2E failure matrix  
3. Scan policy hardening  
4. Observability baseline  
5. Release/governance gates  

Then parallelize TS migration + benchmark corpus + security depth.

## Quick Spanish summary

- **Bloqueante** = lo que impide llamar al proyecto "producción".  
- **Importante** = mejora fuerte, pero no bloquea salida inicial.  
- **Nice to have** = acelera adopción después de estabilizar base.
