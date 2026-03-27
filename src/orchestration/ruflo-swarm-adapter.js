// @ts-check

/**
 * Ruflo Swarm Adapter
 *
 * Provides multi-agent orchestration for NEXUS via Ruflo's swarm engine.
 * Used by:
 *   - Code Gate repair loop (Sprint 4): spawn a coder agent to fix compile errors
 *   - Axiom extraction (Sprint 5): spawn an analyst agent to extract gotchas
 *   - Architecture review (Sprint 6): spawn a reviewer agent to check boundaries
 *
 * Ruflo CLI reference:
 *   npx ruflo@latest agent spawn -t coder --name <name>
 *   npx ruflo@latest hive-mind spawn "<task>"
 *   npx ruflo@latest agent list
 *
 * @see https://github.com/ruvnet/ruflo
 */

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const RUFLO_SPAWN_TIMEOUT_MS = 30000;
const RUFLO_HIVEMIND_TIMEOUT_MS = 120000;

/**
 * @param {unknown} error
 * @returns {string}
 */
function toMsg(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string[]} args
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<unknown>}
 */
async function runRuflo(args, opts = {}) {
  const timeout = opts.timeout ?? RUFLO_SPAWN_TIMEOUT_MS;

  const { stdout } = await execFile("npx", ["--yes", "ruflo@latest", ...args], {
    timeout,
    shell: false,
    windowsHide: true
  });

  const text = typeof stdout === "string" ? stdout : stdout.toString("utf8");

  try {
    return JSON.parse(text.trim());
  } catch {
    return { raw: text.trim() };
  }
}

/**
 * @typedef {{
 *   agentType: "coder" | "reviewer" | "tester" | "analyst" | "security",
 *   name?: string,
 *   task: string,
 *   context?: string,
 *   format?: "json" | "text"
 * }} SpawnAgentOptions
 */

/**
 * @typedef {{
 *   agentId?: string,
 *   output: string,
 *   success: boolean,
 *   error?: string
 * }} AgentResult
 */

/**
 * @typedef {{
 *   task: string,
 *   context?: string,
 *   agents?: number,
 *   strategy?: "hierarchical" | "mesh",
 *   format?: "json" | "text"
 * }} SpawnSwarmOptions
 */

/**
 * @typedef {{
 *   swarmId?: string,
 *   output: string,
 *   agentResults?: AgentResult[],
 *   success: boolean,
 *   error?: string
 * }} SwarmResult
 */

/**
 * Spawn a single specialized Ruflo agent for a targeted task.
 *
 * @param {SpawnAgentOptions} opts
 * @returns {Promise<AgentResult>}
 */
export async function spawnAgent(opts) {
  const { agentType, name, task, context, format = "json" } = opts;
  const agentName = name ?? `nexus-${agentType}-${Date.now()}`;

  const args = [
    "agent",
    "spawn",
    "-t",
    agentType,
    "--name",
    agentName,
    "--task",
    task,
    "--format",
    format
  ];

  if (context) {
    args.push("--context", context);
  }

  try {
    const raw = /** @type {any} */ (await runRuflo(args, { timeout: RUFLO_SPAWN_TIMEOUT_MS }));

    return {
      agentId: raw?.agentId ?? raw?.id ?? agentName,
      output: raw?.output ?? raw?.result ?? raw?.raw ?? "",
      success: raw?.status !== "failed"
    };
  } catch (error) {
    return {
      output: "",
      success: false,
      error: toMsg(error)
    };
  }
}

/**
 * Launch a Ruflo hive-mind swarm for complex multi-agent tasks.
 *
 * @param {SpawnSwarmOptions} opts
 * @returns {Promise<SwarmResult>}
 */
export async function spawnSwarm(opts) {
  const { task, context, agents = 3, strategy = "hierarchical" } = opts;

  const fullTask = context ? `${task}\n\nContext:\n${context}` : task;

  const args = [
    "hive-mind",
    "spawn",
    fullTask,
    "--agents",
    String(agents),
    "--strategy",
    strategy,
    "--format",
    "json"
  ];

  try {
    const raw = /** @type {any} */ (await runRuflo(args, { timeout: RUFLO_HIVEMIND_TIMEOUT_MS }));

    const agentResults = Array.isArray(raw?.agents)
      ? raw.agents.map((/** @type {any} */ a) => ({
          agentId: a.id ?? a.agentId,
          output: a.output ?? a.result ?? "",
          success: a.status !== "failed"
        }))
      : [];

    return {
      swarmId: raw?.swarmId ?? raw?.id,
      output: raw?.output ?? raw?.summary ?? raw?.raw ?? "",
      agentResults,
      success: raw?.status !== "failed"
    };
  } catch (error) {
    return {
      output: "",
      agentResults: [],
      success: false,
      error: toMsg(error)
    };
  }
}

/**
 * List available Ruflo agent types.
 * @returns {Promise<string[]>}
 */
export async function listAgentTypes() {
  try {
    const raw = /** @type {any} */ (await runRuflo(["agent", "list", "--format", "json"]));
    return Array.isArray(raw?.types) ? raw.types : Array.isArray(raw) ? raw : [];
  } catch {
    // Fallback to known types from Ruflo docs
    return ["coder", "reviewer", "tester", "analyst", "security", "devops", "docs"];
  }
}

/**
 * Check if Ruflo swarm is available.
 * @returns {Promise<boolean>}
 */
export async function isRufloSwarmAvailable() {
  try {
    await execFile("npx", ["--yes", "ruflo@latest", "--version"], {
      timeout: 5000,
      shell: false,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}
