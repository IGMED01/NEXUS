export interface NumberRules {
  integer?: boolean;
  min?: number;
  max?: number;
}

export interface ProjectOutputConfig {
  defaultFormat: string;
  jsonSchemaVersion: string;
}

export interface ProjectSelectionConfig {
  tokenBudget: number;
  maxChunks: number;
  minScore: number;
  sentenceBudget: number;
}

export interface ProjectMemoryConfig {
  enabled: boolean;
  project: string;
  limit: number;
  scope: string;
  type: string;
  strictRecall: boolean;
  degradedRecall: boolean;
  autoRecall: boolean;
  autoRemember: boolean;
}

export interface ProjectEngramConfig {
  binaryPath: string;
  dataDir: string;
}

export interface ProjectSecurityConfig {
  ignoreSensitiveFiles: boolean;
  redactSensitiveContent: boolean;
  ignoreGeneratedFiles: boolean;
  allowSensitivePaths: string[];
  extraSensitivePathFragments: string[];
}

export interface ProjectScanConfig {
  ignoreDirs: string[];
}

export interface ProjectConfig {
  schemaVersion: string;
  project: string;
  workspace: string;
  output: ProjectOutputConfig;
  selection: ProjectSelectionConfig;
  memory: ProjectMemoryConfig;
  engram: ProjectEngramConfig;
  security: ProjectSecurityConfig;
  scan: ProjectScanConfig;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }

  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean.`);
  }

  return value;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    fail(`${label} must be an array of strings.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      fail(`${label}[${index}] must be a non-empty string.`);
    }

    return entry.trim();
  });
}

function optionalNumber(value: unknown, label: string, rules: NumberRules = {}): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(`${label} must be a number.`);
  }

  if (rules.integer && !Number.isInteger(value)) {
    fail(`${label} must be an integer.`);
  }

  if (rules.min !== undefined && value < rules.min) {
    fail(`${label} must be >= ${rules.min}.`);
  }

  if (rules.max !== undefined && value > rules.max) {
    fail(`${label} must be <= ${rules.max}.`);
  }

  return value;
}

export function defaultProjectConfig(): ProjectConfig {
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
      degradedRecall: true,
      autoRecall: true,
      autoRemember: false
    },
    engram: {
      binaryPath: "tools/engram/engram.exe",
      dataDir: ".engram"
    },
    security: {
      ignoreSensitiveFiles: true,
      redactSensitiveContent: true,
      ignoreGeneratedFiles: true,
      allowSensitivePaths: [],
      extraSensitivePathFragments: []
    },
    scan: {
      ignoreDirs: [".tmp", ".cache", "tmp", ".turbo", ".next", "out"]
    }
  };
}

export function validateProjectConfig(value: unknown): ProjectConfig {
  assertObject(value, "Project config");

  const config = value;
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

  if (config.security !== undefined) {
    assertObject(config.security, "Project config.security");
  }

  if (config.scan !== undefined) {
    assertObject(config.scan, "Project config.scan");
  }

  const output = config.output;
  const selection = config.selection;
  const memory = config.memory;
  const engram = config.engram;
  const security = config.security;
  const scan = config.scan;

  const defaultFormat = optionalString(output?.defaultFormat, "Project config.output.defaultFormat");

  if (defaultFormat !== undefined && defaultFormat !== "text" && defaultFormat !== "json") {
    fail("Project config.output.defaultFormat must be 'text' or 'json'.");
  }

  return {
    schemaVersion: optionalString(config.schemaVersion, "Project config.schemaVersion") ?? defaults.schemaVersion,
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
      enabled: optionalBoolean(memory?.enabled, "Project config.memory.enabled") ?? defaults.memory.enabled,
      project: optionalString(memory?.project, "Project config.memory.project") ?? defaults.memory.project,
      limit:
        optionalNumber(memory?.limit, "Project config.memory.limit", {
          min: 1,
          integer: true
        }) ?? defaults.memory.limit,
      scope: optionalString(memory?.scope, "Project config.memory.scope") ?? defaults.memory.scope,
      type: optionalString(memory?.type, "Project config.memory.type") ?? defaults.memory.type,
      strictRecall:
        optionalBoolean(memory?.strictRecall, "Project config.memory.strictRecall") ??
        defaults.memory.strictRecall,
      degradedRecall:
        optionalBoolean(memory?.degradedRecall, "Project config.memory.degradedRecall") ??
        defaults.memory.degradedRecall,
      autoRecall:
        optionalBoolean(memory?.autoRecall, "Project config.memory.autoRecall") ??
        defaults.memory.autoRecall,
      autoRemember:
        optionalBoolean(memory?.autoRemember, "Project config.memory.autoRemember") ??
        defaults.memory.autoRemember
    },
    engram: {
      binaryPath:
        optionalString(engram?.binaryPath, "Project config.engram.binaryPath") ?? defaults.engram.binaryPath,
      dataDir: optionalString(engram?.dataDir, "Project config.engram.dataDir") ?? defaults.engram.dataDir
    },
    security: {
      ignoreSensitiveFiles:
        optionalBoolean(security?.ignoreSensitiveFiles, "Project config.security.ignoreSensitiveFiles") ??
        defaults.security.ignoreSensitiveFiles,
      redactSensitiveContent:
        optionalBoolean(security?.redactSensitiveContent, "Project config.security.redactSensitiveContent") ??
        defaults.security.redactSensitiveContent,
      ignoreGeneratedFiles:
        optionalBoolean(security?.ignoreGeneratedFiles, "Project config.security.ignoreGeneratedFiles") ??
        defaults.security.ignoreGeneratedFiles,
      allowSensitivePaths:
        optionalStringArray(security?.allowSensitivePaths, "Project config.security.allowSensitivePaths") ??
        defaults.security.allowSensitivePaths,
      extraSensitivePathFragments:
        optionalStringArray(
          security?.extraSensitivePathFragments,
          "Project config.security.extraSensitivePathFragments"
        ) ?? defaults.security.extraSensitivePathFragments
    },
    scan: {
      ignoreDirs:
        optionalStringArray(scan?.ignoreDirs, "Project config.scan.ignoreDirs") ??
        defaults.scan.ignoreDirs
    }
  };
}

export function parseProjectConfig(raw: string, sourceLabel: string): ProjectConfig {
  try {
    return validateProjectConfig(JSON.parse(raw.replace(/^\uFEFF/u, "")));
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`${sourceLabel} is not valid JSON: ${error.message}`);
    }

    throw error;
  }
}
