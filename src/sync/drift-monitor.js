// @ts-check

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_FILE_PATH = ".lcs/sync-drift.json";
const DEFAULT_WARNING_RATIO = 0.2;
const DEFAULT_CRITICAL_RATIO = 0.45;
const DEFAULT_SPIKE_MULTIPLIER = 2;
const DEFAULT_BASELINE_WINDOW = 8;
const MIN_TOTAL_CHANGE_FOR_SPIKE = 3;

/**
 * @param {unknown} value
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 */
function toFinite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @param {unknown} value
 */
function toPositiveInt(value) {
  return Math.max(0, Math.trunc(toFinite(value)));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function toRatio(value, fallback) {
  const ratio = toFinite(value);

  if (ratio <= 0) {
    return fallback;
  }

  return Math.min(1, ratio);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function toMultiplier(value, fallback) {
  const multiplier = toFinite(value);
  return multiplier > 0 ? multiplier : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function toWindow(value, fallback) {
  const window = toPositiveInt(value);
  return window > 0 ? Math.min(60, window) : fallback;
}

/**
 * @param {string} filePath
 */
async function loadState(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = asRecord(JSON.parse(raw.replace(/^\uFEFF/u, "")));
    return {
      history: Array.isArray(parsed.history)
        ? parsed.history.map((entry) => asRecord(entry))
        : []
    };
  } catch {
    return {
      history: []
    };
  }
}

/**
 * @param {string} filePath
 * @param {{ history: Record<string, unknown>[] }} state
 */
async function saveState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * @param {Record<string, unknown>} input
 */
function normalizeSnapshot(input) {
  const discovered = toPositiveInt(input.discovered);
  const created = toPositiveInt(input.created);
  const changed = toPositiveInt(input.changed);
  const deleted = toPositiveInt(input.deleted);
  const unchanged = toPositiveInt(input.unchanged);
  const totalChange = toPositiveInt(input.totalChange || created + changed + deleted);
  const changeRatio = discovered ? totalChange / discovered : 0;

  return {
    at: typeof input.at === "string" ? input.at : "",
    status: typeof input.status === "string" ? input.status : "unknown",
    discovered,
    created,
    changed,
    deleted,
    unchanged,
    totalChange,
    changeRatio: Number(changeRatio.toFixed(4))
  };
}

/**
 * @param {Array<{ changeRatio: number, totalChange: number }>} previousSnapshots
 * @param {{ changeRatio: number, totalChange: number }} latestSnapshot
 * @param {{ warningRatio: number, criticalRatio: number, spikeMultiplier: number, baselineWindow: number }} thresholds
 */
function evaluateDrift(previousSnapshots, latestSnapshot, thresholds) {
  const previousWindow = previousSnapshots.slice(-thresholds.baselineWindow);
  const baselineSamples = previousWindow.length;
  const baselineAvgRatio = baselineSamples
    ? previousWindow.reduce((total, snapshot) => total + toFinite(snapshot.changeRatio), 0) /
      baselineSamples
    : 0;
  const ratio = toFinite(latestSnapshot.changeRatio);
  const spike =
    baselineAvgRatio > 0 &&
    ratio >= baselineAvgRatio * thresholds.spikeMultiplier &&
    toPositiveInt(latestSnapshot.totalChange) >= MIN_TOTAL_CHANGE_FOR_SPIKE;

  let level = "stable";

  if (ratio >= thresholds.criticalRatio) {
    level = "critical";
  } else if (ratio >= thresholds.warningRatio) {
    level = "warning";
  }

  if (spike && level === "stable") {
    level = "warning";
  }

  return {
    level,
    spike,
    ratio: Number(ratio.toFixed(4)),
    baselineAvgRatio: Number(baselineAvgRatio.toFixed(4)),
    baselineSamples,
    warningRatio: thresholds.warningRatio,
    criticalRatio: thresholds.criticalRatio,
    spikeMultiplier: Number(thresholds.spikeMultiplier.toFixed(3))
  };
}

/**
 * @param {Record<string, unknown>[]} history
 * @param {{ warningRatio: number, criticalRatio: number, spikeMultiplier: number, baselineWindow: number }} thresholds
 */
function annotateHistory(history, thresholds) {
  /** @type {Array<ReturnType<typeof normalizeSnapshot> & { drift: ReturnType<typeof evaluateDrift> }>} */
  const annotated = [];

  for (const entry of history) {
    const snapshot = normalizeSnapshot(asRecord(entry));
    const drift = evaluateDrift(annotated, snapshot, thresholds);

    annotated.push({
      ...snapshot,
      drift
    });
  }

  return annotated;
}

/**
 * @param {Array<ReturnType<typeof normalizeSnapshot> & { drift: ReturnType<typeof evaluateDrift> }>} history
 */
function summarize(history) {
  if (!history.length) {
    return {
      samples: 0,
      avgCreated: 0,
      avgChanged: 0,
      avgDeleted: 0,
      avgDiscovered: 0,
      avgChangeRatio: 0,
      levels: {
        stable: 0,
        warning: 0,
        critical: 0
      },
      spikeCount: 0,
      latestLevel: "stable"
    };
  }

  let created = 0;
  let changed = 0;
  let deleted = 0;
  let discovered = 0;

  for (const item of history) {
    created += item.created;
    changed += item.changed;
    deleted += item.deleted;
    discovered += item.discovered;
  }

  const samples = history.length;
  const avgCreated = created / samples;
  const avgChanged = changed / samples;
  const avgDeleted = deleted / samples;
  const avgDiscovered = discovered / samples;
  const avgChangeRatio = avgDiscovered
    ? (avgCreated + avgChanged + avgDeleted) / avgDiscovered
    : 0;
  const levels = {
    stable: history.filter((item) => item.drift.level === "stable").length,
    warning: history.filter((item) => item.drift.level === "warning").length,
    critical: history.filter((item) => item.drift.level === "critical").length
  };
  const spikeCount = history.filter((item) => item.drift.spike).length;
  const latestLevel = history[history.length - 1]?.drift.level ?? "stable";

  return {
    samples,
    avgCreated: Number(avgCreated.toFixed(3)),
    avgChanged: Number(avgChanged.toFixed(3)),
    avgDeleted: Number(avgDeleted.toFixed(3)),
    avgDiscovered: Number(avgDiscovered.toFixed(3)),
    avgChangeRatio: Number(avgChangeRatio.toFixed(4)),
    levels,
    spikeCount,
    latestLevel
  };
}

/**
 * @param {{
 *   warningRatio?: number,
 *   criticalRatio?: number,
 *   spikeMultiplier?: number,
 *   baselineWindow?: number
 * }} [options]
 */
function resolveThresholds(options = {}) {
  const warningRatio = toRatio(options.warningRatio, DEFAULT_WARNING_RATIO);
  const criticalRatio = Math.max(
    warningRatio,
    toRatio(options.criticalRatio, DEFAULT_CRITICAL_RATIO)
  );
  const spikeMultiplier = toMultiplier(options.spikeMultiplier, DEFAULT_SPIKE_MULTIPLIER);
  const baselineWindow = toWindow(options.baselineWindow, DEFAULT_BASELINE_WINDOW);

  return {
    warningRatio: Number(warningRatio.toFixed(4)),
    criticalRatio: Number(criticalRatio.toFixed(4)),
    spikeMultiplier: Number(spikeMultiplier.toFixed(3)),
    baselineWindow
  };
}

/**
 * NEXUS:0 — monitor drift between sync runs.
 * @param {{
 *   filePath?: string,
 *   maxHistory?: number,
 *   warningRatio?: number,
 *   criticalRatio?: number,
 *   spikeMultiplier?: number,
 *   baselineWindow?: number
 * }} [options]
 */
export function createSyncDriftMonitor(options = {}) {
  const filePath = path.resolve(options.filePath ?? DEFAULT_FILE_PATH);
  const maxHistory = Math.max(5, Math.min(200, Math.trunc(Number(options.maxHistory ?? 60))));
  const defaultThresholds = resolveThresholds({
    warningRatio: options.warningRatio,
    criticalRatio: options.criticalRatio,
    spikeMultiplier: options.spikeMultiplier,
    baselineWindow: options.baselineWindow
  });

  return {
    filePath,
    maxHistory,

    /**
     * @param {{
     *   status?: string,
     *   summary?: {
     *     discovered?: number,
     *     created?: number,
     *     changed?: number,
     *     deleted?: number,
     *     unchanged?: number
     *   }
     * }} input
     */
    async record(input) {
      const state = await loadState(filePath);
      const summary = asRecord(input.summary);
      const discovered = toPositiveInt(summary.discovered);
      const created = toPositiveInt(summary.created);
      const changed = toPositiveInt(summary.changed);
      const deleted = toPositiveInt(summary.deleted);
      const unchanged = toPositiveInt(summary.unchanged);
      const totalChange = created + changed + deleted;
      const changeRatio = discovered ? totalChange / discovered : 0;
      const annotatedHistory = annotateHistory(state.history, defaultThresholds);

      const snapshot = {
        at: new Date().toISOString(),
        status: typeof input.status === "string" ? input.status : "unknown",
        discovered,
        created,
        changed,
        deleted,
        unchanged,
        totalChange,
        changeRatio: Number(changeRatio.toFixed(4)),
        drift: evaluateDrift(
          annotatedHistory,
          {
            changeRatio,
            totalChange
          },
          defaultThresholds
        )
      };

      state.history.push(snapshot);
      state.history = state.history.slice(-maxHistory);

      await saveState(filePath, state);
      const history = annotateHistory(state.history, defaultThresholds);

      return {
        latest: history[history.length - 1] ?? null,
        summary: summarize(history),
        historySize: state.history.length
      };
    },

    /**
     * @param {{
     *   warningRatio?: number,
     *   criticalRatio?: number,
     *   spikeMultiplier?: number,
     *   baselineWindow?: number
     * }} [overrides]
     */
    async getReport(overrides = {}) {
      const thresholds = resolveThresholds({
        ...defaultThresholds,
        ...overrides
      });
      const state = await loadState(filePath);
      const history = annotateHistory(state.history, thresholds);
      const latest = history.length ? history[history.length - 1] : null;

      return {
        filePath,
        maxHistory,
        thresholds,
        latest,
        summary: summarize(history),
        history
      };
    },

    getThresholds() {
      return defaultThresholds;
    }
  };
}
