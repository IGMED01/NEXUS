// @ts-check

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {import("../types/core-contracts.d.ts").MemoryEntry} MemoryEntry
 * @typedef {import("../types/core-contracts.d.ts").MemorySaveInput} MemorySaveInput
 */

const DURABLE_MEMORY_TYPES = new Set([
  "axiom",
  "decision",
  "architecture",
  "security-rule",
  "api-contract",
  "bugfix"
]);

const REVIEWABLE_MEMORY_TYPES = new Set(["learning", "pattern", "session-close"]);
const DISPOSABLE_MEMORY_TYPES = new Set(["test", "generated", "temporary", "fixture", "fallback-smoke"]);
const PROTECTED_TOPIC_PREFIXES = ["arquitectura/", "architecture/", "security/", "contracts/", "axioms/"];
const TEST_NOISE_PATTERNS = [
  /\btest\b/u,
  /\bfixture\b/u,
  /\bfallback\b/u,
  /\blocal-only\b/u,
  /\bsmoke\b/u,
  /\bdummy\b/u,
  /\bexample\b/u,
  /\bmock\b/u
];
const GENERIC_MEMORY_PATTERNS = [
  /\bintegration\b/u,
  /\bquick patch\b/u,
  /\bfallback memory write\b/u,
  /\blocal-only memory\b/u,
  /\bcli integration memory\b/u
];
const PATH_NOISE_PATTERNS = [/[/\\]test[/\\]/u, /[/\\]fixtures?[/\\]/u, /\.spec\./u, /\.test\./u];

/**
 * @param {string} value
 * @returns {string}
 */
function compactText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  const slug = compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/(^-|-$)/gu, "");
  return slug || "memory";
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function tokenize(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u00e0-\u024f/_.-]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * @param {string} cwd
 * @param {string | undefined} baseDir
 */
export function resolveMemoryBaseDir(cwd = process.cwd(), baseDir) {
  return path.resolve(cwd, baseDir ?? ".lcs/memory");
}

/**
 * @param {string} baseDir
 * @param {string | undefined} project
 */
function projectFilePath(baseDir, project) {
  return path.join(baseDir, slugify(project || "_default"), "memories.jsonl");
}

/**
 * @param {string} cwd
 * @param {string | undefined} quarantineDir
 */
function resolveQuarantineBaseDir(cwd = process.cwd(), quarantineDir) {
  return path.resolve(cwd, quarantineDir ?? ".lcs/memory-quarantine");
}

/**
 * @param {string} filePath
 * @returns {Promise<MemoryEntry[]>}
 */
async function readEntries(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry && typeof entry === "object");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/enoent/i.test(message)) {
      return [];
    }

    throw error;
  }
}

/**
 * @param {string} filePath
 * @param {MemoryEntry[]} entries
 */
async function writeEntries(filePath, entries) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, payload ? `${payload}\n` : "", "utf8");
}

/**
 * @param {string} baseDir
 * @param {string | undefined} project
 * @returns {Promise<Array<{ project: string, filePath: string, entries: MemoryEntry[] }>>}
 */
