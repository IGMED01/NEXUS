// @ts-check

/**
 * @param {unknown} error
 * @returns {string}
 */
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} error
 * @returns {"binary-missing" | "timeout" | "malformed-output" | "unknown"}
 */
export function classifyMemoryFailure(error) {
  const message = toErrorMessage(error).toLowerCase();

  if (/enoent|cannot find|not recognized as an internal or external command/i.test(message)) {
    return "binary-missing";
  }

  if (/etimedout|timed out|timeout|killed|sigterm/i.test(message)) {
    return "timeout";
  }

  if (/malformed|parse|unexpected output|unexpected token|invalid format/i.test(message)) {
    return "malformed-output";
  }

  return "unknown";
}

/**
 * @param {"binary-missing" | "timeout" | "malformed-output" | "unknown"} failureKind
 */
export function memoryFailureFixHint(failureKind) {
  if (failureKind === "binary-missing") {
    return "Verify --engram-bin path or learning-context.config.json -> engram.binaryPath.";
  }

  if (failureKind === "timeout") {
    return "Retry recall, reduce query scope, and verify Engram runtime health.";
  }

  if (failureKind === "malformed-output") {
    return "Update Engram and validate output format with doctor + recall --debug.";
  }

  return "Run doctor and verify Engram binary and data directory settings.";
}

/**
 * @param {string} operation
 * @param {unknown} error
 * @returns {string}
 */
function fallbackWarning(operation, error) {
  const kind = classifyMemoryFailure(error);
  return `Engram failed during ${operation}; using local fallback memory store (${kind}).`;
}

/**
 * @param {{
 *   primary: {
 *     config?: { dataDir?: string },
 *     recallContext: (project?: string) => Promise<Record<string, unknown> & { stdout?: string }>,
 *     searchMemories: (query: string, options?: { project?: string, scope?: string, type?: string, limit?: number }) => Promise<Record<string, unknown> & { stdout: string }>,
 *     saveMemory: (input: { title: string, content: string, type?: string, project?: string, scope?: string, topic?: string }) => Promise<Record<string, unknown>>,
 *     closeSession: (input: { summary: string, learned?: string, next?: string, title?: string, project?: string, scope?: string, type?: string }) => Promise<Record<string, unknown>>
 *   },
 *   fallback: {
 *     config?: { dataDir?: string, filePath?: string },
 *     recallContext: (project?: string) => Promise<Record<string, unknown> & { stdout?: string }>,
 *     searchMemories: (query: string, options?: { project?: string, scope?: string, type?: string, limit?: number }) => Promise<Record<string, unknown> & { stdout: string }>,
 *     saveMemory: (input: { title: string, content: string, type?: string, project?: string, scope?: string, topic?: string }) => Promise<Record<string, unknown>>,
 *     closeSession: (input: { summary: string, learned?: string, next?: string, title?: string, project?: string, scope?: string, type?: string }) => Promise<Record<string, unknown>>
 *   },
 *   enabled?: boolean
 * }} input
 * @returns {{
 *   config: { dataDir?: string, filePath?: string },
 *   recallContext: (project?: string) => Promise<Record<string, unknown> & { stdout?: string, provider: string, degraded?: boolean, warning?: string, error?: string, failureKind?: string, fixHint?: string }>,
 *   searchMemories: (query: string, options?: { project?: string, scope?: string, type?: string, limit?: number }) => Promise<Record<string, unknown> & { stdout: string, provider: string, degraded?: boolean, warning?: string, error?: string, failureKind?: string, fixHint?: string }>,
 *   saveMemory: (input: { title: string, content: string, type?: string, project?: string, scope?: string, topic?: string }) => Promise<Record<string, unknown> & { provider: string, degraded?: boolean, warning?: string, error?: string, failureKind?: string, fixHint?: string }>,
 *   closeSession: (input: { summary: string, learned?: string, next?: string, title?: string, project?: string, scope?: string, type?: string }) => Promise<Record<string, unknown> & { provider: string, degraded?: boolean, warning?: string, error?: string, failureKind?: string, fixHint?: string }>
 * }}
 */
export function createResilientMemoryClient(input) {
  const enabled = input.enabled !== false;
  const primary = input.primary;
  const fallback = input.fallback;

  /**
   * @template T
   * @param {string} operation
   * @param {() => Promise<T>} runPrimary
   * @param {() => Promise<T>} runFallback
   * @returns {Promise<T & { provider: string, degraded?: boolean, warning?: string, error?: string, failureKind?: string, fixHint?: string }>}
   */
  async function withFallback(operation, runPrimary, runFallback) {
    try {
      const result = await runPrimary();
      return {
        ...(/** @type {T & Record<string, unknown>} */ (result)),
        provider: "engram"
      };
    } catch (primaryError) {
      if (!enabled) {
        throw primaryError;
      }

      const failureKind = classifyMemoryFailure(primaryError);
      const warning = fallbackWarning(operation, primaryError);

      try {
        const fallbackResult = await runFallback();
        return {
          ...(/** @type {T & Record<string, unknown>} */ (fallbackResult)),
          provider: "local",
          degraded: true,
          warning,
          error: toErrorMessage(primaryError),
          failureKind,
          fixHint: memoryFailureFixHint(failureKind)
        };
      } catch (fallbackError) {
        throw new Error(
          [
            `Primary memory backend failed (${operation}): ${toErrorMessage(primaryError)}`,
            `Fallback memory backend failed (${operation}): ${toErrorMessage(fallbackError)}`
          ].join("\n")
        );
      }
    }
  }

  return {
    config: primary.config ?? fallback.config ?? {},
    /**
     * @param {string} [project]
     */
    recallContext(project) {
      return withFallback(
        "recallContext",
        () => primary.recallContext(project),
        () => fallback.recallContext(project)
      );
    },
    /**
     * @param {string} query
     * @param {{ project?: string, scope?: string, type?: string, limit?: number }} [options]
     */
    searchMemories(query, options = {}) {
      return withFallback(
        "searchMemories",
        () => primary.searchMemories(query, options),
        () => fallback.searchMemories(query, options)
      );
    },
    /**
     * @param {{ title: string, content: string, type?: string, project?: string, scope?: string, topic?: string }} payload
     */
    saveMemory(payload) {
      return withFallback(
        "saveMemory",
        () => primary.saveMemory(payload),
        () => fallback.saveMemory(payload)
      );
    },
    /**
     * @param {{ summary: string, learned?: string, next?: string, title?: string, project?: string, scope?: string, type?: string }} payload
     */
    closeSession(payload) {
      return withFallback(
        "closeSession",
        () => primary.closeSession(payload),
        () => fallback.closeSession(payload)
      );
    }
  };
}
