// @ts-check

import { createHash } from "node:crypto";
import { parseDocumentStructure, parseStructure } from "./structure-parser.js";

/**
 * @typedef {import("../types/core-contracts.d.ts").ChunkOptions} ChunkOptions
 * @typedef {import("../types/core-contracts.d.ts").SmartChunk} SmartChunk
 */

const DEFAULT_MAX_CHARS = 3000;
const DEFAULT_MIN_CHARS = 200;
const DEFAULT_OVERLAP = 100;

/**
 * Generate a deterministic chunk ID from content.
 * @param {string} content
 * @param {number} index
 * @returns {string}
 */
function generateChunkId(content, index) {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `chunk-${index}-${hash}`;
}

/**
 * Apply overlap: the last `overlap` chars of chunk N appear at the start of chunk N+1.
 * @param {SmartChunk[]} chunks
 * @param {number} overlap
 * @returns {SmartChunk[]}
 */
function applyOverlap(chunks, overlap) {
  if (overlap <= 0 || chunks.length <= 1) return chunks;

  /** @type {SmartChunk[]} */
  const result = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const curr = chunks[i];
    const overlapText = prev.content.slice(-overlap);

    const merged = overlapText + curr.content;
    result.push({
      ...curr,
      content: merged,
      id: generateChunkId(merged, i)
    });
  }

  return result;
}

/**
 * Split by markdown headings using structure-parser.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} minChars
 * @returns {SmartChunk[]}
 */
function chunkBySection(text, maxChars, minChars) {
  const structure = parseStructure(text);
  /** @type {SmartChunk[]} */
  const chunks = [];

  let buffer = "";
  let bufferHeading = "";
  let bufferStartLine = 0;
  let bufferEndLine = 0;

  for (const section of structure.sections) {
    const sectionText = section.heading
      ? `${"#".repeat(section.level)} ${section.heading}\n${section.content}`
      : section.content;

    if (buffer.length + sectionText.length + 2 <= maxChars) {
      if (buffer) {
        buffer += "\n\n" + sectionText;
      } else {
        buffer = sectionText;
        bufferHeading = section.heading;
        bufferStartLine = section.startLine;
      }
      bufferEndLine = section.endLine;
    } else {
      if (buffer.length >= minChars) {
        chunks.push({
          id: generateChunkId(buffer, chunks.length),
          content: buffer,
          startLine: bufferStartLine,
          endLine: bufferEndLine,
          section: bufferHeading || undefined,
          strategy: "section"
        });
      } else if (buffer && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        prev.content += "\n\n" + buffer;
        prev.endLine = bufferEndLine;
        prev.id = generateChunkId(prev.content, chunks.length - 1);
      }

      if (sectionText.length > maxChars) {
        const subChunks = chunkByParagraph(sectionText, maxChars, minChars, section.startLine);
        for (const sub of subChunks) {
          sub.section = section.heading || undefined;
          sub.strategy = "section";
          chunks.push(sub);
        }
        buffer = "";
        bufferHeading = "";
      } else {
        buffer = sectionText;
        bufferHeading = section.heading;
        bufferStartLine = section.startLine;
        bufferEndLine = section.endLine;
      }
    }
  }

  if (buffer) {
    if (buffer.length >= minChars || chunks.length === 0) {
      chunks.push({
        id: generateChunkId(buffer, chunks.length),
        content: buffer,
        startLine: bufferStartLine,
        endLine: bufferEndLine,
        section: bufferHeading || undefined,
        strategy: "section"
      });
    } else if (chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      prev.content += "\n\n" + buffer;
      prev.endLine = bufferEndLine;
      prev.id = generateChunkId(prev.content, chunks.length - 1);
    }
  }

  return chunks;
}

/**
 * Split by double newlines (paragraphs), merging small paragraphs together.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} minChars
 * @param {number} [baseLineOffset]
 * @returns {SmartChunk[]}
 */
