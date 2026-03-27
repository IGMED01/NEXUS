// @ts-check

import { createResilientMemoryClient } from "./resilient-memory-client.js";
import { createRufloMemoryAdapter } from "./ruflo-memory-adapter.js";

/**
 * Create a two-tier memory chain: Ruflo semantic recall -> local JSONL fallback.
 * Keeps the external provider optional and deterministic for offline environments.
 *
 * @param {{
 *   local: object,
 *   project?: string,
 *   namespace?: string,
 *   enabled?: boolean,
 *   skipRuflo?: boolean
 * }} input
 */
export function createRufloResilientClient(input) {
  const { local, project, namespace, enabled = true, skipRuflo = false } = input;

  if (skipRuflo) {
    return createResilientMemoryClient({
      primary: /** @type {any} */ (local),
      fallback: /** @type {any} */ (local),
      enabled
    });
  }

  const ruflo = createRufloMemoryAdapter({ project, namespace });

  return createResilientMemoryClient({
    primary: /** @type {any} */ (ruflo),
    fallback: /** @type {any} */ (local),
    enabled
  });
}
