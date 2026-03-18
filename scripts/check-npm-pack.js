// @ts-check

import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const REQUIRED_PACKAGE_PATHS = ["package.json", "README.md", "dist/cli.js"];
const MAX_PACK_FILE_COUNT = 80;

/**
 * @param {string[]} args
 */
function runNpm(args) {
  const useWindowsShell = process.platform === "win32";
  const npmCommand = useWindowsShell ? "cmd.exe" : "npm";
  const npmArgs = useWindowsShell ? ["/d", "/s", "/c", "npm", ...args] : args;
  try {
    return execFileSync(npmCommand, npmArgs, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    }).trim();
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr || "").trim() : "";
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(`npm ${args.join(" ")} failed${stderr ? `: ${stderr}` : `: ${message}`}`);
  }
}

/**
 * @param {string} value
 */
function parsePackJson(value) {
  let parsed;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Unable to parse npm pack JSON output: ${String(error)}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack returned an empty JSON payload.");
  }

  return parsed[0];
}

async function main() {
  const raw = runNpm(["pack", "--json"]);
  const packInfo = parsePackJson(raw);

  if (!packInfo || typeof packInfo !== "object") {
    throw new Error("Invalid npm pack payload shape.");
  }

  const filename =
    "filename" in packInfo && typeof packInfo.filename === "string" ? packInfo.filename : "";
  const files =
    "files" in packInfo && Array.isArray(packInfo.files)
      ? packInfo.files
          .map((entry) => (entry && typeof entry === "object" && "path" in entry ? entry.path : ""))
          .filter((entry) => typeof entry === "string" && entry.length > 0)
      : [];

  if (!filename) {
    throw new Error("npm pack payload did not include tarball filename.");
  }

  const missingPaths = REQUIRED_PACKAGE_PATHS.filter((requiredPath) => !files.includes(requiredPath));

  if (missingPaths.length > 0) {
    throw new Error(
      `npm pack is missing required paths: ${missingPaths.join(", ")}`
    );
  }

  if (files.length > MAX_PACK_FILE_COUNT) {
    throw new Error(
      `npm pack includes too many files (${files.length}). Keep the package lean (max ${MAX_PACK_FILE_COUNT}).`
    );
  }

  await rm(filename, { force: true });
  console.log(
    JSON.stringify(
      {
        status: "ok",
        tarball: filename,
        requiredPaths: REQUIRED_PACKAGE_PATHS,
        fileCount: files.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
