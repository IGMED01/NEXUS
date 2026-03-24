// @ts-check

import { parseDocumentStructure } from "./structure-parser.js";

/**
 * @typedef {{
 *   id: string,
 *   content: string,
 *   metadata: {
 *     source: string,
 *     sectionTitle: string,
 *     sectionLevel: number,
 *     startLine: number,
 *     endLine: number,
 *     index: number
 *   }
 * }} ProcessedChunk
 */

/**
 * @typedef {{
 *   source?: string,
 *   maxCharsPerChunk?: number,
 *   keepHeadingInSplitChunks?: boolean
 * }} ChunkingOptions
 */

const DEFAULT_MAX_CHARS = 1600;

/**
 * NEXUS:1 — chunk document by section, then split oversized sections safely.
 * @param {string} text
 * @param {ChunkingOptions} [options]
 * @returns {ProcessedChunk[]}
 */
export function chunkDocument(text, options = {}) {
  const source = options.source ?? "document";
  const maxChars = Math.max(300, options.maxCharsPerChunk ?? DEFAULT_MAX_CHARS);
  const keepHeadingInSplitChunks = options.keepHeadingInSplitChunks ?? true;
  const sections = parseDocumentStructure(text);

  /** @type {ProcessedChunk[]} */
  const chunks = [];
  let globalIndex = 0;

  for (const section of sections) {
    const pieces = splitLargeContent(section.content, maxChars, keepHeadingInSplitChunks);

    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      chunks.push({
        id: `${source}#${section.id}-${index + 1}`,
        content: piece,
        metadata: {
          source,
          sectionTitle: section.title,
          sectionLevel: section.level,
          startLine: section.startLine,
          endLine: section.endLine,
          index: globalIndex
        }
      });
      globalIndex += 1;
    }
  }

  return chunks;
}

/**
 * @param {string} content
 * @param {number} maxChars
 * @param {boolean} keepHeadingInSplitChunks
 */
function splitLargeContent(content, maxChars, keepHeadingInSplitChunks) {
  const normalized = String(content ?? "").trim();

  if (!normalized) {
    return [""];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const lines = normalized.split(/\r?\n/u);
  const heading = lines[0]?.startsWith("#") ? lines[0] : "";
  const body = heading ? lines.slice(1).join("\n").trim() : normalized;
  const paragraphs = body.split(/\n\s*\n/u).map((entry) => entry.trim()).filter(Boolean);

  /** @type {string[]} */
  const output = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      output.push(current);
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    const hardPieces = hardSplit(paragraph, maxChars);

    for (let index = 0; index < hardPieces.length - 1; index += 1) {
      output.push(hardPieces[index]);
    }

    current = hardPieces[hardPieces.length - 1] ?? "";
  }

  if (current) {
    output.push(current);
  }

  if (keepHeadingInSplitChunks && heading) {
    return output.map((entry, index) => (index === 0 ? `${heading}\n\n${entry}` : `${heading}\n\n${entry}`));
  }

  return output;
}

/**
 * @param {string} content
 * @param {number} maxChars
 */
function hardSplit(content, maxChars) {
  /** @type {string[]} */
  const pieces = [];
  let current = "";

  for (const sentence of content.split(/(?<=[.!?])\s+/u)) {
    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      pieces.push(current);
    }

    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }

    for (let start = 0; start < sentence.length; start += maxChars) {
      pieces.push(sentence.slice(start, start + maxChars));
    }
    current = "";
  }

  if (current) {
    pieces.push(current);
  }

  return pieces.length ? pieces : [content.slice(0, maxChars)];
}
