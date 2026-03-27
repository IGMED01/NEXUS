// @ts-check

/** @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk */
/** @typedef {import("../types/core-contracts.d.ts").ChunkKind} ChunkKind */
/** @typedef {import("../types/core-contracts.d.ts").ChunkDiagnostics} ChunkDiagnostics */
/** @typedef {import("../types/core-contracts.d.ts").SelectedChunk} SelectedChunk */
/** @typedef {import("../types/core-contracts.d.ts").SuppressedChunk} SuppressedChunk */
/** @typedef {import("../types/core-contracts.d.ts").SelectionOptions} SelectionOptions */
/** @typedef {import("../types/core-contracts.d.ts").ContextSelectionResult} ContextSelectionResult */

/**
 * @typedef {Chunk & {
 *   origin: "memory" | "workspace",
 *   tokenCount: number,
 *   tokens: string[],
 *   retrievalScore?: number,
 *   vectorScore?: number
 * }} PreparedChunk
 */

/**
 * @typedef {{
 *   total: number,
 *   detail: ChunkDiagnostics
 * }} ScoreChunkResult
 */

const DEFAULT_STOPWORDS = new Set([
  "a",
  "al",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "con",
  "de",
  "del",
  "el",
  "en",
  "for",
  "from",
  "how",
  "in",
  "is",
  "la",
  "las",
  "los",
  "of",
  "on",
  "or",
  "para",
  "por",
  "que",
  "the",
  "to",
  "un",
  "una",
  "with",
  "y"
]);

const KIND_PRIOR = /** @type {Record<ChunkKind, number>} */ ({
  code: 1,
  test: 0.95,
  spec: 0.9,
  memory: 0.85,
  doc: 0.78,
  chat: 0.42,
  log: 0.2
});

const DEFAULT_RECALL_RESERVE_RATIO = 0.15;
const DEFAULT_SCORING_PROFILE = "vertical-tuned";

const BASELINE_SCORING_WEIGHTS = {
  overlap: 0.26,
  kindPrior: 0.15,
  certainty: 0.12,
  recency: 0.08,
  teachingValue: 0.1,
  priority: 0.06,
  density: 0.03,
  sourceAffinity: 0.09,
  implementationFit: 0.1,
  retrievalBoost: 0.07,
  structuralOverlap: 0.11,
  structuralPublicSurface: 0.07,
  structuralDependency: 0.05,
  changeAnchor: 1,
  relatedTestBoost: 0.04,
  recallOriginBoost: 0.09,
  customBoost: 0.1,
  redundancyPenalty: 0.22,
  sourcePenalty: 0.22,
  narrativePenalty: 0.18,
  genericRunnerPenalty: 0.32
};

const SCORING_PROFILES = {
  baseline: BASELINE_SCORING_WEIGHTS,
  "vertical-tuned": {
    ...BASELINE_SCORING_WEIGHTS,
    overlap: 0.28,
    sourceAffinity: 0.12,
    implementationFit: 0.14,
    structuralOverlap: 0.13,
    structuralPublicSurface: 0.08,
    structuralDependency: 0.06,
    changeAnchor: 1.05,
    relatedTestBoost: 0.05,
    recallOriginBoost: 0.07,
    sourcePenalty: 0.2,
    genericRunnerPenalty: 0.34
  }
};

/**
 * @param {number} value
 * @param {number} [min]
 * @param {number} [max]
 */
function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {unknown} value
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * @param {SelectionOptions} [options]
 */
