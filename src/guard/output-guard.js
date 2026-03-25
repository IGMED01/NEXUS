// @ts-check

/**
 * @typedef {import("../types/core-contracts.d.ts").OutputGuardConfig} OutputGuardConfig
 * @typedef {import("../types/core-contracts.d.ts").OutputGuardInput} OutputGuardInput
 * @typedef {import("../types/core-contracts.d.ts").OutputGuardResult} OutputGuardResult
 * @typedef {import("../types/core-contracts.d.ts").OutputGuardRuleConfig} OutputGuardRuleConfig
 * @typedef {import("../types/core-contracts.d.ts").OutputModification} OutputModification
 */

/**
 * @typedef {{ blocked: boolean, modified: boolean, content: string, modifications: OutputModification[] }} OutputRuleResult
 * @typedef {(input: OutputGuardInput, content: string, config: OutputGuardRuleConfig) => OutputRuleResult} OutputRuleEvaluator
 */

// ── Rule Evaluator Registry ──────────────────────────────────────────

/** @type {Map<string, OutputRuleEvaluator>} */
const outputEvaluators = new Map();

/**
 * @param {string} type
 * @param {OutputRuleEvaluator} evaluator
 */
export function registerOutputGuardRule(type, evaluator) {
  outputEvaluators.set(type, evaluator);
}

/**
 * @returns {string[]}
 */
export function listRegisteredOutputRules() {
  return [...outputEvaluators.keys()];
}

// ── Default Output Guard Config ──────────────────────────────────────

/**
 * @returns {OutputGuardConfig}
 */
export function defaultOutputGuardConfig() {
  return {
    enabled: false,
    rules: [],
    defaultBlockMessage: "This response has been blocked by the output guard."
  };
}

// ── Output Guard Engine Core ─────────────────────────────────────────

/**
 * Evaluate a system response against all configured output guard rules.
 *
 * @param {OutputGuardInput} output
 * @param {OutputGuardConfig} config
 * @returns {OutputGuardResult}
 */
export function evaluateOutputGuard(output, config) {
  const startMs = Date.now();
  const originalContent = output.content;

  if (!config.enabled) {
    return {
      blocked: false,
      modified: false,
      originalContent,
      finalContent: originalContent,
      blockedBy: "",
      modifications: [],
      durationMs: Date.now() - startMs
    };
  }

  let currentContent = originalContent;
  /** @type {OutputModification[]} */
  const allModifications = [];
  let blocked = false;
  let blockedBy = "";

  for (const ruleConfig of config.rules) {
    if (!ruleConfig.enabled) {
      continue;
    }

    const evaluator = outputEvaluators.get(ruleConfig.type);

    if (!evaluator) {
      allModifications.push({
        rule: ruleConfig.type,
        type: /** @type {"warn"} */ ("warn"),
        detail: `Unknown output guard rule type: '${ruleConfig.type}'`
      });
      continue;
    }

    const result = evaluator(output, currentContent, ruleConfig);

    if (result.modifications.length > 0) {
      allModifications.push(...result.modifications);
    }

    if (result.blocked) {
      blocked = true;
      blockedBy = ruleConfig.type;
      break;
    }

    if (result.modified) {
      currentContent = result.content;
    }
  }

  const modified = currentContent !== originalContent;

  return {
    blocked,
    modified,
    originalContent,
    finalContent: blocked ? config.defaultBlockMessage : currentContent,
    blockedBy,
    modifications: allModifications,
    durationMs: Date.now() - startMs
  };
}

// ── Built-in Rule: PII Redaction ─────────────────────────────────────

/** @type {Array<{ name: string, pattern: RegExp, replacement: string, paramKey: string }>} */
const PII_PATTERNS = [
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[REDACTED_EMAIL]",
    paramKey: "redactEmails"
  },
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
    paramKey: "redactSSN"
  },
  {
    name: "credit_card",
    pattern: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
    replacement: "[REDACTED_CREDIT_CARD]",
    paramKey: "redactCreditCards"
  },
  {
    name: "phone",
    pattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[REDACTED_PHONE]",
    paramKey: "redactPhones"
  }
];

registerOutputGuardRule("pii-redaction", (input, content, config) => {
  const params = config.params;
  let modified = false;
  let current = content;
  /** @type {OutputModification[]} */
  const modifications = [];

  for (const pii of PII_PATTERNS) {
    const enabled = params[pii.paramKey] !== false;

    if (!enabled) {
      continue;
    }

    pii.pattern.lastIndex = 0;
    const matches = current.match(pii.pattern);

    if (matches && matches.length > 0) {
      current = current.replace(pii.pattern, pii.replacement);
      modified = true;
      modifications.push({
        rule: "pii-redaction",
        type: /** @type {"redact"} */ ("redact"),
        detail: `Redacted ${matches.length} ${pii.name} pattern(s)`
      });
    }
  }

  return { blocked: false, modified, content: current, modifications };
});

// ── Built-in Rule: Secret Leak Detection ─────────────────────────────

/** @type {RegExp[]} */
const DEFAULT_SECRET_PATTERNS = [
  /\b(sk|pk)[-_](live|test|prod)?[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s"'`]+/g,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g
];

registerOutputGuardRule("secret-leak", (input, content, config) => {
  const params = config.params;
  /** @type {OutputModification[]} */
  const modifications = [];

  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    pattern.lastIndex = 0;

    if (pattern.test(content)) {
      modifications.push({
        rule: "secret-leak",
        type: /** @type {"block"} */ ("block"),
        detail: `Secret/token pattern detected: ${pattern.source.slice(0, 40)}...`
      });

      return { blocked: true, modified: false, content, modifications };
    }
  }

  if (Array.isArray(params.patterns)) {
    for (const patternStr of /** @type {string[]} */ (params.patterns)) {
      try {
        const custom = new RegExp(patternStr, "g");

        if (custom.test(content)) {
          modifications.push({
            rule: "secret-leak",
            type: /** @type {"block"} */ ("block"),
            detail: `Custom secret pattern detected: ${patternStr.slice(0, 40)}`
          });

          return { blocked: true, modified: false, content, modifications };
        }
      } catch {
        // Invalid regex — skip silently
      }
    }
  }

  return { blocked: false, modified: false, content, modifications };
});

