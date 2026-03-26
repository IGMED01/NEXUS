// @ts-check

/**
 * @typedef {{
 *   key: string,
 *   sample: string,
 *   occurrences: number
 * }} RepeatedTask
 */

/**
 * @typedef {{
 *   samples: number,
 *   averageDurationMs: number | null,
 *   errorRate: number | null,
 *   averageUsedTokens: number | null,
 *   averageTokenBudget: number | null
 * }} SkillTelemetrySummary
 */

/**
 * @typedef {{
 *   recordedAt: string,
 *   taskKey: string,
 *   command: string,
 *   durationMs: number,
 *   exitCode: number,
 *   usedTokens: number | null,
 *   tokenBudget: number | null
 * }} SkillTelemetryEntry
 */

/**
 * @typedef {{
 *   version: 1,
 *   generatedAt: string,
  *   skills: Array<{
 *     name: string,
 *     status: "draft" | "experimental" | "stable",
 *     taskKey: string,
 *     sample: string,
 *     occurrences: number,
 *     source: string,
 *     filePath: string,
 *     command?: string,
 *     health?: {
 *       eligible: boolean,
 *       blockedReasons: string[],
 *       checkedAt: string
 *     },
 *     metrics?: {
 *       baseline?: SkillTelemetrySummary & { capturedAt: string },
 *       current?: SkillTelemetrySummary & { capturedAt: string },
 *       deltas?: {
 *         durationImprovementPct: number | null,
 *         errorImprovementPct: number | null,
 *         tokenImprovementPct: number | null
 *       }
 *     },
 *     promotion?: {
 *       lastEvaluatedAt?: string,
 *       decision?: "hold" | "promoted-experimental" | "promoted-stable",
 *       reasons?: string[]
 *     },
 *     createdAt: string,
 *     updatedAt: string
 *   }>
 * }} GeneratedSkillRegistry
 */

const INTERNAL_NAV_COMMANDS = new Set([
  "help",
  "exit",
  "quit",
  "q",
  "status",
  "clear",
  "cls"
]);

const INTERNAL_NAV_PREFIXES = ["tab ", "set "];

const QUICK_SWITCH_TOKENS = new Set(["r", "t", "m", "d", "s", "1", "2", "3", "4", "5"]);
const GENERIC_NO_ARG_COMMANDS = new Set(["recall", "teach", "remember", "doctor", "select"]);

const SECRET_LIKE_FRAGMENT = /(sk-[a-z0-9]{16,}|ghp_[a-z0-9]{16,}|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})/giu;

const KNOWN_SAFE_COMMANDS = new Set([
  "recall",
  "teach",
  "remember",
  "doctor",
  "select",
  "readme",
  "sync-knowledge",
  "ingest-security",
  "close"
]);

const DANGEROUS_SKILL_PATTERNS = [
  /\brm\s+-rf\b/iu,
  /\bdel\s+\/[a-z]/iu,
  /\bformat\s+[a-z]:/iu,
  /\bshutdown\b/iu,
  /\breboot\b/iu,
  /\bcurl\b.*\|\s*(sh|bash)/iu,
  /\b(wget|irm|invoke-webrequest)\b.*\|\s*(iex|sh|bash)/iu,
  /\b(iex|invoke-expression)\b/iu,
  /\bgit\s+push\s+--force\b/iu,
  /\bgit\s+reset\s+--hard\b/iu,
  /\bnpm\s+publish\b/iu,
  /\bsc\s+delete\b/iu,
  /\breg\s+add\b/iu
];

const SIMILARITY_STOPWORDS = new Set([
  "auto",
  "skill",
  "skills",
  "draft",
  "generated",
  "nexus",
  "shell",
  "task",
  "tasks",
  "workflow",
  "interactive",
  "mode"
]);

/**
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asFiniteNumberOrNull(value) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

/**
 * @param {string} taskKey
 * @returns {string}
 */
