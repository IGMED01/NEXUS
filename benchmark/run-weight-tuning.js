// @ts-check

import { readFile } from "node:fs/promises";
import path from "node:path";

import { runCli } from "../src/cli/app.js";
import { parseVerticalBenchmarkFile } from "../src/contracts/vertical-benchmark-contracts.js";
import { NEXUS_SCORING_PROFILES } from "../src/context/noise-canceler.js";

/**
 * @param {number} value
 */
function toPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * @param {number} part
 * @param {number} total
 */
function ratio(part, total) {
  return total ? part / total : 1;
}

/**
 * @param {number[]} values
 */
function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

/**
 * @param {{
 *   observationId: string,
 *   type: string,
 *   title: string,
 *   body: string,
 *   timestamp: string
 * }} memory
 * @param {string} project
 */
function buildMemoryStdout(memory, project) {
  return [
    "Found 1 memories:",
    "",
    `[1] #${memory.observationId} (${memory.type}) — ${memory.title}`,
    `    ${memory.body}`,
    `    ${memory.timestamp} | project: ${project} | scope: project`
  ].join("\n");
}

/**
 * @param {{ memories?: Array<{
 *   query: string,
 *   observationId: string,
 *   type: string,
 *   title: string,
 *   body: string,
 *   timestamp: string
 * }> }} provider
 * @param {string} project
 */
function createFakeEngramClient(provider = {}, project) {
  return {
    async recallContext() {
      return {
        mode: "context",
        project,
        query: "",
        stdout: "No previous session memories found.",
        dataDir: ".engram"
      };
    },
    async searchMemories(query, options) {
      const memory = (provider.memories ?? []).find((entry) => entry.query === query);

      return {
        mode: "search",
        project: options?.project ?? project,
        query,
        type: options?.type ?? "",
        scope: options?.scope ?? "",
        limit: options?.limit ?? null,
        stdout: memory
          ? buildMemoryStdout(memory, options?.project ?? project)
          : "No memories found for that query.",
        dataDir: ".engram"
      };
    },
    async saveMemory() {
      throw new Error("not used");
    },
    async closeSession() {
      throw new Error("not used");
    }
  };
}

/**
 * @param {import("../src/contracts/vertical-benchmark-contracts.js").VerticalBenchmarkCase} entry
 */
async function runCase(entry) {
  const argv = [
    "teach",
    "--workspace",
    entry.input.workspace,
    "--task",
    entry.input.task,
    "--objective",
    entry.input.objective,
    "--changed-files",
    entry.input.changedFiles.join(","),
    "--project",
    entry.input.project,
    "--token-budget",
    String(entry.input.tokenBudget),
    "--max-chunks",
    String(entry.input.maxChunks),
    "--format",
    "json"
  ];

  if (entry.input.noRecall) {
    argv.push("--no-recall");
  }

  if (entry.input.recallQuery) {
    argv.push("--recall-query", entry.input.recallQuery);
  }

  const result = await runCli(argv, {
    engramClient: createFakeEngramClient(entry.provider, entry.input.project)
  });
  const parsed = JSON.parse(result.stdout);
  const selectedSources = parsed.selectedContext.map((chunk) => chunk.source);
  const codeFocusPass = parsed.teachingSections.codeFocus?.source === entry.expectations.codeFocus;
  const relatedTestPass =
    parsed.teachingSections.relatedTests?.[0]?.source === entry.expectations.relatedTest;
  const noiseExclusionPass = entry.expectations.excludedSources.every(
    (source) => !selectedSources.includes(source)
  );
  const memoryBehaviorPass =
    parsed.memoryRecall.status === entry.expectations.memoryRecallStatus &&
    parsed.memoryRecall.selectedChunks === entry.expectations.selectedMemoryChunks &&
    parsed.memoryRecall.suppressedChunks === entry.expectations.suppressedMemoryChunks;
  const pass = codeFocusPass && relatedTestPass && noiseExclusionPass && memoryBehaviorPass;

  return {
    pass,
    codeFocusPass,
    relatedTestPass,
    noiseExclusionPass,
    memoryBehaviorPass
  };
}

/**
 * @param {import("../src/contracts/vertical-benchmark-contracts.js").VerticalBenchmarkCase[]} cases
 * @param {string} profile
 */
async function runProfile(cases, profile) {
  const previousProfile = process.env.LCS_SCORING_PROFILE;
  process.env.LCS_SCORING_PROFILE = profile;

  try {
    const results = [];

    for (const entry of cases) {
      results.push(await runCase(entry));
    }

    return {
      profile,
      passRate: ratio(results.filter((entry) => entry.pass).length, results.length),
      codeFocusPassRate: ratio(results.filter((entry) => entry.codeFocusPass).length, results.length),
      relatedTestPassRate: ratio(results.filter((entry) => entry.relatedTestPass).length, results.length),
      noiseExclusionPassRate: ratio(
        results.filter((entry) => entry.noiseExclusionPass).length,
        results.length
      ),
      memoryBehaviorPassRate: ratio(
        results.filter((entry) => entry.memoryBehaviorPass).length,
        results.length
      ),
      avgSignalPassRate: average(
        results.map((entry) =>
          average([
            entry.codeFocusPass ? 1 : 0,
            entry.relatedTestPass ? 1 : 0,
            entry.noiseExclusionPass ? 1 : 0,
            entry.memoryBehaviorPass ? 1 : 0
          ])
        )
      )
    };
  } finally {
    if (previousProfile) {
      process.env.LCS_SCORING_PROFILE = previousProfile;
    } else {
      delete process.env.LCS_SCORING_PROFILE;
    }
  }
}

async function main() {
  const benchmarkPath = path.resolve("benchmark/vertical-benchmark.json");
  const raw = await readFile(benchmarkPath, "utf8");
  const payload = parseVerticalBenchmarkFile(raw, benchmarkPath);
  const requestedProfiles = process.argv.slice(2).filter(Boolean);
  const profiles = requestedProfiles.length ? requestedProfiles : [...NEXUS_SCORING_PROFILES];
  const results = [];

  for (const profile of profiles) {
    results.push(await runProfile(payload.cases, profile));
  }

  results.sort(
    (left, right) =>
      right.passRate - left.passRate ||
      right.avgSignalPassRate - left.avgSignalPassRate ||
      (right.profile === "vertical-tuned" ? 1 : 0) -
        (left.profile === "vertical-tuned" ? 1 : 0) ||
      left.profile.localeCompare(right.profile)
  );

  console.log("# NEXUS:3 selector weight tuning");
  console.log("");

  for (const result of results) {
    console.log(`## Profile: ${result.profile}`);
    console.log(`- Pass rate: ${toPercent(result.passRate)}`);
    console.log(`- Code-focus pass rate: ${toPercent(result.codeFocusPassRate)}`);
    console.log(`- Related-test pass rate: ${toPercent(result.relatedTestPassRate)}`);
    console.log(`- Noise-exclusion pass rate: ${toPercent(result.noiseExclusionPassRate)}`);
    console.log(`- Memory-behavior pass rate: ${toPercent(result.memoryBehaviorPassRate)}`);
    console.log(`- Avg signal pass rate: ${toPercent(result.avgSignalPassRate)}`);
    console.log("");
  }

  const best = results[0];
  console.log(`Recommended profile: ${best.profile}`);

  if (best.passRate < 1) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
