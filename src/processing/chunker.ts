import { createHash } from "node:crypto";
import type { ChunkOptions, SmartChunk } from "../types/core-contracts.d.ts";
import { parseStructure } from "./structure-parser.js";

const DEFAULT_MAX_CHARS = 3000;
const DEFAULT_MIN_CHARS = 200;
const DEFAULT_OVERLAP = 100;

/**
 * Generate a deterministic chunk ID from content.
 */
function generateChunkId(content: string, index: number): string {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `chunk-${index}-${hash}`;
}

/**
 * Apply overlap: the last `overlap` chars of chunk N appear at the start of chunk N+1.
 */
function applyOverlap(chunks: SmartChunk[], overlap: number): SmartChunk[] {
  if (overlap <= 0 || chunks.length <= 1) return chunks;

  const result: SmartChunk[] = [chunks[0]];

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
 */
function chunkBySection(text: string, maxChars: number, minChars: number): SmartChunk[] {
  const structure = parseStructure(text);
  const chunks: SmartChunk[] = [];

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
      // Flush buffer if it meets minimum
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
        // Merge small buffer into previous chunk
        const prev = chunks[chunks.length - 1];
        prev.content += "\n\n" + buffer;
        prev.endLine = bufferEndLine;
        prev.id = generateChunkId(prev.content, chunks.length - 1);
      }

      // If this section alone exceeds maxChars, split it further
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

  // Flush remaining buffer
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
 */
function chunkByParagraph(text: string, maxChars: number, minChars: number, baseLineOffset: number = 0): SmartChunk[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: SmartChunk[] = [];

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

      // Handle oversized paragraphs
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

    currentLine += paraLines + 1; // +1 for the blank line between paragraphs
  }

  // Flush remaining
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
 */
function chunkBySemantic(text: string, maxChars: number, minChars: number, baseLineOffset: number = 0): SmartChunk[] {
  // Split into sentences at period/question/exclamation boundaries
  const sentenceRe = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/g;
  const sentences: string[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
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

  const chunks: SmartChunk[] = [];
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

      // If a single sentence exceeds maxChars, force-split it
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

    // Rough line estimate: ~80 chars per line
    lineEstimate += Math.max(1, Math.ceil(sentence.length / 80));
  }

  // Flush remaining
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
 */
function detectStrategy(text: string): "section" | "paragraph" | "semantic" {
  const structure = parseStructure(text);

  // If there are headings, use section-based chunking
  if (structure.sections.length > 1 && structure.sections.some(s => s.heading)) {
    return "section";
  }

  // If there are paragraph breaks, use paragraph-based chunking
  if (/\n\n/.test(text)) {
    return "paragraph";
  }

  return "semantic";
}

/**
 * Intelligent chunking that uses document structure analysis.
 *
 * Strategies:
 * - "section": split by headings (uses structure-parser)
 * - "paragraph": split by double newlines, merge small paragraphs
 * - "semantic": split at sentence boundaries
 * - "auto": detect best strategy from document structure
 */
export function smartChunk(text: string, options?: ChunkOptions): SmartChunk[] {
  const maxChars = options?.maxChunkChars ?? DEFAULT_MAX_CHARS;
  const minChars = options?.minChunkChars ?? DEFAULT_MIN_CHARS;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;
  const strategy = options?.strategy ?? "auto";

  if (!text || text.trim().length === 0) {
    return [];
  }

  const resolvedStrategy = strategy === "auto" ? detectStrategy(text) : strategy;
  let chunks: SmartChunk[];

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

  // Apply overlap between consecutive chunks
  chunks = applyOverlap(chunks, overlap);

  return chunks;
}

export interface ChunkDocumentOptions {
  source?: string;
  maxCharsPerChunk?: number;
  minCharsPerChunk?: number;
}

export interface ChunkDocumentItem {
  id: string;
  content: string;
  metadata: {
    source: string;
    sectionTitle: string;
    sectionLevel: number;
    startLine: number;
    endLine: number;
    index: number;
    strategy: string;
  };
}

/**
 * Backward-compatible adapter used by workflow/storage layers.
 */
export function chunkDocument(text: string, options: ChunkDocumentOptions = {}): ChunkDocumentItem[] {
  const source = typeof options.source === "string" && options.source.trim() ? options.source : "inline";
  const maxChunkChars =
    typeof options.maxCharsPerChunk === "number" && Number.isFinite(options.maxCharsPerChunk)
      ? Math.max(200, Math.trunc(options.maxCharsPerChunk))
      : DEFAULT_MAX_CHARS;
  const minChunkChars =
    typeof options.minCharsPerChunk === "number" && Number.isFinite(options.minCharsPerChunk)
      ? Math.max(50, Math.trunc(options.minCharsPerChunk))
      : DEFAULT_MIN_CHARS;

  const chunks = smartChunk(text, {
    maxChunkChars,
    minChunkChars
  });

  return chunks.map((chunk, index) => ({
    id: chunk.id || `${source}:${index}`,
    content: chunk.content,
    metadata: {
      source,
      sectionTitle: chunk.section ?? "document",
      sectionLevel: chunk.section ? 2 : 1,
      startLine: Number.isFinite(chunk.startLine) ? chunk.startLine : 0,
      endLine: Number.isFinite(chunk.endLine) ? chunk.endLine : 0,
      index,
      strategy: chunk.strategy ?? "semantic"
    }
  }));
}