export function inferTaskCommand(taskKey) {
  const normalized = normalizeTaskLine(taskKey);

  if (!normalized) {
    return "unknown";
  }

  const firstToken = normalized.split(" ")[0] ?? "";

  if (KNOWN_SAFE_COMMANDS.has(firstToken)) {
    return firstToken;
  }

  return "unknown";
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function similarityTokens(value) {
  const normalized = normalizeTaskLine(value).replace(/[^a-z0-9]+/gu, " ").trim();

  if (!normalized) {
    return [];
  }

  return [...new Set(
    normalized
      .split(/\s+/gu)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !SIMILARITY_STOPWORDS.has(token))
  )];
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function scoreSkillSimilarity(left, right) {
  const leftSlug = toSkillSlug(left);
  const rightSlug = toSkillSlug(right);

  if (!leftSlug || !rightSlug) {
    return 0;
  }

  if (leftSlug === rightSlug) {
    return 1;
  }

  if (
    (leftSlug.includes(rightSlug) || rightSlug.includes(leftSlug)) &&
    Math.min(leftSlug.length, rightSlug.length) >= 8
  ) {
    return 0.9;
  }

  const leftTokens = similarityTokens(left);
  const rightTokens = similarityTokens(right);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  if (!union) {
    return 0;
  }

  return round(intersection / union);
}

/**
 * @param {string} candidate
 * @param {Array<{ name: string, description?: string, source?: string, filePath?: string }>} entries
 * @param {number} threshold
 * @returns {Array<{ name: string, description: string, source: string, filePath: string, score: number }>}
 */
export function findSimilarSkillMatches(candidate, entries, threshold) {
  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : 0.72;
  const normalizedCandidate = normalizeTaskLine(candidate);

  if (!normalizedCandidate) {
    return [];
  }

  return entries
    .map((entry) => {
      const name = String(entry.name ?? "").trim();
      const description = String(entry.description ?? "").trim();
      const source = String(entry.source ?? "");
      const filePath = String(entry.filePath ?? "");
      const score = scoreSkillSimilarity(normalizedCandidate, `${name} ${description}`);

      return {
        name,
        description,
        source,
        filePath,
        score
      };
    })
    .filter((entry) => entry.name && entry.score >= safeThreshold)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

/**
 * @param {string} value
 * @returns {string}
 */
function dequoteFrontmatterValue(value) {
  const trimmed = compactWhitespace(value);

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

/**
 * @param {string} markdown
 * @returns {{ name: string, description: string }}
 */
export function parseSkillFrontmatterMetadata(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/gu);

  if (lines.length < 3 || lines[0]?.trim() !== "---") {
    return {
      name: "",
      description: ""
    };
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");

  if (endIndex === -1) {
    return {
      name: "",
      description: ""
    };
  }

  /** @type {Record<string, string>} */
  const map = {};

  for (const rawLine of lines.slice(1, endIndex)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = compactWhitespace(line.slice(0, separatorIndex)).toLowerCase();
    const value = dequoteFrontmatterValue(line.slice(separatorIndex + 1));

    if (!key || !value) {
      continue;
    }

    map[key] = value;
  }

  return {
    name: map.name ?? "",
    description: map.description ?? ""
  };
}

/**
 * @param {{
 *   candidateName: string,
 *   candidateContext: string,
 *   entries: Array<{ name: string, description?: string, source?: string, filePath?: string }>,
 *   similarityThreshold?: number
 * }} input
 * @returns {{
 *   exact: Array<{ name: string, description: string, source: string, filePath: string, score: number }>,
 *   similar: Array<{ name: string, description: string, source: string, filePath: string, score: number }>
 * }}
 */
export function detectSkillConflicts(input) {
  const candidateName = compactWhitespace(input.candidateName);
  const candidateNameLower = candidateName.toLowerCase();
  const candidateNameSlug = toSkillSlug(candidateName);
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const similarityThreshold =
    typeof input.similarityThreshold === "number" && Number.isFinite(input.similarityThreshold)
      ? Math.max(0, Math.min(1, input.similarityThreshold))
      : 0.72;

  const exact = entries
    .map((entry) => ({
      name: compactWhitespace(entry.name),
      description: compactWhitespace(String(entry.description ?? "")),
      source: compactWhitespace(String(entry.source ?? "")),
      filePath: compactWhitespace(String(entry.filePath ?? "")),
      score: 1
    }))
    .filter((entry) => {
      if (!entry.name) {
        return false;
      }

      const entryLower = entry.name.toLowerCase();
      if (entryLower === candidateNameLower) {
        return true;
      }

      if (candidateNameSlug && toSkillSlug(entry.name) === candidateNameSlug) {
        return true;
      }

      return false;
    });

  const exactNames = new Set(exact.map((entry) => entry.name.toLowerCase()));
  const similar = findSimilarSkillMatches(
    `${candidateName} ${input.candidateContext}`,
    entries.filter((entry) => {
      const name = compactWhitespace(entry.name).toLowerCase();
      return name && !exactNames.has(name);
    }),
    similarityThreshold
  );

  return {
    exact,
    similar
  };
}

/**
 * @param {string} taskKey
 * @returns {{ healthy: boolean, reasons: string[], command: string }}
 */
export function evaluateSkillCandidateHealth(taskKey) {
  const normalized = normalizeTaskLine(taskKey);
  const reasons = [];
  const command = inferTaskCommand(taskKey);

  if (!normalized) {
    reasons.push("empty-or-navigation-task");
  }

  if (normalized.length > 180) {
    reasons.push("task-too-long");
  }

  if (normalized.split(" ").length < 2) {
    reasons.push("task-too-short");
  }

  for (const pattern of DANGEROUS_SKILL_PATTERNS) {
    if (pattern.test(normalized)) {
      reasons.push(`dangerous-pattern:${pattern.source}`);
      break;
    }
  }

  if (command === "unknown" && normalized.split(" ").length < 3) {
    reasons.push("unknown-command-low-signal");
  }

  return {
    healthy: reasons.length === 0,
    reasons,
    command
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function compactWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactSecretLikeFragments(value) {
  return value.replace(SECRET_LIKE_FRAGMENT, "<redacted>");
}

/**
 * @param {string} rawLine
 * @returns {string}
 */
export function normalizeTaskLine(rawLine) {
  const compact = compactWhitespace(rawLine);

  if (!compact) {
    return "";
  }

  const lower = compact.toLowerCase();

  if (QUICK_SWITCH_TOKENS.has(lower)) {
    return "";
  }

  const unprefixed = lower.startsWith("/") ? lower.slice(1) : lower;

  if (INTERNAL_NAV_COMMANDS.has(unprefixed)) {
    return "";
  }

  if (INTERNAL_NAV_PREFIXES.some((prefix) => unprefixed.startsWith(prefix))) {
    return "";
  }

  const withoutQuotes = unprefixed.replace(/["']/gu, "");
  const redacted = redactSecretLikeFragments(withoutQuotes);
  const normalized = compactWhitespace(redacted);

  if (GENERIC_NO_ARG_COMMANDS.has(normalized)) {
    return "";
  }

  return normalized;
}

/**
 * @param {string} rawLine
 * @returns {string}
 */
function normalizeTaskSample(rawLine) {
  return compactWhitespace(redactSecretLikeFragments(String(rawLine ?? "").replace(/[\r\n\t]/gu, " ")));
}

/**
 * @param {string[]} historyLines
 * @param {{ minOccurrences?: number, top?: number }} [options]
 * @returns {RepeatedTask[]}
 */
export function extractRepeatedTasks(historyLines, options = {}) {
  const minOccurrences =
    typeof options.minOccurrences === "number" && Number.isFinite(options.minOccurrences)
      ? Math.max(1, Math.floor(options.minOccurrences))
      : 3;
  const top =
    typeof options.top === "number" && Number.isFinite(options.top)
      ? Math.max(1, Math.floor(options.top))
      : 5;

  /** @type {Map<string, { occurrences: number, samples: string[] }>} */
  const counters = new Map();

  for (const line of historyLines) {
    const normalized = normalizeTaskLine(line);

    if (!normalized) {
      continue;
    }

    const current = counters.get(normalized) ?? { occurrences: 0, samples: [] };
    current.occurrences += 1;

    const sample = normalizeTaskSample(line);
    if (sample && !current.samples.includes(sample) && current.samples.length < 3) {
      current.samples.push(sample);
    }

    counters.set(normalized, current);
  }

  return [...counters.entries()]
    .filter(([, value]) => value.occurrences >= minOccurrences)
    .sort((a, b) => {
      if (b[1].occurrences !== a[1].occurrences) {
        return b[1].occurrences - a[1].occurrences;
      }

      return a[0].localeCompare(b[0]);
    })
    .slice(0, top)
    .map(([key, value]) => ({
      key,
      sample: value.samples[0] ?? key,
      occurrences: value.occurrences
    }));
}

/**
 * @param {string} value
 * @returns {string}
 */
export function toSkillSlug(value) {
  const normalized = normalizeTaskLine(value)
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);

  return normalized || "repeated-task";
}

/**
 * @param {string} raw
 * @returns {SkillTelemetryEntry[]}
 */
export function parseSkillTelemetryJsonl(raw) {
  return String(raw ?? "")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line);
        const taskKey = normalizeTaskLine(typeof parsed.taskKey === "string" ? parsed.taskKey : "");

        if (!taskKey) {
          return null;
        }

        return {
          recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : "",
          taskKey,
          command: typeof parsed.command === "string" ? parsed.command : "unknown",
          durationMs: Math.max(0, Number(parsed.durationMs ?? 0) || 0),
          exitCode: Number(parsed.exitCode ?? 0) || 0,
          usedTokens: asFiniteNumberOrNull(Number(parsed.usedTokens)),
          tokenBudget: asFiniteNumberOrNull(Number(parsed.tokenBudget))
        };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null);
}

/**
 * @param {SkillTelemetryEntry[]} entries
 * @param {{
 *   taskKey: string,
 *   since?: string,
 *   until?: string
 * }} input
 * @returns {SkillTelemetrySummary}
 */
export function summarizeSkillTelemetry(entries, input) {
  const normalizedTask = normalizeTaskLine(input.taskKey);
  const sinceMs = input.since ? Date.parse(input.since) : Number.NaN;
  const untilMs = input.until ? Date.parse(input.until) : Number.NaN;

  const filtered = entries.filter((entry) => {
    if (entry.taskKey !== normalizedTask) {
      return false;
    }

    const recordedAtMs = Date.parse(entry.recordedAt);

    if (Number.isFinite(sinceMs) && Number.isFinite(recordedAtMs) && recordedAtMs < sinceMs) {
      return false;
    }

    if (Number.isFinite(untilMs) && Number.isFinite(recordedAtMs) && recordedAtMs > untilMs) {
      return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    return {
      samples: 0,
      averageDurationMs: null,
      errorRate: null,
      averageUsedTokens: null,
      averageTokenBudget: null
    };
  }

  const durations = filtered.map((entry) => entry.durationMs).filter((value) => Number.isFinite(value));
  const errors = filtered.filter((entry) => entry.exitCode !== 0).length;
  const usedTokens = filtered.map((entry) => entry.usedTokens).filter((value) => value !== null);
  const tokenBudgets = filtered.map((entry) => entry.tokenBudget).filter((value) => value !== null);

  return {
    samples: filtered.length,
    averageDurationMs: durations.length
      ? round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
    errorRate: round(errors / filtered.length),
    averageUsedTokens: usedTokens.length
      ? round(usedTokens.reduce((sum, value) => sum + (value ?? 0), 0) / usedTokens.length)
      : null,
    averageTokenBudget: tokenBudgets.length
      ? round(tokenBudgets.reduce((sum, value) => sum + (value ?? 0), 0) / tokenBudgets.length)
      : null
  };
}

/**
 * @param {SkillTelemetrySummary} baseline
 * @param {SkillTelemetrySummary} current
 * @returns {{
 *   durationImprovementPct: number | null,
 *   errorImprovementPct: number | null,
 *   tokenImprovementPct: number | null
 * }}
 */
export function compareSkillTelemetry(baseline, current) {
  const durationImprovementPct =
    baseline.averageDurationMs && baseline.averageDurationMs > 0 && current.averageDurationMs !== null
      ? round((baseline.averageDurationMs - current.averageDurationMs) / baseline.averageDurationMs)
      : null;
  const errorImprovementPct =
    baseline.errorRate !== null && baseline.errorRate > 0 && current.errorRate !== null
      ? round((baseline.errorRate - current.errorRate) / baseline.errorRate)
      : null;
  const tokenImprovementPct =
    baseline.averageUsedTokens && baseline.averageUsedTokens > 0 && current.averageUsedTokens !== null
      ? round((baseline.averageUsedTokens - current.averageUsedTokens) / baseline.averageUsedTokens)
      : null;

  return {
    durationImprovementPct,
    errorImprovementPct,
    tokenImprovementPct
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function toYamlSafeInline(value) {
  const clean = compactWhitespace(value).replace(/"/gu, "'");
  return clean || "n/a";
}

/**
 * @param {{
 *   skillName: string,
 *   task: RepeatedTask,
 *   generatedAt?: string,
 *   sourceHistoryPath?: string
 * }} input
 * @returns {string}
 */
export function buildGeneratedSkillMarkdown(input) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sourceHistoryPath = input.sourceHistoryPath ?? ".lcs/shell-history";
  const taskLabel = toYamlSafeInline(input.task.key);
  const taskSample = toYamlSafeInline(input.task.sample);

  return [
    "---",
    `name: ${input.skillName}`,
    `description: Auto-generated draft for repeated task '${taskLabel}' (${input.task.occurrences} occurrences).`,
    "status: draft",
    "source: nexus-skill-auto-generator",
    "---",
    "",
    `# ${input.skillName}`,
    "",
    "## Trigger",
    "",
    `Use this skill when the task pattern appears: \`${taskLabel}\`.`,
    "",
    "## Why this draft exists",
    "",
    `- detected repetitions: **${input.task.occurrences}**`,
    `- latest sample: \`${taskSample}\``,
    `- source history: \`${sourceHistoryPath}\``,
    `- generated at: \`${generatedAt}\``,
    "",
    "## Suggested workflow",
    "",
    "1. Confirm objective and scope before editing.",
    "2. Run the minimum command path that reproduces the task.",
    "3. Apply the smallest safe change.",
    "4. Validate with typecheck/tests/doctor when relevant.",
    "5. Summarize Change, Reason, Concepts, and Practice.",
    "",
    "## Validation checklist",
    "",
    "- [ ] `npm run typecheck`",
    "- [ ] `npm test`",
    "- [ ] `npm run doctor:json` (if environment-sensitive)",
    "",
    "## Promotion checklist",
    "",
    "- [ ] Human-reviewed wording and command safety",
    "- [ ] Demonstrated token/time/error improvement",
    "- [ ] Moved from `draft` to `experimental` in registry",
    "- [ ] Promoted to `stable` after repeated successful use",
    ""
  ].join("\n");
}

/**
 * @returns {GeneratedSkillRegistry}
 */
export function createGeneratedSkillRegistry() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    skills: []
  };
}

/**
 * @param {unknown} value
 * @returns {value is GeneratedSkillRegistry}
 */
export function isGeneratedSkillRegistry(value) {
  return Boolean(value) && typeof value === "object" && Array.isArray(/** @type {GeneratedSkillRegistry} */ (value).skills);
}

/**
 * @param {GeneratedSkillRegistry} registry
 * @param {{
 *   skillName: string,
 *   task: RepeatedTask,
  *   source: string,
  *   filePath: string,
 *   baseline?: SkillTelemetrySummary & { capturedAt: string },
 *   now?: string
 * }} entry
 * @returns {GeneratedSkillRegistry}
 */
export function upsertGeneratedSkillRegistry(registry, entry) {
  const now = entry.now ?? new Date().toISOString();
  const existing = registry.skills.find((item) => item.name === entry.skillName);
  const health = evaluateSkillCandidateHealth(entry.task.key);

  if (existing) {
    existing.occurrences = Math.max(existing.occurrences, entry.task.occurrences);
    existing.taskKey = entry.task.key;
    existing.sample = entry.task.sample;
    existing.filePath = entry.filePath;
    existing.source = entry.source;
    existing.command = health.command;
    existing.health = {
      eligible: health.healthy,
      blockedReasons: health.reasons,
      checkedAt: now
    };
    existing.metrics = {
      ...existing.metrics,
      baseline: entry.baseline ?? existing.metrics?.baseline
    };
    existing.promotion = {
      ...existing.promotion,
      lastEvaluatedAt: now,
      decision: existing.promotion?.decision ?? "hold",
      reasons: existing.promotion?.reasons ?? []
    };
    existing.updatedAt = now;
  } else {
    registry.skills.push({
      name: entry.skillName,
      status: "draft",
      taskKey: entry.task.key,
      sample: entry.task.sample,
      occurrences: entry.task.occurrences,
      source: entry.source,
      filePath: entry.filePath,
      command: health.command,
      health: {
        eligible: health.healthy,
        blockedReasons: health.reasons,
        checkedAt: now
      },
      metrics: {
        baseline: entry.baseline
      },
      promotion: {
        lastEvaluatedAt: now,
        decision: "hold",
        reasons: []
      },
      createdAt: now,
      updatedAt: now
    });
  }

  registry.generatedAt = now;
  registry.skills.sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name));

  return registry;
}
