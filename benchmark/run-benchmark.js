// @ts-check

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseBenchmarkFile } from "../src/contracts/benchmark-contracts.js";
import { selectContextWindow } from "../src/context/noise-canceler.js";
import { buildLearningPacket } from "../src/learning/mentor-loop.js";

function toPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function ratio(part, total) {
  if (!total) {
    return 1;
  }

  return part / total;
}

function runCase(entry) {
  const options = {
    focus: entry.input.focus || `${entry.input.task} ${entry.input.objective}`.trim(),
    tokenBudget: entry.input.tokenBudget,
    maxChunks: entry.input.maxChunks,
    minScore: entry.input.minScore,
    sentenceBudget: entry.input.sentenceBudget,
    changedFiles: entry.input.changedFiles
  };

  const result =
    entry.mode === "teach"
      ? buildLearningPacket({
          task: entry.input.task,
          objective: entry.input.objective,
          focus: options.focus,
          changedFiles: entry.input.changedFiles,
          chunks: entry.input.chunks,
          tokenBudget: options.tokenBudget,
          maxChunks: options.maxChunks,
          minScore: options.minScore,
          sentenceBudget: options.sentenceBudget
        })
      : selectContextWindow(entry.input.chunks, options);

  const selected =
    entry.mode === "teach"
      ? result.selectedContext.map((chunk) => ({ id: chunk.id, source: chunk.source }))
      : result.selected.map((chunk) => ({ id: chunk.id, source: chunk.source }));
  const selectedIds = selected.map((chunk) => chunk.id);
  const relevantSet = new Set(
    [...entry.expectations.relevant, ...entry.expectations.mustSelect].filter(Boolean)
  );

  const mustSelectHits = entry.expectations.mustSelect.filter((id) => selectedIds.includes(id)).length;
  const mustExcludeHits = entry.expectations.mustExclude.filter((id) => !selectedIds.includes(id)).length;
  const relevantHits = selectedIds.filter((id) => relevantSet.has(id)).length;
  const topPrefixPass = entry.expectations.topPrefix.every((id, index) => selectedIds[index] === id);
  const relevantRatio = ratio(relevantHits, selectedIds.length);
  const pass =
    mustSelectHits === entry.expectations.mustSelect.length &&
    mustExcludeHits === entry.expectations.mustExclude.length &&
    topPrefixPass &&
    relevantRatio >= entry.expectations.minRelevantRatio;

  return {
    name: entry.name,
    mode: entry.mode,
    selectedIds,
    mustSelectRecall: ratio(mustSelectHits, entry.expectations.mustSelect.length),
    exclusionSuccess: ratio(mustExcludeHits, entry.expectations.mustExclude.length),
    relevantRatio,
    topPrefixPass,
    pass
  };
}

function formatCase(result) {
  return [
    `- ${result.pass ? "PASS" : "FAIL"} ${result.name}`,
    `  mode: ${result.mode}`,
    `  selected: ${result.selectedIds.join(", ") || "none"}`,
    `  mustSelectRecall: ${toPercent(result.mustSelectRecall)}`,
    `  exclusionSuccess: ${toPercent(result.exclusionSuccess)}`,
    `  relevantRatio: ${toPercent(result.relevantRatio)}`,
    `  topPrefixPass: ${result.topPrefixPass ? "yes" : "no"}`
  ].join("\n");
}

async function main() {
  const benchmarkPath = path.resolve("benchmark/selector-benchmark.json");
  const raw = await readFile(benchmarkPath, "utf8");
  const payload = parseBenchmarkFile(raw, benchmarkPath);
  const results = payload.cases.map(runCase);

  console.log("# Selector Benchmark");
  console.log("");

  for (const result of results) {
    console.log(formatCase(result));
    console.log("");
  }

  const summary = {
    passRate: ratio(results.filter((result) => result.pass).length, results.length),
    avgMustSelectRecall: average(results.map((result) => result.mustSelectRecall)),
    avgExclusionSuccess: average(results.map((result) => result.exclusionSuccess)),
    avgRelevantRatio: average(results.map((result) => result.relevantRatio)),
    topPrefixPassRate: ratio(results.filter((result) => result.topPrefixPass).length, results.length)
  };

  console.log("## Summary");
  console.log(`- Cases: ${results.length}`);
  console.log(`- Pass rate: ${toPercent(summary.passRate)}`);
  console.log(`- Avg must-select recall: ${toPercent(summary.avgMustSelectRecall)}`);
  console.log(`- Avg exclusion success: ${toPercent(summary.avgExclusionSuccess)}`);
  console.log(`- Avg relevant ratio: ${toPercent(summary.avgRelevantRatio)}`);
  console.log(`- Top-prefix pass rate: ${toPercent(summary.topPrefixPassRate)}`);

  if (summary.passRate < 1) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
