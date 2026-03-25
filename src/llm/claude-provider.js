// @ts-check

import { createHash } from "node:crypto";
import { normalizeGenerateResult } from "./provider.js";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";

/**
 * @typedef {{
 *   apiKey?: string,
 *   model?: string,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 *   defaultMaxTokens?: number,
 *   defaultTemperature?: number
 * }} ClaudeProviderOptions
 */

/**
 * @param {unknown} value
 */
function asText(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {number} dimensions
 * @param {string} text
 */
function pseudoEmbedding(dimensions, text) {
  const hash = createHash("sha256").update(text).digest();
  /** @type {number[]} */
  const vector = [];

  for (let index = 0; index < dimensions; index += 1) {
    const byte = hash[index % hash.length] ?? 0;
    vector.push((byte - 127) / 127);
  }

  return vector;
}

/**
 * @param {unknown} payload
 */
function extractText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = /** @type {Record<string, unknown>} */ (payload);
  const content = Array.isArray(record.content) ? record.content : [];

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const chunk = /** @type {Record<string, unknown>} */ (part);
      return chunk.type === "text" ? asText(chunk.text) : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * @param {ClaudeProviderOptions} [options]
 */
export function createClaudeProvider(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Claude provider requires Fetch API support.");
  }

  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || "";

  return {
    provider: "claude",

    /**
     * @param {string} prompt
     * @param {import("./provider.js").LlmGenerateOptions} [generateOptions]
     */
    async generate(prompt, generateOptions = {}) {
      if (!apiKey) {
        throw new Error("Missing ANTHROPIC_API_KEY for Claude provider.");
      }

      const controller = new AbortController();
      const timeoutMs = Math.max(1000, Number(generateOptions.timeoutMs ?? options.timeoutMs ?? 30000));
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(options.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: generateOptions.model ?? options.model ?? DEFAULT_MODEL,
            max_tokens: Math.max(64, Number(generateOptions.maxTokens ?? options.defaultMaxTokens ?? 600)),
            temperature: Number(generateOptions.temperature ?? options.defaultTemperature ?? 0.2),
            system: generateOptions.systemPrompt ?? "",
            messages: [
              {
                role: "user",
                content: prompt
              }
            ]
          })
        });

        const rawText = await response.text();
        let payload = {};

        try {
          payload = rawText ? JSON.parse(rawText) : {};
        } catch {
          payload = {};
        }

        if (!response.ok) {
          const message =
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            payload.error &&
            typeof payload.error === "object" &&
            "message" in payload.error
              ? asText(/** @type {Record<string, unknown>} */ (payload.error).message)
              : rawText || response.statusText;

          throw new Error(`Claude API request failed (${response.status}): ${message}`);
        }

        const usagePayload =
          payload && typeof payload === "object" && "usage" in payload
            ? /** @type {Record<string, unknown>} */ (payload.usage)
            : {};
        const inputTokens = Math.max(0, Number(usagePayload.input_tokens ?? usagePayload.inputTokens ?? 0));
        const outputTokens = Math.max(0, Number(usagePayload.output_tokens ?? usagePayload.outputTokens ?? 0));

        return normalizeGenerateResult({
          content: extractText(payload),
          model:
            payload && typeof payload === "object" && "model" in payload
              ? asText(/** @type {Record<string, unknown>} */ (payload).model)
              : generateOptions.model ?? options.model ?? DEFAULT_MODEL,
          finishReason:
            payload && typeof payload === "object" && "stop_reason" in payload
              ? asText(/** @type {Record<string, unknown>} */ (payload).stop_reason)
              : "",
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens
          },
          raw: payload
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Claude API request timed out after ${timeoutMs}ms.`);
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },

    /**
     * @param {string} prompt
     * @param {import("./provider.js").LlmGenerateOptions} [generateOptions]
     */
    async *stream(prompt, generateOptions = {}) {
      const generated = await this.generate(prompt, generateOptions);
      if (generated.content) {
        yield generated.content;
      }
    },

    /**
     * @param {string} text
     * @param {{ model?: string }} [embedOptions]
     */
    async embed(text, embedOptions = {}) {
      const dimensions = 32;
      return {
        vector: pseudoEmbedding(dimensions, text),
        dimensions,
        model: embedOptions.model ?? options.model ?? "claude-pseudo-embed",
        raw: {
          deterministic: true
        }
      };
    }
  };
}
