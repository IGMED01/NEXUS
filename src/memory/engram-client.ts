import { execFile as execFileCallback } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  Chunk,
  EngramCommandResult,
  EngramResolvedConfig,
  EngramSearchOptions
} from "../types/core-contracts.d.ts";

const execFile = promisify(execFileCallback);

interface CommandOutput {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

type ExecFunction = (
  file: string,
  args: string[],
  options: ExecFileOptions
) => Promise<CommandOutput>;

interface CreateEngramClientOptions {
  cwd?: string;
  binaryPath?: string;
  dataDir?: string;
  exec?: ExecFunction;
}

interface RecallOptions {
  query?: string;
  project?: string;
}

interface SaveMemoryInput {
  title: string;
  content: string;
  type?: string;
  project?: string;
  scope?: string;
  topic?: string;
}

interface CloseSessionInput {
  summary: string;
  learned?: string;
  next?: string;
  title?: string;
  project?: string;
  scope?: string;
  type?: string;
}

interface CloseSummaryInput {
  summary: string;
  learned?: string;
  next?: string;
  workspace?: string;
  closedAt: string;
}

interface ExecErrorLike {
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  message?: unknown;
}

export function resolveEngramConfig(options: {
  cwd?: string;
  binaryPath?: string;
  dataDir?: string;
} = {}): EngramResolvedConfig {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const binaryPath = path.resolve(
    cwd,
    options.binaryPath ?? process.env.ENGRAM_BIN ?? "tools/engram/engram.exe"
  );
  const dataDir = path.resolve(cwd, options.dataDir ?? process.env.ENGRAM_DATA_DIR ?? ".engram");

  return {
    cwd,
    binaryPath,
    dataDir
  };
}

async function defaultExec(file: string, args: string[], options: ExecFileOptions): Promise<CommandOutput> {
  return execFile(file, args, {
    ...options,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 5
  });
}

function normalizeExecText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim();
  }

  return "";
}

function isSpawnPermissionError(error: unknown): boolean {
  const maybeError = typeof error === "object" && error ? (error as ExecErrorLike) : {};
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  const message = error instanceof Error ? error.message : String(error);

  return (
    code === "EPERM" ||
    code === "EACCES" ||
    /spawn\s+(EPERM|EACCES)/i.test(message) ||
    /operation not permitted/i.test(message)
  );
}

