// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OBSERVABILITY_SCHEMA_VERSION = "1.0.0";
const DEFAULT_OBSERVABILITY_FILE = ".lcs/observability.json";

/**
 * @typedef {{
 *   command: string,
 *   durationMs: number,
 *   degraded?: boolean,
 *   selection?: {
 *     selectedCount?: number,
 *     suppressedCount?: number
 *   },
 *   recall?: {
 *     attempted?: boolean,
 *     status?: string,
 *     recoveredChunks?: number,
 *     selectedChunks?: number,
 *     suppressedChunks?: number,
 *     hit?: boolean
 *   },
 *   safety?: {
 *     blocked?: boolean,
 *     reason?: string,
 *     preventedError?: boolean
 *   }
 * }} CommandMetric
 */

/**
 * @param {unknown} value
 */
function toFiniteNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }

  return value;
}

/**
 * @param {number} value
 */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

function defaultStore() {
  return {
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    updatedAt: "",
    totals: {
      runs: 0,
      degradedRuns: 0,
      durationMsTotal: 0,
      blockedRuns: 0,
      preventedErrors: 0
    },
    commands: {},
    recall: {
      attempts: 0,
      hits: 0,
      recoveredChunksTotal: 0,
      selectedChunksTotal: 0,
      suppressedChunksTotal: 0,
      byStatus: {}
    },
    selection: {
      selectedTotal: 0,
      suppressedTotal: 0,
      samples: 0
    },
    safety: {
      blockedRuns: 0,
      preventedErrors: 0,
      byReason: {}
    }
  };
}

/**
 * @param {unknown} value
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {Record<string, unknown>} record
 */
function normalizedStore(record) {
  const defaults = defaultStore();
  const totals = asRecord(record.totals);
  const recall = asRecord(record.recall);
  const selection = asRecord(record.selection);
  const safety = asRecord(record.safety);
  const commands = asRecord(record.commands);

  return {
    schemaVersion:
      typeof record.schemaVersion === "string" && record.schemaVersion.trim()
        ? record.schemaVersion
        : defaults.schemaVersion,
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : "",
    totals: {
      runs: toFiniteNumber(totals.runs),
      degradedRuns: toFiniteNumber(totals.degradedRuns),
      durationMsTotal: toFiniteNumber(totals.durationMsTotal),
      blockedRuns: toFiniteNumber(totals.blockedRuns),
      preventedErrors: toFiniteNumber(totals.preventedErrors)
    },
    commands,
    recall: {
      attempts: toFiniteNumber(recall.attempts),
      hits: toFiniteNumber(recall.hits),
      recoveredChunksTotal: toFiniteNumber(recall.recoveredChunksTotal),
      selectedChunksTotal: toFiniteNumber(recall.selectedChunksTotal),
      suppressedChunksTotal: toFiniteNumber(recall.suppressedChunksTotal),
      byStatus: asRecord(recall.byStatus)
    },
    selection: {
      selectedTotal: toFiniteNumber(selection.selectedTotal),
      suppressedTotal: toFiniteNumber(selection.suppressedTotal),
      samples: toFiniteNumber(selection.samples)
    },
    safety: {
      blockedRuns: toFiniteNumber(safety.blockedRuns),
      preventedErrors: toFiniteNumber(safety.preventedErrors),
      byReason: asRecord(safety.byReason)
    }
  };
}

/**
 * @param {string} filePath
 */
async function loadStore(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/u, ""));

    return {
      found: true,
      error: "",
      store: normalizedStore(asRecord(parsed))
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT/i.test(error.message)) {
      return {
        found: false,
        error: "",
        store: defaultStore()
      };
    }

    return {
      found: false,
      error: error instanceof Error ? error.message : String(error),
      store: defaultStore()
    };
  }
}

/**
 * @param {ReturnType<typeof normalizedStore>} store
 * @param {CommandMetric} metric
 */
