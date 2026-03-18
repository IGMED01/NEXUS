// @ts-check

const NOTION_API_VERSION = "2022-06-28";
const DEFAULT_NOTION_API_BASE_URL = "https://api.notion.com/v1";
const MAX_PARAGRAPH_LENGTH = 1800;

/**
 * @typedef {{
 *   token?: string,
 *   parentPageId?: string,
 *   apiBaseUrl?: string
 * }} NotionConfigInput
 */

/**
 * @typedef {{
 *   token: string,
 *   parentPageId: string,
 *   apiBaseUrl: string
 * }} NotionResolvedConfig
 */

/**
 * @typedef {(url: string, init?: RequestInit) => Promise<{ ok: boolean, status: number, statusText: string, text: () => Promise<string> }>} NotionFetch
 */

/**
 * @typedef {{
 *   title: string,
 *   content: string,
 *   project?: string,
 *   source?: string,
 *   tags?: string[]
 * }} KnowledgeEntryInput
 */

/**
 * @param {unknown} value
 */
function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string} value
 */
function toNotionUuid(value) {
  const compact = value.replace(/-/g, "").toLowerCase();

  if (!/^[0-9a-f]{32}$/u.test(compact)) {
    return value.toLowerCase();
  }

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20, 32)
  ].join("-");
}

/**
 * @param {string} value
 */
function normalizeNotionPageId(value) {
  const compact = normalizeText(value);

  if (!compact) {
    return "";
  }

  const fromUrl = (() => {
    if (!/^https?:\/\//iu.test(compact)) {
      return compact;
    }

    try {
      const parsed = new URL(compact);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return compact;
    }
  })();

  const uuidMatch = fromUrl.match(
    /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu
  );

  if (!uuidMatch) {
    return compact;
  }

  return toNotionUuid(uuidMatch[1]);
}

/**
 * @param {NotionConfigInput} [input]
 * @returns {NotionResolvedConfig}
 */
export function resolveNotionConfig(input = {}) {
  const token = normalizeText(input.token || process.env.NOTION_TOKEN || process.env.NOTION_API_KEY);
  const parentPageId = normalizeNotionPageId(
    normalizeText(input.parentPageId || process.env.NOTION_PARENT_PAGE_ID)
  );
  const apiBaseUrl = normalizeText(input.apiBaseUrl || process.env.NOTION_API_BASE_URL);

  return {
    token,
    parentPageId,
    apiBaseUrl: (apiBaseUrl || DEFAULT_NOTION_API_BASE_URL).replace(/\/+$/u, "")
  };
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitParagraphs(value) {
  const compact = String(value).replace(/\r\n/g, "\n").trim();

  if (!compact) {
    return [];
  }

  return compact
    .split(/\n{2,}/u)
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (part.length <= MAX_PARAGRAPH_LENGTH) {
        return [part];
      }

      const chunks = [];
      let current = part;

      while (current.length > MAX_PARAGRAPH_LENGTH) {
        chunks.push(current.slice(0, MAX_PARAGRAPH_LENGTH));
        current = current.slice(MAX_PARAGRAPH_LENGTH);
      }

      if (current.length) {
        chunks.push(current);
      }

      return chunks;
    });
}

/**
 * @param {string} content
 */
function asRichText(content) {
  return [
    {
      type: "text",
      text: {
        content
      }
    }
  ];
}

/**
 * @param {string} content
 */
function paragraphBlock(content) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: asRichText(content)
    }
  };
}

/**
 * @param {string} title
 * @param {{ project?: string, source?: string, tags?: string[] }} meta
 * @param {string} timestamp
 */
export function buildKnowledgeBlocks(title, meta, timestamp) {
  const safeTitle = title.trim() || "Knowledge Entry";
  const safeTags = Array.isArray(meta.tags)
    ? meta.tags.map((tag) => tag.trim()).filter(Boolean)
    : [];
  const header = {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: asRichText(`${safeTitle} (${timestamp.slice(0, 10)})`)
    }
  };
  const summary = paragraphBlock(
    [
      `Project: ${meta.project || "none"}`,
      `Source: ${meta.source || "lcs-cli"}`,
      `Tags: ${safeTags.join(", ") || "none"}`,
      `Generated: ${timestamp}`
    ].join(" | ")
  );

  return {
    blocks: [header, summary],
    tags: safeTags
  };
}

/**
 * @param {NotionResolvedConfig} config
 * @param {NotionFetch} fetchImpl
 * @param {string} path
 * @param {object} payload
 */
async function postNotion(config, fetchImpl, path, payload) {
  const response = await fetchImpl(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  let parsed = {};

  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : raw || response.statusText || "Unknown Notion API error";
    throw new Error(`Notion API request failed (${response.status}): ${message}`);
  }

  return parsed;
}

/**
 * @param {{
 *   token?: string,
 *   parentPageId?: string,
 *   apiBaseUrl?: string,
 *   fetchImpl?: NotionFetch
 * }} [options]
 */
export function createNotionSyncClient(options = {}) {
  const config = resolveNotionConfig(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Notion sync requires Fetch API support in this runtime.");
  }

  /**
   * @param {KnowledgeEntryInput} input
   */
  async function appendKnowledgeEntry(input) {
    const title = normalizeText(input.title);
    const content = normalizeText(input.content);

    if (!title) {
      throw new Error("Missing required value: title.");
    }

    if (!content) {
      throw new Error("Missing required value: content.");
    }

    if (!config.token) {
      throw new Error(
        "Notion token is missing. Use --notion-token or set NOTION_TOKEN (or NOTION_API_KEY)."
      );
    }

    if (!config.parentPageId) {
      throw new Error(
        "Notion parent page id is missing. Use --notion-page-id or set NOTION_PARENT_PAGE_ID."
      );
    }

    const timestamp = new Date().toISOString();
    const header = buildKnowledgeBlocks(
      title,
      {
        project: input.project,
        source: input.source,
        tags: input.tags
      },
      timestamp
    );
    const paragraphs = splitParagraphs(content).map((paragraph) => paragraphBlock(paragraph));
    const children = [...header.blocks, ...paragraphs];

    await postNotion(config, fetchImpl, `/blocks/${encodeURIComponent(config.parentPageId)}/children`, {
      children
    });

    return {
      action: "append",
      title,
      project: input.project || "",
      source: input.source || "lcs-cli",
      tags: header.tags,
      parentPageId: config.parentPageId,
      appendedBlocks: children.length,
      createdAt: timestamp
    };
  }

  return {
    config,
    appendKnowledgeEntry
  };
}