// ── Built-in Rule: Hallucination Check ───────────────────────────────

/**
 * Extract specific claims from text: numbers, dates.
 * @param {string} text
 * @returns {string[]}
 */
function extractClaims(text) {
  /** @type {string[]} */
  const claims = [];

  const numberPatterns = text.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|percent|million|billion|thousand|dollars?|USD|EUR))?\b/g);
  if (numberPatterns) {
    for (const m of numberPatterns) {
      if (m.length > 1) {
        claims.push(m);
      }
    }
  }

  const datePatterns = text.match(/\b(?:\d{4}[-/]\d{2}[-/]\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?)\b/gi);
  if (datePatterns) {
    claims.push(...datePatterns);
  }

  return claims;
}

registerOutputGuardRule("hallucination-check", (input, content, config) => {
  const params = config.params;
  const requireChunkReference = params.requireChunkReference === true;
  const maxUngrounded = typeof params.maxUngroundedClaims === "number" ? params.maxUngroundedClaims : 3;

  /** @type {OutputModification[]} */
  const modifications = [];

  if (requireChunkReference && (!input.chunks || input.chunks.length === 0)) {
    const claims = extractClaims(content);

    if (claims.length > 0) {
      modifications.push({
        rule: "hallucination-check",
        type: /** @type {"warn"} */ ("warn"),
        detail: `Output contains ${claims.length} specific claim(s) but no source chunks were provided`
      });
    }

    return { blocked: false, modified: false, content, modifications };
  }

  if (input.chunks && input.chunks.length > 0) {
    const chunkText = input.chunks.map((c) => `${c.id} ${c.source}`).join(" ").toLowerCase();
    const claims = extractClaims(content);
    let ungroundedCount = 0;

    for (const claim of claims) {
      if (!chunkText.includes(claim.toLowerCase())) {
        ungroundedCount++;
      }
    }

    if (ungroundedCount > maxUngrounded) {
      modifications.push({
        rule: "hallucination-check",
        type: /** @type {"warn"} */ ("warn"),
        detail: `Output contains ${ungroundedCount} claim(s) not found in source chunks (threshold: ${maxUngrounded})`
      });
    }
  }

  return { blocked: false, modified: false, content, modifications };
});

// ── Built-in Rule: Length Check ──────────────────────────────────────

registerOutputGuardRule("length-check", (input, content, config) => {
  const params = config.params;
  const minLength = typeof params.minLength === "number" ? params.minLength : 10;
  const maxLength = typeof params.maxLength === "number" ? params.maxLength : 50_000;

  /** @type {OutputModification[]} */
  const modifications = [];

  if (content.length < minLength) {
    modifications.push({
      rule: "length-check",
      type: /** @type {"block"} */ ("block"),
      detail: `Output too short (${content.length} chars, minimum ${minLength})`
    });

    return { blocked: true, modified: false, content, modifications };
  }

  if (content.length > maxLength) {
    modifications.push({
      rule: "length-check",
      type: /** @type {"block"} */ ("block"),
      detail: `Output too long (${content.length} chars, maximum ${maxLength})`
    });

    return { blocked: true, modified: false, content, modifications };
  }

  return { blocked: false, modified: false, content, modifications };
});

/**
 * Backward-compatible helper used by legacy tests/modules.
 *
 * @param {string} output
 * @param {{
 *   blockOnSecretSignal?: boolean,
 *   blockedTerms?: string[],
 *   domainScope?: { allowedDomains?: string[] }
 * }} [options]
 */
export function enforceOutputGuard(output, options = {}) {
  const text = String(output ?? "");
  /** @type {string[]} */
  const reasons = [];

  if (options.blockOnSecretSignal) {
    const hasSecretSignal =
      /sk-(?:live|test)-[A-Za-z0-9]/i.test(text) ||
      /\b(?:api[_-]?key|authorization|bearer)\b/i.test(text);
    if (hasSecretSignal) {
      reasons.push("secret-signal-detected");
    }
  }

  for (const term of Array.isArray(options.blockedTerms) ? options.blockedTerms : []) {
    const candidate = String(term ?? "").trim();
    if (!candidate) {
      continue;
    }
    if (text.toLowerCase().includes(candidate.toLowerCase())) {
      reasons.push(`blocked-term:${candidate}`);
    }
  }

  const allowedDomains = Array.isArray(options.domainScope?.allowedDomains)
    ? options.domainScope.allowedDomains.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];
  if (allowedDomains.length > 0) {
    const domainKeywords = {
      security: ["security", "token", "auth", "authorization", "jwt", "secret"],
      observability: ["observability", "metric", "trace", "dashboard", "alert", "logs"]
    };
    /** @type {Array<"security" | "observability">} */
    const knownDomains = ["security", "observability"];
    for (const domain of knownDomains) {
      if (allowedDomains.includes(domain)) {
        continue;
      }
      if (domainKeywords[domain].some((keyword) => text.toLowerCase().includes(keyword))) {
        reasons.push(`domain-scope-outside:${domain}`);
      }
    }
  }

  const blocked = reasons.length > 0;
  return {
    allowed: !blocked,
    action: blocked ? "block" : "allow",
    reasons,
    output: blocked ? "" : text
  };
}
