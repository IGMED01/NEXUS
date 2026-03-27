// @ts-check

/**
 * Ruflo-NEXUS Agent Bridge
 *
 * Connects NEXUS context selection to Ruflo's multi-agent swarm.
 * Before spawning a Ruflo agent, this module:
 *   1. Runs NEXUS context selection (noise-canceler) on the workspace
 *   2. Extracts the most relevant chunks (code, spec, memory)
 *   3. Injects the NEXUS-selected context + axioms into the agent prompt
 *   4. Spawns the Ruflo agent with enriched context
 *   5. Optionally runs the Code Gate on the agent's output
 *
 * This makes Ruflo agents NEXUS-aware:
 *   - They receive only relevant context (not the full repo)
 *   - They see applicable axioms (gotchas, security rules)
 *   - Their output is gated before being accepted
 *
 * Workflow:
 *   workspace → NEXUS select → axiom inject → Ruflo agent → Code Gate → result
 */

import { loadWorkspaceChunks } from "../io/workspace-chunks.js";
import { selectContextWindow } from "../context/noise-canceler.js";
import { createAxiomInjector } from "../memory/axiom-injector.js";
import { spawnAgent, spawnSwarm, isRufloSwarmAvailable } from "./ruflo-swarm-adapter.js";
import { runCodeGate, getGateErrors, formatGateErrors } from "../guard/code-gate.js";

/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */
/** @typedef {import("../types/core-contracts.d.ts").SelectedChunk} SelectedChunk */

/**
 * @typedef {{
 *   task: string,
 *   objective?: string,
 *   workspace?: string,
 *   changedFiles?: string[],
 *   focus?: string,
 *   project?: string,
 *   agentType?: "coder" | "reviewer" | "tester" | "analyst" | "security",
 *   tokenBudget?: number,
 *   maxChunks?: number,
 *   runGate?: boolean,
 *   language?: string,
 *   framework?: string,
 *   useSwarm?: boolean,
 *   swarmAgents?: number
 * }} NexusAgentOptions
 */

/**
 * @typedef {{
 *   success: boolean,
 *   output: string,
 *   nexusContext: {
 *     selectedChunks: number,
 *     usedTokens: number,
 *     structuralHits: number,
 *     axiomsInjected: number
 *   },
 *   gateResult?: import("../types/core-contracts.d.ts").CodeGateResult,
 *   agentId?: string,
 *   error?: string
 * }} NexusAgentResult
 */

/**
 * Build the enriched context string for the Ruflo agent.
 *
 * @param {SelectedChunk[]} selected
 * @param {string} axiomBlock
 * @param {string} task
 * @param {string} objective
 * @param {string[]} changedFiles
 * @returns {string}
 */
function buildAgentContext(selected, axiomBlock, task, objective, changedFiles) {
  const sections = [];

  sections.push(`## Task\n${task}`);

  if (objective) {
    sections.push(`## Objective\n${objective}`);
  }

  if (changedFiles.length) {
    sections.push(`## Changed Files\n${changedFiles.map((f) => `- ${f}`).join("\n")}`);
  }

  if (axiomBlock) {
    sections.push(axiomBlock);
  }

  if (selected.length) {
    sections.push("## Relevant Context (NEXUS-selected)");
    for (const chunk of selected) {
      const header = `### ${chunk.source} [${chunk.kind}] score=${chunk.score.toFixed(2)}`;
      sections.push(`${header}\n\`\`\`\n${chunk.content}\n\`\`\``);
    }
  }

  return sections.join("\n\n");
}

/**
 * Spawn a NEXUS-aware Ruflo agent with context-enriched prompt.
 *
 * @param {NexusAgentOptions} opts
 * @returns {Promise<NexusAgentResult>}
 */
