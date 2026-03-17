// @ts-check

import { validateChunk } from "./context-contracts.js";

function fail(message) {
  throw new Error(message);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
}

function assertStringArray(value, label) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    fail(`${label} must be an array of strings.`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      fail(`${label}[${index}] must be a non-empty string.`);
    }

    return item;
  });
}

function assertNumber(value, label, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(`${label} must be a number.`);
  }

  if (value < min) {
    fail(`${label} must be >= ${min}.`);
  }

  if (value > max) {
    fail(`${label} must be <= ${max}.`);
  }

  return value;
}

/**
 * @param {unknown} value
 * @param {number} index
 */
function validateBenchmarkCase(value, index) {
  assertObject(value, `cases[${index}]`);
  const entry = /** @type {Record<string, unknown>} */ (value);

  assertString(entry.name, `cases[${index}].name`);
  const mode = entry.mode ?? "select";

  if (mode !== "select" && mode !== "teach") {
    fail(`cases[${index}].mode must be 'select' or 'teach'.`);
  }

  assertObject(entry.input, `cases[${index}].input`);
  assertObject(entry.expectations, `cases[${index}].expectations`);

  const input = /** @type {Record<string, unknown>} */ (entry.input);
  const expectations = /** @type {Record<string, unknown>} */ (entry.expectations);

  if (!Array.isArray(input.chunks)) {
    fail(`cases[${index}].input.chunks must be an array.`);
  }

  const chunks = input.chunks.map((chunk, chunkIndex) => validateChunk(chunk, chunkIndex));
  const changedFiles = assertStringArray(input.changedFiles, `cases[${index}].input.changedFiles`);
  const mustSelect = assertStringArray(expectations.mustSelect, `cases[${index}].expectations.mustSelect`);
  const mustExclude = assertStringArray(expectations.mustExclude, `cases[${index}].expectations.mustExclude`);
  const relevant = assertStringArray(expectations.relevant, `cases[${index}].expectations.relevant`);
  const topPrefix = assertStringArray(expectations.topPrefix, `cases[${index}].expectations.topPrefix`);

  return {
    name: /** @type {string} */ (entry.name),
    mode,
    input: {
      focus: typeof input.focus === "string" ? input.focus : "",
      task: typeof input.task === "string" ? input.task : "",
      objective: typeof input.objective === "string" ? input.objective : "",
      changedFiles,
      tokenBudget:
        input.tokenBudget === undefined
          ? 350
          : assertNumber(input.tokenBudget, `cases[${index}].input.tokenBudget`, { min: 1 }),
      maxChunks:
        input.maxChunks === undefined
          ? 6
          : assertNumber(input.maxChunks, `cases[${index}].input.maxChunks`, { min: 1 }),
      minScore:
        input.minScore === undefined
          ? 0.25
          : assertNumber(input.minScore, `cases[${index}].input.minScore`, { min: 0, max: 1 }),
      sentenceBudget:
        input.sentenceBudget === undefined
          ? 3
          : assertNumber(input.sentenceBudget, `cases[${index}].input.sentenceBudget`, { min: 1 }),
      chunks
    },
    expectations: {
      mustSelect,
      mustExclude,
      relevant,
      topPrefix,
      minRelevantRatio:
        expectations.minRelevantRatio === undefined
          ? 0
          : assertNumber(
              expectations.minRelevantRatio,
              `cases[${index}].expectations.minRelevantRatio`,
              { min: 0, max: 1 }
            )
    }
  };
}

/**
 * @param {string} raw
 * @param {string} sourceLabel
 */
export function parseBenchmarkFile(raw, sourceLabel) {
  try {
    const value = JSON.parse(raw);

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(`${sourceLabel} must be a JSON object.`);
    }

    const payload = /** @type {Record<string, unknown>} */ (value);

    if (!Array.isArray(payload.cases)) {
      fail(`${sourceLabel} must contain a 'cases' array.`);
    }

    return {
      cases: payload.cases.map((entry, index) => validateBenchmarkCase(entry, index))
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`${sourceLabel} is not valid JSON: ${error.message}`);
    }

    throw error;
  }
}
