import { access, readFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { defaultProjectConfig } from "../contracts/config-contracts.js";
import { writeTextFile } from "../io/text-file.js";
import type { DoctorCheck, DoctorResult } from "../types/core-contracts.d.ts";

const execFile = promisify(execFileCallback);

interface LoadedConfigInfo {
  found: boolean;
  path: string;
  config: ReturnType<typeof defaultProjectConfig>;
}

interface RunProjectDoctorInput {
  cwd?: string;
  configInfo: LoadedConfigInfo;
  configError?: string;
}

export interface InitProjectConfigInput {
  cwd?: string;
  configPath?: string;
  force?: boolean;
}

export interface InitProjectConfigResult {
  action: string;
  status: string;
  created: boolean;
  path: string;
  message: string;
  project?: string;
}

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeProjectId(value: string): string {
  return value.trim().replace(/^@/u, "").replace(/[\\/]/gu, "-").replace(/\s+/gu, "-");
}

async function detectStableProjectId(cwd: string): Promise<string> {
  const packageJsonPath = path.join(cwd, "package.json");

  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/u, "")) as { name?: unknown };
    const packageName = typeof parsed.name === "string" ? normalizeProjectId(parsed.name) : "";

    return packageName;
  } catch {
    return "";
  }
}

function normalizeOutput(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8").trim();
  }

  return "";
}