function applyMetric(store, metric) {
  const now = new Date().toISOString();
  const durationMs = Math.max(0, Math.round(toFiniteNumber(metric.durationMs)));
  const degraded = metric.degraded === true;
  const command = metric.command.trim() || "unknown";
  const commandStats = asRecord(store.commands[command]);

  store.updatedAt = now;
  store.totals.runs += 1;
  store.totals.durationMsTotal += durationMs;

  if (degraded) {
    store.totals.degradedRuns += 1;
  }

  store.commands[command] = {
    runs: toFiniteNumber(commandStats.runs) + 1,
    degradedRuns: toFiniteNumber(commandStats.degradedRuns) + (degraded ? 1 : 0),
    blockedRuns: toFiniteNumber(commandStats.blockedRuns),
    durationMsTotal: toFiniteNumber(commandStats.durationMsTotal) + durationMs,
    lastDurationMs: durationMs,
    lastRunAt: now
  };

  if (metric.safety?.blocked) {
    const safetySummary = store.safety;
    const safetyReasonCounts = asRecord(safetySummary.byReason);
    const safetyReason = metric.safety.reason?.trim() || "unknown";
    const currentCommandStats = asRecord(store.commands[command]);

    safetySummary.blockedRuns += 1;
    safetySummary.byReason = safetyReasonCounts;
    safetyReasonCounts[safetyReason] = toFiniteNumber(safetyReasonCounts[safetyReason]) + 1;
    store.totals.blockedRuns += 1;
    store.commands[command] = {
      ...currentCommandStats,
      blockedRuns: toFiniteNumber(currentCommandStats.blockedRuns) + 1
    };
  }

  if (metric.safety?.preventedError) {
    store.safety.preventedErrors += 1;
    store.totals.preventedErrors += 1;
  }

  const selectedCount = Math.max(0, Math.round(toFiniteNumber(metric.selection?.selectedCount)));
  const suppressedCount = Math.max(0, Math.round(toFiniteNumber(metric.selection?.suppressedCount)));

  if (selectedCount > 0 || suppressedCount > 0) {
    store.selection.samples += 1;
    store.selection.selectedTotal += selectedCount;
    store.selection.suppressedTotal += suppressedCount;
  }

  if (metric.recall?.attempted) {
    const recoveredChunks = Math.max(
      0,
      Math.round(toFiniteNumber(metric.recall.recoveredChunks))
    );
    const selectedChunks = Math.max(0, Math.round(toFiniteNumber(metric.recall.selectedChunks)));
    const suppressedChunks = Math.max(
      0,
      Math.round(toFiniteNumber(metric.recall.suppressedChunks))
    );
    const hit = metric.recall.hit === true || recoveredChunks > 0;
    const status = metric.recall.status?.trim() || "unknown";
    const statusCounts = asRecord(store.recall.byStatus);

    store.recall.attempts += 1;
    store.recall.recoveredChunksTotal += recoveredChunks;
    store.recall.selectedChunksTotal += selectedChunks;
    store.recall.suppressedChunksTotal += suppressedChunks;
    store.recall.byStatus = statusCounts;
    statusCounts[status] = toFiniteNumber(statusCounts[status]) + 1;

    if (hit) {
      store.recall.hits += 1;
    }
  }
}

/**
 * @param {string} filePath
 * @param {ReturnType<typeof normalizedStore>} store
 */
async function persistStore(filePath, store) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/**
 * @param {{ cwd?: string, filePath?: string }} [options]
 */
function resolveMetricsPath(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const override = options.filePath ?? process.env.LCS_OBSERVABILITY_FILE ?? DEFAULT_OBSERVABILITY_FILE;

  return path.resolve(cwd, override);
}

/**
 * @param {CommandMetric} metric
 * @param {{ cwd?: string, filePath?: string }} [options]
 */
export async function recordCommandMetric(metric, options = {}) {
  const filePath = resolveMetricsPath(options);

  try {
    const loaded = await loadStore(filePath);
    applyMetric(loaded.store, metric);
    await persistStore(filePath, loaded.store);

    return {
      stored: true,
      filePath,
      error: ""
    };
  } catch (error) {
    return {
      stored: false,
      filePath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {Record<string, unknown>} commands
 */
function commandSummary(commands) {
  return Object.entries(commands)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([command, raw]) => {
      const item = asRecord(raw);
      const runs = toFiniteNumber(item.runs);
      const degradedRuns = toFiniteNumber(item.degradedRuns);
      const blockedRuns = toFiniteNumber(item.blockedRuns);
      const durationMsTotal = toFiniteNumber(item.durationMsTotal);

      return {
        command,
        runs,
        degradedRuns,
        blockedRuns,
        degradedRate: runs ? round(degradedRuns / runs) : 0,
        blockedRate: runs ? round(blockedRuns / runs) : 0,
        averageDurationMs: runs ? round(durationMsTotal / runs) : 0,
        lastDurationMs: toFiniteNumber(item.lastDurationMs),
        lastRunAt: typeof item.lastRunAt === "string" ? item.lastRunAt : ""
      };
    });
}

/**
 * @param {{ cwd?: string, filePath?: string }} [options]
 */
export async function getObservabilityReport(options = {}) {
  const filePath = resolveMetricsPath(options);
  const loaded = await loadStore(filePath);
  const totals = loaded.store.totals;
  const recall = loaded.store.recall;
  const selection = loaded.store.selection;
  const safety = loaded.store.safety;

  return {
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    filePath,
    found: loaded.found,
    loadError: loaded.error,
    updatedAt: loaded.store.updatedAt,
    totals: {
      runs: totals.runs,
      degradedRuns: totals.degradedRuns,
      blockedRuns: totals.blockedRuns,
      preventedErrors: totals.preventedErrors,
      degradedRate: totals.runs ? round(totals.degradedRuns / totals.runs) : 0,
      blockedRate: totals.runs ? round(totals.blockedRuns / totals.runs) : 0,
      averageDurationMs: totals.runs ? round(totals.durationMsTotal / totals.runs) : 0
    },
    commands: commandSummary(loaded.store.commands),
    recall: {
      attempts: recall.attempts,
      hits: recall.hits,
      hitRate: recall.attempts ? round(recall.hits / recall.attempts) : 0,
      recoveredChunksTotal: recall.recoveredChunksTotal,
      selectedChunksTotal: recall.selectedChunksTotal,
      suppressedChunksTotal: recall.suppressedChunksTotal,
      byStatus: recall.byStatus
    },
    selection: {
      samples: selection.samples,
      selectedTotal: selection.selectedTotal,
      suppressedTotal: selection.suppressedTotal,
      averageSelected: selection.samples ? round(selection.selectedTotal / selection.samples) : 0,
      averageSuppressed: selection.samples
        ? round(selection.suppressedTotal / selection.samples)
        : 0
    },
    safety: {
      blockedRuns: safety.blockedRuns,
      preventedErrors: safety.preventedErrors,
      byReason: safety.byReason
    }
  };
}