function resolveScoringWeights(options = {}) {
  const requestedProfile =
    typeof options.scoringProfile === "string" && options.scoringProfile.trim()
      ? options.scoringProfile.trim()
      : typeof process.env.LCS_SCORING_PROFILE === "string" &&
          process.env.LCS_SCORING_PROFILE.trim()
        ? process.env.LCS_SCORING_PROFILE.trim()
        : DEFAULT_SCORING_PROFILE;
  const profile = requestedProfile in SCORING_PROFILES ? requestedProfile : DEFAULT_SCORING_PROFILE;
  const profileWeights = SCORING_PROFILES[/** @type {keyof typeof SCORING_PROFILES} */ (profile)];
  const overrides =
    options.scoringWeights && typeof options.scoringWeights === "object"
      ? /** @type {Record<string, unknown>} */ (options.scoringWeights)
      : {};

  /** @type {Record<string, number>} */
  const merged = {};

  for (const [key, value] of Object.entries(profileWeights)) {
    if (key in overrides) {
      const numeric = overrides[key];
      merged[key] = typeof numeric === "number" && Number.isFinite(numeric) ? numeric : value;
      continue;
    }

    merged[key] = value;
  }

  return {
    profile,
    weights: merged
  };
}

export const NEXUS_SCORING_PROFILES = Object.freeze(
  Object.keys(SCORING_PROFILES).sort((left, right) => left.localeCompare(right))
);

/**
 * @param {string} [text]
 */
function normalizeText(text = "") {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s./_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} [text]
 * @param {Set<string>} [stopwords]
 * @returns {string[]}
 */
export function tokenize(text = "", stopwords = DEFAULT_STOPWORDS) {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !stopwords.has(token));
}

/**
 * @param {string[]} tokens
 */
function toSet(tokens) {
  return new Set(tokens);
}

/**
 * @param {string[]} aTokens
 * @param {string[]} bTokens
 */
function jaccardSimilarity(aTokens, bTokens) {
  const a = toSet(aTokens);
  const b = toSet(bTokens);

  if (!a.size || !b.size) {
    return 0;
  }

  let intersection = 0;

  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (a.size + b.size - intersection);
}

/**
 * @param {string[]} chunkTokens
 * @param {string[]} focusTokens
 */
function overlapScore(chunkTokens, focusTokens) {
  if (!chunkTokens.length || !focusTokens.length) {
    return 0;
  }

  const chunkSet = toSet(chunkTokens);
  const focusSet = toSet(focusTokens);
  let overlap = 0;

  for (const token of focusSet) {
    if (chunkSet.has(token)) {
      overlap += 1;
    }
  }

  return overlap / focusSet.size;
}

/**
 * @param {string[]} tokens
 */
function densityScore(tokens) {
  if (!tokens.length) {
    return 0;
  }

  const uniqueRatio = toSet(tokens).size / tokens.length;
  return clamp(uniqueRatio);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(String(entry ?? ""))).filter(Boolean)
    : [];
}

/**
 * @param {Chunk} chunk
 */
function collectStructuralSignals(chunk) {
  const processing = asRecord(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (chunk)).processing);
  const symbols = asRecord(processing.symbols);
  const exports = asStringArray(symbols.exports);
  const publicSurface = asStringArray(symbols.publicSurface);
  const dependencyHints = asStringArray(symbols.dependencyHints);
  const imports = Array.isArray(symbols.imports)
    ? symbols.imports.flatMap((entry) => {
        const importRecord = asRecord(entry);
        return [
          normalizeText(String(importRecord.source ?? "")),
          ...asStringArray(importRecord.bindings)
        ].filter(Boolean);
      })
    : [];
  const declarations = Array.isArray(symbols.declarations)
    ? symbols.declarations.flatMap((entry) => {
        const declaration = asRecord(entry);
        return [
          normalizeText(String(declaration.name ?? "")),
          normalizeText(String(declaration.parent ?? "")),
          ...asStringArray(declaration.extends),
          ...asStringArray(declaration.implements)
        ].filter(Boolean);
      })
    : [];

  const allSignals = [...exports, ...publicSurface, ...dependencyHints, ...imports, ...declarations];
  return {
    tokens: tokenize(allSignals.join(" ")),
    publicSurfaceTokens: tokenize([...exports, ...publicSurface, ...declarations].join(" ")),
    dependencyTokens: tokenize([...dependencyHints, ...imports].join(" ")),
    signalCount: allSignals.length
  };
}

