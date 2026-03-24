// @ts-check

import { redactSensitiveContent } from "../security/secret-redaction.js";

/**
 * @typedef {{
 *   maxOutputChars?: number,
 *   blockOnSecretSignal?: boolean,
 *   blockOnPolicyTerms?: string[],
 *   domainScope?: {
 *     allowedDomains?: string[],
 *     blockedDomains?: string[]
 *   },
 *   redactedReplacement?: string
 * }} OutputGuardOptions
 */

/**
 * @typedef {{
 *   allowed: boolean,
 *   action: "allow" | "redact" | "block",
 *   reasons: string[],
 *   output: string,
 *   metrics: {
 *     originalChars: number,
 *     finalChars: number,
 *     redactionCount: number,
 *     privateBlocks: number,
 *     inlineSecrets: number,
 *     tokenPatterns: number,
 *     jwtLike: number,
 *     connectionStrings: number
 *   }
 * }} OutputGuardResult
 */

const DEFAULT_MAX_OUTPUT_CHARS = 8000;
const DOMAIN_SIGNALS = /** @type {Record<string, RegExp>} */ ({
  security: /\b(auth|jwt|token|secret|encryption|security)\b/iu,
  api: /\b(api|endpoint|http|request|response|route)\b/iu,
  data: /\b(database|storage|vector|index|retrieval|query)\b/iu,
  observability: /\b(metric|trace|observability|dashboard|alert)\b/iu,
  compliance: /\b(compliance|pii|policy|audit|regulation)\b/iu
});

/**
 * @param {string} output
 */
function detectDomains(output) {
  return Object.entries(DOMAIN_SIGNALS)
    .filter(([, pattern]) => pattern.test(output))
    .map(([domain]) => domain);
}

/**
 * NEXUS:4 — guard de salida para respuestas del sistema.
 * @param {string} output
 * @param {OutputGuardOptions} [options]
 * @returns {OutputGuardResult}
 */
export function enforceOutputGuard(output, options = {}) {
  const text = String(output ?? "");
  const maxOutputChars = Math.max(500, options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS);
  const blockOnSecretSignal = options.blockOnSecretSignal ?? true;
  const blockOnPolicyTerms = Array.isArray(options.blockOnPolicyTerms)
    ? options.blockOnPolicyTerms.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const domainScope = options.domainScope ?? {};
  const allowedDomains = Array.isArray(domainScope.allowedDomains)
    ? domainScope.allowedDomains.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];
  const blockedDomains = Array.isArray(domainScope.blockedDomains)
    ? domainScope.blockedDomains.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];
  const reasons = [];

  if (text.length > maxOutputChars) {
    reasons.push(`output-too-large:${text.length}`);
  }

  for (const term of blockOnPolicyTerms) {
    if (text.toLowerCase().includes(term.toLowerCase())) {
      reasons.push(`policy-term:${term}`);
    }
  }

  const detectedDomains = detectDomains(text);

  for (const domain of detectedDomains) {
    if (blockedDomains.includes(domain)) {
      reasons.push(`domain-scope-blocked:${domain}`);
    }
  }

  if (allowedDomains.length > 0) {
    const outOfScope = detectedDomains.filter((domain) => !allowedDomains.includes(domain));

    if (outOfScope.length > 0) {
      reasons.push(`domain-scope-outside:${outOfScope.join(",")}`);
    }
  }

  const redaction = redactSensitiveContent(text);
  const hasSecretSignals =
    redaction.breakdown.privateBlocks > 0 ||
    redaction.breakdown.inlineSecrets > 0 ||
    redaction.breakdown.tokenPatterns > 0 ||
    redaction.breakdown.jwtLike > 0 ||
    redaction.breakdown.connectionStrings > 0;

  if (hasSecretSignals) {
    reasons.push("secret-signal-detected");
  }

  const shouldBlockForSecrets = blockOnSecretSignal && hasSecretSignals;
  const shouldBlock = reasons.some((reason) => reason.startsWith("output-too-large:")) ||
    shouldBlockForSecrets ||
    reasons.some((reason) => reason.startsWith("policy-term:")) ||
    reasons.some((reason) => reason.startsWith("domain-scope-"));
  const shouldRedact = !shouldBlock && redaction.redacted;
  const replacement = options.redactedReplacement ?? redaction.content;
  const finalOutput = shouldRedact ? replacement : text;

  return {
    allowed: !shouldBlock,
    action: shouldBlock ? "block" : shouldRedact ? "redact" : "allow",
    reasons,
    output: shouldBlock ? "" : finalOutput,
    metrics: {
      originalChars: text.length,
      finalChars: shouldBlock ? 0 : finalOutput.length,
      redactionCount: redaction.redactionCount,
      privateBlocks: redaction.breakdown.privateBlocks,
      inlineSecrets: redaction.breakdown.inlineSecrets,
      tokenPatterns: redaction.breakdown.tokenPatterns,
      jwtLike: redaction.breakdown.jwtLike,
      connectionStrings: redaction.breakdown.connectionStrings
    }
  };
}
