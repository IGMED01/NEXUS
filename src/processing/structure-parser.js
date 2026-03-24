// @ts-check

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   level: number,
 *   startLine: number,
 *   endLine: number,
 *   content: string
 * }} ParsedSection
 */

/**
 * @param {string} value
 */
function toSlug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/**
 * NEXUS:1 — parse markdown-like structure into sections.
 * @param {string} source
 * @returns {ParsedSection[]}
 */
export function parseDocumentStructure(source) {
  const lines = String(source ?? "").split(/\r?\n/u);
  /** @type {Array<{ title: string, level: number, startLine: number }>} */
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/u);

    if (!match) {
      continue;
    }

    headings.push({
      level: match[1].length,
      title: match[2].trim(),
      startLine: index
    });
  }

  if (!headings.length) {
    return [
      {
        id: "section-1",
        title: "document",
        level: 1,
        startLine: 0,
        endLine: Math.max(0, lines.length - 1),
        content: lines.join("\n").trim()
      }
    ];
  }

  /** @type {ParsedSection[]} */
  const sections = [];

  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    const endLine = (next?.startLine ?? lines.length) - 1;
    const rawContent = lines.slice(current.startLine, endLine + 1).join("\n").trim();
    const slug = toSlug(current.title);

    sections.push({
      id: slug ? `section-${slug}` : `section-${index + 1}`,
      title: current.title,
      level: current.level,
      startLine: current.startLine,
      endLine: Math.max(current.startLine, endLine),
      content: rawContent
    });
  }

  return sections;
}
