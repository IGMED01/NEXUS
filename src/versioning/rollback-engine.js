// @ts-check

/**
 * @typedef {import("../types/core-contracts.d.ts").RollbackCheck} RollbackCheck
 * @typedef {import("../types/core-contracts.d.ts").EvalSuite} EvalSuite
 * @typedef {{ dropThreshold?: number, evalSuite: EvalSuite, project: string, promptName: string, baseDir?: string }} RollbackEngineOptions
 */

import { runEvalSuite } from "../eval/eval-runner.js";
import { getPromptHistory, rollbackPrompt } from "./prompt-versioning.js";
import { saveSnapshot, getScoreTrend } from "./context-snapshot.js";

/**
 * @param {number} value
 */
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * NEXUS:9 — build rollback candidate plan from version history + eval scores.
 * @param {{ listVersions: (promptKey: string) => Promise<Array<{ id: string, version: number, createdAt: string }>> }} store
 * @param {{
 *   promptKey: string,
 *   evalScoresByVersion?: Record<string, number>,
 *   minScore?: number,
 *   preferPrevious?: boolean
 * }} input
 */
export async function buildRollbackPlan(store, input) {
  const promptKey = String(input.promptKey ?? "").trim();

  if (!promptKey) {
    throw new Error("promptKey is required.");
  }

  const list = await store.listVersions(promptKey);
  const current = list[0] ?? null;
  const minScore =
    typeof input.minScore === "number" && Number.isFinite(input.minScore)
      ? clamp01(input.minScore)
      : 0.75;
  const preferPrevious = input.preferPrevious !== false;
  const scores =
    input.evalScoresByVersion && typeof input.evalScoresByVersion === "object"
      ? input.evalScoresByVersion
      : {};

  const considered = list.map((entry) => ({
    id: entry.id,
    version: entry.version,
    score:
      typeof scores[entry.id] === "number" && Number.isFinite(scores[entry.id])
        ? clamp01(scores[entry.id])
        : 0
  }));

  const eligible = considered
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.version - left.version;
    });

  let selected = null;

  if (preferPrevious && current) {
    selected = eligible.find((entry) => entry.version < current.version) ?? null;
  }

  if (!selected) {
    selected = eligible[0] ?? null;
  }

  return {
    promptKey,
    status: selected ? "rollback-ready" : "no-candidate",
    selected,
    considered,
    minScore,
    preferPrevious
  };
}

/**
 * @param {RollbackEngineOptions} options
 * @returns {Promise<RollbackCheck>}
 */
export async function checkAndRollback(options) {
  const threshold = options.dropThreshold ?? 0.10;

  const trend = await getScoreTrend(options.project, 2, options.baseDir);
  const previousScore = trend.length > 0 ? trend[0].evalScore : 1.0;

  const report = await runEvalSuite(options.evalSuite, { minScore: 0 });
  const currentScore = report.ciGate.actualScore;

  const dropPercent = previousScore > 0
    ? (previousScore - currentScore) / previousScore
    : 0;

  await saveSnapshot({
    project: options.project,
    command: "rollback-check",
    query: `eval:${options.evalSuite.name}`,
    selectedChunkIds: [],
    evalScore: currentScore,
    promptVersionId: options.promptName
  });

  if (dropPercent > threshold) {
    const history = await getPromptHistory(options.promptName, options.baseDir);
    const previousVersion = history.currentVersion - 1;

    /** @type {number | undefined} */
    let rolledBackTo;

    if (previousVersion >= 1) {
      const rollbackResult = await rollbackPrompt(options.promptName, previousVersion, options.baseDir);
      rolledBackTo = rollbackResult?.version;
    }

    return {
      shouldRollback: true,
      reason: `Eval score dropped ${(dropPercent * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%)`,
      previousScore,
      currentScore,
      dropPercent: Math.round(dropPercent * 1000) / 1000,
      threshold,
      rolledBackTo
    };
  }

  return {
    shouldRollback: false,
    reason: dropPercent > 0
      ? `Score dropped ${(dropPercent * 100).toFixed(1)}% but within threshold (${(threshold * 100).toFixed(1)}%)`
      : "Score stable or improved",
    previousScore,
    currentScore,
    dropPercent: Math.round(dropPercent * 1000) / 1000,
    threshold
  };
}