/**
 * @param {string} [text]
 */
function approximateTokenCount(text = "") {
  return tokenize(text).length;
}

/**
 * @param {string} [source]
 */
function normalizeSource(source = "") {
  return String(source).replace(/\\/g, "/").toLowerCase();
}

/**
 * @param {string} [source]
 * @returns {"memory" | "workspace"}
 */
function chunkOrigin(source = "") {
  return /^(engram|memory):\/\//u.test(normalizeSource(source)) ? "memory" : "workspace";
}

/**
 * Boost for chunks that were explicitly recalled from memory.
 * These were specifically retrieved for the task, so they deserve
 * higher selection priority than brute-force scan discoveries.
 *
 * @param {string} [source]
 * @returns {number}
 */
function recallBoost(source = "") {
  return /^(engram|memory):\/\//u.test(normalizeSource(source)) ? 0.12 : 0;
}

/**
 * @param {Chunk} chunk
 */
function retrievalSignal(chunk) {
  const lexical = clamp(asNumber(chunk.retrievalScore));
  const vector = clamp(asNumber(chunk.vectorScore));
  return clamp(lexical * 0.6 + vector * 0.4);
}

/**
 * @param {string} [source]
 * @returns {string[]}
 */
function sourceTerms(source = "") {
  return normalizeSource(source)
    .split(/[/. _-]+/)
    .filter(Boolean)
    .filter((term) => !DEFAULT_STOPWORDS.has(term));
}

/**
 * @param {string} [source]
 */
function stemSource(source = "") {
  return normalizeSource(source)
    .replace(/\.[a-z0-9]+$/u, "")
    .replace(/(\.test|\.spec)$/u, "")
    .replace(/\/index$/u, "");
}

/**
 * @param {string[]} aTerms
 * @param {string[]} bTerms
 */
function tokenOverlap(aTerms, bTerms) {
  const a = new Set(aTerms);
  const b = new Set(bTerms);

  if (!a.size || !b.size) {
    return 0;
  }

  let hits = 0;

  for (const term of a) {
    if (b.has(term)) {
      hits += 1;
    }
  }

  return hits / Math.max(a.size, b.size);
}

/**
 * @param {string} source
 * @param {string[]} [changedFiles]
 */
function sourceAffinityScore(source, changedFiles = []) {
  if (!changedFiles.length) {
    return 0;
  }

  const normalizedSource = normalizeSource(source);
  const sourceStem = stemSource(source);
  const sourceDir = normalizedSource.includes("/")
    ? normalizedSource.slice(0, normalizedSource.lastIndexOf("/"))
    : "";
  const terms = sourceTerms(source);
  let best = 0;

  for (const changedFile of changedFiles) {
    const normalizedChanged = normalizeSource(changedFile);
    const changedStem = stemSource(changedFile);
    const changedDir = normalizedChanged.includes("/")
      ? normalizedChanged.slice(0, normalizedChanged.lastIndexOf("/"))
      : "";
    const changedTerms = sourceTerms(changedFile);

    if (normalizedSource === normalizedChanged) {
      return 1;
    }

    if (sourceStem && changedStem && sourceStem === changedStem) {
      best = Math.max(best, 0.93);
      continue;
    }

    if (sourceDir && changedDir && sourceDir === changedDir) {
      best = Math.max(best, 0.76);
    }

    best = Math.max(best, tokenOverlap(terms, changedTerms) * 0.82);
  }

  return clamp(best);
}

/**
 * @param {string} source
 * @param {string[]} [changedFiles]
 */
