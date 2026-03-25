import type {
  DocumentStructure,
  Section,
  TableRef,
  CodeBlockRef,
  ListRef
} from "../types/core-contracts.d.ts";

/**
 * Parse front-matter metadata (YAML-like key: value pairs at start of document).
 * Stops at the first line that isn't a key-value pair or separator.
 */
function parseFrontMatter(lines: string[]): { metadata: Record<string, string>; contentStartLine: number } {
  const metadata: Record<string, string> = {};
  let i = 0;

  // Skip optional opening fence (---)
  if (lines.length > 0 && /^---\s*$/.test(lines[0])) {
    i = 1;
    // Look for closing fence
    for (let j = i; j < lines.length; j++) {
      if (/^---\s*$/.test(lines[j])) {
        // Parse key: value pairs between fences
        for (let k = i; k < j; k++) {
          const match = lines[k].match(/^([A-Za-z_][\w.-]*)\s*:\s*(.+)$/);
          if (match) {
            metadata[match[1].trim()] = match[2].trim();
          }
        }
        return { metadata, contentStartLine: j + 1 };
      }
    }
    // No closing fence found, treat as regular content
    return { metadata: {}, contentStartLine: 0 };
  }

  // Try unfenced key: value pairs at start
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      // Empty line ends front-matter block
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
 */
export function parseStructure(text: string, _sourceHint?: string): DocumentStructure {
  const lines = text.split(/\r?\n/);
  const { metadata, contentStartLine } = parseFrontMatter(lines);

  const sections: Section[] = [];
  const tables: TableRef[] = [];
  const codeBlocks: CodeBlockRef[] = [];
  const lists: ListRef[] = [];

  let currentHeading = "";
  let currentLevel = 0;
  let sectionStartLine = contentStartLine;
  let sectionLines: string[] = [];

  let inCodeBlock = false;
  let codeBlockStart = -1;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  let inTable = false;
  let tableStart = -1;
  let tableHeaders: string[] = [];
  let tableRowCount = 0;

  let inList = false;
  let listStart = -1;
  let listItems: string[] = [];
  let listOrdered = false;

  function flushSection(endLine: number): void {
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

  function flushTable(endLine: number): void {
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

  function flushList(endLine: number): void {
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
    const lineNum = i; // 0-based line numbers

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
        // Closing fence
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

      // Check if this is a separator row (---|---|---)
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
      // Continuation line (indented) or blank line within list
      const isContinuation = /^\s{2,}/.test(line) && line.trim().length > 0;
      const isBlankInList = line.trim() === "";

      if (isContinuation) {
        // Append to last item
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

  // Flush any remaining state
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
 */
export function parseDocumentStructure(text: string, _sourceHint?: string): DocumentStructure {
  return parseStructure(text, _sourceHint);
}
