// @ts-check

/**
 * @typedef {{ id: string, version: number, createdAt: string }} PromptVersionLite
 */

/**
 * @param {number} value
 */
function clamp(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

/**
 * NEXUS:9 — choose rollback target from prompt versions and eval scores.
 * @param {{
 *   versions: PromptVersionLite[],
 *   evalScoresByVersion?: Record<string, number>,
 *   minScore?: number,
 *   preferPrevious?: boolean
 * }} input
 */
export function selectRollbackCandidate(input) {
  const versions = [...(input.versions ?? [])].sort((left, right) => right.version - left.version);
  const minScore = clamp(Number(input.minScore ?? 0.65));
  const evalScoresByVersion = input.evalScoresByVersion ?? {};

  if (!versions.length) {
    return {
      selected: null,
      status: "no-versions",
      minScore,
      considered: []
    };
  }

  const current = versions[0];
  const candidates = versions
    .filter((version) =>
      input.preferPrevious === false ? true : version.id !== current.id
    )
    .map((version) => ({
      version,
      score: clamp(Number(evalScoresByVersion[version.id] ?? 0))
    }))
    .sort((left, right) => right.score - left.score || right.version.version - left.version.version);

  const selected = candidates.find((candidate) => candidate.score >= minScore) ?? null;

  return {
    selected: selected?.version ?? null,
    selectedScore: selected?.score ?? 0,
    current,
    minScore,
    status: selected ? "rollback-ready" : "no-safe-candidate",
    considered: candidates.map((candidate) => ({
      id: candidate.version.id,
      version: candidate.version.version,
      score: candidate.score
    }))
  };
}

/**
 * @param {{ listVersions: (promptKey: string) => Promise<Array<{ id: string, version: number, createdAt: string }>> }} store
 * @param {{ promptKey: string, evalScoresByVersion?: Record<string, number>, minScore?: number, preferPrevious?: boolean }} input
 */
export async function buildRollbackPlan(store, input) {
  const versions = await store.listVersions(input.promptKey);
  const selection = selectRollbackCandidate({
    versions,
    evalScoresByVersion: input.evalScoresByVersion,
    minScore: input.minScore,
    preferPrevious: input.preferPrevious
  });

  return {
    promptKey: input.promptKey,
    ...selection
  };
}
