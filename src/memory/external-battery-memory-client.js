// @ts-check

import { createResilientMemoryClient } from "./resilient-memory-client.js";

/**
 * @typedef {import("../types/core-contracts.d.ts").MemoryProvider} MemoryProvider
 */

/**
 * @template {Record<string, unknown>} T
 * @param {T} result
 * @param {string} provider
 * @returns {T}
 */
function tagProvider(result, provider) {
  return /** @type {T} */ ({
    ...result,
    provider
  });
}

/**
 * @param {MemoryProvider} provider
 * @param {string} [label]
 * @returns {MemoryProvider}
 */
export function wrapMemoryProviderAsExternalBattery(provider, label = "engram-battery") {
  return /** @type {MemoryProvider} */ ({
    ...provider,
    name: label,
    async search(query, options = {}) {
      return /** @type {any} */ (tagProvider(/** @type {any} */ (await provider.search(query, options)), label));
    },
    async save(input) {
      return /** @type {any} */ (tagProvider(/** @type {any} */ (await provider.save(input)), label));
    },
    async delete(id, project) {
      return await provider.delete(id, project);
    },
    async list(options = {}) {
      return await provider.list(options);
    },
    async health() {
      const result = await provider.health();
      return {
        ...result,
        provider: label,
        detail: `External battery: ${result.detail}`
      };
    },
    async recallContext(project) {
      const result = /** @type {any} */ (await provider.recallContext(project));
      return {
        ...result,
        stdout: String(result.stdout ?? ""),
        provider: label
      };
    },
    async searchMemories(query, options = {}) {
      const result = /** @type {any} */ (await provider.searchMemories(query, options));
      return {
        ...result,
        stdout: String(result.stdout ?? ""),
        provider: label
      };
    },
    async saveMemory(input) {
      return /** @type {any} */ (tagProvider(/** @type {any} */ (await provider.saveMemory(input)), label));
    },
    async closeSession(input) {
      return /** @type {any} */ (tagProvider(/** @type {any} */ (await provider.closeSession(input)), label));
    }
  });
}

/**
 * @param {{
 *   primary: MemoryProvider,
 *   battery: MemoryProvider,
 *   enabled?: boolean
 * }} input
 * @returns {MemoryProvider}
 */
export function createExternalBatteryMemoryClient(input) {
  return /** @type {MemoryProvider} */ (createResilientMemoryClient({
    primary: input.primary,
    fallback: wrapMemoryProviderAsExternalBattery(input.battery),
    enabled: input.enabled !== false,
    fallbackDescription: "external battery memory provider"
  }));
}
