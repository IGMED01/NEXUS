// @ts-check

/**
 * @typedef {import("../types/core-contracts.d.ts").DocumentStructure} DocumentStructure
 * @typedef {import("../types/core-contracts.d.ts").Section} Section
 * @typedef {import("../types/core-contracts.d.ts").TableRef} TableRef
 * @typedef {import("../types/core-contracts.d.ts").CodeBlockRef} CodeBlockRef
 * @typedef {import("../types/core-contracts.d.ts").ListRef} ListRef
 */

/**
 * Parse front-matter metadata (YAML-like key: value pairs at start of document).
 * @param {string[]} lines
 * @returns {{ metadata: Record<string, string>, contentStartLine: number }}
 */
function parseFrontMatter(lines) {
  /** @type {Record<string, string>} */
  const metadata = {};
  let i = 0;

  // Skip optional opening fence (---)
  if (lines.length > 0 && /^---\s*$/.test(lines[0])) {
    i = 1;
    for (let j = i; j < lines.length; j++) {
      if (/^---\s*$/.test(lines[j])) {
        for (let k = i; k < j; k++) {
          const match = lines[k].match(/^([A-Za-z_][\w.-]*)\s*:\s*(.+)$/);
          if (match) {
            metadata[match[1].trim()] = match[2].trim();
          }
        }
        return { metadata, contentStartLine: j + 1 };
      }
    }
    return { metadata: {}, contentStartLine: 0 };
  }

  // Try unfenced key: value pairs at start
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      if (Object.keys(metadata).length > 0) {
        return { metadata, contentStartLine: i + 1 };
      }
      break;
    }
    const match = trimmed.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.+)$/);
    if (match) {
      metadata[match[1].trim()] = match[2].trim();
    } else {
      break;
    }
  }

  if (Object.keys(metadata).length > 0) {
    return { metadata, contentStartLine: i };
  }

  return { metadata: {}, contentStartLine: 0 };
}

/**
 * Detect document structure from raw text.
 *
 * Identifies: markdown headings, code fences, tables (pipe-delimited),
 * ordered/unordered lists, separator lines, and front-matter metadata.
 *
 * @param {string} text
 * @param {string} [_sourceHint]
 * @returns {DocumentStructure}
 */
