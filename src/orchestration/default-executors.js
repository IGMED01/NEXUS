// @ts-check

import { chunkDocument } from "../processing/chunker.js";
import { extractEntities } from "../processing/entity-extractor.js";
import { tagChunkMetadata } from "../processing/metadata-tagger.js";
import { createChunkRepository } from "../storage/chunk-repository.js";
import { createHybridRetriever } from "../storage/hybrid-retriever.js";

/**
 * @param {unknown} value
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {Record<string, unknown>} payload
 */
function ingestDocuments(payload) {
  const source = Array.isArray(payload.documents)
    ? payload.documents
    : typeof payload.text === "string"
      ? [
          {
            source: String(payload.source ?? "inline"),
            content: payload.text,
            kind: String(payload.kind ?? "doc")
          }
        ]
      : [];

  return source
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const record = /** @type {Record<string, unknown>} */ (entry);
      return {
        source: typeof record.source === "string" ? record.source : "inline",
        content: typeof record.content === "string" ? record.content : "",
        kind: typeof record.kind === "string" ? record.kind : "doc"
      };
    })
    .filter((entry) => entry.content.trim().length > 0);
}

/**
 * NEXUS:5 — register default executors for ingest/process/store/recall pipeline.
 * @param {{ repositoryFilePath?: string }} [options]
 */
export function createDefaultExecutors(options = {}) {
  const repository = createChunkRepository({
    filePath: options.repositoryFilePath
  });

  return {
    /**
     * @param {{ input: unknown }} context
     */
    async ingest(context) {
      const payload = asRecord(context.input);
      const documents = ingestDocuments(payload);

      return {
        documents,
        query: typeof payload.query === "string" ? payload.query : "",
        limit:
          typeof payload.limit === "number" && Number.isFinite(payload.limit)
            ? Math.max(1, Math.trunc(payload.limit))
            : 5
      };
    },

    /**
     * @param {{ input: unknown }} context
     */
    async process(context) {
      const input = asRecord(context.input);
      const documents = Array.isArray(input.documents) ? input.documents : [];
      /** @type {Array<{ id: string, source: string, kind: string, content: string, metadata: Record<string, unknown> }>} */
      const chunks = [];

      for (const document of documents) {
        if (!document || typeof document !== "object") {
          continue;
        }

        const item = /** @type {Record<string, unknown>} */ (document);
        const source = typeof item.source === "string" ? item.source : "inline";
        const content = typeof item.content === "string" ? item.content : "";
        const kind = typeof item.kind === "string" ? item.kind : "doc";

        for (const processed of chunkDocument(content, {
          source,
          maxCharsPerChunk: 1500
        })) {
          const metadataTags = tagChunkMetadata({
            source,
            kind,
            content: processed.content
          });

          chunks.push({
            id: processed.id,
            source,
            kind,
            content: processed.content,
            metadata: {
              ...processed.metadata,
              tags: metadataTags,
              entities: extractEntities(processed.content)
            }
          });
        }
      }

      return {
        ...input,
        chunks
      };
    },

    /**
     * @param {{ input: unknown }} context
     */
    async store(context) {
      const input = asRecord(context.input);
      const chunks = Array.isArray(input.chunks) ? input.chunks : [];
      let storedCount = 0;

      for (const chunk of chunks) {
        if (!chunk || typeof chunk !== "object") {
          continue;
        }

        const entry = /** @type {Record<string, unknown>} */ (chunk);

        await repository.upsertChunk({
          id: String(entry.id ?? ""),
          source: String(entry.source ?? ""),
          kind: String(entry.kind ?? "doc"),
          content: String(entry.content ?? ""),
          metadata: asRecord(entry.metadata)
        });
        storedCount += 1;
      }

      return {
        ...input,
        storedCount,
        repositoryFilePath: repository.filePath
      };
    },

    /**
     * @param {{ input: unknown }} context
     */
    async recall(context) {
      const input = asRecord(context.input);
      const query = typeof input.query === "string" ? input.query : "";
      const limit =
        typeof input.limit === "number" && Number.isFinite(input.limit)
          ? Math.max(1, Math.trunc(input.limit))
          : 5;
      const indexed = await repository.listChunks({ limit: 1000 });
      const retriever = createHybridRetriever(
        indexed.map((entry) => ({
          id: entry.id,
          source: entry.source,
          content: entry.content
        }))
      );
      const results = query ? retriever.search(query, { limit }) : [];

      return {
        ...input,
        query,
        limit,
        results,
        hit: results.length > 0
      };
    }
  };
}
