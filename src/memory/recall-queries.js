// @ts-check

/** @typedef {import("../types/core-contracts.d.ts").TeachRecallQueryInput} TeachRecallQueryInput */

const RECALL_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "app",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "client",
  "close",
  "code",
  "context",
  "day",
  "do",
  "docs",
  "during",
  "each",
  "feeds",
  "file",
  "files",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "js",
  "json",
  "md",
  "now",
  "of",
  "on",
  "or",
  "packet",
  "project",
  "readme",
  "remember",
  "route",
  "run",
  "scope",
  "session",
  "so",
  "src",
  "system",
  "task",
  "teach",
  "teaching",
  "test",
  "tests",
  "that",
  "the",
  "their",
  "them",
  "this",
  "through",
  "to",
  "ts",
  "txt",
  "uses",
  "using",
  "what",
  "when",
  "where",
  "why",
  "with",
  "workspace"
]);

function normalizeText(text = "") {
  return String(text)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} [text]
 * @returns {string[]}
 */
function splitTerms(text = "") {
  return normalizeText(text)
    .split(/[\s/._-]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/**
 * @param {string} term
 */
function isUsefulTerm(term) {
  return (
    term.length >= 3 &&
    !RECALL_STOPWORDS.has(term) &&
    !/^\d+$/u.test(term) &&
    !/^v?\d+$/u.test(term)
  );
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * @param {string} term
 * @returns {string[]}
 */
function expandTerm(term) {
  const variants = [term];

  if (term.endsWith("ate") && term.length > 5) {
    variants.push(`${term.slice(0, -1)}ion`);
  }

  if (term.endsWith("ize") && term.length > 5) {
    variants.push(`${term.slice(0, -1)}ation`);
  }

  if (term.endsWith("ers") && term.length > 5) {
    variants.push(term.slice(0, -1));
  }

  return uniqueStrings(variants).filter(isUsefulTerm);
}

/**
 * @param {Map<string, number>} scoreMap
 * @param {string[]} terms
 * @param {number} weight
 */
function addWeightedTerms(scoreMap, terms, weight) {
  for (const term of terms) {
    if (!isUsefulTerm(term)) {
      continue;
    }

    scoreMap.set(term, (scoreMap.get(term) ?? 0) + weight);

    for (const variant of expandTerm(term)) {
      if (variant === term) {
        continue;
      }

      scoreMap.set(variant, (scoreMap.get(variant) ?? 0) + weight * 0.72);
    }
  }
}

/**
 * @param {TeachRecallQueryInput} input
 * @returns {Map<string, number>}
 */
function scoreTerms(input) {
  const scoreMap = new Map();

  addWeightedTerms(scoreMap, splitTerms(input.task), 1.8);
  addWeightedTerms(scoreMap, splitTerms(input.objective), 1.55);
  addWeightedTerms(scoreMap, splitTerms(input.focus), 1.2);

  for (const file of input.changedFiles ?? []) {
    const terms = splitTerms(file);
    addWeightedTerms(scoreMap, terms, 1.35);

    const basenameTerms = splitTerms(file.split(/[\\/]/u).pop() ?? "");
    addWeightedTerms(scoreMap, basenameTerms, 1.6);
  }

  return scoreMap;
}

/**
 * @param {TeachRecallQueryInput} input
 * @returns {string[]}
 */
function rankedTerms(input) {
  return [...scoreTerms(input).entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([term]) => term);
}

/**
 * @param {string[]} [changedFiles]
 * @returns {string[]}
 */
function rankedFileTerms(changedFiles = []) {
  const scoreMap = new Map();

  for (const file of changedFiles) {
    const pathTerms = splitTerms(file);
    addWeightedTerms(scoreMap, pathTerms, 1.2);
    const basenameTerms = splitTerms(file.split(/[\\/]/u).pop() ?? "");
    addWeightedTerms(scoreMap, basenameTerms, 1.5);
  }

  return [...scoreMap.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([term]) => term);
}

/**
 * @param {string[]} terms
 * @param {number} limit
 */
function buildQueryFromTerms(terms, limit) {
  return uniqueStrings(terms)
    .filter(isUsefulTerm)
    .slice(0, limit)
    .join(" ")
    .trim();
}

/**
 * @param {TeachRecallQueryInput} input
 * @returns {string[]}
 */
export function buildTeachRecallQueries(input) {
  const explicitQuery = input.explicitQuery?.trim();

  if (explicitQuery) {
    return [explicitQuery];
  }

  const ranked = rankedTerms(input);
  const fileTerms = rankedFileTerms(input.changedFiles);
  const focusTerms = splitTerms(input.focus).filter(isUsefulTerm);
  const taskTerms = splitTerms(input.task).filter(isUsefulTerm);
  const objectiveTerms = splitTerms(input.objective).filter(isUsefulTerm);
  const nounLikeTerms = ranked.filter((term) => /(ion|ity|ment|ance|ence|order|auth|cli|memory|engram)$/u.test(term));
  const derivedConceptTerms = ranked.filter((term) => /(ion|ity|ment|ance|ence)$/u.test(term));

  const candidates = uniqueStrings([
    buildQueryFromTerms(
      [...fileTerms.slice(0, 2), ...derivedConceptTerms.slice(0, 1), ...ranked.slice(0, 1)],
      4
    ),
    buildQueryFromTerms([...fileTerms.slice(0, 2), ...nounLikeTerms.slice(0, 2), ...ranked.slice(0, 1)], 4),
    buildQueryFromTerms([...ranked.slice(0, 3), ...nounLikeTerms.slice(0, 2)], 4),
    buildQueryFromTerms([...taskTerms.slice(0, 2), ...objectiveTerms.slice(0, 3), ...fileTerms.slice(0, 2)], 5),
    buildQueryFromTerms([...ranked.slice(0, 5), ...fileTerms.slice(0, 2)], 6),
    buildQueryFromTerms([...focusTerms.slice(0, 6)], 6),
    buildQueryFromTerms([...taskTerms.slice(0, 6), ...objectiveTerms.slice(0, 4)], 6)
  ]).filter((query) => query.split(/\s+/u).length >= 2);

  return candidates.slice(0, input.maxQueries ?? 5);
}
