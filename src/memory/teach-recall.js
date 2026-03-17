// @ts-check

import { buildTeachRecallQueries } from "./recall-queries.js";
import { searchOutputToChunks } from "./engram-client.js";

/** @typedef {import("../types/core-contracts.d.ts").MemoryRecallState} MemoryRecallState */
/** @typedef {import("../types/core-contracts.d.ts").TeachRecallResolution} TeachRecallResolution */
/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */

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

  try {
    /** @type {Map<string, Chunk>} */
    const uniqueChunks = new Map();
    const queriesTried = [];
    const matchedQueries = [];
    let firstMatchIndex = -1;
    const limit = input.limit ?? 3;

    for (const query of queryCandidates) {
      queriesTried.push(query);
      const memoryResult = await input.searchMemories(query, {
        project: input.project,
        scope: input.scope ?? "project",
        type: input.type,
        limit
      });
      const memoryChunks = searchOutputToChunks(memoryResult.stdout, {
        query,
        project: input.project
      });

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
