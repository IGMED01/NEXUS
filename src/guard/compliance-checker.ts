/**
 * Compliance Checker — combines input + output guard results into a
 * unified compliance report.
 *
 * This is the top-level compliance layer that answers: "Was this
 * request/response cycle handled correctly from a security and
 * compliance standpoint?"
 *
 * Design decisions:
 * - Pure function: no side effects, no state
 * - Violations are collected from both layers
 * - Risk level = highest severity found among violations
 * - Summary is human-readable for audit logs and dashboards
 */

import type {
  ComplianceInput,
  ComplianceReport,
  ComplianceViolation,
  ComplianceRiskLevel,
  ComplianceSeverity
} from "../types/core-contracts.d.ts";

// ── Severity Ordering ────────────────────────────────────────────────

const SEVERITY_ORDER: Record<ComplianceSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};

const RISK_FROM_SEVERITY: Record<ComplianceSeverity, ComplianceRiskLevel> = {
  info: "low",
  warning: "medium",
  error: "high",
  critical: "critical"
};

// ── Compliance Checker ───────────────────────────────────────────────

/**
 * Evaluate compliance across the full request/response cycle.
 *
 * Analyzes both input guard and output guard results to produce
 * a unified compliance report with risk assessment.
 */
export function checkCompliance(input: ComplianceInput): ComplianceReport {
  const violations: ComplianceViolation[] = [];

  // ── Input Guard Analysis ─────────────────────────────────────────

  const inputResult = input.inputGuardResult;

  // If input guard had no rules evaluated, that's suspicious
  if (inputResult.results.length === 0 && !inputResult.blocked) {
    violations.push({
      rule: "input-guard-bypass",
      severity: "warning",
      description: "Input guard did not evaluate any rules — guard may be disabled or misconfigured",
      layer: "input"
    });
  }

  // If input was rate-limited, note it
  if (inputResult.blocked && inputResult.blockedBy === "rate-limit") {
    violations.push({
      rule: "rate-limit-triggered",
      severity: "info",
      description: `Input was rate-limited: ${inputResult.userMessage}`,
      layer: "input"
    });
  }

  // If input was blocked for any reason, log it
  if (inputResult.blocked && inputResult.blockedBy !== "rate-limit") {
    violations.push({
      rule: `input-blocked-${inputResult.blockedBy}`,
      severity: "warning",
      description: `Input was blocked by ${inputResult.blockedBy}: ${inputResult.userMessage}`,
      layer: "input"
    });
  }

  // ── Output Guard Analysis ────────────────────────────────────────

  const outputResult = input.outputGuardResult;

  // Check each output modification
  for (const mod of outputResult.modifications) {
    if (mod.type === "block" && mod.rule === "secret-leak") {
      // Secret leak is critical
      violations.push({
        rule: "secret-leak-detected",
        severity: "critical",
        description: `Output contained secrets and was blocked: ${mod.detail}`,
        layer: "output"
      });
    } else if (mod.type === "redact" && mod.rule === "pii-redaction") {
      // PII was redacted — this is good, just note it
      violations.push({
        rule: "pii-redacted",
        severity: "info",
        description: `PII was detected and redacted: ${mod.detail}`,
        layer: "output"
      });
    } else if (mod.type === "block") {
      // Other blocks
      violations.push({
        rule: `output-blocked-${mod.rule}`,
        severity: "error",
        description: `Output was blocked by ${mod.rule}: ${mod.detail}`,
        layer: "output"
      });
    } else if (mod.type === "warn") {
      violations.push({
        rule: `output-warn-${mod.rule}`,
        severity: "warning",
        description: `Output warning from ${mod.rule}: ${mod.detail}`,
        layer: "output"
      });
    }
  }

  // ── Risk Level Calculation ───────────────────────────────────────

  let highestSeverity: ComplianceSeverity | null = null;

  for (const v of violations) {
    if (highestSeverity === null || SEVERITY_ORDER[v.severity] > SEVERITY_ORDER[highestSeverity]) {
      highestSeverity = v.severity;
    }
  }

  const riskLevel: ComplianceRiskLevel = highestSeverity
    ? RISK_FROM_SEVERITY[highestSeverity]
    : "none";

  const compliant = riskLevel === "none" || riskLevel === "low";

  // ── Summary ──────────────────────────────────────────────────────

  let summary: string;

  if (violations.length === 0) {
    summary = `Compliance check passed for project "${input.project}" — no violations detected.`;
  } else {
    const counts: Record<string, number> = {};

    for (const v of violations) {
      counts[v.severity] = (counts[v.severity] ?? 0) + 1;
    }

    const parts: string[] = [];

    for (const sev of ["critical", "error", "warning", "info"] as ComplianceSeverity[]) {
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

interface LegacyOutputComplianceOptions {
  blockedTerms?: string[];
}

interface LegacyOutputComplianceResult {
  compliant: boolean;
  violations: string[];
}

/**
 * Backward-compatible helper used by legacy tests/modules.
 */
export function checkOutputCompliance(
  output: string,
  options: LegacyOutputComplianceOptions = {}
): LegacyOutputComplianceResult {
  const violations: string[] = [];
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
