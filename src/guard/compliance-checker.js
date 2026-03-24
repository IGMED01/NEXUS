// @ts-check

/**
 * @typedef {{
 *   allowEmail?: boolean,
 *   allowPhone?: boolean,
 *   blockedTerms?: string[]
 * }} ComplianceOptions
 */

/**
 * @typedef {{
 *   compliant: boolean,
 *   violations: string[]
 * }} ComplianceResult
 */

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_PATTERN = /\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/gu;

/**
 * NEXUS:4 — lightweight compliance checks for output.
 * @param {string} output
 * @param {ComplianceOptions} [options]
 * @returns {ComplianceResult}
 */
export function checkOutputCompliance(output, options = {}) {
  const text = String(output ?? "");
  /** @type {string[]} */
  const violations = [];

  if (!options.allowEmail && EMAIL_PATTERN.test(text)) {
    violations.push("email-detected");
  }

  if (!options.allowPhone && PHONE_PATTERN.test(text)) {
    violations.push("phone-detected");
  }

  const blockedTerms = Array.isArray(options.blockedTerms)
    ? options.blockedTerms.map((entry) => String(entry).trim()).filter(Boolean)
    : [];

  for (const term of blockedTerms) {
    if (text.toLowerCase().includes(term.toLowerCase())) {
      violations.push(`blocked-term:${term}`);
    }
  }

  return {
    compliant: violations.length === 0,
    violations
  };
}
