// @ts-check

/**
 * @typedef {import("../types/core-contracts.d.ts").ComplianceInput} ComplianceInput
 * @typedef {import("../types/core-contracts.d.ts").ComplianceReport} ComplianceReport
 * @typedef {import("../types/core-contracts.d.ts").ComplianceViolation} ComplianceViolation
 * @typedef {import("../types/core-contracts.d.ts").ComplianceRiskLevel} ComplianceRiskLevel
 * @typedef {import("../types/core-contracts.d.ts").ComplianceSeverity} ComplianceSeverity
 */

// ── Severity Ordering ────────────────────────────────────────────────

/** @type {Record<string, number>} */
const SEVERITY_ORDER = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};

/** @type {Record<string, ComplianceRiskLevel>} */
const RISK_FROM_SEVERITY = {
  info: "low",
  warning: "medium",
  error: "high",
  critical: "critical"
};

// ── Compliance Checker ───────────────────────────────────────────────

/**
 * Evaluate compliance across the full request/response cycle.
 *
 * @param {ComplianceInput} input
 * @returns {ComplianceReport}
 */
export function checkCompliance(input) {
  /** @type {ComplianceViolation[]} */
  const violations = [];

  // ── Input Guard Analysis ─────────────────────────────────────────

  const inputResult = input.inputGuardResult;

  if (inputResult.results.length === 0 && !inputResult.blocked) {
    violations.push({
      rule: "input-guard-bypass",
      severity: /** @type {ComplianceSeverity} */ ("warning"),
      description: "Input guard did not evaluate any rules — guard may be disabled or misconfigured",
      layer: /** @type {"input"} */ ("input")
    });
  }

  if (inputResult.blocked && inputResult.blockedBy === "rate-limit") {
    violations.push({
      rule: "rate-limit-triggered",
      severity: /** @type {ComplianceSeverity} */ ("info"),
      description: `Input was rate-limited: ${inputResult.userMessage}`,
      layer: /** @type {"input"} */ ("input")
    });
  }

  if (inputResult.blocked && inputResult.blockedBy !== "rate-limit") {
    violations.push({
      rule: `input-blocked-${inputResult.blockedBy}`,
      severity: /** @type {ComplianceSeverity} */ ("warning"),
      description: `Input was blocked by ${inputResult.blockedBy}: ${inputResult.userMessage}`,
      layer: /** @type {"input"} */ ("input")
    });
  }

  // ── Output Guard Analysis ────────────────────────────────────────

  const outputResult = input.outputGuardResult;

  for (const mod of outputResult.modifications) {
    if (mod.type === "block" && mod.rule === "secret-leak") {
      violations.push({
        rule: "secret-leak-detected",
        severity: /** @type {ComplianceSeverity} */ ("critical"),
        description: `Output contained secrets and was blocked: ${mod.detail}`,
        layer: /** @type {"output"} */ ("output")
      });
    } else if (mod.type === "redact" && mod.rule === "pii-redaction") {
      violations.push({
        rule: "pii-redacted",
        severity: /** @type {ComplianceSeverity} */ ("info"),
        description: `PII was detected and redacted: ${mod.detail}`,
        layer: /** @type {"output"} */ ("output")
      });
    } else if (mod.type === "block") {
      violations.push({
        rule: `output-blocked-${mod.rule}`,
        severity: /** @type {ComplianceSeverity} */ ("error"),
        description: `Output was blocked by ${mod.rule}: ${mod.detail}`,
        layer: /** @type {"output"} */ ("output")
      });
    } else if (mod.type === "warn") {
      violations.push({
        rule: `output-warn-${mod.rule}`,
        severity: /** @type {ComplianceSeverity} */ ("warning"),
        description: `Output warning from ${mod.rule}: ${mod.detail}`,
        layer: /** @type {"output"} */ ("output")
      });
    }
  }

  // ── Risk Level Calculation ───────────────────────────────────────

  /** @type {ComplianceSeverity | null} */
  let highestSeverity = null;

  for (const v of violations) {
    if (highestSeverity === null || SEVERITY_ORDER[v.severity] > SEVERITY_ORDER[highestSeverity]) {
      highestSeverity = v.severity;
    }
  }

  /** @type {ComplianceRiskLevel} */
  const riskLevel = highestSeverity
    ? RISK_FROM_SEVERITY[highestSeverity]
    : "none";

  const compliant = riskLevel === "none" || riskLevel === "low";

  // ── Summary ──────────────────────────────────────────────────────

  /** @type {string} */
  let summary;

  if (violations.length === 0) {
    summary = `Compliance check passed for project "${input.project}" — no violations detected.`;
  } else {
    /** @type {Record<string, number>} */
    const counts = {};

    for (const v of violations) {
      counts[v.severity] = (counts[v.severity] ?? 0) + 1;
    }

    /** @type {string[]} */
    const parts = [];

    for (const sev of ["critical", "error", "warning", "info"]) {
      if (counts[sev]) {
        parts.push(`${counts[sev]} ${sev}`);
      }
    }

    summary = `Compliance check for project "${input.project}": ${parts.join(", ")}. Risk level: ${riskLevel}.`;
  }

  return {
    compliant,
    violations,
    riskLevel,
    summary
  };
}

/**
 * Backward-compatible helper used by legacy tests/modules.
 *
 * @param {string} output
 * @param {{ blockedTerms?: string[] }} [options]
 */
export function checkOutputCompliance(output, options = {}) {
  /** @type {string[]} */
  const violations = [];
  const text = String(output ?? "");
  const lower = text.toLowerCase();

  if (/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(text)) {
    violations.push("email-detected");
  }

  if (/(?:\+\d{1,3}[\s-]*)?(?:\(?\d{2,4}\)?[\s-]*)\d{3,4}[\s-]*\d{3,4}/.test(text)) {
    violations.push("phone-detected");
  }

  for (const term of Array.isArray(options.blockedTerms) ? options.blockedTerms : []) {
    const candidate = String(term ?? "").trim();
    if (!candidate) {
      continue;
    }
    if (lower.includes(candidate.toLowerCase())) {
      violations.push(`blocked-term:${candidate}`);
    }
  }

  return {
    compliant: violations.length === 0,
    violations
  };
}
