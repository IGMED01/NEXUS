// @ts-check

const DEFAULT_MAX_HIGHLIGHTS = 5;
const DEFAULT_BODY_EXCERPT_CHARS = 900;

/**
 * @param {unknown} value
 */
function compactText(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

/**
 * @param {unknown} value
 */
function normalizeLines(value) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function extractPrBodyHighlights(value) {
  const lines = normalizeLines(value);
  /** @type {string[]} */
  const highlights = [];

  for (const line of lines) {
    const bullet = line.match(/^[-*]\s+(.+)$/u);

    if (!bullet) {
      continue;
    }

    const text = compactText(bullet[1]);

    if (text.length < 8) {
      continue;
    }

    highlights.push(text);

    if (highlights.length >= DEFAULT_MAX_HIGHLIGHTS) {
      break;
    }
  }

  if (highlights.length) {
    return highlights;
  }

  const fallback = compactText(value);

  if (!fallback) {
    return [];
  }

  return [fallback.slice(0, 220)];
}

/**
 * @param {unknown} value
 */
function normalizeTag(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
}

/**
 * @param {{
 *   pull_request?: {
 *     number?: number,
 *     title?: string,
 *     body?: string,
 *     html_url?: string,
 *     merged?: boolean,
 *     merged_at?: string,
 *     additions?: number,
 *     deletions?: number,
 *     changed_files?: number,
 *     commits?: number,
 *     merge_commit_sha?: string,
 *     base?: { ref?: string },
 *     head?: { ref?: string },
 *     user?: { login?: string },
 *     labels?: Array<{ name?: string }>
 *   },
 *   repository?: { full_name?: string }
 * }} event
 * @param {{ repoFallback?: string, titlePrefix?: string }} [options]
 */
export function buildPrLearningsSyncPayload(event, options = {}) {
  const pr = event.pull_request;

  if (!pr || typeof pr !== "object") {
    return {
      skipped: true,
      reason: "Event payload has no pull_request object."
    };
  }

  if (pr.merged !== true) {
    return {
      skipped: true,
      reason: "Pull request is closed but not merged."
    };
  }

  const number = typeof pr.number === "number" ? pr.number : 0;
  const title = compactText(pr.title) || `PR #${number}`;
  const repository =
    compactText(event.repository?.full_name) || compactText(options.repoFallback) || "unknown-repo";
  const mergedAt = compactText(pr.merged_at) || new Date().toISOString();
  const url = compactText(pr.html_url);
  const author = compactText(pr.user?.login) || "unknown";
  const baseRef = compactText(pr.base?.ref) || "unknown";
  const headRef = compactText(pr.head?.ref) || "unknown";
  const additions = typeof pr.additions === "number" ? pr.additions : 0;
  const deletions = typeof pr.deletions === "number" ? pr.deletions : 0;
  const changedFiles = typeof pr.changed_files === "number" ? pr.changed_files : 0;
  const commits = typeof pr.commits === "number" ? pr.commits : 0;
  const mergeCommitSha = compactText(pr.merge_commit_sha);
  const labelNames = Array.isArray(pr.labels)
    ? pr.labels
        .map((label) => compactText(label?.name))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const highlights = extractPrBodyHighlights(pr.body);
  const bodyExcerpt = compactText(pr.body).slice(0, DEFAULT_BODY_EXCERPT_CHARS);
  const titlePrefix = compactText(options.titlePrefix) || "PR Learnings";
  const noteTitle = `${titlePrefix} #${number} - ${title}`.slice(0, 100);

  const lines = [
    "## Pull Request Learnings",
    "",
    `- Repository: ${repository}`,
    `- PR: #${number} (${title})`,
    `- URL: ${url || "none"}`,
    `- Author: ${author}`,
    `- Branch flow: ${headRef} -> ${baseRef}`,
    `- Merged at: ${mergedAt}`,
    `- Diff: +${additions} / -${deletions} | files=${changedFiles} | commits=${commits}`,
    `- Labels: ${labelNames.join(", ") || "none"}`
  ];

  if (mergeCommitSha) {
    lines.push(`- Merge commit: ${mergeCommitSha}`);
  }

  if (highlights.length) {
    lines.push("", "### Extracted highlights");
    lines.push(...highlights.map((item) => `- ${item}`));
  }

  if (bodyExcerpt) {
    lines.push("", "### Body excerpt", bodyExcerpt);
  }

  const tags = [
    "pr-learnings",
    "github",
    ...labelNames.map(normalizeTag).filter(Boolean),
    normalizeTag(baseRef),
    "merged"
  ]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 12);

  return {
    skipped: false,
    reason: "",
    entry: {
      title: noteTitle,
      content: lines.join("\n"),
      project: repository,
      source: `github-pr-${number}`,
      tags
    },
    metadata: {
      number,
      repository,
      url,
      mergedAt
    }
  };
}
