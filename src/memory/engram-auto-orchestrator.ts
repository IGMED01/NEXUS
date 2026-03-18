import {
  redactSensitiveContent,
  resolveSecurityPolicy,
  shouldIgnoreSensitiveFile,
  type SecurityPolicy,
  type SecurityPolicyInput
} from "../security/secret-redaction.js";
import { resolveTeachRecall } from "./teach-recall.js";
import type {
  Chunk,
  EngramSearchOptions,
  EngramSearchResult,
  MemoryRecallState,
  TeachRecallResolution
} from "../types/core-contracts.d.ts";

export interface AutoMemorySecurityOptions {
  ignoreSensitiveFiles?: boolean;
  redactSensitiveContent?: boolean;
  ignoreGeneratedFiles?: boolean;
  allowSensitivePaths?: string[];
  extraSensitivePathFragments?: string[];
}

export interface AutoRememberPayloadInput {
  task: string;
  objective: string;
  changedFiles: string[];
  selectedSources: string[];
  project?: string;
  recallState: MemoryRecallState;
  memoryType?: string;
  memoryScope?: string;
  security?: AutoMemorySecurityOptions;
}

export interface AutoMemorySecurityMeta {
  redacted: boolean;
  redactionCount: number;
  sensitivePathCount: number;
}

export interface AutoRememberPayload {
  title: string;
  content: string;
  type: string;
  scope: string;
  project?: string;
  security: AutoMemorySecurityMeta;
}

export interface ResolveAutoTeachRecallInput {
  task?: string;
  objective?: string;
  focus: string;
  changedFiles?: string[];
  project?: string;
  explicitQuery?: string;
  noRecall?: boolean;
  autoRecall?: boolean;
  limit?: number;
  scope?: string;
  type?: string;
  strictRecall?: boolean;
  baseChunks?: Chunk[];
  searchMemories: (
    query: string,
    options?: EngramSearchOptions
  ) => Promise<EngramSearchResult>;
}

function sanitizePathList(
  values: string[],
  securityPolicy: SecurityPolicy
): { values: string[]; sensitivePathCount: number } {
  const sanitized: string[] = [];
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

export async function resolveAutoTeachRecall(
  input: ResolveAutoTeachRecallInput
): Promise<TeachRecallResolution & { autoRecallEnabled: boolean }> {
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

function compactText(value: string, maxLength: number): string {
  const compacted = value.trim().replace(/\s+/g, " ");
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

export function buildTeachAutoRememberPayload(input: AutoRememberPayloadInput): AutoRememberPayload {
  const title = `Teach loop - ${compactText(input.task || "learning", 52)}`;
  const scope = input.memoryScope || "project";
  const type = input.memoryType || "learning";
  const recall = input.recallState;
  const securityPolicy: SecurityPolicyInput = {
    ...(input.security ?? {}),
    ignoreSensitiveFiles: true,
    redactSensitiveContent: true
  };
  const resolvedSecurityPolicy = resolveSecurityPolicy(securityPolicy);
  const changedFiles = sanitizePathList(input.changedFiles, resolvedSecurityPolicy);
  const topSources = sanitizePathList(input.selectedSources.slice(0, 4), resolvedSecurityPolicy);
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
