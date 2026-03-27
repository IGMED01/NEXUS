// @ts-check

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildLearningPacket } from "../learning/mentor-loop.js";

/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */
/** @typedef {import("../types/core-contracts.d.ts").LearningPacket} LearningPacket */

/**
 * @typedef {{
 *   title: string,
 *   description: string,
 *   signals: string[],
 *   hits?: number
 * }} ConceptEntry
 */

/**
 * @typedef {{
 *   builtin: string[],
 *   external: string[],
 *   local: string[]
 * }} ImportClassification
 */

/**
 * @typedef {{
 *   name: string | null,
 *   type: string | null,
 *   scripts: Record<string, string>,
 *   dependencies: Record<string, string>,
 *   devDependencies: Record<string, string>
 * }} ProjectMetadata
 */

const CONCEPT_CATALOG = [
  {
    title: "Node.js CLI orchestration",
    description:
      "Learn how a Node CLI receives terminal arguments, dispatches commands, and returns structured output.",
    signals: ["process.argv", "runcli", "cli.js", "command", "argv", "usage:"]
  },
  {
    title: "ES modules in Node.js",
    description:
      "Understand `import`/`export`, the `type: module` package setting, and how files are connected without CommonJS.",
    signals: ["import ", "export ", "\"type\": \"module\"", "type\": \"module"]
  },
  {
    title: "Input contracts and validation",
    description:
      "The tool trusts structured input only after validating chunk shape, allowed kinds, and numeric score ranges.",
    signals: ["validatechunk", "validatechunkfile", "contract", "must be a non-empty string", "must be one of", "json.parse"]
  },
  {
    title: "Filesystem and JSON I/O",
    description:
      "The workflow depends on reading JSON, scanning workspace files, and writing generated markdown safely.",
    signals: ["readfile", "writefile", "readdir", "fs/promises", "json", "workspace"]
  },
  {
    title: "Tokenization and normalization",
    description:
      "The selector first normalizes text, removes stopwords, and tokenizes chunks so it can compare meaning cheaply.",
    signals: ["tokenize", "normalizetext", "stopwords", "split", "trim"]
  },
  {
    title: "Heuristic ranking",
    description:
      "Context is ranked with a weighted heuristic that mixes overlap, source priors, certainty, recency, teaching value, and priority.",
    signals: ["scorechunk", "overlap", "certainty", "recency", "teachingvalue", "priority", "kindprior"]
  },
  {
    title: "Redundancy control",
    description:
      "The system penalizes near-duplicate chunks so the prompt budget is spent on distinct information.",
    signals: ["jaccardsimilarity", "redundancy", "redundant-context", "intersection", "penalty"]
  },
  {
    title: "Prompt-budget management",
    description:
      "Selection is constrained by score thresholds, chunk limits, token budgets, and sentence compression.",
    signals: ["tokenbudget", "maxchunks", "sentencebudget", "usedtokens", "score-below-threshold"]
  },
  {
    title: "Pedagogical packaging",
    description:
      "The learning layer takes filtered context and turns it into explanations, concepts, and practice-oriented scaffolding.",
    signals: ["buildlearningpacket", "teachingchecklist", "mentor", "objective", "practice"]
  },
  {
    title: "Portable test harnesses",
    description:
      "The project uses a minimal portable runner so behavior can be checked even in constrained environments.",
    signals: ["assert", "all portable checks passed", "run-tests", "pass ", "fail "]
  },
  {
    title: "Agent memory architecture",
    description:
      "The docs point toward a persistent memory runtime with local-first recall, so understanding session memory and retrieval is useful for the next phase.",
    signals: ["engram", "memory", "mcp", "session", "memory protocol", "mem_save", "mem_context"]
  }
];

const BUILTIN_PREFIX = "node:";

/**
 * @param {string} value
 */
