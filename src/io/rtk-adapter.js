// @ts-check

/**
 * RTK Adapter — NEXUS:1 PROCESSING / NEXUS:0 SYNC
 *
 * Integrates RTK (github.com/rtk-ai/rtk) into the NEXUS IO pipeline.
 * RTK is a Rust CLI proxy that compresses command outputs by 60-90%
 * before they reach the LLM context window.
 *
 * Integration points in NEXUS:
 *   1. Workspace scanning: pipe `git diff`, `git log`, test output through RTK
 *   2. Chunk ingestion: compress raw file reads before chunking
 *   3. Observability: expose RTK token savings in NEXUS metrics
 *   4. Doctor: check if RTK is installed and suggest `rtk init -g`
 *
 * RTK reduces:
 *   git status:    80% token reduction
 *   cargo/npm test: 90% token reduction
 *   file reads:    70% token reduction
 *
 * @see https://github.com/rtk-ai/rtk
 */

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const RTK_TIMEOUT_MS = 15000;

/**
 * @param {unknown} error
 * @returns {string}
 */
function toMsg(error) {
  return error instanceof Error ? error.message : String(error);
}

// ── RTK availability ──────────────────────────────────────────────────────────

/** @type {boolean | null} */
let _rtkAvailable = null;

/**
 * Check if RTK binary is available in PATH.
 * Result is cached after first check.
 *
 * @returns {Promise<boolean>}
 */
export async function isRtkAvailable() {
  if (_rtkAvailable !== null) {
    return _rtkAvailable;
  }

  try {
    await execFile("rtk", ["--version"], { timeout: 3000, shell: false, windowsHide: true });
    _rtkAvailable = true;
  } catch {
    _rtkAvailable = false;
  }

  return _rtkAvailable;
}

/**
 * Reset the RTK availability cache (useful for tests).
 */
export function resetRtkCache() {
  _rtkAvailable = null;
}

// ── RTK command wrappers ──────────────────────────────────────────────────────

/**
 * @typedef {{
 *   output: string,
 *   compressedBy?: number,
 *   rtkUsed: boolean,
 *   source: string
 * }} RtkResult
 */

/**
 * Run an RTK-compressed git command.
 *
 * @param {string[]} args  Git subcommand args (e.g., ["diff", "HEAD"])
 * @param {string} [cwd]
 * @returns {Promise<RtkResult>}
 */
export async function rtkGit(args, cwd = ".") {
  if (!(await isRtkAvailable())) {
    return rtkFallback(["git", ...args], cwd);
  }

  try {
    const { stdout } = await execFile("rtk", ["git", ...args], {
      cwd,
      timeout: RTK_TIMEOUT_MS,
      shell: false,
      windowsHide: true
    });
    const output = typeof stdout === "string" ? stdout : stdout.toString("utf8");
    return { output: output.trim(), rtkUsed: true, source: `rtk git ${args.join(" ")}` };
  } catch (error) {
    return rtkFallback(["git", ...args], cwd, toMsg(error));
  }
}

/**
 * Run an RTK-compressed file read.
 * RTK's `read` command applies smart filtering (removes comments, whitespace).
 *
 * @param {string} filePath
 * @param {{ aggressive?: boolean, cwd?: string }} [opts]
 * @returns {Promise<RtkResult>}
 */
export async function rtkRead(filePath, opts = {}) {
  if (!(await isRtkAvailable())) {
    return rtkFallback(["cat", filePath], opts.cwd ?? ".");
  }

  const rtkArgs = ["read", filePath];
  if (opts.aggressive) {
    rtkArgs.push("-l", "aggressive");
  }

  try {
    const { stdout } = await execFile("rtk", rtkArgs, {
      cwd: opts.cwd ?? ".",
      timeout: RTK_TIMEOUT_MS,
      shell: false,
      windowsHide: true
    });
    const output = typeof stdout === "string" ? stdout : stdout.toString("utf8");
    return { output: output.trim(), rtkUsed: true, source: `rtk read ${filePath}` };
  } catch (error) {
    return rtkFallback(["cat", filePath], opts.cwd ?? ".", toMsg(error));
  }
}