async function readScopedMemoryFiles(baseDir, project) {
  if (project) {
    const filePath = projectFilePath(baseDir, project);
    return [{ project, filePath, entries: await readEntries(filePath) }];
  }

  try {
    const dirents = await readdir(baseDir, { withFileTypes: true });
    /** @type {Array<{ project: string, filePath: string, entries: MemoryEntry[] }>} */
    const scoped = [];

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) {
        continue;
      }

      const projectId = dirent.name === "_default" ? "" : dirent.name;
      const filePath = path.join(baseDir, dirent.name, "memories.jsonl");
      scoped.push({
        project: projectId,
        filePath,
        entries: await readEntries(filePath)
      });
    }

    return scoped;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/enoent/i.test(message)) {
      return [];
    }

    throw error;
  }
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function inferSourceKind(entry) {
  const record = /** @type {Record<string, unknown>} */ (entry);
  const sourceKind =
    typeof record.sourceKind === "string" && record.sourceKind.trim() ? record.sourceKind.trim() : "";

  if (sourceKind) {
    return sourceKind;
  }

  const haystack = compactText(
    [entry.title, entry.content, entry.topic, entry.project, entry.scope].filter(Boolean).join(" ")
  ).toLowerCase();

  if (TEST_NOISE_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return "test";
  }

  return "manual";
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function hasProtectedTopic(entry) {
  const topic = String(entry.topic ?? "").trim().toLowerCase();
  return PROTECTED_TOPIC_PREFIXES.some((prefix) => topic.startsWith(prefix));
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function hasDurableType(entry) {
  return DURABLE_MEMORY_TYPES.has(String(entry.type ?? "").trim().toLowerCase());
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function scoreSignal(entry) {
  const title = compactText(String(entry.title ?? ""));
  const content = compactText(String(entry.content ?? ""));
  let score = 0.25;

  if (title.length >= 12) score += 0.12;
  if (title.length >= 24) score += 0.08;
  if (content.length >= 80) score += 0.14;
  if (content.length >= 160) score += 0.16;
  if (content.length >= 260) score += 0.1;
  if (/\bwhy\b|\bpor qu[eé]\b|\bporque\b|\bwhere\b|\bd[oó]nde\b|\bfiles?\b|\bpath\b/u.test(content)) {
    score += 0.08;
  }
  if (/src[/\\]|docs[/\\]|test[/\\]|\.md\b|\.ts\b|\.js\b/u.test(content)) {
    score += 0.1;
  }
  if (String(entry.topic ?? "").trim()) {
    score += 0.09;
  }
  if (String(entry.project ?? "").trim()) {
    score += 0.04;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function scoreDurability(entry) {
  const type = String(entry.type ?? "").trim().toLowerCase();

  if (DURABLE_MEMORY_TYPES.has(type)) {
    return 0.96;
  }

  if (REVIEWABLE_MEMORY_TYPES.has(type)) {
    return 0.62;
  }

  if (DISPOSABLE_MEMORY_TYPES.has(type)) {
    return 0.12;
  }

  return 0.4;
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function hasTestNoise(entry) {
  const identityHaystack = compactText(
    [entry.title, entry.topic, inferSourceKind(entry)].filter(Boolean).join(" ")
  ).toLowerCase();
  const contentHaystack = compactText(String(entry.content ?? "")).toLowerCase();

  if (TEST_NOISE_PATTERNS.some((pattern) => pattern.test(identityHaystack))) {
    return true;
  }

  if (
    /\btest memory\b|\bfixture memory\b|\bfallback memory write\b|\blocal-only memory\b/u.test(
      contentHaystack
    )
  ) {
    return true;
  }

  return PATH_NOISE_PATTERNS.some((pattern) => pattern.test(identityHaystack));
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function hasGenericContent(entry) {
  const haystack = compactText([entry.title, entry.content].filter(Boolean).join(" ")).toLowerCase();
  return GENERIC_MEMORY_PATTERNS.some((pattern) => pattern.test(haystack));
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function buildFingerprint(entry) {
  return [
    compactText(String(entry.title ?? "")).toLowerCase(),
    compactText(String(entry.content ?? "")).toLowerCase(),
    String(entry.type ?? "").trim().toLowerCase(),
    String(entry.project ?? "").trim().toLowerCase(),
    String(entry.scope ?? "").trim().toLowerCase()
  ].join("::");
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function buildTopicKey(entry) {
  return compactText(String(entry.topic ?? "")).toLowerCase();
}

/**
 * @param {number} signalScore
 * @param {number} durabilityScore
 * @param {number} duplicateScore
 * @param {boolean} testNoise
 * @param {boolean} genericContent
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function scoreHealth(signalScore, durabilityScore, duplicateScore, testNoise, genericContent, entry) {
  const record = /** @type {Record<string, unknown>} */ (entry);
  const createdAt = typeof record.createdAt === "string" ? new Date(record.createdAt) : null;
  const recencyScore =
    createdAt && !Number.isNaN(createdAt.getTime())
      ? Math.max(0.15, Math.min(1, 1 - (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 90)))
      : 0.55;
  const specificityScore = Math.min(
    1,
    tokenize([entry.title, entry.content, entry.topic].filter(Boolean).join(" ")).length / 18
  );
  const health =
    signalScore * 0.35 +
    durabilityScore * 0.25 +
    specificityScore * 0.2 +
    recencyScore * 0.1 -
    duplicateScore * 0.3 -
    (genericContent ? 0.1 : 0) -
    (testNoise ? 0.4 : 0);

  return Math.max(0, Math.min(1, Number(health.toFixed(3))));
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 * @param {{ fingerprintCounts: Map<string, number>, topicCounts: Map<string, number> }} indexes
 */
function evaluateEntry(entry, indexes) {
  const record = /** @type {Record<string, unknown>} */ (entry);
  const signalScore = scoreSignal(entry);
  const durabilityScore = scoreDurability(entry);
  const testNoise = hasTestNoise(entry);
  const genericContent = hasGenericContent(entry);
  const fingerprintCount = indexes.fingerprintCounts.get(buildFingerprint(entry)) ?? 0;
  const topicKey = buildTopicKey(entry);
  const topicCount = topicKey ? indexes.topicCounts.get(topicKey) ?? 0 : 0;
  const duplicateScore = Math.max(
    fingerprintCount > 1 ? Math.min(1, 0.4 + (fingerprintCount - 1) * 0.25) : 0,
    topicCount > 1 ? Math.min(0.9, 0.25 + (topicCount - 1) * 0.2) : 0
  );
  const lowSignal = signalScore < 0.46;
  const protectedTopic = hasProtectedTopic(entry);
  const protectedEntry =
    protectedTopic ||
    (hasDurableType(entry) &&
      !testNoise &&
      !genericContent &&
      !lowSignal &&
      duplicateScore < 0.6);
  /** @type {string[]} */
  const reasons = [];

  if (testNoise) reasons.push("test-noise");
  if (duplicateScore >= 0.6) reasons.push("duplicate");
  if (lowSignal) reasons.push("low-signal");
  if (genericContent) reasons.push("generic");

  const quarantineCandidate =
    !protectedEntry && (testNoise || duplicateScore >= 0.6 || (genericContent && lowSignal));
  const reviewStatus = quarantineCandidate ? "candidate" : reasons.length ? "candidate" : "accepted";
  const healthScore = scoreHealth(
    signalScore,
    durabilityScore,
    duplicateScore,
    testNoise,
    genericContent,
    entry
  );

  return {
    id: String(record.id ?? ""),
    title: String(entry.title ?? ""),
    type: String(entry.type ?? ""),
    project: String(entry.project ?? ""),
    scope: String(entry.scope ?? ""),
    topic: String(entry.topic ?? ""),
    sourceKind: inferSourceKind(entry),
    protected: protectedEntry,
    reviewStatus,
    signalScore,
    duplicateScore: Number(duplicateScore.toFixed(3)),
    durabilityScore,
    healthScore,
    quarantineCandidate,
    reasons,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : ""
  };
}

/**
 * @param {Array<MemoryEntry | MemorySaveInput | Record<string, unknown>>} entries
 */
function buildIndexes(entries) {
  /** @type {Map<string, number>} */
  const fingerprintCounts = new Map();
  /** @type {Map<string, number>} */
  const topicCounts = new Map();

  for (const entry of entries) {
    const fingerprint = buildFingerprint(entry);
    const topic = buildTopicKey(entry);
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);

    if (topic) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }

  return { fingerprintCounts, topicCounts };
}

/**
 * @param {string[]} values
 * @param {string} [fallback]
 */
function mostCommonValue(values, fallback = "") {
  /** @type {Map<string, number>} */
  const counts = new Map();

  for (const value of values.map((item) => compactText(item)).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let winner = fallback;
  let winnerCount = -1;

  for (const [value, count] of counts) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }

  return winner || fallback;
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function isReviewableEntry(entry) {
  return REVIEWABLE_MEMORY_TYPES.has(String(entry.type ?? "").trim().toLowerCase());
}

/**
 * @param {MemoryEntry | MemorySaveInput | Record<string, unknown>} entry
 */
function buildCompactionGroupKey(entry) {
  const topic = buildTopicKey(entry);

  if (topic) {
    return `topic:${topic}`;
  }

  return `title:${slugify(String(entry.title ?? ""))}::${String(entry.type ?? "").trim().toLowerCase()}`;
}

/**
 * @param {Array<{ entry: MemoryEntry, report: ReturnType<typeof evaluateEntry> }>} group
 */
function chooseCompactionType(group) {
  if (group.some((item) => String(item.entry.type).trim().toLowerCase() === "pattern")) {
    return "pattern";
  }

  return "learning";
}

/**
 * @param {Array<{ entry: MemoryEntry, report: ReturnType<typeof evaluateEntry> }>} group
 */
function buildCompactionTitle(group) {
  const firstTitle = compactText(String(group[0]?.entry.title ?? ""));
  const uniqueTitles = new Set(group.map((item) => compactText(String(item.entry.title ?? ""))).filter(Boolean));

  if (uniqueTitles.size === 1 && firstTitle) {
    return `${firstTitle} (compacted)`;
  }

  const topic = compactText(String(group[0]?.entry.topic ?? ""));
  if (topic) {
    return `Compacted memory: ${topic}`;
  }

  return `Compacted ${chooseCompactionType(group)} memory`;
}

/**
 * @param {Array<{ entry: MemoryEntry, report: ReturnType<typeof evaluateEntry> }>} group
 */
function buildCompactionContent(group) {
  const snippets = group
    .map((item) => ({
      createdAt: String(item.entry.createdAt ?? ""),
      content: compactText(String(item.entry.content ?? ""))
    }))
    .filter((item) => item.content)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  /** @type {string[]} */
  const uniqueSnippets = [];

  for (const snippet of snippets) {
    if (!uniqueSnippets.includes(snippet.content)) {
      uniqueSnippets.push(snippet.content);
    }
  }

  const bulletLines = uniqueSnippets.slice(0, 5).map((content) => `- ${content}`);
  const firstDate = snippets.at(-1)?.createdAt || "";
  const lastDate = snippets[0]?.createdAt || "";

  return [
    `Compacted from ${group.length} memory entries.`,
    firstDate && lastDate ? `Window: ${firstDate} -> ${lastDate}.` : "",
    "Key learnings:",
    ...bulletLines
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {Array<{ entry: MemoryEntry, report: ReturnType<typeof evaluateEntry> }>} evaluated
 */
function buildCompactionGroups(evaluated) {
  /** @type {Map<string, Array<{ entry: MemoryEntry, report: ReturnType<typeof evaluateEntry> }>>} */
  const groups = new Map();

  for (const item of evaluated) {
    if (!isReviewableEntry(item.entry)) {
      continue;
    }

    if (item.report.protected) {
      continue;
    }

    if (item.report.reasons.includes("test-noise")) {
      continue;
    }

    const key = buildCompactionGroupKey(item.entry);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([groupKey, group]) => {
      const sortedGroup = [...group].sort((left, right) =>
        String(right.entry.createdAt ?? "").localeCompare(String(left.entry.createdAt ?? ""))
      );
      const firstEntry = sortedGroup[0]?.entry;
      const project = mostCommonValue(sortedGroup.map((item) => String(item.entry.project ?? "")));
      const scope = mostCommonValue(sortedGroup.map((item) => String(item.entry.scope ?? "")), "project");
      const topic = mostCommonValue(sortedGroup.map((item) => String(item.entry.topic ?? "")));
      const type = chooseCompactionType(sortedGroup);
      const title = buildCompactionTitle(sortedGroup);
      const content = buildCompactionContent(sortedGroup);
      const evaluation = evaluateMemoryWrite({
        title,
        content,
        type,
        project,
        scope,
        topic,
        sourceKind: "compaction"
      });
      const compactedEntry = withAcceptedMemoryMetadata(
        {
          id: "",
          title,
          content,
          type,
          project,
          scope,
          topic,
          createdAt: ""
        },
        evaluation,
        {
          sourceKind: "compaction",
          supersedes: sortedGroup.map((item) => item.entry.id)
        }
      );

      return {
        groupKey,
        project,
        scope,
        topic,
        title,
        compactedType: type,
        count: sortedGroup.length,
        sourceIds: sortedGroup.map((item) => item.entry.id),
        sourceTitles: [...new Set(sortedGroup.map((item) => item.entry.title))],
        sourceTypes: [...new Set(sortedGroup.map((item) => item.entry.type))],
        latestCreatedAt: String(firstEntry?.createdAt ?? ""),
        compactedEntry,
        entries: sortedGroup
      };
    });
}

/**
 * @param {{
 *   title: string,
 *   content: string,
 *   type?: string,
 *   project?: string,
 *   scope?: string,
 *   topic?: string,
 *   sourceKind?: string
 * }} input
 */
export function evaluateMemoryWrite(input) {
  const normalized = {
    title: input.title,
    content: input.content,
    type: input.type ?? "learning",
    project: input.project ?? "",
    scope: input.scope ?? "project",
    topic: input.topic ?? "",
    sourceKind: input.sourceKind ?? "manual"
  };
  const indexes = buildIndexes([normalized]);
  const evaluation = evaluateEntry(normalized, indexes);

  return {
    ...evaluation,
    action: evaluation.quarantineCandidate ? "quarantine" : "accept",
    input: normalized
  };
}

/**
 * @param {ReturnType<typeof evaluateMemoryWrite>} evaluation
 * @param {{ sourceKind?: string, expiresAt?: string | null, supersedes?: string[] }} [options]
 */
export function buildAcceptedMemoryMetadata(evaluation, options = {}) {
  /** @type {Record<string, unknown>} */
  const metadata = {
    sourceKind: options.sourceKind ?? evaluation.sourceKind,
    protected: evaluation.protected,
    reviewStatus: evaluation.reviewStatus,
    signalScore: evaluation.signalScore,
    duplicateScore: evaluation.duplicateScore,
    durabilityScore: evaluation.durabilityScore,
    healthScore: evaluation.healthScore,
    reviewReasons: [...evaluation.reasons]
  };

  if (typeof options.expiresAt === "string" && options.expiresAt.trim()) {
    metadata.expiresAt = options.expiresAt;
  }

  if (Array.isArray(options.supersedes) && options.supersedes.length) {
    metadata.supersedes = [...options.supersedes];
  }

  return metadata;
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} input
 * @param {ReturnType<typeof evaluateMemoryWrite>} evaluation
 * @param {{ sourceKind?: string, expiresAt?: string | null, supersedes?: string[] }} [options]
 * @returns {T & Record<string, unknown>}
 */
export function withAcceptedMemoryMetadata(input, evaluation, options = {}) {
  return {
    ...input,
    ...buildAcceptedMemoryMetadata(evaluation, options)
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   quarantineDir?: string,
 *   title: string,
 *   content: string,
 *   type?: string,
 *   project?: string,
 *   scope?: string,
 *   topic?: string,
 *   sourceKind?: string,
 *   reasons?: string[]
 * }} input
 */
export async function quarantineMemoryWrite(input) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const quarantineBaseDir = resolveQuarantineBaseDir(cwd, input.quarantineDir);
  const projectSlug = slugify(input.project || "_default");
  const dateLabel = new Date().toISOString().slice(0, 10);
  const quarantinePath = path.join(quarantineBaseDir, projectSlug, `${dateLabel}.jsonl`);
  const existing = await readEntries(quarantinePath);
  const createdAt = new Date().toISOString();
  const entry = {
    id: `${createdAt.replace(/[-:.TZ]/gu, "")}-${slugify(input.title).slice(0, 20)}`,
    title: input.title,
    content: input.content,
    type: input.type ?? "learning",
    project: input.project ?? "",
    scope: input.scope ?? "project",
    topic: input.topic ?? "",
    createdAt,
    sourceKind: input.sourceKind ?? inferSourceKind(input),
    protected: false,
    reviewStatus: "quarantined",
    quarantineReasons: input.reasons ?? []
  };

  existing.push(entry);
  await writeEntries(quarantinePath, /** @type {MemoryEntry[]} */ (existing));

  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    type: entry.type,
    project: entry.project,
    scope: entry.scope,
    topic: entry.topic,
    provider: "quarantine",
    stdout: `Quarantined memory candidate #${entry.id}`,
    dataDir: path.dirname(quarantinePath),
    filePath: quarantinePath,
    memoryStatus: "quarantined",
    reviewStatus: "quarantined",
    warnings: input.reasons ?? [],
    reasons: input.reasons ?? []
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   project?: string,
 *   baseDir?: string
 * }} options
 */
export async function runMemoryDoctor(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const baseDir = resolveMemoryBaseDir(cwd, options.baseDir);
  const scopedFiles = await readScopedMemoryFiles(baseDir, options.project);
  const flatEntries = scopedFiles.flatMap((scope) => scope.entries);
  const indexes = buildIndexes(flatEntries);
  const entries = flatEntries
    .map((entry) => evaluateEntry(entry, indexes))
    .sort((left, right) => {
      if (left.quarantineCandidate !== right.quarantineCandidate) {
        return left.quarantineCandidate ? -1 : 1;
      }

      return left.healthScore - right.healthScore;
    });

  const summary = {
    total: entries.length,
    accepted: entries.filter((entry) => entry.reviewStatus === "accepted").length,
    candidate: entries.filter((entry) => entry.reviewStatus === "candidate").length,
    healthy: entries.filter((entry) => entry.healthScore >= 0.7).length,
    protected: entries.filter((entry) => entry.protected).length,
    duplicates: entries.filter((entry) => entry.reasons.includes("duplicate")).length,
    testNoise: entries.filter((entry) => entry.reasons.includes("test-noise")).length,
    lowSignal: entries.filter((entry) => entry.reasons.includes("low-signal")).length,
    quarantineCandidates: entries.filter((entry) => entry.quarantineCandidate).length
  };

  return {
    action: "audit",
    cwd,
    project: options.project ?? "",
    baseDir,
    files: scopedFiles.map((scope) => ({
      project: scope.project,
      filePath: scope.filePath,
      entries: scope.entries.length
    })),
    summary,
    entries
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   project?: string,
 *   baseDir?: string,
 *   quarantineDir?: string,
 *   apply?: boolean
 * }} options
 */
export async function runMemoryPrune(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const baseDir = resolveMemoryBaseDir(cwd, options.baseDir);
  const quarantineBaseDir = resolveQuarantineBaseDir(cwd, options.quarantineDir);
  const scopedFiles = await readScopedMemoryFiles(baseDir, options.project);
  const flatEntries = scopedFiles.flatMap((scope) => scope.entries);
  const indexes = buildIndexes(flatEntries);
  const evaluatedByFile = scopedFiles.map((scope) => ({
    ...scope,
    evaluated: scope.entries.map((entry) => ({
      entry,
      report: evaluateEntry(entry, indexes)
    }))
  }));
  const candidates = evaluatedByFile.flatMap((scope) =>
    scope.evaluated
      .filter((item) => item.report.quarantineCandidate)
      .map((item) => ({
        filePath: scope.filePath,
        ...item.report
      }))
  );
  /** @type {string[]} */
  const quarantinePaths = [];
  let moved = 0;

  if (options.apply) {
    const dateLabel = new Date().toISOString().slice(0, 10);

    for (const scope of evaluatedByFile) {
      const quarantineEntries = scope.evaluated
        .filter((item) => item.report.quarantineCandidate)
        .map((item) => ({
          ...item.entry,
          sourceKind: inferSourceKind(item.entry),
          protected: item.report.protected,
          reviewStatus: "quarantined",
          quarantineReasons: item.report.reasons,
          quarantinedAt: new Date().toISOString()
        }));

      if (!quarantineEntries.length) {
        continue;
      }

      const projectSlug = slugify(scope.project || "_default");
      const quarantinePath = path.join(quarantineBaseDir, projectSlug, `${dateLabel}.jsonl`);
      const existing = await readEntries(quarantinePath);
      await writeEntries(
        quarantinePath,
        /** @type {MemoryEntry[]} */ ([...existing, ...quarantineEntries])
      );
      quarantinePaths.push(quarantinePath);
      moved += quarantineEntries.length;

      const keptEntries = scope.evaluated
        .filter((item) => !item.report.quarantineCandidate)
        .map((item) => item.entry);
      await writeEntries(scope.filePath, keptEntries);
    }
  }

  return {
    action: "prune",
    cwd,
    project: options.project ?? "",
    baseDir,
    quarantineBaseDir,
    dryRun: options.apply !== true,
    applied: options.apply === true,
    quarantinePaths,
    summary: {
      totalBefore: flatEntries.length,
      candidates: candidates.length,
      moved,
      kept: flatEntries.length - moved,
      protectedSkipped: evaluatedByFile
        .flatMap((scope) => scope.evaluated)
        .filter((item) => item.report.protected && item.report.reasons.length > 0).length
    },
    candidates
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   project?: string,
 *   baseDir?: string
 * }} options
 */
export async function runMemoryStats(options = {}) {
  const doctor = await runMemoryDoctor(options);
  const entries = doctor.entries;
  const total = Math.max(1, entries.length);
  const durableCount = entries.filter((entry) =>
    DURABLE_MEMORY_TYPES.has(String(entry.type ?? "").trim().toLowerCase())
  ).length;
  const reviewableCount = entries.filter((entry) =>
    REVIEWABLE_MEMORY_TYPES.has(String(entry.type ?? "").trim().toLowerCase())
  ).length;
  const disposableCount = entries.filter((entry) =>
    DISPOSABLE_MEMORY_TYPES.has(String(entry.type ?? "").trim().toLowerCase())
  ).length;
  const recallableDurableCount = entries.filter(
    (entry) =>
      DURABLE_MEMORY_TYPES.has(String(entry.type ?? "").trim().toLowerCase()) &&
      entry.healthScore >= 0.7 &&
      entry.reviewStatus === "accepted"
  ).length;
  const averageHealthScore = Number(
    (
      entries.reduce((sum, entry) => sum + (Number(entry.healthScore) || 0), 0) / total
    ).toFixed(3)
  );
  const averageSignalScore = Number(
    (
      entries.reduce((sum, entry) => sum + (Number(entry.signalScore) || 0), 0) / total
    ).toFixed(3)
  );
  const averageDuplicateScore = Number(
    (
      entries.reduce((sum, entry) => sum + (Number(entry.duplicateScore) || 0), 0) / total
    ).toFixed(3)
  );

  return {
    action: "stats",
    cwd: doctor.cwd,
    project: doctor.project,
    baseDir: doctor.baseDir,
    files: doctor.files,
    summary: doctor.summary,
    metrics: {
      averageHealthScore,
      averageSignalScore,
      averageDuplicateScore,
      durableCount,
      reviewableCount,
      disposableCount,
      recallableDurableCount,
      candidateRate: Number((doctor.summary.candidate / total).toFixed(3)),
      noiseRate: Number((doctor.summary.testNoise / total).toFixed(3)),
      duplicateRate: Number((doctor.summary.duplicates / total).toFixed(3)),
      healthyRate: Number((doctor.summary.healthy / total).toFixed(3)),
      quarantineRate: Number((doctor.summary.quarantineCandidates / total).toFixed(3))
    }
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   project?: string,
 *   topic?: string,
 *   baseDir?: string,
 *   quarantineDir?: string,
 *   apply?: boolean
 * }} options
 */
export async function runMemoryCompact(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const baseDir = resolveMemoryBaseDir(cwd, options.baseDir);
  const quarantineBaseDir = resolveQuarantineBaseDir(cwd, options.quarantineDir);
  const scopedFiles = await readScopedMemoryFiles(baseDir, options.project);
  const flatEntries = scopedFiles.flatMap((scope) => scope.entries);
  const indexes = buildIndexes(flatEntries);
  const dateLabel = new Date().toISOString().slice(0, 10);
  const applied = options.apply === true;
  /** @type {string[]} */
  const quarantinePaths = [];
  /** @type {string[]} */
  const writtenFiles = [];
  let moved = 0;
  let created = 0;

  const plans = scopedFiles.flatMap((scope) => {
    const evaluated = scope.entries.map((entry) => ({
      entry,
      report: evaluateEntry(entry, indexes)
    }));
    return buildCompactionGroups(evaluated)
      .filter((plan) => {
        if (!options.topic) {
          return true;
        }

        return compactText(plan.topic).toLowerCase() === compactText(options.topic).toLowerCase();
      })
      .map((plan) => ({
        ...plan,
        filePath: scope.filePath,
        project: scope.project || plan.project
      }));
  });

  if (applied) {
    for (const scope of scopedFiles) {
      const filePlans = plans.filter((plan) => plan.filePath === scope.filePath);
      if (!filePlans.length) {
        continue;
      }

      const removeIds = new Set(filePlans.flatMap((plan) => plan.sourceIds));
      const keptEntries = scope.entries.filter((entry) => !removeIds.has(entry.id));
      const createdEntries = filePlans.map((plan, index) => {
        const createdAt = new Date().toISOString();
        const compactedId = `${createdAt.replace(/[-:.TZ]/gu, "")}-compact-${index + 1}`;
        return {
          ...plan.compactedEntry,
          id: compactedId,
          createdAt
        };
      });

      const projectSlug = slugify(scope.project || "_default");
      const quarantinePath = path.join(quarantineBaseDir, projectSlug, `${dateLabel}-compact.jsonl`);
      const existingQuarantine = await readEntries(quarantinePath);
      const supersededEntries = filePlans.flatMap((plan, index) =>
        plan.entries.map((item) => ({
          ...item.entry,
          sourceKind: inferSourceKind(item.entry),
          protected: item.report.protected,
          reviewStatus: "superseded",
          supersededBy: createdEntries[index]?.id ?? "",
          compactedAt: createdEntries[index]?.createdAt ?? new Date().toISOString(),
          quarantineReasons: ["compacted"]
        }))
      );

      await writeEntries(
        scope.filePath,
        /** @type {MemoryEntry[]} */ ([...keptEntries, ...createdEntries].sort((left, right) =>
          String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
        ))
      );
      await writeEntries(
        quarantinePath,
        /** @type {MemoryEntry[]} */ ([...existingQuarantine, ...supersededEntries])
      );
      writtenFiles.push(scope.filePath);
      quarantinePaths.push(quarantinePath);
      moved += supersededEntries.length;
      created += createdEntries.length;
    }
  }

  return {
    action: "compact",
    cwd,
    project: options.project ?? "",
    topic: options.topic ?? "",
    baseDir,
    quarantineBaseDir,
    dryRun: !applied,
    applied,
    quarantinePaths,
    writtenFiles,
    summary: {
      groups: plans.length,
      entriesToCompact: plans.reduce((sum, plan) => sum + plan.count, 0),
      created,
      moved,
      kept: flatEntries.length - moved,
      topicFilterApplied: Boolean(options.topic)
    },
    groups: plans.map((plan) => ({
      groupKey: plan.groupKey,
      title: plan.title,
      project: plan.project,
      scope: plan.scope,
      topic: plan.topic,
      compactedType: plan.compactedType,
      count: plan.count,
      sourceIds: plan.sourceIds,
      sourceTitles: plan.sourceTitles,
      sourceTypes: plan.sourceTypes,
      latestCreatedAt: plan.latestCreatedAt,
      compactedPreview: {
        title: plan.compactedEntry.title,
        type: plan.compactedEntry.type,
        topic: plan.compactedEntry.topic,
        content: plan.compactedEntry.content
      },
      filePath: plan.filePath
    }))
  };
}
