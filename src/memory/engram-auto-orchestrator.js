// @ts-check

import { resolveTeachRecall } from "./teach-recall.js";

/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */
/** @typedef {import("../types/core-contracts.d.ts").TeachRecallResolution} TeachRecallResolution */
/** @typedef {import("../types/core-contracts.d.ts").MemoryRecallState} MemoryRecallState */

/**
 * @typedef {{
 *   task: string,
 *   objective: string,
 *   changedFiles: string[],
 *   selectedSources: string[],
 *   project?: string,
 *   recallState: MemoryRecallState,
 *   memoryType?: string,
 *   memoryScope?: string
 * }} AutoRememberPayloadInput
 */

/**
 * @param {{
 *   task?: string,
 *   objective?: string,
 *   focus: string,
 *   changedFiles?: string[],
 *   project?: string,
 *   explicitQuery?: string,
 *   noRecall?: boolean,
 *   autoRecall?: boolean,
 *   limit?: number,
 *   scope?: string,
 *   type?: string,
 *   strictRecall?: boolean,
 *   baseChunks?: Chunk[],
 *   searchMemories: (query: string, options?: { project?: string, scope?: string, type?: string, limit?: number }) => Promise<{ stdout: string }>
 * }} input
 * @returns {Promise<TeachRecallResolution & { autoRecallEnabled: boolean }>}
 */
export async function resolveAutoTeachRecall(input) {
  const autoRecallEnabled = input.noRecall !== true && input.autoRecall !== false;

  const result = await resolveTeachRecall({
    task: input.task,
    objective: input.objective,
    focus: input.focus,
    changedFiles: input.changedFiles,
    project: input.project,
    explicitQuery: autoRecallEnabled ? input.explicitQuery : "__disabled__",
    limit: input.limit,
    scope: input.scope,
    type: input.type,
    strictRecall: input.strictRecall,
    baseChunks: input.baseChunks,
    searchMemories: input.searchMemories
  });

  return {
    ...result,
    autoRecallEnabled
  };
}

/**
 * @param {string} value
 * @param {number} maxLength
 */
function compactText(value, maxLength) {
  const compacted = value.trim().replace(/\s+/g, " ");
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}…` : compacted;
}

/**
 * @param {AutoRememberPayloadInput} input
 */
export function buildTeachAutoRememberPayload(input) {
  const title = `Teach loop - ${compactText(input.task || "learning", 52)}`;
  const scope = input.memoryScope || "project";
  const type = input.memoryType || "learning";
  const topSources = input.selectedSources.slice(0, 4).join(", ") || "none";
  const changedFiles = input.changedFiles.join(", ") || "none";
  const recall = input.recallState;

  const content = [
    "## Teach Auto Memory",
    "",
    `- Task: ${input.task}`,
    `- Objective: ${input.objective}`,
    `- Changed files: ${changedFiles}`,
    `- Recall status: ${recall.status}`,
    `- Recall query: ${recall.query || "none"}`,
    `- Recovered chunks: ${recall.recoveredChunks}`,
    `- Selected recalled chunks: ${recall.selectedChunks}`,
    `- Top selected context sources: ${topSources}`
  ].join("\n");

  return {
    title,
    content,
    type,
    scope,
    project: input.project
  };
}