function quoteForCmd(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function runThroughCmd(
  binaryPath: string,
  args: string[],
  options: ExecFileOptions
): Promise<CommandOutput> {
  const cmdPath = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  const command = [binaryPath, ...args].map(quoteForCmd).join(" ");

  return defaultExec(cmdPath, ["/d", "/s", "/c", command], options);
}

export function buildCloseSummaryContent(input: CloseSummaryInput): string {
  const lines = ["## Session Close Summary", "", `- Summary: ${input.summary}`];

  if (input.learned) {
    lines.push(`- Learned: ${input.learned}`);
  }

  if (input.next) {
    lines.push(`- Next: ${input.next}`);
  }

  lines.push(`- Closed at: ${input.closedAt}`);

  if (input.workspace) {
    lines.push(`- Workspace: ${input.workspace}`);
  }

  return lines.join("\n");
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function memoryTypeProfile(type: string): { certainty: number; teachingValue: number; priority: number } {
  const normalized = type.trim().toLowerCase();

  switch (normalized) {
    case "architecture":
      return { certainty: 0.93, teachingValue: 0.92, priority: 0.9 };
    case "decision":
      return { certainty: 0.91, teachingValue: 0.88, priority: 0.88 };
    case "bugfix":
      return { certainty: 0.9, teachingValue: 0.84, priority: 0.9 };
    case "pattern":
      return { certainty: 0.87, teachingValue: 0.87, priority: 0.82 };
    case "learning":
      return { certainty: 0.82, teachingValue: 0.86, priority: 0.78 };
    default:
      return { certainty: 0.78, teachingValue: 0.72, priority: 0.7 };
  }
}

function recencyFromMetadata(metadataLine: string): number {
  const timestampText = metadataLine.split("|")[0]?.trim();

  if (!timestampText) {
    return 0.72;
  }

  const parsed = new Date(timestampText.replace(" ", "T"));

  if (Number.isNaN(parsed.getTime())) {
    return 0.72;
  }

  const ageDays = Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  return clamp(1 - ageDays / 30, 0.45, 1);
}

export function searchOutputToChunks(raw: string, options: RecallOptions = {}): Chunk[] {
  const text = raw.trim();

  if (!text || /^No memories found/i.test(text)) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const blocks: Array<{ header: string; detailLines: string[] }> = [];
  let currentBlock: { header: string; detailLines: string[] } | null = null;

  for (const line of lines) {
    if (/^\[\d+\]\s+#/u.test(line.trim())) {
      currentBlock = {
        header: line.trim(),
        detailLines: []
      };
      blocks.push(currentBlock);
      continue;
    }

    if (currentBlock) {
      currentBlock.detailLines.push(line);
    }
  }

  return blocks.map((block, index) => {
    const headerMatch =
      block.header.match(/^\[(\d+)\]\s+#([^\s]+)\s+\(([^)]+)\)\s+[-]\s+(.+)$/u) ??
      block.header.match(/^\[(\d+)\]\s+#([^\s]+)\s+\(([^)]+)\)\s+.+?\s+(.+)$/u);
    const rank = headerMatch?.[1] ?? String(index + 1);
    const observationId = headerMatch?.[2] ?? `unknown-${index + 1}`;
    const type = headerMatch?.[3] ?? "memory";
    const title = headerMatch?.[4] ?? block.header;
    const trimmedDetails = block.detailLines.map((line) => line.trim()).filter(Boolean);
    const metadataLine = trimmedDetails[trimmedDetails.length - 1] ?? "";
    const bodyLines =
      metadataLine && metadataLine.includes("|") ? trimmedDetails.slice(0, -1) : trimmedDetails;
    const body = bodyLines.join(" ").trim();
    const projectMatch = metadataLine.match(/project:\s*([^|]+)/i);
    const scopeMatch = metadataLine.match(/scope:\s*([^|]+)/i);
    const project = projectMatch?.[1]?.trim() ?? options.project ?? "global";
    const scope = scopeMatch?.[1]?.trim() ?? "project";
    const profile = memoryTypeProfile(type);

    return {
      id: `engram-memory-${observationId}`,
      source: `engram://${project}/${observationId}`,
      kind: "memory",
      content: [
        title,
        body,
        metadataLine ? `Metadata: ${metadataLine}` : "",
        options.query ? `Recall query: ${options.query}` : "",
        `Memory type: ${type}`,
        `Memory scope: ${scope}`
      ]
        .filter(Boolean)
        .join(". "),
      certainty: profile.certainty,
      recency: recencyFromMetadata(metadataLine),
      teachingValue: profile.teachingValue,
      priority: clamp(profile.priority + (Number(rank) === 1 ? 0.04 : 0))
    };
  });
}

export function createEngramClient(options: CreateEngramClientOptions = {}) {
  const config = resolveEngramConfig(options);
  const runCommand = options.exec ?? defaultExec;

  async function execute(args: string[]): Promise<EngramCommandResult> {
    try {
      const executionOptions: ExecFileOptions = {
        cwd: config.cwd,
        env: {
          ...process.env,
          ENGRAM_DATA_DIR: config.dataDir
        }
      };
      let result: CommandOutput;

      try {
        result = await runCommand(config.binaryPath, args, executionOptions);
      } catch (error) {
        if (process.platform !== "win32" || !isSpawnPermissionError(error)) {
          throw error;
        }

        result = await runThroughCmd(config.binaryPath, args, executionOptions);
      }

      return {
        args: [...args],
        stdout: normalizeExecText(result.stdout),
        stderr: normalizeExecText(result.stderr),
        binaryPath: config.binaryPath,
        dataDir: config.dataDir,
        cwd: config.cwd
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const maybeError = typeof error === "object" && error ? (error as ExecErrorLike) : {};
      const stdout = normalizeExecText(maybeError.stdout);
      const stderr = normalizeExecText(maybeError.stderr);

      throw new Error(
        [`Engram command failed: ${config.binaryPath} ${args.join(" ")}`, stderr, stdout, message]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  async function recallContext(project?: string) {
    const args = ["context"];

    if (project) {
      args.push(project);
    }

    const result = await execute(args);

    return {
      mode: "context" as const,
      project: project ?? "",
      query: "",
      ...result
    };
  }

  async function searchMemories(query: string, options: EngramSearchOptions = {}) {
    const args = ["search", query];

    if (options.type) {
      args.push("--type", options.type);
    }

    if (options.project) {
      args.push("--project", options.project);
    }

    if (options.scope) {
      args.push("--scope", options.scope);
    }

    if (options.limit !== undefined) {
      args.push("--limit", String(options.limit));
    }

    const result = await execute(args);

    return {
      mode: "search" as const,
      query,
      project: options.project ?? "",
      scope: options.scope ?? "",
      type: options.type ?? "",
      limit: options.limit ?? null,
      ...result
    };
  }

  async function saveMemory(input: SaveMemoryInput) {
    const args = ["save", input.title, input.content];

    if (input.type) {
      args.push("--type", input.type);
    }

    if (input.project) {
      args.push("--project", input.project);
    }

    if (input.scope) {
      args.push("--scope", input.scope);
    }

    if (input.topic) {
      args.push("--topic", input.topic);
    }

    const result = await execute(args);

    return {
      action: "save" as const,
      title: input.title,
      content: input.content,
      type: input.type ?? "",
      project: input.project ?? "",
      scope: input.scope ?? "",
      topic: input.topic ?? "",
      ...result
    };
  }

  async function closeSession(input: CloseSessionInput) {
    const closedAt = new Date().toISOString();
    const title = input.title ?? `Session close - ${closedAt.slice(0, 10)}`;
    const content = buildCloseSummaryContent({
      summary: input.summary,
      learned: input.learned,
      next: input.next,
      workspace: config.cwd,
      closedAt
    });
    const result = await saveMemory({
      title,
      content,
      type: input.type ?? "learning",
      project: input.project,
      scope: input.scope ?? "project"
    });

    return {
      ...result,
      action: "close" as const,
      title,
      summary: input.summary,
      learned: input.learned ?? "",
      next: input.next ?? "",
      content
    };
  }

  return {
    config,
    recallContext,
    searchMemories,
    saveMemory,
    closeSession
  };
}