function normalizeForMatching(value) {
  return value.toLowerCase();
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function unique(values) {
  return Array.from(new Set(values));
}

/**
 * @param {string} raw
 * @returns {unknown | null}
 */
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractImports(text) {
  const matches = [];
  const importRegex =
    /(?:import\s+.*?\s+from\s+["']([^"']+)["'])|(?:import\s+["']([^"']+)["'])|(?:require\(\s*["']([^"']+)["']\s*\))/g;
  let match = importRegex.exec(text);

  while (match) {
    const moduleName = match[1] || match[2] || match[3];

    if (moduleName) {
      matches.push(moduleName);
    }

    match = importRegex.exec(text);
  }

  return matches;
}

/**
 * @param {Chunk[]} chunks
 * @returns {ImportClassification}
 */
function classifyImports(chunks) {
  const allImports = unique(
    chunks
      .filter((chunk) => chunk.kind === "code" || chunk.kind === "test")
      .flatMap((chunk) => extractImports(chunk.content))
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => name !== "." && name !== ",")
  );

  return {
    builtin: allImports.filter((name) => name.startsWith(BUILTIN_PREFIX)).sort(),
    external: allImports
      .filter((name) => !name.startsWith(BUILTIN_PREFIX) && !name.startsWith("."))
      .sort(),
    local: allImports.filter((name) => name.startsWith(".")).sort()
  };
}

/**
 * @param {string} projectRoot
 * @returns {Promise<ProjectMetadata | null>}
 */
async function inferProjectMetadata(projectRoot) {
  const packageJsonPath = resolve(projectRoot, "package.json");

  return readFile(packageJsonPath, "utf8")
    .then((raw) => {
      const parsed = safeJsonParse(raw);

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const pkg = /** @type {Record<string, unknown>} */ (parsed);
      return {
        name: typeof pkg.name === "string" ? pkg.name : null,
        type: typeof pkg.type === "string" ? pkg.type : null,
        scripts:
          pkg.scripts && typeof pkg.scripts === "object" ? /** @type {Record<string, string>} */ (pkg.scripts) : {},
        dependencies:
          pkg.dependencies && typeof pkg.dependencies === "object"
            ? /** @type {Record<string, string>} */ (pkg.dependencies)
            : {},
        devDependencies:
          pkg.devDependencies && typeof pkg.devDependencies === "object"
            ? /** @type {Record<string, string>} */ (pkg.devDependencies)
            : {}
      };
    })
    .catch(() => null);
}

/**
 * @param {string} source
 */
function sourceWeight(source) {
  if (source === "src/cli.js") {
    return 1000;
  }

  if (source.startsWith("src/cli/")) {
    return 950;
  }

  if (source.startsWith("src/contracts/")) {
    return 920;
  }

  if (source.startsWith("src/io/")) {
    return 900;
  }

  if (source.startsWith("src/context/")) {
    return 880;
  }

  if (source.startsWith("src/learning/")) {
    return 860;
  }

  if (source.startsWith("src/analysis/")) {
    return 845;
  }

  if (source.startsWith("docs/")) {
    return 780;
  }

  if (source.startsWith("test/")) {
    return 730;
  }

  if (source.endsWith("package.json")) {
    return 720;
  }

  return 600;
}

/**
 * @param {Chunk[]} chunks
 * @param {LearningPacket} packet
 * @returns {string[]}
 */
function buildReadingOrder(chunks, packet) {
  const selectedSources = packet.selectedContext.map((chunk) => chunk.source);
  const allSources = unique([...selectedSources, ...chunks.map((chunk) => chunk.source)]);
  const preferred = [
    "src/cli.js",
    "src/cli/app.js",
    "src/contracts/context-contracts.js",
    "src/io/json-file.js",
    "src/io/workspace-chunks.js",
    "src/context/noise-canceler.js",
    "src/learning/mentor-loop.js",
    "src/analysis/readme-generator.js",
    "test/run-tests.js"
  ].filter((source) => allSources.includes(source));

  const ranked = allSources
    .filter((source) => !preferred.includes(source))
    .sort((left, right) => sourceWeight(right) - sourceWeight(left) || left.localeCompare(right));

  return unique([...preferred, ...ranked]).slice(0, 8);
}

