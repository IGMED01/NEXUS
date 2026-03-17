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

const KIND_PRIOR = {
  code: 1,
  test: 0.95,
  spec: 0.9,
  memory: 0.85,
  doc: 0.78,
  chat: 0.42,
  log: 0.2
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text = "") {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s./_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text = "", stopwords = DEFAULT_STOPWORDS) {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !stopwords.has(token));
}

function toSet(tokens) {
  return new Set(tokens);
}

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

function densityScore(tokens) {
  if (!tokens.length) {
    return 0;
  }

  const uniqueRatio = toSet(tokens).size / tokens.length;
  return clamp(uniqueRatio);
}

function approximateTokenCount(text = "") {
  return tokenize(text).length;
}

function normalizeSource(source = "") {
  return String(source).replace(/\\/g, "/").toLowerCase();
}

function sourceTerms(source = "") {
  return normalizeSource(source)
    .split(/[/. _-]+/)
    .filter(Boolean)
    .filter((term) => !DEFAULT_STOPWORDS.has(term));
}

function stemSource(source = "") {
  return normalizeSource(source)
    .replace(/\.[a-z0-9]+$/u, "")
    .replace(/(\.test|\.spec)$/u, "")
    .replace(/\/index$/u, "");
}

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
    return 0.52 * implementationBias;
  }

  if (normalized === "agents.md" || normalized === "agents.md") {
    return 0.4 * implementationBias;
  }

  if (normalized === "package.json") {
    return 0.26 * implementationBias;
  }

  if (normalized.startsWith("docs/")) {
    return 0.24 * implementationBias;
  }

  return 0;
}

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

export function scoreChunk(chunk, focus, selectedChunks = [], options = {}) {
  const focusTokens = tokenize(focus);
  const chunkTokens = tokenize(chunk.content);
  const overlap = overlapScore(chunkTokens, focusTokens);
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
  const sourcePenalty = genericSourcePenalty(chunk.source, changedFiles);
  const narrativePenalty = narrativeMemoryPenalty(chunk);
  const implementationFit = implementationFitScore(chunk, changedFiles);

  const redundancy = selectedChunks.length
    ? Math.max(
        ...selectedChunks.map((selected) =>
          jaccardSimilarity(chunkTokens, tokenize(selected.content))
        )
      )
    : 0;

  const positiveScore =
    overlap * 0.3 +
    kindPrior * 0.15 +
    certainty * 0.12 +
    recency * 0.08 +
    teachingValue * 0.1 +
    priority * 0.06 +
    density * 0.03 +
    sourceAffinity * 0.1 +
    implementationFit * 0.12 +
    changeAnchor * 0.12 +
    relatedTestBoost * 0.04;

  const penalty = redundancy * 0.22 + sourcePenalty * 0.22 + narrativePenalty * 0.18;
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
      sourceAffinity,
      changeAnchor,
      relatedTestBoost,
      sourcePenalty,
      implementationFit,
      narrativePenalty,
      redundancy,
      penalty
    }
  };
}

export function selectContextWindow(chunks, options = {}) {
  const {
    focus = "",
    tokenBudget = 350,
    maxChunks = 6,
    minScore = 0.25,
    sentenceBudget = 3,
    changedFiles = []
  } = options;

  const prepared = chunks.map((chunk) => {
    const compressedContent = compressContent(chunk.content, focus, sentenceBudget);
    return {
      ...chunk,
      content: compressedContent,
      tokenCount: approximateTokenCount(compressedContent)
    };
  });

  const selected = [];
  const suppressed = [];
  let usedTokens = 0;

  const ranked = prepared
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, focus, [], { changedFiles }).total
    }))
    .sort((left, right) => right.score - left.score);

  for (const entry of ranked) {
    const rescored = scoreChunk(entry.chunk, focus, selected, { changedFiles });
    const chunk = {
      ...entry.chunk,
      score: rescored.total,
      diagnostics: rescored.detail
    };

    if (chunk.score < minScore) {
      suppressed.push({
        id: chunk.id,
        reason: "score-below-threshold",
        score: chunk.score
      });
      continue;
    }

    if (selected.length >= maxChunks) {
      suppressed.push({
        id: chunk.id,
        reason: "max-chunks-reached",
        score: chunk.score
      });
      continue;
    }

    if (usedTokens + chunk.tokenCount > tokenBudget) {
      suppressed.push({
        id: chunk.id,
        reason: "token-budget-exceeded",
        score: chunk.score
      });
      continue;
    }

    if (chunk.diagnostics.redundancy >= 0.65) {
      suppressed.push({
        id: chunk.id,
        reason: "redundant-context",
        score: chunk.score
      });
      continue;
    }

    selected.push(chunk);
    usedTokens += chunk.tokenCount;
  }

  return {
    focus,
    tokenBudget,
    usedTokens,
    selected,
    suppressed
  };
}