export function parseStructure(text, _sourceHint) {
  const lines = text.split(/\r?\n/);
  const { metadata, contentStartLine } = parseFrontMatter(lines);

  /** @type {Section[]} */
  const sections = [];
  /** @type {TableRef[]} */
  const tables = [];
  /** @type {CodeBlockRef[]} */
  const codeBlocks = [];
  /** @type {ListRef[]} */
  const lists = [];

  let currentHeading = "";
  let currentLevel = 0;
  let sectionStartLine = contentStartLine;
  /** @type {string[]} */
  let sectionLines = [];

  let inCodeBlock = false;
  let codeBlockStart = -1;
  let codeBlockLang = "";
  /** @type {string[]} */
  let codeBlockLines = [];

  let inTable = false;
  let tableStart = -1;
  /** @type {string[]} */
  let tableHeaders = [];
  let tableRowCount = 0;

  let inList = false;
  let listStart = -1;
  /** @type {string[]} */
  let listItems = [];
  let listOrdered = false;

  function flushSection(/** @type {number} */ endLine) {
    const content = sectionLines.join("\n").trim();
    if (content || currentHeading) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        content,
        startLine: sectionStartLine,
        endLine
      });
    }
  }

  function flushTable(/** @type {number} */ endLine) {
    if (inTable) {
      tables.push({
        startLine: tableStart,
        endLine,
        headers: tableHeaders,
        rowCount: tableRowCount
      });
      inTable = false;
      tableHeaders = [];
      tableRowCount = 0;
    }
  }

  function flushList(/** @type {number} */ endLine) {
    if (inList) {
      lists.push({
        startLine: listStart,
        endLine,
        items: listItems,
        ordered: listOrdered
      });
      inList = false;
      listItems = [];
    }
  }

  for (let i = contentStartLine; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i;

    // ── Code fences ──────────────────────────────────────────────
    const codeFenceMatch = line.match(/^(`{3,}|~{3,})(\w*)/);
    if (codeFenceMatch) {
      if (!inCodeBlock) {
        flushTable(lineNum - 1);
        flushList(lineNum - 1);
        inCodeBlock = true;
        codeBlockStart = lineNum;
        codeBlockLang = codeFenceMatch[2] || "";
        codeBlockLines = [];
        sectionLines.push(line);
        continue;
      } else {
        inCodeBlock = false;
        codeBlocks.push({
          startLine: codeBlockStart,
          endLine: lineNum,
          language: codeBlockLang,
          content: codeBlockLines.join("\n")
        });
        sectionLines.push(line);
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      sectionLines.push(line);
      continue;
    }

    // ── Headings ─────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      flushTable(lineNum - 1);
      flushList(lineNum - 1);
      flushSection(lineNum - 1);

      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      sectionStartLine = lineNum;
      sectionLines = [];
      continue;
    }

    // ── Tables (pipe-delimited) ──────────────────────────────────
    const tableMatch = line.match(/^\|(.+)\|$/);
    if (tableMatch) {
      flushList(lineNum - 1);
      const cells = tableMatch[1].split("|").map(c => c.trim());
      const isSeparator = cells.every(c => /^[-:]+$/.test(c));

      if (!inTable) {
        inTable = true;
        tableStart = lineNum;
        if (!isSeparator) {
          tableHeaders = cells;
        }
        tableRowCount = 0;
      } else if (!isSeparator) {
        tableRowCount++;
      }

      sectionLines.push(line);
      continue;
    } else if (inTable) {
      flushTable(lineNum - 1);
    }

    // ── Lists ────────────────────────────────────────────────────
    const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.+)/);
    const orderedMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)/);
    const listMatch = unorderedMatch || orderedMatch;

    if (listMatch) {
      const itemText = listMatch[3].trim();
      const isOrderedItem = !!orderedMatch;

      if (!inList) {
        inList = true;
        listStart = lineNum;
        listOrdered = isOrderedItem;
        listItems = [itemText];
      } else {
        listItems.push(itemText);
      }

      sectionLines.push(line);
      continue;
    } else if (inList) {
      const isContinuation = /^\s{2,}/.test(line) && line.trim().length > 0;
      const isBlankInList = line.trim() === "";

      if (isContinuation) {
        if (listItems.length > 0) {
          listItems[listItems.length - 1] += " " + line.trim();
        }
        sectionLines.push(line);
        continue;
      } else if (!isBlankInList) {
        flushList(lineNum - 1);
      }
    }

    sectionLines.push(line);
  }

  // Flush remaining state
  if (inCodeBlock) {
    codeBlocks.push({
      startLine: codeBlockStart,
      endLine: lines.length - 1,
      language: codeBlockLang,
      content: codeBlockLines.join("\n")
    });
  }

  flushTable(lines.length - 1);
  flushList(lines.length - 1);
  flushSection(lines.length - 1);

  return { sections, tables, codeBlocks, lists, metadata };
}

/**
 * Backward-compatible alias used by legacy modules/tests.
 *
 * @param {string} text
 * @param {string} [_sourceHint]
 */
export function parseDocumentStructure(text, _sourceHint) {
  const parsed = parseStructure(text, _sourceHint);

  return parsed.sections.map((section, index) => {
    const rawId = (section.heading || "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, "").replace(/\s+/gu, "-");

    return {
      id: rawId ? `section-${rawId}` : `section-${index + 1}`,
      title: section.heading || "document",
      level: section.level || 1,
      startLine: section.startLine,
      endLine: section.endLine,
      content: section.content
    };
  });
}
