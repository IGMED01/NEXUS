import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import {
  buildGeneratedSkillMarkdown,
  detectSkillConflicts,
  evaluateSkillCandidateHealth,
  createGeneratedSkillRegistry,
  extractRepeatedTasks,
  parseSkillFrontmatterMetadata,
  isGeneratedSkillRegistry,
  parseSkillTelemetryJsonl,
  summarizeSkillTelemetry,
  toSkillSlug,
  upsertGeneratedSkillRegistry
} from "../src/skills/auto-generator.js";

/**
 * @param {string[]} argv
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
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
 * @param {string[]} argv
 * @param {string} key
 * @returns {boolean}
 */
function hasFlag(argv, key) {
  return argv.includes(`--${key}`);
}

/**
 * @param {string[]} argv
 * @param {string} key
 * @returns {string[]}
 */
function options(argv, key) {
  /** @type {string[]} */
  const values = [];

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== `--${key}`) {
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }

    values.push(value);
  }

  return values;
}

/**
 * @param {string} value
 * @param {string} key
 * @param {{ min?: number, max?: number, integer?: boolean }} [rules]
 * @returns {number}
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
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
async function readFileIfPresent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function compact(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function displayPath(filePath) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolute);

  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }

  return absolute.replaceAll("\\", "/");
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniquePaths(values) {
  const seen = new Set();
  /** @type {string[]} */
  const output = [];

  for (const value of values) {
    const absolute = path.resolve(value).trim();
    if (!absolute || seen.has(absolute.toLowerCase())) {
      continue;
    }

    seen.add(absolute.toLowerCase());
    output.push(absolute);
  }

  return output;
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function inferSkillDescription(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/gu);
  const heading = lines.find((line) => line.trim().startsWith("# "));

  if (!heading) {
    return "";
  }

  return compact(heading.replace(/^#\s+/u, ""));
}

/**
 * @param {string} rootDir
 * @param {number} maxDepth
 * @param {number} depth
 * @returns {Promise<string[]>}
 */
async function discoverSkillFiles(rootDir, maxDepth, depth = 0) {
  if (depth > maxDepth) {
    return [];
  }

  /** @type {import("node:fs").Dirent[]} */
  let entries = [];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw error;
  }

  /** @type {string[]} */
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await discoverSkillFiles(fullPath, maxDepth, depth + 1);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * @param {Array<{ rootDir: string, source: string }>} roots
 * @param {number} maxDepth
 * @returns {Promise<Array<{ name: string, description: string, source: string, filePath: string }>>}
 */
async function loadInstalledSkillCatalog(roots, maxDepth) {
  /** @type {Array<{ name: string, description: string, source: string, filePath: string }>} */
  const catalog = [];

  for (const root of roots) {
    const skillFiles = await discoverSkillFiles(root.rootDir, maxDepth);

    for (const skillFile of skillFiles) {
      const markdown = await readFileIfPresent(skillFile);

      if (!markdown) {
        continue;
      }

      const meta = parseSkillFrontmatterMetadata(markdown);
      const fallbackName = compact(path.basename(path.dirname(skillFile)));
      const name = compact(meta.name || fallbackName);
      const description = compact(meta.description || inferSkillDescription(markdown));

      if (!name) {
        continue;
      }

      catalog.push({
        name,
        description,
        source: root.source,
        filePath: displayPath(skillFile)
      });
    }
  }

  const seen = new Set();
  return catalog.filter((entry) => {
    const key = `${entry.name.toLowerCase()}::${entry.filePath.toLowerCase()}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * @returns {string[]}
 */
function resolveDefaultSystemSkillDirs() {
  const codeHome = compact(process.env.CODEX_HOME ?? "");
  const home = compact(process.env.HOME ?? process.env.USERPROFILE ?? "");
  const appData = compact(process.env.APPDATA ?? "");
  const envDirs = compact(process.env.NEXUS_SKILLS_DIRS ?? process.env.CODEX_SKILLS_DIRS ?? "");
  const envList = envDirs ? envDirs.split(path.delimiter).map((item) => compact(item)) : [];
  const unixDefaults =
    process.platform === "win32" ? [] : ["/usr/local/share/codex/skills", "/etc/codex/skills"];

  const defaults = [
    ...(codeHome ? [path.join(codeHome, "skills")] : []),
    ...(home ? [path.join(home, ".codex", "skills")] : []),
    ...(appData ? [path.join(appData, "Codex", "skills")] : []),
    ...unixDefaults,
    ...envList
  ];

  return uniquePaths(defaults);
}

/**
 * @param {import("../src/skills/auto-generator.js").RepeatedTask} task
 * @param {string} skillName
 * @param {boolean} exists
 * @returns {string}
 */
function buildProposalLabel(task, skillName, exists) {
  const sample = compact(task.sample);
  const shortSample = sample.length > 92 ? `${sample.slice(0, 89)}...` : sample;
  const mode = exists ? "update" : "create";
  return `[proposal:${mode}] ${skillName} | ${task.occurrences}x | "${shortSample}"`;
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {{ label: string }} input
 * @returns {Promise<"yes" | "no" | "all" | "quit">}
 */
async function askForApproval(rl, input) {
  console.log(input.label);
  const answer = compact(
    await rl.question("Create draft skill? [y]es / [n]o / [a]ll / [q]uit: ")
  ).toLowerCase();

  if (answer === "y" || answer === "yes") {
    return "yes";
  }

  if (answer === "a" || answer === "all") {
    return "all";
  }

  if (answer === "q" || answer === "quit") {
    return "quit";
  }

  return "no";
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {{
 *   kind: "exact" | "similar",
 *   skillName: string,
 *   taskKey: string,
 *   matches: Array<{ name: string, source: string, filePath: string, score: number }>
 * }} input
 * @returns {Promise<"yes" | "no" | "quit">}
 */
async function askForConflictOverride(rl, input) {
  const label =
    input.kind === "exact"
      ? `[conflict:installed] ${input.skillName} already exists`
      : `[conflict:similar] ${input.skillName} has similar installed skills`;

  console.log(label);
  console.log(`task: ${input.taskKey}`);

  const topMatches = input.matches.slice(0, 3);
  for (const match of topMatches) {
    const scoreLabel = Number.isFinite(match.score) ? `${Math.round(match.score * 100)}%` : "n/a";
    console.log(`- ${match.name} (${match.source}, score ${scoreLabel})`);
    console.log(`  ${match.filePath}`);
  }

  const answer = compact(
    await rl.question("Create anyway? [y]es / [n]o / [q]uit: ")
  ).toLowerCase();

  if (answer === "y" || answer === "yes") {
    return "yes";
  }

  if (answer === "q" || answer === "quit") {
    return "quit";
  }

  return "no";
}

const argv = process.argv.slice(2);
const historyPath = path.resolve(option(argv, "history", path.join(".lcs", "shell-history")));
const outputDir = path.resolve(option(argv, "output-dir", path.join("skills", "generated")));
const telemetryPath = path.resolve(option(argv, "telemetry", path.join(".lcs", "shell-telemetry.jsonl")));
const minRepetitions = parseNumberOption(option(argv, "min-repetitions", "3"), "min-repetitions", {
  integer: true,
  min: 2
});
const top = parseNumberOption(option(argv, "top", "5"), "top", {
  integer: true,
  min: 1,
  max: 20
});
const dryRun = hasFlag(argv, "dry-run");
const force = hasFlag(argv, "force");
const autoApprove = hasFlag(argv, "yes") || hasFlag(argv, "auto-approve");
const proposeOnly = hasFlag(argv, "propose-only");
const allowInstalled = hasFlag(argv, "allow-installed") || hasFlag(argv, "allow-duplicate");
const allowSimilar = hasFlag(argv, "allow-similar");
const noSystemScan = hasFlag(argv, "no-system-scan");
const similarityThreshold = parseNumberOption(
  option(argv, "similarity-threshold", "0.72"),
  "similarity-threshold",
  { min: 0, max: 1 }
);
const catalogDepth = parseNumberOption(option(argv, "catalog-depth", "5"), "catalog-depth", {
  integer: true,
  min: 1,
  max: 8
});
const repoSkillsRoot = path.resolve(option(argv, "skills-dir", "skills"));
const cliSystemSkillDirs = options(argv, "system-skills-dir");
const envSystemSkillDirs = compact(option(argv, "system-skills-dirs", ""));
const splitEnvSystemSkillDirs = envSystemSkillDirs
  ? envSystemSkillDirs.split(path.delimiter).map((item) => compact(item))
  : [];
const defaultSystemSkillRoots = resolveDefaultSystemSkillDirs();
const explicitSystemSkillRoots = uniquePaths([...cliSystemSkillDirs, ...splitEnvSystemSkillDirs]);
const systemSkillRoots = uniquePaths([
  ...(!noSystemScan ? defaultSystemSkillRoots : []),
  ...explicitSystemSkillRoots
]);
const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const catalogRoots = [
  { rootDir: repoSkillsRoot, source: "repo" },
  ...systemSkillRoots.map((rootDir) => ({
    rootDir,
    source: "system"
  }))
];

const historyRaw = await readFileIfPresent(historyPath);
const telemetryRaw = await readFileIfPresent(telemetryPath);
const installedSkillCatalog = await loadInstalledSkillCatalog(catalogRoots, catalogDepth);

if (historyRaw === null) {
  console.error(`History file not found: ${historyPath}`);
  process.exitCode = 1;
} else {
  const lines = historyRaw.split(/\r?\n/gu);
  const repeated = extractRepeatedTasks(lines, {
    minOccurrences: minRepetitions,
    top
  });
  const telemetryEntries = telemetryRaw ? parseSkillTelemetryJsonl(telemetryRaw) : [];

  const safeCandidates = [];
  const blockedCandidates = [];

  for (const task of repeated) {
    const health = evaluateSkillCandidateHealth(task.key);

    if (!health.healthy) {
      blockedCandidates.push({
        task,
        reasons: health.reasons
      });
      continue;
    }

    safeCandidates.push({
      task,
      health
    });
  }

  if (repeated.length === 0) {
    console.log("No repetitive task patterns found.");
    console.log(`- history: ${historyPath}`);
    console.log(`- min repetitions: ${minRepetitions}`);
    process.exitCode = 0;
  } else if (safeCandidates.length === 0) {
    console.log("Patterns were detected but none passed the skill health filter.");
    console.log(`- blocked patterns: ${blockedCandidates.length}`);
    for (const blocked of blockedCandidates) {
      console.log(`- ${blocked.task.occurrences}x :: ${blocked.task.key}`);
      console.log(`  reasons: ${blocked.reasons.join(", ")}`);
    }
    process.exitCode = 0;
  } else {
    const registryPath = path.join(outputDir, "registry.json");
    const registryRaw = await readFileIfPresent(registryPath);
    const parsedRegistry = registryRaw ? JSON.parse(registryRaw) : null;
    const registry = isGeneratedSkillRegistry(parsedRegistry)
      ? parsedRegistry
      : createGeneratedSkillRegistry();

    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let rejected = 0;
    let applied = 0;
    let skippedExactConflict = 0;
    let skippedSimilarConflict = 0;

    /** @type {Array<{ name: string, kind: "exact" | "similar", matches: Array<{ name: string, source: string, filePath: string, score: number }> }>} */
    const conflictSkips = [];
    /** @type {Array<{ name: string, kind: "exact" | "similar", matches: Array<{ name: string, source: string, filePath: string, score: number }> }>} */
    const overriddenConflicts = [];
    /** @type {Array<{ name: string, description: string, source: string, filePath: string }>} */
    const knownSkillCatalog = [...installedSkillCatalog];

    const interactiveApproval = !dryRun && !autoApprove && !proposeOnly && canPrompt;
    const gatedNoTty = !dryRun && !autoApprove && !proposeOnly && !canPrompt;

    if (gatedNoTty) {
      console.log("Interactive approval required but no TTY detected.");
      console.log("No skills will be created in this run.");
      console.log("Use --yes for unattended creation or run in an interactive terminal.");
      console.log("");
    }

    /** @type {import("node:readline/promises").Interface | null} */
    let approvalRl = null;
    let approveAllRemaining = autoApprove;
    let quitRequested = false;

    if (interactiveApproval) {
      approvalRl = createInterface({
        input: process.stdin,
        output: process.stdout
      });
      console.log("Interactive approval mode enabled.");
      console.log("Each repeated task will be proposed before creating/updating a skill.");
      console.log("");
    }

    if (!dryRun && !proposeOnly && !gatedNoTty) {
      await mkdir(outputDir, { recursive: true });
    }

    try {
      for (const candidate of safeCandidates) {
        const task = candidate.task;
        if (quitRequested) {
          skipped += 1;
          continue;
        }

        const skillName = `auto-${toSkillSlug(task.key)}`;
        const skillDir = path.join(outputDir, skillName);
        const skillFilePath = path.join(skillDir, "SKILL.md");
        const relativeSkillFilePath = path.relative(process.cwd(), skillFilePath).replaceAll("\\", "/");
        const existingSkill = await readFileIfPresent(skillFilePath);
        const markdown = buildGeneratedSkillMarkdown({
          skillName,
          task,
          generatedAt: now,
          sourceHistoryPath: path.relative(process.cwd(), historyPath).replaceAll("\\", "/")
        });

        if (existingSkill && !force) {
          skipped += 1;
          continue;
        }

        const skillFileDisplayPath = displayPath(skillFilePath);
        const comparableCatalog = knownSkillCatalog.filter(
          (entry) => entry.filePath.toLowerCase() !== skillFileDisplayPath.toLowerCase()
        );
        const conflicts = detectSkillConflicts({
          candidateName: skillName,
          candidateContext: `${task.key} ${task.sample}`,
          entries: comparableCatalog,
          similarityThreshold
        });

        if (!allowInstalled && conflicts.exact.length > 0) {
          let override = false;

          if (approvalRl) {
            const decision = await askForConflictOverride(approvalRl, {
              kind: "exact",
              skillName,
              taskKey: task.key,
              matches: conflicts.exact
            });

            if (decision === "quit") {
              quitRequested = true;
              rejected += 1;
              continue;
            }

            override = decision === "yes";
          }

          if (!override) {
            skipped += 1;
            skippedExactConflict += 1;
            conflictSkips.push({
              name: skillName,
              kind: "exact",
              matches: conflicts.exact
            });
            continue;
          }

          overriddenConflicts.push({
            name: skillName,
            kind: "exact",
            matches: conflicts.exact
          });
        }

        if (!allowSimilar && conflicts.similar.length > 0) {
          let override = false;

          if (approvalRl) {
            const decision = await askForConflictOverride(approvalRl, {
              kind: "similar",
              skillName,
              taskKey: task.key,
              matches: conflicts.similar
            });

            if (decision === "quit") {
              quitRequested = true;
              rejected += 1;
              continue;
            }

            override = decision === "yes";
          }

          if (!override) {
            skipped += 1;
            skippedSimilarConflict += 1;
            conflictSkips.push({
              name: skillName,
              kind: "similar",
              matches: conflicts.similar
            });
            continue;
          }

          overriddenConflicts.push({
            name: skillName,
            kind: "similar",
            matches: conflicts.similar
          });
        }

        const actionable = !proposeOnly && !dryRun && !gatedNoTty;
        let approved = dryRun || proposeOnly || gatedNoTty || approveAllRemaining;

        if (!approved && approvalRl) {
          const decision = await askForApproval(approvalRl, {
            label: buildProposalLabel(task, skillName, Boolean(existingSkill))
          });

          if (decision === "all") {
            approveAllRemaining = true;
            approved = true;
          } else if (decision === "quit") {
            quitRequested = true;
            rejected += 1;
            continue;
          } else if (decision === "yes") {
            approved = true;
          } else {
            rejected += 1;
            continue;
          }
        } else if (!approved) {
          rejected += 1;
          continue;
        }

        if (actionable) {
          await mkdir(skillDir, { recursive: true });
          await writeFile(skillFilePath, markdown, "utf8");
          applied += 1;

          if (existingSkill) {
            updated += 1;
          } else {
            created += 1;
          }
        } else {
          if (existingSkill) {
            updated += 1;
          } else {
            created += 1;
          }
        }

        const inCatalog = knownSkillCatalog.some(
          (entry) => entry.filePath.toLowerCase() === skillFileDisplayPath.toLowerCase()
        );
        if (!inCatalog) {
          knownSkillCatalog.push({
            name: skillName,
            description: "",
            source: "generated",
            filePath: skillFileDisplayPath
          });
        }

        if (actionable) {
          upsertGeneratedSkillRegistry(registry, {
            skillName,
            task,
            source: path.relative(process.cwd(), historyPath).replaceAll("\\", "/"),
            filePath: relativeSkillFilePath,
            baseline: {
              ...summarizeSkillTelemetry(telemetryEntries, {
                taskKey: task.key,
                until: now
              }),
              capturedAt: now
            },
            now
          });
        }
      }
    } finally {
      approvalRl?.close();
    }

    if (!dryRun && !proposeOnly && !gatedNoTty) {
      await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    }

    console.log("NEXUS Skill Auto-Generator");
    console.log(`- history: ${historyPath}`);
    console.log(`- telemetry: ${telemetryPath}`);
    console.log(`- output: ${outputDir}`);
    console.log(`- repo skills root: ${repoSkillsRoot}`);
    console.log(`- default system scan: ${noSystemScan ? "off" : "on"}`);
    console.log(`- explicit system roots: ${explicitSystemSkillRoots.length}`);
    console.log(`- catalog roots: ${catalogRoots.length}`);
    console.log(`- installed skills catalog: ${installedSkillCatalog.length}`);
    console.log(`- similarity threshold: ${similarityThreshold}`);
    console.log(`- patterns detected: ${repeated.length}`);
    console.log(`- healthy candidates: ${safeCandidates.length}`);
    console.log(`- blocked by health filter: ${blockedCandidates.length}`);
    console.log(`- conflict guard (installed duplicates): ${allowInstalled ? "off" : "on"}`);
    console.log(`- conflict guard (similar skills): ${allowSimilar ? "off" : "on"}`);
    console.log(`- created: ${created}`);
    console.log(`- updated: ${updated}`);
    console.log(`- rejected: ${rejected}`);
    console.log(`- skipped: ${skipped}${force ? " (force enabled)" : ""}`);
    console.log(`  - skipped exact installed conflicts: ${skippedExactConflict}`);
    console.log(`  - skipped similar conflicts: ${skippedSimilarConflict}`);
    console.log(`- applied: ${applied}`);
    console.log(`- mode: ${
      dryRun
        ? "dry-run"
        : proposeOnly
          ? "propose-only"
          : gatedNoTty
            ? "approval-required-no-tty"
            : interactiveApproval
              ? "interactive-approval"
              : autoApprove
                ? "auto-approve"
                : "write"
    }`);
    console.log("");
    console.log("Top healthy repeated patterns:");
    for (const candidate of safeCandidates) {
      console.log(`- ${candidate.task.occurrences}x :: ${candidate.task.key}`);
    }

    if (blockedCandidates.length > 0) {
      console.log("");
      console.log("Blocked candidates (health filter):");
      for (const blocked of blockedCandidates) {
        console.log(`- ${blocked.task.occurrences}x :: ${blocked.task.key}`);
        console.log(`  reasons: ${blocked.reasons.join(", ")}`);
      }
    }

    if (conflictSkips.length > 0) {
      console.log("");
      console.log("Conflict-guard skips:");
      for (const entry of conflictSkips.slice(0, 10)) {
        const matches = entry.matches.slice(0, 2).map((match) => `${match.name} (${match.source})`).join(", ");
        console.log(`- ${entry.name} [${entry.kind}] -> ${matches}`);
      }
    }

    if (overriddenConflicts.length > 0) {
      console.log("");
      console.log("Conflict overrides (interactive):");
      for (const entry of overriddenConflicts.slice(0, 10)) {
        const matches = entry.matches.slice(0, 2).map((match) => `${match.name} (${match.source})`).join(", ");
        console.log(`- ${entry.name} [${entry.kind}] -> ${matches}`);
      }
    }
  }
}
