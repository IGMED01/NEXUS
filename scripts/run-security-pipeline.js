import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCli } from "../src/cli/app.js";

const QUALITY_GATE_FAILED_EXIT_CODE = 2;

/**
 * @param {string[]} argv
 * @param {string} key
 * @param {string} fallback
 */
function option(argv, key, fallback) {
  const index = argv.indexOf(`--${key}`);

  if (index === -1) {
    return fallback;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return fallback;
  }

  return value;
}

/**
 * @param {string} value
 * @param {string} key
 * @param {{ min?: number, max?: number, integer?: boolean }} [rules]
 */
function parseNumberOption(value, key, rules = {}) {
  const parsed = Number(value);

  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    throw new Error(`Option --${key} must be a valid number.`);
  }

  if (rules.integer && !Number.isInteger(parsed)) {
    throw new Error(`Option --${key} must be an integer.`);
  }

  if (rules.min !== undefined && parsed < rules.min) {
    throw new Error(`Option --${key} must be >= ${rules.min}.`);
  }

  if (rules.max !== undefined && parsed > rules.max) {
    throw new Error(`Option --${key} must be <= ${rules.max}.`);
  }

  return parsed;
}

/**
 * @param {string} value
 * @param {string} key
 */
function parseBooleanOption(value, key) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Option --${key} must be true or false.`);
}

/**
 * @param {{
 *   qualityGateEnabled: boolean,
 *   minIncludedFindings: number,
 *   minSelectedTeachChunks: number,
 *   minPriority: number
 * }} rules
 * @param {{
 *   ingest: {
 *     includedFindings?: number,
 *     chunkFile?: { chunks?: Array<{ priority?: number }> }
 *   },
 *   teach: {
 *     selectedContext?: unknown[]
 *   }
 * }} input
 */
function evaluateQualityGate(rules, input) {
  if (!rules.qualityGateEnabled) {
    return {
      enabled: false,
      passed: true,
      failures: []
    };
  }

  const failures = [];
  const includedFindings = Number(input.ingest.includedFindings ?? 0);
  const selectedTeachChunks = Array.isArray(input.teach.selectedContext)
    ? input.teach.selectedContext.length
    : 0;
  const priorities = Array.isArray(input.ingest.chunkFile?.chunks)
    ? input.ingest.chunkFile.chunks
        .map((chunk) => (typeof chunk.priority === "number" ? chunk.priority : 0))
        .filter((value) => Number.isFinite(value))
    : [];
  const maxPriority = priorities.length ? Math.max(...priorities) : 0;

  if (includedFindings < rules.minIncludedFindings) {
    failures.push(
      `included findings ${includedFindings} < required ${rules.minIncludedFindings}`
    );
  }

  if (selectedTeachChunks < rules.minSelectedTeachChunks) {
    failures.push(
      `selected teach chunks ${selectedTeachChunks} < required ${rules.minSelectedTeachChunks}`
    );
  }

  if (maxPriority < rules.minPriority) {
    failures.push(
      `max finding priority ${maxPriority.toFixed(3)} < required ${rules.minPriority.toFixed(3)}`
    );
  }

  return {
    enabled: true,
    passed: failures.length === 0,
    failures,
    includedFindings,
    selectedTeachChunks,
    maxPriority
  };
}

const argv = process.argv.slice(2);
const input = option(argv, "input", "examples/prowler-findings.sample.json");
const outputDir = option(argv, "output-dir", "test-output/security-pipeline");
const statusFilter = option(argv, "status-filter", "non-pass");
const maxFindings = option(argv, "max-findings", "200");
const qualityGateEnabled = parseBooleanOption(option(argv, "quality-gate", "true"), "quality-gate");
const minIncludedFindings = parseNumberOption(
  option(argv, "min-included-findings", "1"),
  "min-included-findings",
  { min: 0, integer: true }
);
const minSelectedTeachChunks = parseNumberOption(
  option(argv, "min-selected-teach-chunks", "1"),
  "min-selected-teach-chunks",
  { min: 0, integer: true }
);
const minPriority = parseNumberOption(option(argv, "min-priority", "0.84"), "min-priority", {
  min: 0,
  max: 1
});
const task = option(argv, "task", "Prioritize cloud security findings");
const objective = option(
  argv,
  "objective",
  "Teach severity-first remediation sequencing from imported findings"
);

const resolvedOutputDir = path.resolve(outputDir);
const chunksPath = path.join(resolvedOutputDir, "security-chunks.json");
const teachPath = path.join(resolvedOutputDir, "security-teach.json");

await mkdir(resolvedOutputDir, { recursive: true });

const ingestResult = await runCli([
  "ingest-security",
  "--input",
  input,
  "--status-filter",
  statusFilter,
  "--max-findings",
  maxFindings,
  "--output",
  chunksPath,
  "--format",
  "json"
]);

if (ingestResult.exitCode !== 0) {
  console.error(ingestResult.stderr || ingestResult.stdout);
  process.exitCode = ingestResult.exitCode;
} else {
  const ingest = JSON.parse(ingestResult.stdout);
  const teachResult = await runCli([
    "teach",
    "--input",
    chunksPath,
    "--task",
    task,
    "--objective",
    objective,
    "--no-recall",
    "--format",
    "json"
  ]);

  if (teachResult.exitCode !== 0) {
    console.error(teachResult.stderr || teachResult.stdout);
    process.exitCode = teachResult.exitCode;
  } else {
    await writeFile(teachPath, `${teachResult.stdout}\n`, "utf8");
    const teach = JSON.parse(teachResult.stdout);
    const gate = evaluateQualityGate(
      {
        qualityGateEnabled,
        minIncludedFindings,
        minSelectedTeachChunks,
        minPriority
      },
      { ingest, teach }
    );

    console.log("Pipeline completed.");
    console.log(`- findings input: ${path.resolve(input)}`);
    console.log(`- chunks output: ${chunksPath}`);
    console.log(`- teach output: ${teachPath}`);
    console.log(`- included findings: ${ingest.includedFindings}`);
    console.log(`- skipped findings: ${ingest.skippedFindings}`);
    console.log(`- selected teach chunks: ${teach.selectedContext?.length ?? 0}`);

    if (gate.enabled) {
      if (gate.passed) {
        console.log(
          `- quality gate: PASS (included=${gate.includedFindings}, selected=${gate.selectedTeachChunks}, maxPriority=${gate.maxPriority.toFixed(3)})`
        );
      } else {
        console.error("Quality gate failed:");
        for (const failure of gate.failures) {
          console.error(`- ${failure}`);
        }
        process.exitCode = QUALITY_GATE_FAILED_EXIT_CODE;
      }
    } else {
      console.log("- quality gate: DISABLED");
    }
  }
}
