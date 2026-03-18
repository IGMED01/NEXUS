import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateReleaseDiscipline,
  formatReleaseDisciplineReport
} from "../src/ci/release-discipline.js";

/**
 * @param {string[]} argv
 * @param {string} key
 * @param {string} fallback
 */
function option(argv, key, fallback) {
  const index = argv.indexOf(`--${key}`);

  if (index === -1) {
    return fallback;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return fallback;
  }

  return value;
}

const argv = process.argv.slice(2);
const packagePath = path.resolve(option(argv, "package", "package.json"));
const changelogPath = path.resolve(option(argv, "changelog", "CHANGELOG.md"));
const versioningPath = path.resolve(option(argv, "versioning", "VERSIONING.md"));

const [packageJsonRaw, changelogRaw, versioningRaw] = await Promise.all([
  readFile(packagePath, "utf8"),
  readFile(changelogPath, "utf8"),
  readFile(versioningPath, "utf8")
]);

const result = evaluateReleaseDiscipline({
  packageJsonRaw,
  changelogRaw,
  versioningRaw
});

const report = formatReleaseDisciplineReport(result);

if (result.passed) {
  console.log(report);
  process.exitCode = 0;
} else {
  console.error(report);
  process.exitCode = 1;
}