function changeAnchorScore(source, changedFiles = []) {
  if (!changedFiles.length) {
    return 0;
  }

  const normalizedSource = normalizeSource(source);
  const sourceStem = stemSource(source);
  let best = 0;

  for (const changedFile of changedFiles) {
    const normalizedChanged = normalizeSource(changedFile);
    const changedStem = stemSource(changedFile);

    if (normalizedSource === normalizedChanged) {
      return 1;
    }

    if (sourceStem && changedStem && sourceStem === changedStem) {
      best = Math.max(best, 0.86);
    }
  }

  return best;
}

/**
 * @param {string} source
 * @param {string[]} [changedFiles]
 */
function testRelationshipScore(source, changedFiles = []) {
  const normalizedSource = normalizeSource(source);

  if (!changedFiles.length || !normalizedSource || !/(\.test\.|\.spec\.|^test\/)/u.test(normalizedSource)) {
    return 0;
  }

  const testStem = stemSource(source);
  const testTerms = sourceTerms(source);
  let best = 0;

  for (const changedFile of changedFiles) {
    const changedStem = stemSource(changedFile);
    const changedTerms = sourceTerms(changedFile);
    const normalizedChanged = normalizeSource(changedFile);

    if (testStem && changedStem && testStem.endsWith(changedStem.split("/").pop() ?? "")) {
      best = Math.max(best, 1);
      continue;
    }

    if (testStem && changedStem && testStem.includes(changedStem)) {
      best = Math.max(best, 0.95);
    }

    if (normalizedSource.includes(normalizedChanged.replace(/^src\//u, ""))) {
      best = Math.max(best, 0.88);
    }

    best = Math.max(best, tokenOverlap(testTerms, changedTerms) * 0.9);
  }

  return clamp(best);
}

/**
 * @param {Chunk} chunk
 * @param {string[]} [changedFiles]
 */
function genericTestRunnerPenalty(chunk, changedFiles = []) {
  if (chunk.kind !== "test" || !changedFiles.length) {
    return 0;
  }

  const normalizedSource = normalizeSource(chunk.source);
  const content = normalizeText(chunk.content);
  const relatedness = testRelationshipScore(chunk.source, changedFiles);
  const looksGeneric =
    normalizedSource.includes("run-tests") ||
    normalizedSource.includes("test/index") ||
    normalizedSource.includes("test/setup") ||
    content.includes("whole repository") ||
    content.includes("portable checks") ||
    content.includes("runs portable checks") ||
    content.includes("across the repository");

  if (!looksGeneric || relatedness >= 0.45) {
    return 0;
  }

  return 0.85;
}

/**
 * @param {string} source
 * @param {string[]} [changedFiles]
 */
function genericSourcePenalty(source, changedFiles = []) {
  if (!source) {
    return 0;
  }

  const normalized = normalizeSource(source);

  if (sourceAffinityScore(normalized, changedFiles) >= 0.9) {
    return 0;
  }

  const implementationBias = changedFiles.length ? 1 : 0.45;

  if (normalized === "readme.md") {
    return 0.92 * implementationBias;
  }

  if (normalized === "agents.md" || normalized === "agents.md") {
    return 0.56 * implementationBias;
  }

  if (normalized === "package.json") {
    return 0.26 * implementationBias;
  }

  if (normalized.startsWith("docs/")) {
    return 0.24 * implementationBias;
  }

  return 0;
}

/**
 * @param {Chunk} chunk
 */
function narrativeMemoryPenalty(chunk) {
  if (chunk.kind !== "memory") {
    return 0;
  }

  const content = normalizeText(chunk.content);

  if (
    content.includes("session close summary") ||
    content.includes("closed at") ||
    content.includes(" learned ") ||
    content.includes(" next ")
  ) {
    return 0.34;
  }

  return 0;
}

/**
 * @param {Chunk} chunk
 * @param {string[]} [changedFiles]
 */
function implementationFitScore(chunk, changedFiles = []) {
  if (!changedFiles.length) {
    return 0;
  }

  const affinity = sourceAffinityScore(chunk.source, changedFiles);
  const testRelationship = testRelationshipScore(chunk.source, changedFiles);

  switch (chunk.kind) {
    case "code":
      return clamp(0.3 + affinity * 0.7);
    case "test":
      return clamp(0.36 + affinity * 0.42 + testRelationship * 0.28);
    case "spec":
      return clamp(0.12 + affinity * 0.5);
    case "memory":
      return clamp(0.08 + affinity * 0.38);
    case "doc":
      return clamp(0.05 + affinity * 0.28);
    default:
      return clamp(affinity * 0.2);
  }
}

/**
 * @param {string} content
 * @param {string} [focus]
 * @param {number} [sentenceBudget]
 */
export function compressContent(content, focus = "", sentenceBudget = 3) {
  const focusTokens = tokenize(focus);
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= sentenceBudget) {
    return content.trim();
  }

  const ranked = sentences
    .map((sentence, index) => {
      const tokens = tokenize(sentence);
      return {
        sentence,
        index,
        score: overlapScore(tokens, focusTokens) * 0.7 + densityScore(tokens) * 0.3
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, sentenceBudget)
    .sort((left, right) => left.index - right.index);

  return ranked.map((item) => item.sentence).join(" ").trim();
}

/**
 * @param {Chunk} chunk
 * @param {string} focus
 * @param {Array<Chunk | SelectedChunk>} [selectedChunks]
 * @param {SelectionOptions} [options]
 * @returns {ScoreChunkResult}
 */
export function scoreChunk(chunk, focus, selectedChunks = [], options = {}) {
  const focusTokens = options._cachedFocusTokens || tokenize(focus);
  const chunkTokens = options._cachedChunkTokens || chunk.tokens || tokenize(chunk.content);
  const structuralSignals = collectStructuralSignals(chunk);
  const overlap = overlapScore(chunkTokens, focusTokens);
  const structuralOverlap = overlapScore(structuralSignals.tokens, focusTokens);
  const structuralPublicSurface = overlapScore(structuralSignals.publicSurfaceTokens, focusTokens);
  const structuralDependency = overlapScore(structuralSignals.dependencyTokens, focusTokens);
  const density = densityScore(chunkTokens);
  const kindPrior = KIND_PRIOR[chunk.kind] ?? 0.5;
  const certainty = clamp(chunk.certainty ?? 0.7);
  const recency = clamp(chunk.recency ?? 0.5);
  const teachingValue = clamp(chunk.teachingValue ?? 0.5);
  const priority = clamp(chunk.priority ?? 0.5);
  const changedFiles = options.changedFiles ?? [];
  const sourceAffinity = sourceAffinityScore(chunk.source, changedFiles);
  const changeAnchor = changeAnchorScore(chunk.source, changedFiles);
  const relatedTestBoost = testRelationshipScore(chunk.source, changedFiles);
  const scoringWeights =
    options._cachedScoringWeights ?? resolveScoringWeights(options).weights;
  const changeAnchorWeightBase =
    chunk.kind === "code" ? 0.16 : chunk.kind === "test" ? 0.09 : 0.12;
  const changeAnchorWeight = changeAnchorWeightBase * (scoringWeights.changeAnchor ?? 1);
  const sourcePenalty = genericSourcePenalty(chunk.source, changedFiles);
  const genericRunnerPenalty = genericTestRunnerPenalty(chunk, changedFiles);
  const narrativePenalty = narrativeMemoryPenalty(chunk);
  const implementationFit = implementationFitScore(chunk, changedFiles);
  const recallOriginBoost = recallBoost(chunk.source);
  const retrievalBoost = retrievalSignal(chunk);
  const customScorerInput = {
    chunk,
    focus,
    selectedChunks,
    options
  };
  const customScorerFns = Array.isArray(options.customScorers)
    ? options.customScorers.filter((entry) => typeof entry === "function")
    : [];
  const customBoost = clamp(
    customScorerFns.reduce((total, scorer) => total + asNumber(scorer(customScorerInput)), 0),
    -0.4,
    0.4
  );

  const redundancy = selectedChunks.length
    ? Math.max(
        ...selectedChunks.map((selected) =>
          jaccardSimilarity(chunkTokens, selected.tokens || tokenize(selected.content))
        )
      )
    : 0;

  const positiveScore =
    overlap * (scoringWeights.overlap ?? 0.3) +
    kindPrior * (scoringWeights.kindPrior ?? 0.15) +
    certainty * (scoringWeights.certainty ?? 0.12) +
    recency * (scoringWeights.recency ?? 0.08) +
    teachingValue * (scoringWeights.teachingValue ?? 0.1) +
    priority * (scoringWeights.priority ?? 0.06) +
    density * (scoringWeights.density ?? 0.03) +
    sourceAffinity * (scoringWeights.sourceAffinity ?? 0.1) +
    implementationFit * (scoringWeights.implementationFit ?? 0.12) +
    retrievalBoost * (scoringWeights.retrievalBoost ?? 0.08) +
    structuralOverlap * (scoringWeights.structuralOverlap ?? 0.11) +
    structuralPublicSurface * (scoringWeights.structuralPublicSurface ?? 0.07) +
    structuralDependency * (scoringWeights.structuralDependency ?? 0.05) +
    changeAnchor * changeAnchorWeight +
    relatedTestBoost * (scoringWeights.relatedTestBoost ?? 0.04) +
    recallOriginBoost * (scoringWeights.recallOriginBoost ?? 0.09) +
    customBoost * (scoringWeights.customBoost ?? 0.1);

  const penalty =
    redundancy * (scoringWeights.redundancyPenalty ?? 0.22) +
    sourcePenalty * (scoringWeights.sourcePenalty ?? 0.22) +
    narrativePenalty * (scoringWeights.narrativePenalty ?? 0.18) +
    genericRunnerPenalty * (scoringWeights.genericRunnerPenalty ?? 0.32);
  const total = clamp(positiveScore - penalty);

  return {
    total,
    detail: {
      overlap,
      kindPrior,
      certainty,
      recency,
      teachingValue,
      priority,
      density,
      structuralOverlap,
      structuralPublicSurface,
      structuralDependency,
      structuralSignalCount: structuralSignals.signalCount,
      sourceAffinity,
      changeAnchor,
      changeAnchorWeight,
      relatedTestBoost,
      sourcePenalty,
      genericRunnerPenalty,
      implementationFit,
      retrievalBoost,
      customBoost,
      recallOriginBoost,
      narrativePenalty,
      redundancy,
      penalty
    }
  };
}

/**
 * @param {Chunk[]} chunks
 * @param {SelectionOptions} [options]
 * @returns {ContextSelectionResult}
 */
export function selectContextWindow(chunks, options = {}) {
  const {
    focus = "",
    tokenBudget = 350,
    maxChunks = 6,
    minScore = 0.25,
    sentenceBudget = 3,
    changedFiles = [],
    recallReserveRatio = DEFAULT_RECALL_RESERVE_RATIO
  } = options;

  /** @type {PreparedChunk[]} */
  const prepared = chunks.map((chunk) => {
    const compressedContent = compressContent(chunk.content, focus, sentenceBudget);
    const tokens = tokenize(compressedContent);
    return {
      ...chunk,
      origin: chunkOrigin(chunk.source),
      content: compressedContent,
      tokenCount: approximateTokenCount(compressedContent),
      tokens
    };
  });
  const focusTokens = tokenize(focus);
  const scoringContext = resolveScoringWeights(options);

  /** @type {SelectedChunk[]} */
  const selected = [];
  /** @type {SuppressedChunk[]} */
  const suppressed = [];
  let usedTokens = 0;

  const ranked = prepared
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, focus, [], {
        changedFiles,
        _cachedFocusTokens: focusTokens,
        _cachedChunkTokens: chunk.tokens,
        _cachedScoringWeights: scoringContext.weights
      }).total
    }))
    .sort((left, right) => right.score - left.score);
  const preparedById = new Map(prepared.map((chunk) => [chunk.id, chunk]));

  const normalizedRecallReserveRatio = clamp(recallReserveRatio, 0, 0.5);
  const recallRanked = ranked.filter((entry) => entry.chunk.origin === "memory");
  const workspaceRanked = ranked.filter((entry) => entry.chunk.origin === "workspace");
  const recallTokenBudget = recallRanked.length
    ? Math.max(1, Math.floor(tokenBudget * normalizedRecallReserveRatio))
    : 0;
  /** @type {Set<string>} */
  const processed = new Set();
  let usedRecallTokens = 0;

  /**
   * @param {PreparedChunk & { score: number, diagnostics: ChunkDiagnostics }} chunk
   * @param {string} reason
   */
  function suppressChunk(chunk, reason) {
    processed.add(chunk.id);
    suppressed.push({
      id: chunk.id,
      source: chunk.source,
      kind: chunk.kind,
      origin: chunk.origin,
      tokenCount: chunk.tokenCount,
      reason,
      score: chunk.score,
      diagnostics: chunk.diagnostics
    });
  }

  /**
   * @param {{ chunk: PreparedChunk, score: number }} entry
   * @param {"recall" | "general"} phase
   */
  function evaluateEntry(entry, phase) {
    if (processed.has(entry.chunk.id)) {
      return;
    }

    const rescored = scoreChunk(entry.chunk, focus, selected, {
      changedFiles,
      _cachedFocusTokens: focusTokens,
      _cachedChunkTokens: entry.chunk.tokens,
      _cachedScoringWeights: scoringContext.weights
    });
    const chunk = {
      ...entry.chunk,
      score: rescored.total,
      diagnostics: rescored.detail
    };
    const hasImplementationAnchor = selected.some(
      (selectedChunk) => selectedChunk.kind === "code" || selectedChunk.kind === "test"
    );

    if (chunk.score < minScore) {
      suppressChunk(chunk, "score-below-threshold");
      return;
    }

    if (
      changedFiles.length &&
      hasImplementationAnchor &&
      (chunk.kind === "spec" || chunk.kind === "doc") &&
      chunk.diagnostics.sourcePenalty >= 0.8 &&
      chunk.diagnostics.sourceAffinity <= 0.2
    ) {
      suppressChunk(chunk, "generic-doc-noise");
      return;
    }

    if (
      changedFiles.length &&
      hasImplementationAnchor &&
      chunk.kind === "test" &&
      chunk.diagnostics.genericRunnerPenalty >= 0.8 &&
      chunk.diagnostics.relatedTestBoost < 0.45 &&
      chunk.diagnostics.sourceAffinity < 0.3
    ) {
      suppressChunk(chunk, "generic-test-noise");
      return;
    }

    if (selected.length >= maxChunks) {
      suppressChunk(chunk, "max-chunks-reached");
      return;
    }

    if (
      phase === "recall" &&
      chunk.origin === "memory" &&
      recallTokenBudget > 0 &&
      usedRecallTokens + chunk.tokenCount > recallTokenBudget
    ) {
      return;
    }

    if (usedTokens + chunk.tokenCount > tokenBudget) {
      suppressChunk(chunk, "token-budget-exceeded");
      return;
    }

    if (chunk.diagnostics.redundancy >= 0.65) {
      suppressChunk(chunk, "redundant-context");
      return;
    }

    processed.add(chunk.id);
    selected.push(chunk);
    usedTokens += chunk.tokenCount;

    if (phase === "recall" && chunk.origin === "memory") {
      usedRecallTokens += chunk.tokenCount;
    }
  }

  for (const entry of recallRanked) {
    evaluateEntry(entry, "recall");
  }

  for (const entry of workspaceRanked) {
    evaluateEntry(entry, "general");
  }

  for (const entry of ranked) {
    evaluateEntry(entry, "general");
  }

  let rebalanceIterations = 0;
  while (rebalanceIterations < maxChunks) {
    rebalanceIterations++;
    const selectedRecall = selected
      .map((chunk, index) => ({ chunk, index }))
      .filter((entry) => entry.chunk.origin === "memory")
      .sort((left, right) => left.chunk.score - right.chunk.score);

    const workspaceCandidates = suppressed
      .map((chunk, index) => ({ chunk, index }))
      .filter(
        (entry) =>
          entry.chunk.origin === "workspace" &&
          (entry.chunk.reason === "max-chunks-reached" ||
            entry.chunk.reason === "token-budget-exceeded")
      )
      .sort((left, right) => right.chunk.score - left.chunk.score);

    const recallEntry = selectedRecall[0];

    if (!recallEntry || !workspaceCandidates.length) {
      break;
    }

    const selectedWithoutRecall = selected.filter((_, index) => index !== recallEntry.index);
    const workspaceContextCount = selectedWithoutRecall.filter(
      (chunk) => chunk.origin === "workspace"
    ).length;
    const tightImplementationWindow =
      changedFiles.length > 0 &&
      maxChunks <= 5 &&
      workspaceContextCount >= Math.max(3, maxChunks - 1);
    /** @type {{ chunk: SelectedChunk, suppressedIndex: number } | null} */
    let replacement = null;

    for (const workspaceCandidate of workspaceCandidates) {
      const preparedCandidate = preparedById.get(workspaceCandidate.chunk.id);

      if (!preparedCandidate) {
        continue;
      }

      const rescored = scoreChunk(preparedCandidate, focus, selectedWithoutRecall, {
        changedFiles,
        _cachedFocusTokens: focusTokens,
        _cachedChunkTokens: preparedCandidate.tokens,
        _cachedScoringWeights: scoringContext.weights
      });
      const candidate = {
        ...preparedCandidate,
        score: rescored.total,
        diagnostics: rescored.detail
      };

      if (candidate.score < minScore) {
        continue;
      }

      if (
        !tightImplementationWindow &&
        candidate.score <= recallEntry.chunk.score + 0.12
      ) {
        continue;
      }

      if (usedTokens - recallEntry.chunk.tokenCount + candidate.tokenCount > tokenBudget) {
        continue;
      }

      replacement = {
        chunk: candidate,
        suppressedIndex: workspaceCandidate.index
      };
      break;
    }

    if (!replacement) {
      break;
    }

    usedTokens = usedTokens - recallEntry.chunk.tokenCount + replacement.chunk.tokenCount;
    selected[recallEntry.index] = replacement.chunk;
    suppressed[replacement.suppressedIndex] = {
      id: recallEntry.chunk.id,
      source: recallEntry.chunk.source,
      kind: recallEntry.chunk.kind,
      origin: recallEntry.chunk.origin,
      tokenCount: recallEntry.chunk.tokenCount,
      reason: "workspace-priority-over-recall",
      score: recallEntry.chunk.score,
      diagnostics: recallEntry.chunk.diagnostics
    };
  }

  selected.sort((left, right) => right.score - left.score);

  return {
    focus,
    tokenBudget,
    usedTokens,
    selected,
    suppressed,
    summary: {
      selectedCount: selected.length,
      suppressedCount: suppressed.length,
      selectedOrigins: summarizeBy(selected, (chunk) => chunk.origin),
      suppressedOrigins: summarizeBy(suppressed, (chunk) => chunk.origin ?? chunkOrigin(chunk.source)),
      suppressionReasons: summarizeBy(suppressed, (chunk) => chunk.reason)
    }
  };
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string | undefined} keySelector
 * @returns {Record<string, number>}
 */
function summarizeBy(items, keySelector) {
  /** @type {Record<string, number>} */
  const counts = {};

  for (const item of items) {
    const key = keySelector(item) || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}