async function tryExec(command: string, args: string[]): Promise<ExecResult> {
  const candidates =
    process.platform === "win32" && !command.toLowerCase().endsWith(".cmd")
      ? [command, `${command}.cmd`]
      : [command];

  for (const candidate of candidates) {
    try {
      const result = await execFile(candidate, args, {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });

      return {
        ok: true,
        stdout: normalizeOutput(result.stdout),
        stderr: normalizeOutput(result.stderr)
      };
    } catch (error) {
      if (candidate !== candidates[candidates.length - 1]) {
        continue;
      }

      return {
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return { ok: false, stdout: "", stderr: `Unable to execute ${command}` };
}

export async function runProjectDoctor(input: RunProjectDoctorInput): Promise<DoctorResult> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const configInfo = input.configInfo;
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  checks.push({
    id: "node",
    label: "Node.js runtime",
    status: nodeMajor >= 20 ? "pass" : "fail",
    detail: `Detected Node.js ${process.versions.node}`,
    fix: nodeMajor >= 20 ? "" : "Install Node.js 20 or newer."
  });

  const npmResult =
    process.platform === "win32"
      ? await tryExec("cmd.exe", ["/c", "npm.cmd", "--version"])
      : await tryExec("npm", ["--version"]);
  checks.push({
    id: "npm",
    label: "npm availability",
    status: npmResult.ok ? "pass" : "fail",
    detail: npmResult.ok ? `npm ${npmResult.stdout}` : npmResult.stderr,
    fix: npmResult.ok ? "" : "Install npm (bundled with Node.js) and ensure it is available in PATH."
  });

  const gitResult = await tryExec("git", ["--version"]);
  checks.push({
    id: "git",
    label: "Git availability",
    status: gitResult.ok ? "pass" : "fail",
    detail: gitResult.ok ? gitResult.stdout : gitResult.stderr,
    fix: gitResult.ok ? "" : "Install Git and ensure it is available in PATH."
  });

  const packageJsonPath = path.join(cwd, "package.json");
  const packageJsonExists = await pathExists(packageJsonPath);
  checks.push({
    id: "package-json",
    label: "Package manifest",
    status: packageJsonExists ? "pass" : "fail",
    detail: packageJsonExists ? packageJsonPath : `Missing package.json at ${packageJsonPath}`,
    fix: packageJsonExists ? "" : "Create package.json before using npm-based workflows."
  });

  const nodeModulesPath = path.join(cwd, "node_modules");
  const nodeModulesExists = await pathExists(nodeModulesPath);
  checks.push({
    id: "dependencies",
    label: "Installed dependencies",
    status: nodeModulesExists ? "pass" : "warn",
    detail: nodeModulesExists ? nodeModulesPath : `Missing dependency directory: ${nodeModulesPath}`,
    fix: nodeModulesExists ? "" : "Run `npm ci` (or `npm install`) in the project root."
  });

  checks.push({
    id: "config",
    label: "Project config",
    status: input.configError ? "fail" : configInfo.found ? "pass" : "warn",
    detail: input.configError
      ? input.configError
      : configInfo.found
        ? `Loaded ${configInfo.path}`
        : "No tracked config found; defaults will be used.",
    fix: input.configError
      ? "Fix the JSON file or re-run init to regenerate it."
      : configInfo.found
        ? ""
        : "Run `node src/cli.js init` to create learning-context.config.json."
  });

  const workspaceRoot = path.resolve(cwd, configInfo.config.workspace || ".");
  const workspaceExists = await pathExists(workspaceRoot);
  checks.push({
    id: "workspace",
    label: "Workspace root",
    status: workspaceExists ? "pass" : "fail",
    detail: workspaceExists ? workspaceRoot : `Missing workspace: ${workspaceRoot}`,
    fix: workspaceExists ? "" : "Set a valid workspace path in learning-context.config.json."
  });

  const scanSafetyRelaxed =
    configInfo.config.security.ignoreSensitiveFiles === false ||
    configInfo.config.security.redactSensitiveContent === false ||
    configInfo.config.security.ignoreGeneratedFiles === false;
  checks.push({
    id: "scan-safety",
    label: "Scan safety policy",
    status: scanSafetyRelaxed ? "warn" : "pass",
    detail: scanSafetyRelaxed
      ? "One or more default protections were relaxed in config.security."
      : "Default ignore/redact protections are enabled.",
    fix: scanSafetyRelaxed
      ? "Re-enable config.security.ignoreSensitiveFiles, redactSensitiveContent, and ignoreGeneratedFiles unless you intentionally need broader scanning."
      : ""
  });

  const strictSafetyEnabled =
    configInfo.config.safety.requirePlanForWrite === true &&
    configInfo.config.safety.allowedScopePaths.length > 0;
  checks.push({
    id: "task-safety-gate",
    label: "Task safety gate",
    status: strictSafetyEnabled ? "pass" : "warn",
    detail: strictSafetyEnabled
      ? `Plan gate enabled and scope locked (${configInfo.config.safety.allowedScopePaths.join(", ")}).`
      : "Safety gate is permissive (plan gate disabled or scope paths empty).",
    fix: strictSafetyEnabled
      ? ""
      : "Set config.safety.requirePlanForWrite=true and define config.safety.allowedScopePaths for production workflows."
  });

  const memoryBackend = configInfo.config.memory.backend || "resilient";
  const engramEnabledByBackend = memoryBackend !== "local-only";
  checks.push({
    id: "memory-backend",
    label: "Memory backend mode",
    status: memoryBackend === "resilient" ? "pass" : "warn",
    detail:
      memoryBackend === "resilient"
        ? "resilient (Engram primary + local fallback)."
        : memoryBackend === "engram-only"
          ? "engram-only (no local fallback)."
          : "local-only (Engram disabled by config).",
    fix:
      memoryBackend === "resilient"
        ? ""
        : "Prefer memory.backend='resilient' for production reliability unless you intentionally need single-provider mode."
  });

  const engramBinary = path.resolve(cwd, configInfo.config.engram.binaryPath || "tools/engram/engram.exe");
  const engramBinaryExists = await pathExists(engramBinary);
  checks.push({
    id: "engram-binary",
    label: "Engram binary",
    status: engramEnabledByBackend ? (engramBinaryExists ? "pass" : "warn") : "pass",
    detail: engramEnabledByBackend
      ? engramBinaryExists
        ? engramBinary
        : `Not found: ${engramBinary}`
      : `Skipped because memory.backend='${memoryBackend}'.`,
    fix:
      !engramEnabledByBackend || engramBinaryExists
        ? ""
        : "Install Engram or point config.engram.binaryPath to the correct binary."
  });

  const engramDataDir = path.resolve(cwd, configInfo.config.engram.dataDir || ".engram");
  const engramDataExists = await pathExists(engramDataDir);
  checks.push({
    id: "engram-data",
    label: "Engram data directory",
    status: engramEnabledByBackend ? (engramDataExists ? "pass" : "warn") : "pass",
    detail: engramEnabledByBackend
      ? engramDataExists
        ? engramDataDir
        : `Missing data dir: ${engramDataDir}`
      : `Skipped because memory.backend='${memoryBackend}'.`,
    fix:
      !engramEnabledByBackend || engramDataExists
        ? ""
        : "The directory will be created on first successful Engram write."
  });

  const summary = checks.reduce<DoctorResult["summary"]>(
    (accumulator, check) => {
      accumulator[check.status] += 1;
      return accumulator;
    },
    { pass: 0, warn: 0, fail: 0 }
  );

  return {
    cwd,
    summary,
    checks
  };
}

export async function initProjectConfig(
  input: InitProjectConfigInput = {}
): Promise<InitProjectConfigResult> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const targetPath = path.resolve(cwd, input.configPath ?? "learning-context.config.json");
  const exists = await pathExists(targetPath);

  if (exists && input.force !== true) {
    return {
      action: "init",
      status: "exists",
      created: false,
      path: targetPath,
      message: "Config already exists."
    };
  }

  const config = defaultProjectConfig();
  config.project = await detectStableProjectId(cwd);
  config.workspace = ".";

  await writeTextFile(targetPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    action: "init",
    status: exists ? "overwritten" : "created",
    created: true,
    path: targetPath,
    project: config.project,
    message: exists ? "Config overwritten." : "Config created."
  };
}