/**
 * Run RTK on test output (filters to failures only).
 *
 * @param {string[]} testCommand  e.g., ["npm", "test"] or ["cargo", "test"]
 * @param {string} [cwd]
 * @returns {Promise<RtkResult>}
 */
export async function rtkTest(testCommand, cwd = ".") {
  if (!(await isRtkAvailable())) {
    return rtkFallback(testCommand, cwd);
  }

  // RTK wraps test commands: `rtk test npm test`
  try {
    const { stdout, stderr } = await execFile("rtk", ["test", ...testCommand], {
      cwd,
      timeout: RTK_TIMEOUT_MS * 5,
      shell: false,
      windowsHide: true
    });
    const out = typeof stdout === "string" ? stdout : stdout.toString("utf8");
    const err = typeof stderr === "string" ? stderr : stderr.toString("utf8");
    const output = [out, err].filter(Boolean).join("\n");
    return { output: output.trim(), rtkUsed: true, source: `rtk test ${testCommand.join(" ")}` };
  } catch (/** @type {any} */ error) {
    const out = String(error?.stdout ?? "");
    const err = String(error?.stderr ?? "");
    return {
      output: [out, err].filter(Boolean).join("\n").trim(),
      rtkUsed: true,
      source: `rtk test ${testCommand.join(" ")}`
    };
  }
}

/**
 * Get RTK token savings statistics.
 *
 * @returns {Promise<{ available: boolean, savings?: Record<string, unknown> }>}
 */
export async function rtkGain() {
  if (!(await isRtkAvailable())) {
    return { available: false };
  }

  try {
    const { stdout } = await execFile("rtk", ["gain", "--json"], {
      timeout: 5000,
      shell: false,
      windowsHide: true
    });
    const raw = typeof stdout === "string" ? stdout : stdout.toString("utf8");
    try {
      const savings = JSON.parse(raw.trim());
      return { available: true, savings };
    } catch {
      return { available: true, savings: { raw: raw.trim() } };
    }
  } catch {
    return { available: true, savings: {} };
  }
}

// ── Fallback (no RTK) ─────────────────────────────────────────────────────────

/**
 * Run the original command when RTK is not available.
 * @param {string[]} command
 * @param {string} cwd
 * @param {string} [rtkError]
 * @returns {Promise<RtkResult>}
 */
async function rtkFallback(command, cwd, rtkError) {
  const [bin, ...args] = command;

  try {
    const { stdout } = await execFile(String(bin), args, {
      cwd,
      timeout: RTK_TIMEOUT_MS,
      shell: false,
      windowsHide: true
    });
    const output = typeof stdout === "string" ? stdout : stdout.toString("utf8");
    return { output: output.trim(), rtkUsed: false, source: command.join(" ") };
  } catch (/** @type {any} */ error) {
    const output = [String(error?.stdout ?? ""), String(error?.stderr ?? "")].join("\n");
    return { output: output.trim(), rtkUsed: false, source: command.join(" ") };
  }
}

// ── Doctor check ──────────────────────────────────────────────────────────────

/**
 * Generate a NEXUS doctor check entry for RTK.
 *
 * @returns {Promise<{ id: string, label: string, status: "pass" | "warn", detail: string, fix?: string }>}
 */
export async function rtkDoctorCheck() {
  const available = await isRtkAvailable();

  if (available) {
    return {
      id: "rtk-available",
      label: "RTK token optimizer",
      status: "pass",
      detail: "RTK is installed — CLI outputs will be compressed 60-90% before entering NEXUS."
    };
  }

  return {
    id: "rtk-available",
    label: "RTK token optimizer",
    status: "warn",
    detail: "RTK is not installed. Without it, raw CLI output uses 3-10x more tokens.",
    fix: "Install: curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh && rtk init -g"
  };
}
