// @ts-check

/**
 * @typedef {{
 *   change: string,
 *   reason: string,
 *   concepts: string[],
 *   practice: string,
 *   raw: string
 * }} ParsedLlmAnswer
 */

const SECTION_ALIASES = {
  change: ["change", "cambio"],
  reason: ["reason", "razon", "motivo", "por que", "por qué"],
  concepts: ["concepts", "conceptos"],
  practice: ["practice", "practica", "práctica", "exercise", "ejercicio"]
};

/**
 * @param {string} title
 */
function normalizeTitle(title) {
  return String(title)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * @param {string} title
 */
function resolveSectionKey(title) {
  const normalized = normalizeTitle(title);

  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      return key;
    }
  }

  return "";
}

/**
 * @param {string} value
 */
function toBulletList(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/u, ""))
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * NEXUS:6 — parse LLM raw text into teaching sections.
 * @param {string} raw
 * @returns {ParsedLlmAnswer}
 */
export function parseLlmResponse(raw) {
  const text = String(raw ?? "").trim();

  if (!text) {
    return {
      change: "",
      reason: "",
      concepts: [],
      practice: "",
      raw: ""
    };
  }

  const sections = {
    change: "",
    reason: "",
    concepts: "",
    practice: ""
  };

  /** @type {keyof typeof sections | ""} */
  let current = "";

  for (const line of text.split(/\r?\n/u)) {
    const headingMatch = line.match(/^\s*(?:#+\s*)?(?:\d+[.)]\s*)?([A-Za-zÁÉÍÓÚáéíóúñÑ ]+)\s*:\s*$/u);

    if (headingMatch) {
      const key = /** @type {keyof typeof sections | ""} */ (resolveSectionKey(headingMatch[1]));
      current = key;
      continue;
    }

    if (!current) {
      continue;
    }

    sections[current] = `${sections[current]}\n${line}`.trim();
  }

  const fallbackLines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);

  return {
    change: sections.change || fallbackLines[0] || "",
    reason: sections.reason || fallbackLines[1] || "",
    concepts: sections.concepts ? toBulletList(sections.concepts) : [],
    practice: sections.practice || fallbackLines.slice(2).join(" "),
    raw: text
  };
}
