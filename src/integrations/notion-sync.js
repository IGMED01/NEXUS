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
function stripUuidDashes(value) {
  const compact = value.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/u.test(compact) ? compact : value;
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
 * @param {string} pageId
 */
function notionPageIdCandidates(pageId) {
  const normalized = normalizeText(pageId);

  if (!normalized) {
    return [];
  }

  const candidates = [
    normalized,
    toNotionUuid(normalized),
    stripUuidDashes(normalized)
  ].filter(Boolean);

  return candidates.filter((value, index, array) => array.indexOf(value) === index);
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
function splitLongText(value) {
  const compact = String(value || "");

  if (!compact.length) {
    return [];
  }

  if (compact.length <= MAX_PARAGRAPH_LENGTH) {
    return [compact];
  }

  const chunks = [];
  let current = compact;

  while (current.length > MAX_PARAGRAPH_LENGTH) {
    chunks.push(current.slice(0, MAX_PARAGRAPH_LENGTH));
    current = current.slice(MAX_PARAGRAPH_LENGTH);
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * @param {unknown} value
 */
function normalizeInlineText(value) {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
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
    .map((part) => normalizeInlineText(part))
    .filter(Boolean)
    .flatMap((part) => splitLongText(part));
}

/**
 * @param {string} content
 */
function asRichText(content) {
  return splitLongText(content).map((part) => ({
    type: "text",
    text: {
      content: part
    }
  }));
}

/**
 * @param {"heading_1" | "heading_2" | "heading_3"} type
 * @param {string} content
 */
function headingBlock(type, content) {
  return {
    object: "block",
    type,
    [type]: {
      rich_text: asRichText(content)
    }
  };
}

/**
 * @param {string} content
 */
function bulletedListBlock(content) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: asRichText(content)
    }
  };
}

/**
 * @param {string} content
 */
function numberedListBlock(content) {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: asRichText(content)
    }
  };
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
 * @param {string} content
 */
function contentBlocksFromMarkdown(content) {
  const compact = String(content).replace(/\r\n/g, "\n").trim();

  if (!compact) {
    return [];
  }

  const lines = compact.split("\n");
  /** @type {string[]} */
  const paragraphBuffer = [];
  /** @type {Array<Record<string, unknown>>} */
  const blocks = [];

  const flushParagraphBuffer = () => {
    if (!paragraphBuffer.length) {
      return;
    }

    const merged = normalizeInlineText(paragraphBuffer.join(" "));
    paragraphBuffer.length = 0;

    if (!merged) {
      return;
    }

    blocks.push(...splitLongText(merged).map((paragraph) => paragraphBlock(paragraph)));
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraphBuffer();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/u);

    if (headingMatch) {
      flushParagraphBuffer();
      const depth = headingMatch[1].length;
      const headingText = normalizeInlineText(headingMatch[2]);

      if (!headingText) {
        continue;
      }

      const headingType =
        depth === 1 ? "heading_1" : depth === 2 ? "heading_2" : "heading_3";
      blocks.push(headingBlock(headingType, headingText));
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/u);

    if (bulletMatch) {
      flushParagraphBuffer();
      const bulletText = normalizeInlineText(bulletMatch[1]);

      if (!bulletText) {
        continue;
      }

      blocks.push(bulletedListBlock(bulletText));
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/u);

    if (numberedMatch) {
      flushParagraphBuffer();
      const listItemText = normalizeInlineText(numberedMatch[1]);

      if (!listItemText) {
        continue;
      }

      blocks.push(numberedListBlock(listItemText));
      continue;
    }

    paragraphBuffer.push(trimmed);
  }

  flushParagraphBuffer();

  return blocks.length ? blocks : splitParagraphs(compact).map((paragraph) => paragraphBlock(paragraph));
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
 * @param {"POST" | "PATCH"} method
 * @param {string} path
 * @param {object} payload
 */
async function postNotion(config, fetchImpl, method, path, payload) {
  const response = await fetchImpl(`${config.apiBaseUrl}${path}`, {
    method,
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
 * @param {unknown} error
 */
function isInvalidRequestUrlError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /invalid request url/iu.test(error.message);
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
    const contentBlocks = contentBlocksFromMarkdown(content);
    const children = [...header.blocks, ...contentBlocks];
    const pageIdCandidates = notionPageIdCandidates(config.parentPageId);
    /** @type {unknown} */
    let lastError = null;
    let usedPageId = config.parentPageId;

    for (const candidate of pageIdCandidates) {
      try {
        await postNotion(
          config,
          fetchImpl,
          "PATCH",
          `/blocks/${encodeURIComponent(candidate)}/children`,
          {
            children
          }
        );
        usedPageId = candidate;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;

        if (!isInvalidRequestUrlError(error)) {
          throw error;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    return {
      action: "append",
      title,
      project: input.project || "",
      source: input.source || "lcs-cli",
      tags: header.tags,
      parentPageId: usedPageId,
      appendedBlocks: children.length,
      createdAt: timestamp
    };
  }

  return {
    config,
    appendKnowledgeEntry
  };
}
