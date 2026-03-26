// @ts-check

import { chunkDocument } from "../processing/chunker.js";
import { extractEntities } from "../processing/entity-extractor.js";
import { tagChunkMetadata } from "../processing/metadata-tagger.js";
import { getAdapter, listAdapters } from "../io/source-adapter.js";
import { createChunkRepository } from "../storage/chunk-repository.js";
import { createHybridRetriever } from "../storage/hybrid-retriever.js";

// Trigger adapter auto-registration for ingest by path/source.
import "../io/pdf-adapter.js";
import "../io/markdown-adapter.js";

/**
 * @param {unknown} value
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 */
function asText(value) {
  return typeof value === "string" ? value.trim() : "";
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
 * @param {Record<string, unknown>} payload
 */
async function ingestWithAdapter(payload) {
  const adapterName = asText(payload.adapter ?? payload.sourceAdapter ?? payload.ingestAdapter);
  const sourcePath = asText(payload.path ?? payload.sourcePath ?? payload.inputPath);

  if (!adapterName || !sourcePath) {
    return null;
  }

  const adapter = getAdapter(adapterName);

  if (!adapter) {
    const available = listAdapters();
    throw new Error(
      `Unknown source adapter '${adapterName}'. Available: ${
        available.length ? available.join(", ") : "none"
      }.`
    );
  }

  const project = asText(payload.project);
  const maxContentChars = Number(payload.maxContentChars ?? 0);
  const readResult = await adapter.read(sourcePath, {
    project,
    maxContentChars: Number.isFinite(maxContentChars) && maxContentChars > 0
      ? Math.trunc(maxContentChars)
      : undefined
  });

  return {
    adapter: adapter.name,
    sourcePath,
    stats: readResult.stats,
    chunks: readResult.chunks.map((chunk, index) => ({
      id: String(chunk.id ?? `ingested-${index + 1}`),
      source: String(chunk.source ?? sourcePath),
      kind: String(chunk.kind ?? "doc"),
      content: String(chunk.content ?? ""),
      metadata: {
        ingestedBy: `adapter:${adapter.name}`,
        sourcePath
      }
    }))
  };
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
      const adapterIngest = await ingestWithAdapter(payload);

      if (adapterIngest) {
        return {
          documents: [],
          chunks: adapterIngest.chunks,
          skipChunking: true,
          ingest: {
            adapter: adapterIngest.adapter,
            sourcePath: adapterIngest.sourcePath,
            stats: adapterIngest.stats,
            totalChunks: adapterIngest.chunks.length
          },
          query: typeof payload.query === "string" ? payload.query : "",
          limit:
            typeof payload.limit === "number" && Number.isFinite(payload.limit)
              ? Math.max(1, Math.trunc(payload.limit))
              : 5
        };
      }

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
      const skipChunking = input.skipChunking === true;
      const preChunked = Array.isArray(input.chunks) ? input.chunks : [];
      const documents = Array.isArray(input.documents) ? input.documents : [];
      /** @type {Array<{ id: string, source: string, kind: string, content: string, metadata: Record<string, unknown> }>} */
      const chunks = [];

      if (skipChunking && preChunked.length > 0) {
        for (let index = 0; index < preChunked.length; index += 1) {
          const entry = preChunked[index];

          if (!entry || typeof entry !== "object") {
            continue;
          }

          const record = /** @type {Record<string, unknown>} */ (entry);
          const source = String(record.source ?? "inline");
          const content = String(record.content ?? "");

          if (!content.trim()) {
            continue;
          }

          const kind = String(record.kind ?? "doc");
          const metadata = asRecord(record.metadata);
          const metadataTags = tagChunkMetadata({
            source,
            kind,
            content
          });

          chunks.push({
            id: String(record.id ?? `${source}::${index}`),
            source,
            kind,
            content,
            metadata: {
              ...metadata,
              tags: {
                ...metadataTags,
                ...asRecord(metadata.tags)
              },
              entities: extractEntities(content),
              preChunked: true
            }
          });
        }

        return {
          ...input,
          chunks
        };
      }

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
      const retriever = createHybridRetriever();
      retriever.index(
        indexed.map((entry) => ({
          id: entry.id,
          source: entry.source,
          kind: /** @type {import("../types/core-contracts.d.ts").ChunkKind} */ (entry.kind ?? "doc"),
          content: entry.content,
          certainty: 0.8,
          recency: 0.7,
          teachingValue: 0.7,
          priority: 0.75
        }))
      );
      const advancedResults = query ? retriever.search(query, { limit }) : [];
      const results = advancedResults.map((entry) => ({
        id: entry.chunk.id,
        source: entry.chunk.source,
        kind: entry.chunk.kind,
        content: entry.chunk.content,
        score: entry.score,
        breakdown: entry.breakdown
      }));

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