/**
 * @param {string[]} sources
 * @returns {string[]}
 */
function buildFlow(sources) {
  const steps = [];

  if (sources.includes("src/cli.js")) {
    steps.push("`src/cli.js` receives the terminal command and delegates everything to `runCli`.");
  }

  if (sources.some((source) => source.startsWith("src/cli/"))) {
    steps.push("The CLI app parses arguments, validates required options, and chooses which command branch to execute.");
  }

  if (sources.some((source) => source.startsWith("src/io/") || source.startsWith("src/contracts/"))) {
    steps.push("Input is loaded either from JSON or by scanning the workspace, then validated before the rest of the pipeline touches it.");
  }

  if (sources.some((source) => source.startsWith("src/context/"))) {
    steps.push("The context selector normalizes text, scores each chunk, penalizes duplicates, and enforces the prompt budget.");
  }

  if (sources.some((source) => source.startsWith("src/learning/"))) {
    steps.push("The mentor layer wraps the filtered context with objective, explanations, and learning scaffolding.");
  }

  if (sources.some((source) => source.startsWith("src/analysis/"))) {
    steps.push("The README generator turns project structure and selected context into a study guide for a human reader.");
  }

  return steps;
}

/**
 * @param {Chunk[]} chunks
 * @param {LearningPacket} packet
 * @param {ProjectMetadata | null} metadata
 * @returns {ConceptEntry[]}
 */
function detectConcepts(chunks, packet, metadata) {
  const corpus = normalizeForMatching(
    [
      ...chunks.map((chunk) => `${chunk.source}\n${chunk.content}`),
      ...packet.selectedContext.map((chunk) => `${chunk.source}\n${chunk.content}`),
      metadata?.type ?? "",
      Object.keys(metadata?.scripts ?? {}).join(" ")
    ].join("\n")
  );

  return CONCEPT_CATALOG.map((concept) => ({
    ...concept,
    hits: concept.signals.filter((signal) => corpus.includes(normalizeForMatching(signal))).length
  }))
    .filter((concept) => concept.hits > 0)
    .sort((left, right) => right.hits - left.hits || left.title.localeCompare(right.title))
    .slice(0, 7);
}

/**
 * @param {ProjectMetadata | null} metadata
 * @param {ImportClassification} imports
 */
function formatDependencySection(metadata, imports) {
  const lines = ["## Dependencies", ""];
  const runtime = Object.keys(metadata?.dependencies ?? {});
  const dev = Object.keys(metadata?.devDependencies ?? {});

  lines.push("- Runtime requirement: Node.js with ESM support.");

  if (metadata?.type === "module") {
    lines.push("- Package mode: ESM (`type: module`).");
  }

  if (!runtime.length && !dev.length) {
    lines.push("- Third-party packages: none declared in `package.json` right now.");
  } else {
    lines.push(`- Runtime packages: ${runtime.length ? runtime.join(", ") : "none"}.`);
    lines.push(`- Dev packages: ${dev.length ? dev.join(", ") : "none"}.`);
  }

  if (imports.builtin.length) {
    lines.push(`- Node platform APIs used directly: ${imports.builtin.join(", ")}.`);
  }

  if (imports.external.length) {
    lines.push(`- External imports used in code: ${imports.external.join(", ")}.`);
  }

  return lines.join("\n");
}

/**
 * @param {ConceptEntry[]} concepts
 */
function formatConceptSection(concepts) {
  const lines = ["## Core Concepts To Learn First", ""];

  if (!concepts.length) {
    lines.push("- No strong concepts were inferred from the current corpus.");
    return lines.join("\n");
  }

  for (const concept of concepts) {
    lines.push(`- **${concept.title}**: ${concept.description}`);
  }

  return lines.join("\n");
}

/**
 * @param {string[]} readingOrder
 */
