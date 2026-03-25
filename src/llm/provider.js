// @ts-check

/**
 * @typedef {{
 *   model?: string,
 *   temperature?: number,
 *   maxTokens?: number,
 *   systemPrompt?: string,
 *   timeoutMs?: number
 * }} LlmGenerateOptions
 */

/**
 * @typedef {{
 *   content: string,
 *   model?: string,
 *   finishReason?: string,
 *   usage?: {
 *     inputTokens: number,
 *     outputTokens: number,
 *     totalTokens: number
 *   },
 *   raw?: unknown
 * }} LlmGenerateResult
 */

/**
 * @typedef {{
 *   vector: number[],
 *   dimensions: number,
 *   model?: string,
 *   raw?: unknown
 * }} LlmEmbedResult
 */

/**
 * @typedef {{
 *   provider: string,
 *   generate: (prompt: string, options?: LlmGenerateOptions) => Promise<LlmGenerateResult>,
 *   stream?: (prompt: string, options?: LlmGenerateOptions) => AsyncIterable<string>,
 *   embed?: (text: string, options?: { model?: string }) => Promise<LlmEmbedResult>
 * }} LlmProvider
 */

/**
 * @typedef {{
 *   provider?: string,
 *   fallbackProviders?: string[],
 *   attemptTimeoutMs?: number,
 *   options?: LlmGenerateOptions
 * }} LlmFallbackInput
 */

/**
 * @param {unknown} value
 */
function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @param {unknown} value
 */
function asPositiveInteger(value) {
  return Math.max(0, Math.trunc(asFiniteNumber(value)));
}

/**
 * @param {import("./provider.js").LlmGenerateResult["usage"] | undefined} usage
 */
function normalizeUsage(usage) {
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    };
  }

  return {
    inputTokens: asPositiveInteger(usage.inputTokens),
    outputTokens: asPositiveInteger(usage.outputTokens),
    totalTokens: asPositiveInteger(usage.totalTokens)
  };
}

/**
 * @param {Array<{ provider: string, ok: boolean, durationMs: number, usage?: { inputTokens: number, outputTokens: number, totalTokens: number }, error?: string }>} attempts
 */
function summarizeAttempts(attempts) {
  let totalDurationMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let successfulProvider = "";
  let successfulAttempt = 0;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const usage = normalizeUsage(attempt.usage);

    totalDurationMs += asPositiveInteger(attempt.durationMs);
    totalInputTokens += usage.inputTokens;
    totalOutputTokens += usage.outputTokens;
    totalTokens += usage.totalTokens;

    if (attempt.ok && !successfulProvider) {
      successfulProvider = attempt.provider;
      successfulAttempt = index + 1;
    }
  }

  const attemptsCount = attempts.length;

  return {
    attemptsCount,
    failedAttempts: attempts.filter((entry) => !entry.ok).length,
    totalDurationMs,
    averageAttemptDurationMs: attemptsCount ? Math.round(totalDurationMs / attemptsCount) : 0,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    successfulProvider,
    successfulAttempt
  };
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} timeoutMessage
 */
