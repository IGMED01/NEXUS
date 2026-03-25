/**
 * Output Guard — validates system responses before they reach the user.
 *
 * Architecture:
 *   Response → [PII-Redaction] → [Secret-Leak] → [Hallucination-Check] → [Length-Check] → DELIVER
 *                    ↓                 ↓                   ↓                    ↓
 *                 REDACT             BLOCK               WARN                BLOCK
 *
 * Each rule is a pure function: (input, config) → OutputRuleResult
 * The engine runs them in config order. Blocks stop evaluation.
 * Modifications (redactions) accumulate and the final content reflects all changes.
 *
 * Design decisions:
 * - Same registry pattern as input guard for consistency
 * - "modify" rules (PII redaction) transform content rather than blocking
 * - "block" rules (secret leak) halt delivery entirely
 * - "warn" rules (hallucination) annotate but don't alter
 * - All rules are sync — no async needed for pattern matching
 */

import type {
  OutputGuardConfig,
  OutputGuardInput,
  OutputGuardResult,
  OutputGuardRuleConfig,
  OutputModification
} from "../types/core-contracts.d.ts";

// ── Rule Evaluator Registry ──────────────────────────────────────────

interface OutputRuleResult {
  blocked: boolean;
  modified: boolean;
  content: string;
  modifications: OutputModification[];
}

type OutputRuleEvaluator = (input: OutputGuardInput, content: string, config: OutputGuardRuleConfig) => OutputRuleResult;

const outputEvaluators = new Map<string, OutputRuleEvaluator>();

export function registerOutputGuardRule(type: string, evaluator: OutputRuleEvaluator): void {
  outputEvaluators.set(type, evaluator);
}

export function listRegisteredOutputRules(): string[] {
  return [...outputEvaluators.keys()];
}

// ── Default Output Guard Config ──────────────────────────────────────