export async function spawnNexusAgent(opts) {
  const {
    task,
    objective = "",
    workspace = ".",
    changedFiles = [],
    focus,
    project = "default",
    agentType = "coder",
    tokenBudget = 350,
    maxChunks = 6,
    runGate = false,
    language,
    framework,
    useSwarm = false,
    swarmAgents = 3
  } = opts;

  // ── Step 1: NEXUS context selection ─────────────────────────────────────────
  let selected = /** @type {SelectedChunk[]} */ ([]);
  let usedTokens = 0;
  let structuralHits = 0;

  try {
    const workspaceResult = await loadWorkspaceChunks(workspace);
    const focusQuery = focus ?? `${task} ${objective}`.trim();

    const selectionResult = selectContextWindow(workspaceResult.payload.chunks, {
      focus: focusQuery,
      tokenBudget,
      maxChunks,
      minScore: 0.2,
      changedFiles,
      scoringProfile: "symbol-aware"
    });

    selected = selectionResult.selected;
    usedTokens = selectionResult.usedTokens;
    structuralHits = selectionResult.selected.filter((c) => c.diagnostics?.structuralHit).length;
  } catch {
    // Non-fatal: proceed without workspace context
  }

  // ── Step 2: Axiom injection ──────────────────────────────────────────────────
  let axiomBlock = "";
  let axiomsInjected = 0;

  try {
    const injector = createAxiomInjector({ project, maxAxioms: 3 });
    const focusTerms = `${task} ${objective}`.trim().split(/\s+/).filter(Boolean);

    axiomBlock = await injector.inject({ language, framework, focusTerms });
    axiomsInjected = axiomBlock ? (axiomBlock.match(/##/g) ?? []).length : 0;
  } catch {
    // Non-fatal: proceed without axioms
  }

  // ── Step 3: Build enriched context ───────────────────────────────────────────
  const context = buildAgentContext(selected, axiomBlock, task, objective, changedFiles);

  // ── Step 4: Check Ruflo availability ─────────────────────────────────────────
  const rufloAvailable = await isRufloSwarmAvailable();

  if (!rufloAvailable) {
    return {
      success: false,
      output: "",
      nexusContext: { selectedChunks: selected.length, usedTokens, structuralHits, axiomsInjected },
      error: "Ruflo is not available. Install: npx ruflo@latest init"
    };
  }

  // ── Step 5: Spawn Ruflo agent / swarm ────────────────────────────────────────
  let agentOutput = "";
  let agentId = "";
  let agentSuccess = false;

  if (useSwarm) {
    const swarmResult = await spawnSwarm({
      task,
      context,
      agents: swarmAgents,
      strategy: "hierarchical",
      format: "json"
    });
    agentOutput = swarmResult.output;
    agentSuccess = swarmResult.success;
  } else {
    const agentResult = await spawnAgent({
      agentType,
      task,
      context,
      format: "json"
    });
    agentOutput = agentResult.output;
    agentId = agentResult.agentId ?? "";
    agentSuccess = agentResult.success;
  }

  const nexusContext = { selectedChunks: selected.length, usedTokens, structuralHits, axiomsInjected };

  if (!agentSuccess) {
    return {
      success: false,
      output: agentOutput,
      nexusContext,
      agentId,
      error: "Ruflo agent did not complete successfully"
    };
  }

  // ── Step 6: Optional Code Gate ────────────────────────────────────────────────
  if (runGate && agentOutput) {
    const gateResult = await runCodeGate({ cwd: workspace, tools: ["typecheck", "lint"] });
    const gateErrors = getGateErrors(gateResult);

    return {
      success: gateResult.passed,
      output: agentOutput,
      nexusContext,
      gateResult,
      agentId,
      error: gateErrors.length ? formatGateErrors(gateErrors) : undefined
    };
  }

  return {
    success: true,
    output: agentOutput,
    nexusContext,
    agentId
  };
}

/**
 * Summary of what NEXUS contributed to the agent run.
 *
 * @param {NexusAgentResult} result
 * @returns {string}
 */
export function formatNexusAgentSummary(result) {
  const { nexusContext, gateResult } = result;
  const lines = [
    `Agent: ${result.success ? "✓ success" : "✗ failed"}`,
    `NEXUS context: ${nexusContext.selectedChunks} chunks / ${nexusContext.usedTokens} tokens`,
    `  structural hits: ${nexusContext.structuralHits}`,
    `  axioms injected: ${nexusContext.axiomsInjected}`
  ];

  if (gateResult) {
    lines.push(`Code Gate: ${gateResult.status} (${gateResult.errorCount} errors)`);
  }

  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  return lines.join("\n");
}
