// @ts-check

import {
  redactSensitiveContent,
  resolveSecurityPolicy,
  shouldIgnoreSensitiveFile
} from "../security/secret-redaction.js";
import { resolveTeachRecall } from "./teach-recall.js";

/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */
/** @typedef {import("../types/core-contracts.d.ts").TeachRecallResolution} TeachRecallResolution */
/** @typedef {import("../types/core-contracts.d.ts").MemoryRecallState} MemoryRecallState */

/**
 * @typedef {{
 *   ignoreSensitiveFiles?: boolean,
 *   redactSensitiveContent?: boolean,
 *   ignoreGeneratedFiles?: boolean,
 *   allowSensitivePaths?: string[],
 *   extraSensitivePathFragments?: string[]
 * }} AutoMemorySecurityOptions
 */

/**
 * @typedef {{
 *   task: string,
 *   objective: string,
 *   changedFiles: string[],
 *   selectedSources: string[],
 *   project?: string,
 *   recallState: MemoryRecallState,
 *   memoryType?: string,
 *   memoryScope?: string,
 *   security?: AutoMemorySecurityOptions
 * }} AutoRememberPayloadInput
 */

/**
 * @typedef {{
 *   redacted: boolean,
 *   redactionCount: number,
 *   sensitivePathCount: number
 * }} AutoMemorySecurityMeta
 */

/**
 * @typedef {{
 *   title: string,
 *   content: string,
 *   type: string,
 *   scope: string,
 *   project?: string,
 *   security: AutoMemorySecurityMeta
 * }} AutoRememberPayload
 */

/**
 * @param {string[]} values
 * @param {ReturnType<typeof resolveSecurityPolicy>} securityPolicy
 */
function sanitizePathList(values, securityPolicy) {
  /** @type {string[]} */
  const sanitized = [];
  let sensitivePathCount = 0;

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (shouldIgnoreSensitiveFile(value, securityPolicy)) {
      sensitivePathCount += 1;
      sanitized.push("[redacted-sensitive-path]");
      continue;
    }

    sanitized.push(value);
  }

  return {
    values: sanitized,
    sensitivePathCount
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
  const canUseAutoRecall = input.noRecall !== true && input.autoRecall !== false;
  const hasExplicitQuery = Boolean(input.explicitQuery && input.explicitQuery.trim().length > 0);
  const changedFiles = (input.changedFiles ?? []).filter(Boolean);
  const signalText = [input.task, input.objective, input.focus].filter(Boolean).join(" ").trim();
  const lowSignalTask = !hasExplicitQuery && changedFiles.length === 0 && signalText.length < 72;
  const autoRecallEnabled = canUseAutoRecall && !lowSignalTask;

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

  if (lowSignalTask) {
    return {
      ...result,
      autoRecallEnabled: false,
      memoryRecall: {
        ...result.memoryRecall,
        status: "skipped",
        reason: "low-signal-task"
      }
    };
  }

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
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

/**
 * @param {AutoRememberPayloadInput} input
 * @returns {AutoRememberPayload}
 */
export function buildTeachAutoRememberPayload(input) {
  const title = `Teach loop - ${compactText(input.task || "learning", 52)}`;
  const scope = input.memoryScope || "project";
  const type = input.memoryType || "learning";
  const recall = input.recallState;
  const securityPolicy = resolveSecurityPolicy({
    ...(input.security ?? {}),
    ignoreSensitiveFiles: true,
    redactSensitiveContent: true
  });
  const changedFiles = sanitizePathList(input.changedFiles, securityPolicy);
  const topSources = sanitizePathList(input.selectedSources.slice(0, 4), securityPolicy);
  const sensitivePathCount = changedFiles.sensitivePathCount + topSources.sensitivePathCount;

  const rawContent = [
    "## Teach Auto Memory",
    "",
    `- Task: ${input.task}`,
    `- Objective: ${input.objective}`,
    `- Changed files: ${changedFiles.values.join(", ") || "none"}`,
    `- Recall status: ${recall.status}`,
    `- Recall query: ${recall.query || "none"}`,
    `- Recovered chunks: ${recall.recoveredChunks}`,
    `- Selected recalled chunks: ${recall.selectedChunks}`,
    `- Top selected context sources: ${topSources.values.join(", ") || "none"}`
  ].join("\n");
  const redaction = redactSensitiveContent(rawContent, securityPolicy);

  return {
    title,
    content: redaction.content,
    type,
    scope,
    project: input.project,
    security: {
      redacted: redaction.redacted,
      redactionCount: redaction.redactionCount,
      sensitivePathCount
    }
  };
}
