// @ts-check

import { readFile } from "node:fs/promises";

import { runCli } from "../src/cli/app.js";
import { buildPrLearningsSyncPayload } from "../src/ci/pr-learnings.js";
import { resolveNotionConfig } from "../src/integrations/notion-sync.js";

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

/**
 * @param {string[]} argv
 * @param {string} key
 * @param {boolean} fallback
 */
function booleanOption(argv, key, fallback) {
  const raw = option(argv, key, fallback ? "true" : "false");

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new Error(`Option --${key} must be true or false.`);
}

/**
 * @param {string} value
 */
function asEventPath(value) {
  const compact = String(value || "").trim();

  if (!compact) {
    throw new Error(
      "Missing GitHub event payload path. Use --event <path> or set GITHUB_EVENT_PATH."
    );
  }

  return compact;
}

async function main() {
  const argv = process.argv.slice(2);
  const eventPath = asEventPath(option(argv, "event", process.env.GITHUB_EVENT_PATH || ""));
  const strict = booleanOption(argv, "strict", false);
  const dryRun = booleanOption(argv, "dry-run", false);
  const titlePrefix = option(argv, "title-prefix", "PR Learnings");

  const rawEvent = await readFile(eventPath, "utf8");
  const eventPayload = JSON.parse(rawEvent.replace(/^\uFEFF/u, ""));
  const built = buildPrLearningsSyncPayload(eventPayload, {
    repoFallback: process.env.GITHUB_REPOSITORY || "",
    titlePrefix
  });

  if (built.skipped) {
    console.log(`[pr-learnings-sync] skipped: ${built.reason}`);
    process.exitCode = 0;
    return;
  }

  if (dryRun) {
    console.log("[pr-learnings-sync] dry-run payload:");
    console.log(JSON.stringify(built.entry, null, 2));
    process.exitCode = 0;
    return;
  }

  const notion = resolveNotionConfig();

  if (!notion.token || !notion.parentPageId) {
    const reason =
      "NOTION_TOKEN/NOTION_API_KEY or NOTION_PARENT_PAGE_ID is missing. Configure repo secrets.";

    if (strict) {
      throw new Error(`[pr-learnings-sync] strict mode: ${reason}`);
    }

    console.log(`[pr-learnings-sync] skipped (degraded): ${reason}`);
    process.exitCode = 0;
    return;
  }

  const cliResult = await runCli([
    "sync-knowledge",
    "--title",
    built.entry.title,
    "--content",
    built.entry.content,
    "--project",
    built.entry.project,
    "--source",
    built.entry.source,
    "--tags",
    built.entry.tags.join(","),
    "--format",
    "json"
  ]);

  if (cliResult.exitCode !== 0) {
    throw new Error(cliResult.stderr || cliResult.stdout || "sync-knowledge command failed.");
  }

  const parsed = JSON.parse(cliResult.stdout);
  console.log(
    `[pr-learnings-sync] synced: ${parsed.title} -> page ${parsed.parentPageId} (${parsed.appendedBlocks} blocks)`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
