import { buildTeachRecallQueries } from "./recall-queries.js";
import { searchOutputToChunks } from "./engram-client.js";
import type {
  Chunk,
  EngramSearchOptions,
  EngramSearchResult,
  MemoryRecallState,
  TeachRecallResolution
} from "../types/core-contracts.d.ts";

const DEFAULT_RECALL_RETRY_ATTEMPTS = 2;
const DEFAULT_RECALL_RETRY_BACKOFF_MS = 40;

interface SearchWithRetryRuntime {
  searchMemories: (query: string, options?: EngramSearchOptions) => Promise<EngramSearchResult>;
  retryAttempts: number;
  retryBackoffMs: number;
}

export interface ResolveTeachRecallInput {
  task?: string;
  objective?: string;
  focus: string;
  changedFiles?: string[];
  project?: string;
  explicitQuery?: string;
  limit?: number;
  scope?: string;
  type?: string;
  strictRecall?: boolean;
  retryAttempts?: number;
  retryBackoffMs?: number;
  baseChunks?: Chunk[];
  searchMemories: (
    query: string,
    options?: EngramSearchOptions
  ) => Promise<EngramSearchResult>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldRetryRecallError(error: unknown): boolean {
  const normalized = errorMessage(error).toLowerCase();

  return (
    /etimedout|timed out|timeout/u.test(normalized) ||
    /econnreset|econnrefused|epipe/u.test(normalized) ||
    /temporary|temporarily|try again/u.test(normalized) ||
    /rate limit|429/u.test(normalized) ||
    /unavailable|service unavailable|busy/u.test(normalized)
  );
}

function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function searchWithRetry(
  query: string,
  options: EngramSearchOptions,
  runtime: SearchWithRetryRuntime
): Promise<EngramSearchResult> {
  let attempt = 0;
  let lastError: unknown = null;

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

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Engram recall failed with unknown error.");
}

function disabledRecall(project = ""): MemoryRecallState {
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

function skippedRecall(project = ""): MemoryRecallState {
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

export async function resolveTeachRecall(
  input: ResolveTeachRecallInput
): Promise<TeachRecallResolution> {
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

  const uniqueChunks = new Map<string, Chunk>();
  const queriesTried: string[] = [];
  const matchedQueries: string[] = [];
  let firstMatchIndex = -1;
  const limit = input.limit ?? 3;
  const retryAttempts = Math.max(
    1,
    Math.trunc(input.retryAttempts ?? DEFAULT_RECALL_RETRY_ATTEMPTS)
  );
  const retryBackoffMs = Math.max(
    0,
    Math.trunc(input.retryBackoffMs ?? DEFAULT_RECALL_RETRY_BACKOFF_MS)
  );
  let providerHadSuccess = false;
  let lastProviderError = "";

  try {
    for (const query of queryCandidates) {
      queriesTried.push(query);

      let memoryResult: EngramSearchResult;

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
        error: errorMessage(error)
      }
    };
  }
}
