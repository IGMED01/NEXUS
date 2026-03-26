import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  compareSkillTelemetry,
  evaluateSkillCandidateHealth,
  parseSkillTelemetryJsonl,
  summarizeSkillTelemetry
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
async function readOptional(filePath) {
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
 * @param {string | null} markdown
 * @returns {string[]}
 */
function validateSkillMarkdown(markdown) {
  if (!markdown) {
    return ["missing-skill-file"];
  }

  const required = [
    "## Trigger",
    "## Suggested workflow",
    "## Validation checklist",
    "## Promotion checklist"
  ];

  const reasons = [];
  for (const section of required) {
    if (!markdown.includes(section)) {
      reasons.push(`missing-section:${section.replace(/^##\s+/u, "").toLowerCase().replace(/\s+/gu, "-")}`);
    }
  }

  return reasons;
}

const argv = process.argv.slice(2);
const registryPath = path.resolve(option(argv, "registry", path.join("skills", "generated", "registry.json")));
const telemetryPath = path.resolve(option(argv, "telemetry", path.join(".lcs", "shell-telemetry.jsonl")));
const minRuns = parseNumberOption(option(argv, "min-runs", "3"), "min-runs", { min: 1, integer: true });
const minTokenImprovement = parseNumberOption(option(argv, "token-improvement", "0.2"), "token-improvement", { min: 0, max: 1 });
const minDurationImprovement = parseNumberOption(option(argv, "time-improvement", "0.25"), "time-improvement", { min: 0, max: 1 });
const minErrorImprovement = parseNumberOption(option(argv, "error-improvement", "0.3"), "error-improvement", { min: 0, max: 1 });
const dryRun = hasFlag(argv, "dry-run");
const strictTokens = !hasFlag(argv, "allow-missing-token-metrics");

const registryRaw = await readOptional(registryPath);

if (!registryRaw) {
  console.log(`No generated skill registry found at: ${registryPath}`);
  console.log("Run `npm run skills:auto` first to create draft skills.");
  process.exitCode = 0;
} else {
  const registry = JSON.parse(registryRaw.replace(/^\uFEFF/u, ""));
  const skills = Array.isArray(registry.skills) ? registry.skills : [];
  const telemetryRaw = await readOptional(telemetryPath);
  const telemetryEntries = telemetryRaw ? parseSkillTelemetryJsonl(telemetryRaw) : [];
  const now = new Date().toISOString();

  let promoted = 0;
  let held = 0;
  let updated = 0;

  /** @type {Array<{ name: string, reasons: string[] }>} */
  const holds = [];
  /** @type {string[]} */
  const promotions = [];

  for (const skill of skills) {
    if (!skill || typeof skill !== "object") {
      continue;
    }

    if (skill.status !== "draft") {
      continue;
    }

    const reasons = [];
    const health = evaluateSkillCandidateHealth(String(skill.taskKey ?? ""));
    const skillFilePath = path.resolve(process.cwd(), String(skill.filePath ?? ""));
    const markdown = await readOptional(skillFilePath);
    const markdownReasons = validateSkillMarkdown(markdown);

    if (!health.healthy) {
      reasons.push(...health.reasons);
    }

    reasons.push(...markdownReasons);

    const baseline = skill.metrics?.baseline ?? summarizeSkillTelemetry(telemetryEntries, {
      taskKey: String(skill.taskKey ?? ""),
      until: String(skill.createdAt ?? now)
    });
    const current = summarizeSkillTelemetry(telemetryEntries, {
      taskKey: String(skill.taskKey ?? ""),
      since: String(skill.createdAt ?? now)
    });

    const deltas = compareSkillTelemetry(baseline, current);

    if (current.samples < minRuns) {
      reasons.push(`insufficient-runs:${current.samples}/${minRuns}`);
    }

    if (deltas.durationImprovementPct === null || deltas.durationImprovementPct < minDurationImprovement) {
      reasons.push(
        `duration-improvement-below-threshold:${deltas.durationImprovementPct ?? "null"}<${minDurationImprovement}`
      );
    }

    if (deltas.errorImprovementPct === null || deltas.errorImprovementPct < minErrorImprovement) {
      reasons.push(
        `error-improvement-below-threshold:${deltas.errorImprovementPct ?? "null"}<${minErrorImprovement}`
      );
    }

    if (strictTokens) {
      if (deltas.tokenImprovementPct === null || deltas.tokenImprovementPct < minTokenImprovement) {
        reasons.push(
          `token-improvement-below-threshold:${deltas.tokenImprovementPct ?? "null"}<${minTokenImprovement}`
        );
      }
    }

    skill.command = health.command;
    skill.health = {
      eligible: health.healthy && markdownReasons.length === 0,
      blockedReasons: [...new Set(reasons.filter((reason) => reason.startsWith("missing-") || reason.includes("dangerous") || reason.includes("unknown-command") || reason.includes("missing-skill-file")))],
      checkedAt: now
    };
    skill.metrics = {
      ...(skill.metrics ?? {}),
      baseline: {
        ...baseline,
        capturedAt: skill.metrics?.baseline?.capturedAt ?? String(skill.createdAt ?? now)
      },
      current: {
        ...current,
        capturedAt: now
      },
      deltas
    };

    if (reasons.length === 0) {
      skill.status = "experimental";
      skill.promotion = {
        lastEvaluatedAt: now,
        decision: "promoted-experimental",
        reasons: ["automatic-promotion-passed-token-time-error-thresholds"]
      };
      promoted += 1;
      updated += 1;
      promotions.push(String(skill.name ?? "unknown"));
    } else {
      skill.promotion = {
        lastEvaluatedAt: now,
        decision: "hold",
        reasons
      };
      held += 1;
      updated += 1;
      holds.push({
        name: String(skill.name ?? "unknown"),
        reasons
      });
    }
  }

  if (!dryRun) {
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  }

  console.log("NEXUS Skill Promotion");
  console.log(`- registry: ${registryPath}`);
  console.log(`- telemetry: ${telemetryPath}`);
  console.log(`- strict token metric: ${strictTokens ? "on" : "off"}`);
  console.log(`- updated entries: ${updated}`);
  console.log(`- promoted to experimental: ${promoted}`);
  console.log(`- held: ${held}`);
  console.log(`- mode: ${dryRun ? "dry-run" : "write"}`);

  if (promotions.length > 0) {
    console.log("");
    console.log("Promoted skills:");
    for (const name of promotions) {
      console.log(`- ${name}`);
    }
  }

  if (holds.length > 0) {
    console.log("");
    console.log("Held skills:");
    for (const hold of holds) {
      console.log(`- ${hold.name}`);
      console.log(`  reasons: ${hold.reasons.join(", ")}`);
    }
  }
}