function formatReadingOrder(readingOrder) {
  const lines = ["## Reading Order", ""];

  for (const source of readingOrder) {
    lines.push(`1. \`${source}\``);
  }

  return lines.join("\n");
}

/**
 * @param {string[]} flowSteps
 */
function formatFlowSection(flowSteps) {
  const lines = ["## How The Code Flows", ""];

  for (const step of flowSteps) {
    lines.push(`1. ${step}`);
  }

  return lines.join("\n");
}

/**
 * @param {LearningPacket} packet
 */
function formatSelectedContext(packet) {
  const lines = ["## High-Signal Files For This Goal", ""];

  if (!packet.selectedContext.length) {
    lines.push("- No chunks passed the selection threshold.");
    return lines.join("\n");
  }

  for (const chunk of packet.selectedContext) {
    lines.push(`- \`${chunk.source}\` (${chunk.kind}, score ${chunk.score.toFixed(3)})`);
  }

  return lines.join("\n");
}

/**
 * @param {ProjectMetadata | null} metadata
 */
function formatCommands(metadata) {
  const scripts = metadata?.scripts ?? {};
  const lines = ["## Useful Commands", ""];

  for (const [name, command] of Object.entries(scripts)) {
    lines.push(`- \`npm run ${name}\` -> \`${command}\``);
  }

  lines.push("- `node src/cli.js help`");
  lines.push("- `node test/run-tests.js`");

  return lines.join("\n");
}

/**
 * @param {string | undefined} task
 * @param {string | undefined} objective
 */
function formatScope(task, objective) {
  const lines = ["## Scope", ""];

  if (task) {
    lines.push(`- Task: ${task}`);
  }

  if (objective) {
    lines.push(`- Objective: ${objective}`);
  }

  if (!task && !objective) {
    lines.push("- Goal: understand the current codebase and the concepts required to modify it safely.");
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   title?: string,
 *   task?: string,
 *   objective?: string,
 *   focus?: string,
 *   projectRoot?: string,
 *   chunks?: Chunk[],
 *   tokenBudget?: number,
 *   maxChunks?: number,
 *   minScore?: number,
 *   sentenceBudget?: number
 * }} input
 */
export async function buildLearningReadme(input) {
  const {
    title = "README.LEARN",
    task,
    objective,
    focus = `${task ?? ""} ${objective ?? ""} understand code dependencies concepts`.trim(),
    projectRoot = ".",
    chunks = [],
    tokenBudget = 450,
    maxChunks = 8,
    minScore = 0.25,
    sentenceBudget = 3
  } = input;

  const metadata = await inferProjectMetadata(projectRoot);
  const packet = buildLearningPacket({
    task: task || "Understand the codebase",
    objective: objective || "Identify dependencies and concepts required to understand the code",
    focus,
    chunks,
    tokenBudget,
    maxChunks,
    minScore,
    sentenceBudget
  });
  const imports = classifyImports(chunks);
  const concepts = detectConcepts(chunks, packet, metadata);
  const readingOrder = buildReadingOrder(chunks, packet);
  const flowSteps = buildFlow(unique(chunks.map((chunk) => chunk.source)));

  const markdown = [
    `# ${title}`,
    "",
    "This file is generated to answer one practical question: what do you need to learn first to understand this code without drifting?",
    "",
    formatScope(task, objective),
    "",
    formatDependencySection(metadata, imports),
    "",
    formatConceptSection(concepts),
    "",
    formatReadingOrder(readingOrder),
    "",
    formatFlowSection(flowSteps),
    "",
    formatSelectedContext(packet),
    "",
    formatCommands(metadata),
    "",
    "## Current Reality",
    "",
    "- This guide reflects the current code and docs, not future architecture promises.",
    "- If Engram appears here, treat it as an optional external battery unless it is imported and used in the code itself.",
    "- The selector is still heuristic; understanding the scoring logic matters more than memorizing every constant."
  ].join("\n");

  return {
    markdown,
    packet,
    metadata,
    concepts,
    readingOrder,
    imports
  };
}
