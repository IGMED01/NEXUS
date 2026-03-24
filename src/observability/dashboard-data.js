// @ts-check

import { getObservabilityReport } from "./metrics-store.js";

/**
 * NEXUS:8 — shape dashboard-ready observability data.
 * @param {{
 *   metrics?: Awaited<ReturnType<typeof getObservabilityReport>>,
 *   includeCommandTable?: boolean,
 *   topCommands?: number
 * }} [options]
 */
export async function buildDashboardData(options = {}) {
  const metrics = options.metrics ?? (await getObservabilityReport());
  const topCommands = Math.max(1, Math.trunc(options.topCommands ?? 5));

  const commandRows = [...metrics.commands]
    .sort((left, right) => right.runs - left.runs)
    .slice(0, topCommands);

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: metrics.schemaVersion,
    health: {
      degradedRate: metrics.totals.degradedRate,
      blockedRate: metrics.totals.blockedRate,
      averageDurationMs: metrics.totals.averageDurationMs,
      recallHitRate: metrics.recall.hitRate
    },
    totals: metrics.totals,
    recall: metrics.recall,
    selection: metrics.selection,
    safety: metrics.safety,
    commands: options.includeCommandTable === false ? [] : commandRows
  };
}