export function defaultOutputGuardConfig(): OutputGuardConfig {
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
 * Rules run in config order. Block rules stop evaluation.
 * Modify rules (redaction) transform the content and continue.
 * Warn rules annotate without altering content.
 */
export function evaluateOutputGuard(output: OutputGuardInput, config: OutputGuardConfig): OutputGuardResult {
  const startMs = Date.now();
  const originalContent = output.content;

  // Guard disabled = pass everything through
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
  const allModifications: OutputModification[] = [];
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
        type: "warn",
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
//
// Detects and redacts personally identifiable information in output.
// This is a "modify" rule: it transforms content rather than blocking.
//
// Config params:
//   redactEmails: boolean (default true)
//   redactPhones: boolean (default true)
//   redactSSN: boolean (default true)
//   redactCreditCards: boolean (default true)

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string; paramKey: string }> = [
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

registerOutputGuardRule("pii-redaction", (input: OutputGuardInput, content: string, config: OutputGuardRuleConfig): OutputRuleResult => {
  const params = config.params;
  let modified = false;
  let current = content;
  const modifications: OutputModification[] = [];

  for (const pii of PII_PATTERNS) {
    const enabled = params[pii.paramKey] !== false; // default true

    if (!enabled) {
      continue;
    }

    // Reset regex state for global patterns
    pii.pattern.lastIndex = 0;
    const matches = current.match(pii.pattern);

    if (matches && matches.length > 0) {
      current = current.replace(pii.pattern, pii.replacement);
      modified = true;
      modifications.push({
        rule: "pii-redaction",
        type: "redact",
        detail: `Redacted ${matches.length} ${pii.name} pattern(s)`
      });
    }
  }

  return { blocked: false, modified, content: current, modifications };
});

// ── Built-in Rule: Secret Leak Detection ─────────────────────────────
//
// Detects if output contains secrets or tokens.
// This is a "block" rule: secrets should never leak to users.
//
// Config params:
//   patterns: string[] — additional regex patterns to check (optional)

const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  // API keys: sk-..., pk-...
  /\b(sk|pk)[-_](live|test|prod)?[A-Za-z0-9]{16,}\b/g,
  // AWS access keys: AKIA...
  /\bAKIA[A-Z0-9]{16}\b/g,
  // JWT tokens: eyJ...
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
  // GitHub tokens
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // Generic connection strings
  /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s"'`]+/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g
];

registerOutputGuardRule("secret-leak", (input: OutputGuardInput, content: string, config: OutputGuardRuleConfig): OutputRuleResult => {
  const params = config.params;
  const modifications: OutputModification[] = [];

  // Check default patterns
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    pattern.lastIndex = 0;

    if (pattern.test(content)) {
      modifications.push({
        rule: "secret-leak",
        type: "block",
        detail: `Secret/token pattern detected: ${pattern.source.slice(0, 40)}...`
      });

      return { blocked: true, modified: false, content, modifications };
    }
  }

  // Check custom patterns from config
  if (Array.isArray(params.patterns)) {
    for (const patternStr of params.patterns as string[]) {
      try {
        const custom = new RegExp(patternStr, "g");

        if (custom.test(content)) {
          modifications.push({
            rule: "secret-leak",
            type: "block",
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
//
// Basic heuristic to check if output references are grounded in chunks.
// This is a "warn" rule: it flags potential issues but does not block.
//
// Config params:
//   requireChunkReference: boolean (default false)
//   maxUngroundedClaims: number (default 3)

/**
 * Extract specific claims from text: numbers, dates, proper nouns.
 * These are the kinds of facts that should be grounded in source chunks.
 */
function extractClaims(text: string): string[] {
  const claims: string[] = [];

  // Numbers with context (e.g., "42%", "$1000", "15 million")
  const numberPatterns = text.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|percent|million|billion|thousand|dollars?|USD|EUR))?\b/g);
  if (numberPatterns) {
    for (const m of numberPatterns) {
      if (m.length > 1) { // skip single digits
        claims.push(m);
      }
    }
  }

  // Date patterns (YYYY-MM-DD, Month DD YYYY, etc.)
  const datePatterns = text.match(/\b(?:\d{4}[-/]\d{2}[-/]\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?)\b/gi);
  if (datePatterns) {
    claims.push(...datePatterns);
  }

  return claims;
}

registerOutputGuardRule("hallucination-check", (input: OutputGuardInput, content: string, config: OutputGuardRuleConfig): OutputRuleResult => {
  const params = config.params;
  const requireChunkReference = params.requireChunkReference === true;
  const maxUngrounded = typeof params.maxUngroundedClaims === "number" ? params.maxUngroundedClaims : 3;

  const modifications: OutputModification[] = [];

  // If no chunks were provided and we require references, warn
  if (requireChunkReference && (!input.chunks || input.chunks.length === 0)) {
    const claims = extractClaims(content);

    if (claims.length > 0) {
      modifications.push({
        rule: "hallucination-check",
        type: "warn",
        detail: `Output contains ${claims.length} specific claim(s) but no source chunks were provided`
      });
    }

    return { blocked: false, modified: false, content, modifications };
  }

  // Build a combined text from all chunk sources for grounding check
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
        type: "warn",
        detail: `Output contains ${ungroundedCount} claim(s) not found in source chunks (threshold: ${maxUngrounded})`
      });
    }
  }

  return { blocked: false, modified: false, content, modifications };
});

// ── Built-in Rule: Length Check ──────────────────────────────────────
//
// Ensures output isn't suspiciously short or long.
// This is a "block" rule for extreme cases.
//
// Config params:
//   minLength: number (default 10)
//   maxLength: number (default 50000)

registerOutputGuardRule("length-check", (input: OutputGuardInput, content: string, config: OutputGuardRuleConfig): OutputRuleResult => {
  const params = config.params;
  const minLength = typeof params.minLength === "number" ? params.minLength : 10;
  const maxLength = typeof params.maxLength === "number" ? params.maxLength : 50_000;

  const modifications: OutputModification[] = [];

  if (content.length < minLength) {
    modifications.push({
      rule: "length-check",
      type: "block",
      detail: `Output too short (${content.length} chars, minimum ${minLength})`
    });

    return { blocked: true, modified: false, content, modifications };
  }

  if (content.length > maxLength) {
    modifications.push({
      rule: "length-check",
      type: "block",
      detail: `Output too long (${content.length} chars, maximum ${maxLength})`
    });

    return { blocked: true, modified: false, content, modifications };
  }

  return { blocked: false, modified: false, content, modifications };
});

interface LegacyOutputGuardOptions {
  blockOnSecretSignal?: boolean;
  blockedTerms?: string[];
  domainScope?: { allowedDomains?: string[] };
}

interface LegacyOutputGuardResult {
  allowed: boolean;
  action: "allow" | "block";
  reasons: string[];
  output: string;
}

/**
 * Backward-compatible helper used by legacy tests/modules.
 */
export function enforceOutputGuard(output: string, options: LegacyOutputGuardOptions = {}): LegacyOutputGuardResult {
  const text = String(output ?? "");
  const reasons: string[] = [];

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
    const domainKeywords: Record<"security" | "observability", string[]> = {
      security: ["security", "token", "auth", "authorization", "jwt", "secret"],
      observability: ["observability", "metric", "trace", "dashboard", "alert", "logs"]
    };
    (["security", "observability"] as const).forEach((domain) => {
      if (allowedDomains.includes(domain)) {
        return;
      }
      if (domainKeywords[domain].some((keyword) => text.toLowerCase().includes(keyword))) {
        reasons.push(`domain-scope-outside:${domain}`);
      }
    });
  }

  const blocked = reasons.length > 0;
  return {
    allowed: !blocked,
    action: blocked ? "block" : "allow",
    reasons,
    output: blocked ? "" : text
  };
}
