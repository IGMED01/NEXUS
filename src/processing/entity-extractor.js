// @ts-check

/**
 * @typedef {"date" | "organization" | "person" | "url" | "reference"} EntityType
 */

/**
 * @typedef {{
 *   type: EntityType,
 *   value: string,
 *   normalized: string
 * }} ExtractedEntity
 */

const PATTERNS = /** @type {Array<{ type: EntityType, regex: RegExp, normalize?: (value: string) => string }>} */ ([
  {
    type: "date",
    regex: /\b\d{4}-\d{2}-\d{2}\b/gu
  },
  {
    type: "url",
    regex: /\bhttps?:\/\/[^\s)]+/gu
  },
  {
    type: "reference",
    regex: /\b(?:NEXUS|LCS):?\d*\b/gu,
    normalize(value) {
      return value.toUpperCase();
    }
  },
  {
    type: "organization",
    regex: /\b(?:GitHub|OpenAI|Notion|Engram|NEXUS)\b/gu
  },
  {
    type: "person",
    regex: /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)+\b/gu
  }
]);

/**
 * NEXUS:1 — lightweight entity extraction for routing and metadata enrichment.
 * @param {string} text
 * @returns {ExtractedEntity[]}
 */
export function extractEntities(text) {
  const input = String(text ?? "");
  /** @type {ExtractedEntity[]} */
  const entities = [];
  const seen = new Set();

  for (const pattern of PATTERNS) {
    for (const match of input.matchAll(pattern.regex)) {
      const value = String(match[0] ?? "").trim();

      if (!value) {
        continue;
      }

      const normalized = pattern.normalize ? pattern.normalize(value) : value.toLowerCase();
      const key = `${pattern.type}:${normalized}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entities.push({
        type: pattern.type,
        value,
        normalized
      });
    }
  }

  return entities;
}
