// @ts-check

/**
 * @typedef {{
 *   packageVersion: string,
 *   passed: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   checks: {
 *     semverVersion: boolean,
 *     changelogHasUnreleased: boolean,
 *     changelogHasCurrentVersion: boolean,
 *     changelogCurrentVersionDated: boolean,
 *     changelogCurrentVersionContractsSection: boolean,
 *     versioningHasReleaseChecklist: boolean
 *   }
 * }} ReleaseDisciplineResult
 */

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * @param {string} changelog
 * @param {string} tag
 * @returns {string}
 */
function changelogSectionBody(changelog, tag) {
  const headingPattern = new RegExp(`^## \\[${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\].*$`, "m");
  const headingMatch = headingPattern.exec(changelog);

  if (!headingMatch || headingMatch.index < 0) {
    return "";
  }

  const start = headingMatch.index + headingMatch[0].length;
  const nextHeadingPattern = /^## \[[^\]]+\].*$/gm;
  nextHeadingPattern.lastIndex = start;
  const nextMatch = nextHeadingPattern.exec(changelog);
  const end = nextMatch ? nextMatch.index : changelog.length;
  return changelog.slice(start, end).trim();
}

/**
 * @param {{
 *   packageJsonRaw: string,
 *   changelogRaw: string,
 *   versioningRaw: string
 * }} input
 * @returns {ReleaseDisciplineResult}
 */
export function evaluateReleaseDiscipline(input) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  /** @type {{ version?: unknown }} */
  let parsedPackage = {};

  try {
    parsedPackage = JSON.parse(input.packageJsonRaw.replace(/^\uFEFF/u, ""));
  } catch (error) {
    errors.push(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const packageVersion =
    typeof parsedPackage.version === "string" ? parsedPackage.version.trim() : "";

  const semverVersion = Boolean(packageVersion && SEMVER_PATTERN.test(packageVersion));

  if (!semverVersion) {
    errors.push(`package.json version '${packageVersion || "(missing)"}' is not valid SemVer.`);
  }

  const changelog = input.changelogRaw.replace(/^\uFEFF/u, "");
  const changelogHasUnreleased = /^## \[Unreleased\]\s*$/m.test(changelog);
  if (!changelogHasUnreleased) {
    errors.push("CHANGELOG.md must include '## [Unreleased]'.");
  }

  const changelogHasCurrentVersion = packageVersion
    ? new RegExp(
        `^## \\[${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?:\\s+-\\s+\\d{4}-\\d{2}-\\d{2})?\\s*$`,
        "m"
      ).test(changelog)
    : false;

  if (!changelogHasCurrentVersion) {
    errors.push(
      `CHANGELOG.md must include a release heading for package version ${packageVersion || "(missing)"}.`
    );
  }

  const changelogCurrentVersionDated = packageVersion
    ? new RegExp(
        `^## \\[${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\] - \\d{4}-\\d{2}-\\d{2}$`,
        "m"
      ).test(changelog)
    : false;

  if (!changelogCurrentVersionDated) {
    errors.push(
      `Current release heading must be dated as '## [${packageVersion || "x.y.z"}] - YYYY-MM-DD'.`
    );
  }

  const currentSection = packageVersion ? changelogSectionBody(changelog, packageVersion) : "";
  const changelogCurrentVersionContractsSection = /^###\s+Contracts\s*$/m.test(currentSection);
  if (!changelogCurrentVersionContractsSection) {
    errors.push(
      `CHANGELOG.md release section [${packageVersion || "x.y.z"}] must include a '### Contracts' subsection.`
    );
  }

  const versioning = input.versioningRaw.replace(/^\uFEFF/u, "");
  const versioningHasReleaseChecklist = /^##\s+Release checklist\b/m.test(versioning);
  if (!versioningHasReleaseChecklist) {
    errors.push("VERSIONING.md must include a '## Release checklist' section.");
  }

  if (!/^##\s+Contract compatibility policy/m.test(versioning)) {
    warnings.push("VERSIONING.md should include 'Contract compatibility policy'.");
  }

  return {
    packageVersion,
    passed: errors.length === 0,
    errors,
    warnings,
    checks: {
      semverVersion,
      changelogHasUnreleased,
      changelogHasCurrentVersion,
      changelogCurrentVersionDated,
      changelogCurrentVersionContractsSection,
      versioningHasReleaseChecklist
    }
  };
}

/**
 * @param {ReleaseDisciplineResult} result
 */
export function formatReleaseDisciplineReport(result) {
  const lines = [
    "Release discipline check:",
    `- package version: ${result.packageVersion || "(missing)"}`,
    `- passed: ${result.passed ? "yes" : "no"}`,
    `- semver version: ${result.checks.semverVersion ? "yes" : "no"}`,
    `- changelog has [Unreleased]: ${result.checks.changelogHasUnreleased ? "yes" : "no"}`,
    `- changelog has current version: ${result.checks.changelogHasCurrentVersion ? "yes" : "no"}`,
    `- changelog current version dated: ${result.checks.changelogCurrentVersionDated ? "yes" : "no"}`,
    `- changelog current version has Contracts section: ${result.checks.changelogCurrentVersionContractsSection ? "yes" : "no"}`,
    `- versioning has Release checklist: ${result.checks.versioningHasReleaseChecklist ? "yes" : "no"}`
  ];

  if (result.errors.length) {
    lines.push("", "Errors:");
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }

  if (result.warnings.length) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}