function chunkByParagraph(text, maxChars, minChars, baseLineOffset = 0) {
  const paragraphs = text.split(/\n{2,}/);
  /** @type {SmartChunk[]} */
  const chunks = [];

  let buffer = "";
  let bufferStartLine = baseLineOffset;
  let currentLine = baseLineOffset;

  for (const para of paragraphs) {
    const paraLines = para.split(/\r?\n/).length;

    if (buffer.length + para.length + 2 <= maxChars) {
      if (buffer) {
        buffer += "\n\n" + para;
      } else {
        buffer = para;
        bufferStartLine = currentLine;
      }
    } else {
      if (buffer.length >= minChars) {
        chunks.push({
          id: generateChunkId(buffer, chunks.length),
          content: buffer,
          startLine: bufferStartLine,
          endLine: currentLine - 1,
          strategy: "paragraph"
        });
      } else if (buffer && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        prev.content += "\n\n" + buffer;
        prev.endLine = currentLine - 1;
        prev.id = generateChunkId(prev.content, chunks.length - 1);
      }

      if (para.length > maxChars) {
        const sentenceChunks = chunkBySemantic(para, maxChars, minChars, currentLine);
        for (const sc of sentenceChunks) {
          sc.strategy = "paragraph";
          chunks.push(sc);
        }
        buffer = "";
      } else {
        buffer = para;
        bufferStartLine = currentLine;
      }
    }

    currentLine += paraLines + 1;
  }

  if (buffer) {
    if (buffer.length >= minChars || chunks.length === 0) {
      chunks.push({
        id: generateChunkId(buffer, chunks.length),
        content: buffer,
        startLine: bufferStartLine,
        endLine: currentLine - 1,
        strategy: "paragraph"
      });
    } else if (chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      prev.content += "\n\n" + buffer;
      prev.endLine = currentLine - 1;
      prev.id = generateChunkId(prev.content, chunks.length - 1);
    }
  }

  return chunks;
}

/**
 * Split at sentence boundaries, keeping related sentences together.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} minChars
 * @param {number} [baseLineOffset]
 * @returns {SmartChunk[]}
 */
function chunkBySemantic(text, maxChars, minChars, baseLineOffset = 0) {
  const sentenceRe = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/g;
  /** @type {string[]} */
  const sentences = [];
  let lastIndex = 0;

  let match;
  while ((match = sentenceRe.exec(text)) !== null) {
    sentences.push(text.slice(lastIndex, match.index + 1).trim());
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    sentences.push(text.slice(lastIndex).trim());
  }

  if (sentences.length === 0) {
    sentences.push(text);
  }

  /** @type {SmartChunk[]} */
  const chunks = [];
  let buffer = "";
  let lineEstimate = baseLineOffset;
  let bufferStartLine = baseLineOffset;

  for (const sentence of sentences) {
    if (buffer.length + sentence.length + 1 <= maxChars) {
      if (buffer) {
        buffer += " " + sentence;
      } else {
        buffer = sentence;
        bufferStartLine = lineEstimate;
      }
    } else {
      if (buffer.length >= minChars) {
        chunks.push({
          id: generateChunkId(buffer, chunks.length),
          content: buffer,
          startLine: bufferStartLine,
          endLine: lineEstimate,
          strategy: "semantic"
        });
      } else if (buffer && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        prev.content += " " + buffer;
        prev.endLine = lineEstimate;
        prev.id = generateChunkId(prev.content, chunks.length - 1);
      }

      if (sentence.length > maxChars) {
        for (let pos = 0; pos < sentence.length; pos += maxChars) {
          const slice = sentence.slice(pos, pos + maxChars);
          chunks.push({
            id: generateChunkId(slice, chunks.length),
            content: slice,
            startLine: lineEstimate,
            endLine: lineEstimate,
            strategy: "semantic"
          });
        }
        buffer = "";
      } else {
        buffer = sentence;
        bufferStartLine = lineEstimate;
      }
    }

    lineEstimate += Math.max(1, Math.ceil(sentence.length / 80));
  }

  if (buffer) {
    if (buffer.length >= minChars || chunks.length === 0) {
      chunks.push({
        id: generateChunkId(buffer, chunks.length),
        content: buffer,
        startLine: bufferStartLine,
        endLine: lineEstimate,
        strategy: "semantic"
      });
    } else if (chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      prev.content += " " + buffer;
      prev.endLine = lineEstimate;
      prev.id = generateChunkId(prev.content, chunks.length - 1);
    }
  }

  return chunks;
}

