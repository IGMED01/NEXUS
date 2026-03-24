// @ts-check

/**
 * @typedef {{
 *   started: boolean,
 *   intervalMs: number,
 *   running: boolean,
 *   runCount: number,
 *   successCount: number,
 *   failureCount: number,
 *   lastRunAt: string,
 *   lastSuccessAt: string,
 *   lastErrorAt: string,
 *   lastError: string,
 *   nextRunAt: string
 * }} SyncSchedulerStatus
 */

/**
 * NEXUS:0 — scheduler for periodic sync jobs.
 * @param {{ intervalMs?: number, onTick: () => Promise<unknown>, autoStart?: boolean }} options
 */
export function createSyncScheduler(options) {
  if (!options || typeof options.onTick !== "function") {
    throw new Error("createSyncScheduler requires an async onTick callback.");
  }

  const intervalMs = Math.max(1000, Number(options.intervalMs ?? 60000));
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  let running = false;
  const status = {
    started: false,
    intervalMs,
    running: false,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRunAt: "",
    lastSuccessAt: "",
    lastErrorAt: "",
    lastError: "",
    nextRunAt: ""
  };

  async function runTick() {
    if (running) {
      return;
    }

    running = true;
    status.running = true;
    status.lastRunAt = new Date().toISOString();
    status.runCount += 1;

    try {
      await options.onTick();
      status.successCount += 1;
      status.lastSuccessAt = new Date().toISOString();
      status.lastError = "";
    } catch (error) {
      status.failureCount += 1;
      status.lastErrorAt = new Date().toISOString();
      status.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      running = false;
      status.running = false;
      status.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    }
  }

  function start() {
    if (timer) {
      return false;
    }

    status.started = true;
    status.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    timer = setInterval(() => {
      runTick().catch(() => {
        // tick errors are captured in status
      });
    }, intervalMs);
    return true;
  }

  function stop() {
    if (!timer) {
      return false;
    }

    clearInterval(timer);
    timer = null;
    status.started = false;
    status.nextRunAt = "";
    return true;
  }

  if (options.autoStart !== false) {
    start();
  }

  return {
    intervalMs,
    start,
    stop,
    runNow: runTick,
    getStatus() {
      return {
        ...status
      };
    }
  };
}
