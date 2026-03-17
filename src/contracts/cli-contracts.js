// @ts-check

/** @typedef {import("../types/core-contracts.d.ts").CliContractMeta} CliContractMeta */

export const CLI_SCHEMA_VERSION = "1.0.0";

/**
 * @param {string} command
 * @param {Record<string, unknown>} payload
 * @param {CliContractMeta} [meta]
 */
export function buildCliJsonContract(command, payload, meta = {}) {
  return {
    schemaVersion: meta.schemaVersion ?? CLI_SCHEMA_VERSION,
    command,
    status: meta.status ?? "ok",
    degraded: meta.degraded === true,
    warnings: meta.warnings ?? [],
    config: {
      found: meta.configFound === true,
      path: meta.configPath ?? ""
    },
    meta: {
      generatedAt: meta.generatedAt ?? "",
      cwd: meta.cwd ?? "",
      durationMs: meta.durationMs ?? 0,
      debug: meta.debug === true,
      scanStats: meta.scanStats ?? null
    },
    ...payload
  };
}
