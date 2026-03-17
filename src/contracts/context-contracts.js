// @ts-check

const VALID_KINDS = new Set([
  "code",
  "test",
  "spec",
  "memory",
  "doc",
  "chat",
  "log"
]);

/**
 * @typedef {"code" | "test" | "spec" | "memory" | "doc" | "chat" | "log"} ChunkKind
 */

/**
 * @typedef {object} Chunk
 * @property {string} id
 * @property {string} source
 * @property {ChunkKind} kind
 * @property {string} content
 * @property {number=} certainty
 * @property {number=} recency
 * @property {number=} teachingValue
 * @property {number=} priority
 */

/**
 * @typedef {object} ChunkFile
 * @property {Chunk[]} chunks
 */

/**
 * @param {string} message
 */
function fail(message) {
  throw new Error(message);
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function assertNumberInRange(value, label) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    fail(`${label} must be a number between 0 and 1.`);
  }
}

/**
 * @param {unknown} value
 * @param {number} index
 * @returns {Chunk}
 */
export function validateChunk(value, index) {
  assertObject(value, `chunks[${index}]`);

  const chunk = /** @type {Record<string, unknown>} */ (value);

  assertString(chunk.id, `chunks[${index}].id`);
  assertString(chunk.source, `chunks[${index}].source`);
  assertString(chunk.kind, `chunks[${index}].kind`);
  assertString(chunk.content, `chunks[${index}].content`);

  if (!VALID_KINDS.has(/** @type {string} */ (chunk.kind))) {
    fail(
      `chunks[${index}].kind must be one of: ${Array.from(VALID_KINDS).join(", ")}.`
    );
  }

  assertNumberInRange(chunk.certainty, `chunks[${index}].certainty`);
  assertNumberInRange(chunk.recency, `chunks[${index}].recency`);
  assertNumberInRange(chunk.teachingValue, `chunks[${index}].teachingValue`);
  assertNumberInRange(chunk.priority, `chunks[${index}].priority`);

  return /** @type {Chunk} */ ({
    id: chunk.id,
    source: chunk.source,
    kind: chunk.kind,
    content: chunk.content,
    certainty: chunk.certainty,
    recency: chunk.recency,
    teachingValue: chunk.teachingValue,
    priority: chunk.priority
  });
}

/**
 * @param {unknown} value
 * @returns {ChunkFile}
 */
export function validateChunkFile(value) {
  assertObject(value, "Input payload");

  const payload = /** @type {Record<string, unknown>} */ (value);

  if (!Array.isArray(payload.chunks)) {
    fail("Input payload must contain a 'chunks' array.");
  }

  return {
    chunks: /** @type {unknown[]} */ (payload.chunks).map((chunk, index) => validateChunk(chunk, index))
  };
}

/**
 * @param {string} raw
 * @param {string} sourceLabel
 * @returns {ChunkFile}
 */
export function parseChunkFile(raw, sourceLabel) {
  try {
    return validateChunkFile(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`${sourceLabel} is not valid JSON: ${error.message}`);
    }

    throw error;
  }
}
