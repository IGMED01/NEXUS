// @ts-check

/**
 * Shared memory utilities — provider-agnostic helpers used across
 * local-memory-store, axiom-store, and the memory chain.
 */

/**
 * Build a structured close-session content block from session summary fields.
 *
 * @param {{ summary: string, learned?: string, next?: string, workspace?: string, closedAt: string }} input
 * @returns {string}
 */
export function buildCloseSummaryContent(input) {
  const lines = ["## Session Close Summary", "", `- Summary: ${input.summary}`];

  if (input.learned) {
    lines.push(`- Learned: ${input.learned}`);
  }

  if (input.next) {
    lines.push(`- Next: ${input.next}`);
  }

  lines.push(`- Closed at: ${input.closedAt}`);

  if (input.workspace) {
    lines.push(`- Workspace: ${input.workspace}`);
  }

  return lines.join("\n");
}

/**
 * Convert a MemoryEntry[] (structured provider result) into NEXUS Chunks.
 *
 * This replaces the Engram-specific `searchOutputToChunks` (which parsed plain text stdout).
 * All memory providers that implement `MemoryProvider.search()` return structured entries —
 * this function converts those entries to the Chunk shape used by the noise-canceler.
 *
 * @param {import("../types/core-contracts.d.ts").MemoryEntry[]} entries
 * @param {{ query?: string, project?: string }} [options]
 * @returns {import("../types/core-contracts.d.ts").Chunk[]}
 */
export function memoryEntriesToChunks(entries, options = {}) {
  return entries.map((entry, index) => ({
    id: entry.id,
    source: `memory://${entry.project || options.project || "global"}/${entry.id}`,
    kind: /** @type {"memory"} */ ("memory"),
    content: [
      entry.title,
      entry.content,
      options.query ? `Recall query: ${options.query}` : "",
      `Memory type: ${entry.type}`,
      `Memory scope: ${entry.scope}`
    ]
      .filter(Boolean)
      .join(". "),
    certainty: 0.87,
    recency: recencyFromCreatedAt(entry.createdAt),
    teachingValue: 0.82,
    priority: index === 0 ? 0.9 : 0.82
  }));
}

/**
 * Transitional compatibility helper: parse legacy stdout memory search output
 * into structured MemoryEntry records.
 *
 * @param {string} raw
 * @param {{ project?: string }} [options]
 * @returns {import("../types/core-contracts.d.ts").MemoryEntry[]}
 */
export function legacySearchStdoutToEntries(raw, options = {}) {
  const text = String(raw ?? "").trim();

  if (!text || /^No memories found/i.test(text)) {
    return [];
  }

  const lines = text.split(/\r?\n/u);
  /** @type {Array<{ header: string, detailLines: string[] }>} */
  const blocks = [];
  /** @type {{ header: string, detailLines: string[] } | null} */
  let currentBlock = null;

  for (const line of lines) {
    if (/^\[\d+\]\s+#/u.test(line.trim())) {
      currentBlock = { header: line.trim(), detailLines: [] };
      blocks.push(currentBlock);
      continue;
    }

    if (currentBlock) {
      currentBlock.detailLines.push(line);
    }
  }

  return blocks.map((block, index) => {
    const headerMatch =
      block.header.match(/^\[(\d+)\]\s+#([^\s]+)\s+\(([^)]+)\)\s+[-—]\s+(.+)$/u) ??
      block.header.match(/^\[(\d+)\]\s+#([^\s]+)\s+\(([^)]+)\)\s+.+?\s+(.+)$/u);
    const observationId = headerMatch?.[2] ?? `legacy-${index + 1}`;
    const type = headerMatch?.[3] ?? "memory";
    const title = headerMatch?.[4] ?? block.header;
    const trimmedDetails = block.detailLines.map((line) => line.trim()).filter(Boolean);
    const metadataLine = trimmedDetails[trimmedDetails.length - 1] ?? "";
    const bodyLines =
      metadataLine && metadataLine.includes("|") ? trimmedDetails.slice(0, -1) : trimmedDetails;
    const body = bodyLines.join(" ").trim();
    const projectMatch = metadataLine.match(/project:\s*([^|]+)/i);
    const scopeMatch = metadataLine.match(/scope:\s*([^|]+)/i);
    const timestampText = metadataLine.split("|")[0]?.trim() ?? "";
    const parsedTimestamp = timestampText ? new Date(timestampText.replace(" ", "T")) : null;
    const createdAt =
      parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
        ? parsedTimestamp.toISOString()
        : new Date().toISOString();

    return {
      id: observationId,
      title,
      content: body,
      type,
      project: projectMatch?.[1]?.trim() ?? options.project ?? "global",
      scope: scopeMatch?.[1]?.trim() ?? "project",
      topic: "",
      createdAt
    };
  });
}

/**
 * @param {string | undefined} createdAt
 * @returns {number}
 */
function recencyFromCreatedAt(createdAt) {
  if (!createdAt) return 0.72;
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return 0.72;
  const ageDays = Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0.45, Math.min(1, 1 - ageDays / 30));
}
