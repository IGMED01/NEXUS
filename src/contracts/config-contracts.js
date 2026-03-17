// @ts-check

/**
 * @typedef {{
 *   integer?: boolean,
 *   min?: number,
 *   max?: number
 * }} NumberRules
 */

/**
 * @param {string} message
 */
function fail(message) {
  throw new Error(message);
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function optionalString(value, label) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }

  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function optionalBoolean(value, label) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean.`);
  }

  return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {NumberRules} [rules]
 */
function optionalNumber(value, label, rules = {}) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(`${label} must be a number.`);
  }

  const numericValue = /** @type {number} */ (value);

  if (rules.integer && !Number.isInteger(numericValue)) {
    fail(`${label} must be an integer.`);
  }

  if (rules.min !== undefined && numericValue < rules.min) {
    fail(`${label} must be >= ${rules.min}.`);
  }

  if (rules.max !== undefined && numericValue > rules.max) {
    fail(`${label} must be <= ${rules.max}.`);
  }

  return numericValue;
}

export function defaultProjectConfig() {
  return {
    schemaVersion: "1.0.0",
    project: "",
    workspace: "",
    output: {
      defaultFormat: "",
      jsonSchemaVersion: "1.0.0"
    },
    selection: {
      tokenBudget: 350,
      maxChunks: 6,
      minScore: 0.25,
      sentenceBudget: 3
    },
    memory: {
      enabled: true,
      project: "",
      limit: 3,
      scope: "project",
      type: "",
      strictRecall: false,
      degradedRecall: true
    },
    engram: {
      binaryPath: "tools/engram/engram.exe",
      dataDir: ".engram"
    }
  };
}

/**
 * @param {unknown} value
 */
export function validateProjectConfig(value) {
  assertObject(value, "Project config");

  const config = /** @type {Record<string, unknown>} */ (value);
  const defaults = defaultProjectConfig();

  if (config.output !== undefined) {
    assertObject(config.output, "Project config.output");
  }

  if (config.selection !== undefined) {
    assertObject(config.selection, "Project config.selection");
  }

  if (config.memory !== undefined) {
    assertObject(config.memory, "Project config.memory");
  }

  if (config.engram !== undefined) {
    assertObject(config.engram, "Project config.engram");
  }

  const output = /** @type {Record<string, unknown> | undefined} */ (config.output);
  const selection = /** @type {Record<string, unknown> | undefined} */ (config.selection);
  const memory = /** @type {Record<string, unknown> | undefined} */ (config.memory);
  const engram = /** @type {Record<string, unknown> | undefined} */ (config.engram);

  const defaultFormat = optionalString(output?.defaultFormat, "Project config.output.defaultFormat");

  if (
    defaultFormat !== undefined &&
    defaultFormat !== "text" &&
    defaultFormat !== "json"
  ) {
    fail("Project config.output.defaultFormat must be 'text' or 'json'.");
  }

  return {
    schemaVersion:
      optionalString(config.schemaVersion, "Project config.schemaVersion") ??
      defaults.schemaVersion,
    project: optionalString(config.project, "Project config.project") ?? defaults.project,
    workspace: optionalString(config.workspace, "Project config.workspace") ?? defaults.workspace,
    output: {
      defaultFormat: defaultFormat ?? defaults.output.defaultFormat,
      jsonSchemaVersion:
        optionalString(output?.jsonSchemaVersion, "Project config.output.jsonSchemaVersion") ??
        defaults.output.jsonSchemaVersion
    },
    selection: {
      tokenBudget:
        optionalNumber(selection?.tokenBudget, "Project config.selection.tokenBudget", {
          min: 1,
          integer: true
        }) ?? defaults.selection.tokenBudget,
      maxChunks:
        optionalNumber(selection?.maxChunks, "Project config.selection.maxChunks", {
          min: 1,
          integer: true
        }) ?? defaults.selection.maxChunks,
      minScore:
        optionalNumber(selection?.minScore, "Project config.selection.minScore", {
          min: 0,
          max: 1
        }) ?? defaults.selection.minScore,
      sentenceBudget:
        optionalNumber(selection?.sentenceBudget, "Project config.selection.sentenceBudget", {
          min: 1,
          integer: true
        }) ?? defaults.selection.sentenceBudget
    },
    memory: {
      enabled:
        optionalBoolean(memory?.enabled, "Project config.memory.enabled") ??
        defaults.memory.enabled,
      project:
        optionalString(memory?.project, "Project config.memory.project") ??
        defaults.memory.project,
      limit:
        optionalNumber(memory?.limit, "Project config.memory.limit", {
          min: 1,
          integer: true
        }) ?? defaults.memory.limit,
      scope:
        optionalString(memory?.scope, "Project config.memory.scope") ??
        defaults.memory.scope,
      type:
        optionalString(memory?.type, "Project config.memory.type") ??
        defaults.memory.type,
      strictRecall:
        optionalBoolean(memory?.strictRecall, "Project config.memory.strictRecall") ??
        defaults.memory.strictRecall,
      degradedRecall:
        optionalBoolean(memory?.degradedRecall, "Project config.memory.degradedRecall") ??
        defaults.memory.degradedRecall
    },
    engram: {
      binaryPath:
        optionalString(engram?.binaryPath, "Project config.engram.binaryPath") ??
        defaults.engram.binaryPath,
      dataDir:
        optionalString(engram?.dataDir, "Project config.engram.dataDir") ??
        defaults.engram.dataDir
    }
  };
}

/**
 * @param {string} raw
 * @param {string} sourceLabel
 */
export function parseProjectConfig(raw, sourceLabel) {
  try {
    return validateProjectConfig(JSON.parse(raw.replace(/^\uFEFF/u, "")));
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`${sourceLabel} is not valid JSON: ${error.message}`);
    }

    throw error;
  }
}