/**
 * Detect the best chunking strategy based on document structure.
 * @param {string} text
 * @returns {"section" | "paragraph" | "semantic"}
 */
function detectStrategy(text) {
  const structure = parseStructure(text);

  if (structure.sections.length > 1 && structure.sections.some(s => s.heading)) {
    return "section";
  }

  if (/\n\n/.test(text)) {
    return "paragraph";
  }

  return "semantic";
}

/**
 * Intelligent chunking that uses document structure analysis.
 *
 * @param {string} text
 * @param {ChunkOptions} [options]
 * @returns {SmartChunk[]}
 */
export function smartChunk(text, options) {
  const maxChars = options?.maxChunkChars ?? DEFAULT_MAX_CHARS;
  const minChars = options?.minChunkChars ?? DEFAULT_MIN_CHARS;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;
  const strategy = options?.strategy ?? "auto";

  if (!text || text.trim().length === 0) {
    return [];
  }

  const resolvedStrategy = strategy === "auto" ? detectStrategy(text) : strategy;
  /** @type {SmartChunk[]} */
  let chunks;

  switch (resolvedStrategy) {
    case "section":
      chunks = chunkBySection(text, maxChars, minChars);
      break;
    case "paragraph":
      chunks = chunkByParagraph(text, maxChars, minChars);
      break;
    case "semantic":
      chunks = chunkBySemantic(text, maxChars, minChars);
      break;
    default:
      chunks = chunkByParagraph(text, maxChars, minChars);
  }

  chunks = applyOverlap(chunks, overlap);

  return chunks;
}

/**
 * Backward-compatible adapter used by workflow/storage layers.
 *
 * @param {string} text
 * @param {{ source?: string, maxCharsPerChunk?: number, minCharsPerChunk?: number }} [options]
 * @returns {Array<{ id: string, content: string, metadata: { source: string, sectionTitle: string, sectionLevel: number, startLine: number, endLine: number, index: number, strategy: string } }>}
 */
export function chunkDocument(text, options = {}) {
  const source = typeof options.source === "string" && options.source.trim() ? options.source : "inline";
  const maxChunkChars =
    typeof options.maxCharsPerChunk === "number" && Number.isFinite(options.maxCharsPerChunk)
      ? Math.max(300, Math.trunc(options.maxCharsPerChunk))
      : 1600;
  const sections = parseDocumentStructure(text);

  /** @type {Array<{ id: string, content: string, metadata: { source: string, sectionTitle: string, sectionLevel: number, startLine: number, endLine: number, index: number, strategy: string } }>} */
  const chunks = [];
  let globalIndex = 0;

  for (const section of sections) {
    const pieces = splitLegacyLargeContent(section.content, maxChunkChars);

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
          index: globalIndex,
          strategy: "section"
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
 * @returns {string[]}
 */
function splitLegacyLargeContent(content, maxChars) {
  const normalized = String(content ?? "").trim();

  if (!normalized) {
    return [""];
  }

  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const paragraphs = normalized
    .split(/\n\s*\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);

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

    const hardPieces = hardSplitLegacy(paragraph, maxChars);
    for (let index = 0; index < hardPieces.length - 1; index += 1) {
      output.push(hardPieces[index]);
    }
    current = hardPieces[hardPieces.length - 1] ?? "";
  }

  if (current) {
    output.push(current);
  }

  return output;
}

/**
 * @param {string} content
 * @param {number} maxChars
 * @returns {string[]}
 */
function hardSplitLegacy(content, maxChars) {
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
