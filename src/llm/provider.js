// @ts-check

/**
 * @typedef {{
 *   model?: string,
 *   temperature?: number,
 *   maxTokens?: number,
 *   systemPrompt?: string
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
 * @param {unknown} value
 */
function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
    }
  };
}
