// @ts-check

import { buildTeachRecallQueries } from "./recall-queries.js";
import { searchOutputToChunks } from "./engram-client.js";

/** @typedef {import("../types/core-contracts.d.ts").MemoryRecallState} MemoryRecallState */
/** @typedef {import("../types/core-contracts.d.ts").TeachRecallResolution} TeachRecallResolution */
/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */

const DEFAULT_RECALL_RETRY_ATTEMPTS = 2;
const DEFAULT_RECALL_RETRY_BACKOFF_MS = 40;

/**
 * @param {unknown} error
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error
 */
function shouldRetryRecallError(error) {
  const normalized = errorMessage(error).toLowerCase();

  return (
    /etimedout|timed out|timeout/u.test(normalized) ||
    /econnreset|econnrefused|epipe/u.test(normalized) ||
    /temporary|temporarily|try again/u.test(normalized) ||
    /rate limit|429/u.test(normalized) ||
    /unavailable|service unavailable|busy/u.test(normalized)
  );
}

/**
 * @param {number} milliseconds
 */
function sleep(milliseconds) {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * @param {string} query
 * @param {{ project?: string, scope?: string, type?: string, limit?: number }} options
 * @param {{
 *   searchMemories: (query: string, options?: { project?: string, scope?: string, type?: string, limit?: number }) => Promise<{ stdout: string }>,
 *   retryAttempts: number,
 *   retryBackoffMs: number
 * }} runtime
 */
async function searchWithRetry(query, options, runtime) {
  let attempt = 0;
  /** @type {unknown} */
  let lastError = null;

  while (attempt < runtime.retryAttempts) {
    attempt += 1;

    try {
      return await runtime.searchMemories(query, options);
    } catch (error) {
      lastError = error;

      const isFinalAttempt = attempt >= runtime.retryAttempts;

      if (isFinalAttempt || !shouldRetryRecallError(error)) {
        throw error;
      }

      await sleep(runtime.retryBackoffMs * attempt);
    }
  }

  throw lastError ?? new Error("Engram recall failed with unknown error.");
}

/**
 * @param {string} [project]
 * @returns {MemoryRecallState}
 */
function disabledRecall(project = "") {
  return {
    enabled: false,
    status: "disabled",
    degraded: false,
    reason: "manual-disable",
    query: "",
    queriesTried: [],
    matchedQueries: [],
    project,
    recoveredChunks: 0,
    recoveredMemoryIds: [],
    firstMatchIndex: -1,
    selectedChunks: 0,
    suppressedChunks: 0,
    error: ""
  };
}

/**
 * @param {string} [project]
 * @returns {MemoryRecallState}
 */
function skippedRecall(project = "") {
  return {
    enabled: false,
    status: "skipped",
    degraded: false,
    reason: "empty-query",
    query: "",
    queriesTried: [],
    matchedQueries: [],
    project,
    recoveredChunks: 0,
    recoveredMemoryIds: [],
    firstMatchIndex: -1,
    selectedChunks: 0,
    suppressedChunks: 0,
    error: ""
  };
}

/**
 * @param {{
 *   task?: string,
 *   objective?: string,
 *   focus: string,
 *   changedFiles?: string[],
 *   project?: string,
 *   explicitQuery?: string,
 *   limit?: number,
 *   scope?: string,
 *   type?: string,
 *   strictRecall?: boolean,
 *   retryAttempts?: number,
 *   retryBackoffMs?: number,
 *   baseChunks?: Chunk[],
 *   searchMemories: (query: string, options?: { project?: string, scope?: string, type?: string, limit?: number }) => Promise<{ stdout: string }>
 * }} input
 * @returns {Promise<TeachRecallResolution>}
 */
export async function resolveTeachRecall(input) {
  const changedFiles = input.changedFiles ?? [];
  const baseChunks = input.baseChunks ?? [];
  const project = input.project ?? "";
  const queryCandidates = buildTeachRecallQueries({
    explicitQuery: input.explicitQuery,
    task: input.task,
    objective: input.objective,
    focus: input.focus,
    changedFiles
  });

  if (input.explicitQuery === "__disabled__") {
    return {
      chunks: baseChunks,
      memoryRecall: disabledRecall(project)
    };
  }

  if (!queryCandidates.length) {
    return {
      chunks: baseChunks,
      memoryRecall: skippedRecall(project)
    };
  }

  /** @type {Map<string, Chunk>} */
  const uniqueChunks = new Map();
  const queriesTried = [];
  const matchedQueries = [];
  let firstMatchIndex = -1;
  const limit = input.limit ?? 3;
  const retryAttempts = Math.max(1, Math.trunc(input.retryAttempts ?? DEFAULT_RECALL_RETRY_ATTEMPTS));
  const retryBackoffMs = Math.max(0, Math.trunc(input.retryBackoffMs ?? DEFAULT_RECALL_RETRY_BACKOFF_MS));
  let providerHadSuccess = false;
  let lastProviderError = "";

  try {
    for (const query of queryCandidates) {
      queriesTried.push(query);

      let memoryResult;

      try {
        memoryResult = await searchWithRetry(
          query,
          {
            project: input.project,
            scope: input.scope ?? "project",
            type: input.type,
            limit
          },
          {
            searchMemories: input.searchMemories,
            retryAttempts,
            retryBackoffMs
          }
        );
        providerHadSuccess = true;
      } catch (error) {
        lastProviderError = errorMessage(error);

        if (input.strictRecall) {
          throw error;
        }

        continue;
      }

      const memoryChunks = searchOutputToChunks(memoryResult.stdout, { query, project: input.project });

      if (memoryChunks.length) {
        matchedQueries.push(query);

        if (firstMatchIndex === -1) {
          firstMatchIndex = queriesTried.length - 1;
        }

        for (const chunk of memoryChunks) {
          uniqueChunks.set(chunk.id, chunk);
        }

        break;
      }
    }

    const memoryChunks = [...uniqueChunks.values()].slice(0, limit);
    const winningQuery = matchedQueries[0] ?? queryCandidates[0] ?? "";

    if (!providerHadSuccess && lastProviderError) {
      return {
        chunks: baseChunks,
        memoryRecall: {
          enabled: true,
          status: "failed",
          degraded: true,
          reason: "engram-error",
          query: queryCandidates[0] ?? "",
          queriesTried,
          matchedQueries: [],
          project,
          recoveredChunks: 0,
          recoveredMemoryIds: [],
          firstMatchIndex: -1,
          selectedChunks: 0,
          suppressedChunks: 0,
          error: `${lastProviderError} (retryAttempts=${retryAttempts}, retryBackoffMs=${retryBackoffMs})`
        }
      };
    }

    return {
      chunks: [...baseChunks, ...memoryChunks],
      memoryRecall: {
        enabled: true,
        status: memoryChunks.length ? "recalled" : "empty",
        degraded: false,
        reason: "",
        query: winningQuery,
        queriesTried,
        matchedQueries,
        project,
        recoveredChunks: memoryChunks.length,
        recoveredMemoryIds: memoryChunks.map((chunk) => chunk.id),
        firstMatchIndex,
        selectedChunks: 0,
        suppressedChunks: 0,
        error: ""
      }
    };
  } catch (error) {
    if (input.strictRecall) {
      throw error;
    }

    return {
      chunks: baseChunks,
      memoryRecall: {
        enabled: true,
        status: "failed",
        degraded: true,
        reason: "engram-error",
        query: queryCandidates[0] ?? "",
        queriesTried: queryCandidates,
        matchedQueries: [],
        project,
        recoveredChunks: 0,
        recoveredMemoryIds: [],
        firstMatchIndex: -1,
        selectedChunks: 0,
        suppressedChunks: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