async function awaitWithTimeout(promise, timeoutMs, timeoutMessage) {
  if (timeoutMs <= 0) {
    return promise;
  }

  /** @type {NodeJS.Timeout | null} */
  let timeout = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * @param {Partial<LlmGenerateResult>} input
 * @returns {LlmGenerateResult}
 */
export function normalizeGenerateResult(input) {
  const content = typeof input.content === "string" ? input.content : "";
  const usage = input.usage
    ? {
        inputTokens: Math.max(0, Math.round(asFiniteNumber(input.usage.inputTokens))),
        outputTokens: Math.max(0, Math.round(asFiniteNumber(input.usage.outputTokens))),
        totalTokens: Math.max(0, Math.round(asFiniteNumber(input.usage.totalTokens)))
      }
    : undefined;

  return {
    content,
    model: typeof input.model === "string" ? input.model : "",
    finishReason: typeof input.finishReason === "string" ? input.finishReason : "",
    usage,
    raw: input.raw
  };
}

/**
 * @param {{ get: (name?: string) => LlmProvider }} registry
 * @param {string} prompt
 * @param {LlmFallbackInput} [input]
 */
export async function generateWithProviderFallback(registry, prompt, input = {}) {
  const primaryName = typeof input.provider === "string" ? input.provider.trim() : "";
  const fallbackProviders = Array.isArray(input.fallbackProviders)
    ? input.fallbackProviders
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];
  const options = input.options ?? {};
  const attemptTimeoutMs = asPositiveInteger(input.attemptTimeoutMs ?? options.timeoutMs);
  const queue = [...new Set([primaryName, ...fallbackProviders].filter(Boolean))];

  if (!queue.length) {
    queue.push("");
  }

  /** @type {Array<{ provider: string, ok: boolean, durationMs: number, usage?: { inputTokens: number, outputTokens: number, totalTokens: number }, error?: string }>} */
  const attempts = [];
  /** @type {Error | null} */
  let lastError = null;

  for (const providerName of queue) {
    const startedAt = Date.now();
    try {
      const provider = registry.get(providerName);
      const generatePromise = provider.generate(prompt, options);
      const generated = await awaitWithTimeout(
        generatePromise,
        attemptTimeoutMs,
        `Provider '${provider.provider}' timed out after ${attemptTimeoutMs}ms.`
      );

      const normalized = normalizeGenerateResult(generated);
      const usage = normalizeUsage(normalized.usage);

      attempts.push({
        provider: provider.provider,
        ok: true,
        durationMs: Date.now() - startedAt,
        usage
      });

      return {
        provider: provider.provider,
        generated: normalized,
        attempts,
        summary: summarizeAttempts(attempts)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error(message);
      attempts.push({
        provider: providerName || "default",
        ok: false,
        durationMs: Date.now() - startedAt,
        error: message
      });
    }
  }

  const error = new Error(
    `All provider attempts failed: ${attempts.map((entry) => `${entry.provider}:${entry.error ?? "error"}`).join(" | ")}`
  );

  throw Object.assign(error, {
    attempts,
    summary: summarizeAttempts(attempts),
    cause: lastError
  });
}

/**
 * @param {{
 *   defaultProvider?: string,
 *   providers?: LlmProvider[]
 * }} [options]
 */
export function createLlmProviderRegistry(options = {}) {
  /** @type {Map<string, LlmProvider>} */
  const providers = new Map();

  for (const provider of options.providers ?? []) {
    if (provider?.provider) {
      providers.set(provider.provider, provider);
    }
  }

  let defaultProvider = options.defaultProvider ?? "";

  return {
    /**
     * @param {LlmProvider} provider
     */
    register(provider) {
      if (!provider || typeof provider.provider !== "string" || !provider.provider.trim()) {
        throw new Error("Invalid provider registration: provider name is required.");
      }

      if (typeof provider.generate !== "function") {
        throw new Error(`Provider '${provider.provider}' must implement generate().`);
      }

      providers.set(provider.provider, provider);

      if (!defaultProvider) {
        defaultProvider = provider.provider;
      }

      return provider;
    },

    /**
     * @param {string} [name]
     */
    get(name = "") {
      const resolved = name || defaultProvider;

      if (!resolved) {
        throw new Error("No LLM provider configured.");
      }

      const provider = providers.get(resolved);

      if (!provider) {
        throw new Error(`Unknown LLM provider '${resolved}'.`);
      }

      return provider;
    },

    /**
     * @param {string} name
     */
    setDefault(name) {
      if (!providers.has(name)) {
        throw new Error(`Cannot set default provider to '${name}': provider not registered.`);
      }

      defaultProvider = name;
      return defaultProvider;
    },

    list() {
      return [...providers.keys()].sort((left, right) => left.localeCompare(right));
    },

    getDefault() {
      return defaultProvider;
    },

    /**
     * @param {string} prompt
     * @param {LlmFallbackInput} [input]
     */
    async generateWithFallback(prompt, input = {}) {
      return generateWithProviderFallback(
        {
          get: (name = "") => this.get(name)
        },
        prompt,
        input
      );
    }
  };
}
