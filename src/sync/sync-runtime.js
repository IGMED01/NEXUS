// @ts-check

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chunkDocument } from "../processing/chunker.js";
import { extractEntities } from "../processing/entity-extractor.js";
import { tagChunkMetadata } from "../processing/metadata-tagger.js";
import {
  redactSensitiveContent,
  resolveSecurityPolicy,
  shouldIgnoreSensitiveFile
} from "../security/secret-redaction.js";
import { createChunkRepository } from "../storage/chunk-repository.js";
import { createChangeDetector } from "./change-detector.js";
import { createVersionTracker } from "./version-tracker.js";

/**
 * @typedef {import("../types/core-contracts.d.ts").Chunk} Chunk
 * @typedef {import("../types/core-contracts.d.ts").ChunkKind} ChunkKind
 */

const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".go",
  ".py",
  ".json",
  ".log",
  ".md",
  ".txt",
  ".toml",
  ".yaml",
  ".yml"
]);

const ALLOWED_FILENAMES = new Set(["README.md", "AGENTS.md", "agents.md", "package.json"]);
const NEAR_DUPLICATE_THRESHOLD = 0.82;

/**
 * @typedef {{
 *   schemaVersion: string,
 *   generatedAt: string,
 *   projectId: string,
 *   rootPath: string,
 *   files: Record<string, {
 *     chunkIds: string[],
 *     checksums: Record<string, string>,
 *     updatedAt: string
 *   }>
 * }} SyncManifest
 */

/**
 * @typedef {{
 *   chunk: Chunk,
 *   source: string,
 *   contentHash: string
 * }} SyncCandidateChunk
 */

/**
 * @typedef {{
 *   chunkId: string,
 *   source: string,
 *   duplicateOf: string,
 *   reason: "exact" | "near"
 * }} SyncDuplicate
 */

/**
 * @param {string} value
 */
function toPosixPath(value) {
  return value.replace(/\\/gu, "/");
}

/**
 * @param {string} content
 */
function hashContent(content) {
  return createHash("sha1").update(content).digest("hex");
}

function createRunId() {
  return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {string} source
 * @returns {ChunkKind}
 */
function classifyKind(source) {
  const normalized = toPosixPath(source);
  const extension = path.extname(normalized);

  if (normalized.includes("/logs/") || normalized.endsWith(".log")) {
    return "log";
  }

  if (normalized.includes("/chat/")) {
    return "chat";
  }

  if (
    normalized.startsWith("test/") ||
    normalized.includes(".test.") ||
    normalized.includes(".spec.")
  ) {
    return "test";
  }

  if (
    normalized.startsWith("docs/") ||
    normalized === "README.md" ||
    normalized === "AGENTS.md" ||
    normalized === "agents.md" ||
    normalized === "package.json"
  ) {
    return "spec";
  }

  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".go", ".py"].includes(extension)) {
    return "code";
  }

  return "doc";
}

/**
 * @param {ChunkKind} kind
 */
function defaultSignals(kind) {
  switch (kind) {
    case "code":
      return { certainty: 0.92, recency: 0.75, teachingValue: 0.72, priority: 0.86 };
    case "test":
      return { certainty: 0.93, recency: 0.74, teachingValue: 0.8, priority: 0.84 };
    case "spec":
      return { certainty: 0.88, recency: 0.7, teachingValue: 0.82, priority: 0.78 };
    case "log":
      return { certainty: 0.35, recency: 0.6, teachingValue: 0.1, priority: 0.15 };
    case "chat":
      return { certainty: 0.45, recency: 0.5, teachingValue: 0.25, priority: 0.2 };
    default:
      return { certainty: 0.7, recency: 0.65, teachingValue: 0.6, priority: 0.55 };
  }
}

/**
 * @param {string} source
 */
function isSupportedForSync(source) {
  const normalized = toPosixPath(source);
  const basename = path.basename(normalized);

  if (ALLOWED_FILENAMES.has(basename)) {
    return true;
  }

  return ALLOWED_EXTENSIONS.has(path.extname(normalized));
}

/**
 * @param {string} text
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/gu, " ")
    .split(/\s+/u)
    .filter((entry) => entry.length > 2);
}

/**
 * @param {string} left
 * @param {string} right
 */
function jaccardSimilarity(left, right) {
  const leftSet = new Set(tokenize(left));
  const rightSet = new Set(tokenize(right));

  if (!leftSet.size || !rightSet.size) {
    return 0;
  }

  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;

  return union ? intersection / union : 0;
}

/**
 * Deduplicate within each source file (stable ownership).
 * @param {SyncCandidateChunk[]} candidates
 */
function deduplicateCandidates(candidates) {
  /** @type {Map<string, SyncCandidateChunk[]>} */
  const bySource = new Map();

  for (const candidate of candidates) {
    if (!bySource.has(candidate.source)) {
      bySource.set(candidate.source, []);
    }

    bySource.get(candidate.source)?.push(candidate);
  }

  /** @type {SyncCandidateChunk[]} */
  const unique = [];
  /** @type {SyncDuplicate[]} */
  const duplicates = [];

  for (const [, sourceCandidates] of bySource) {
    /** @type {Map<string, SyncCandidateChunk>} */
    const seenByHash = new Map();
    /** @type {SyncCandidateChunk[]} */
    const uniqueForSource = [];

    for (const candidate of sourceCandidates) {
      const existingHash = seenByHash.get(candidate.contentHash);

      if (existingHash) {
        duplicates.push({
          chunkId: candidate.chunk.id,
          source: candidate.source,
          duplicateOf: existingHash.chunk.id,
          reason: "exact"
        });
        continue;
      }

      /** @type {SyncCandidateChunk | null} */
      let nearMatch = null;

      for (const existing of uniqueForSource) {
        if (existing.chunk.kind !== candidate.chunk.kind) {
          continue;
        }

        if (jaccardSimilarity(existing.chunk.content, candidate.chunk.content) >= NEAR_DUPLICATE_THRESHOLD) {
          nearMatch = existing;
          break;
        }
      }

      if (nearMatch) {
        duplicates.push({
          chunkId: candidate.chunk.id,
          source: candidate.source,
          duplicateOf: nearMatch.chunk.id,
          reason: "near"
        });
        continue;
      }

      seenByHash.set(candidate.contentHash, candidate);
      uniqueForSource.push(candidate);
    }

    unique.push(...uniqueForSource);
  }

  return {
    unique,
    duplicates
  };
}

/**
 * @param {string} filePath
 */
async function loadManifest(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = /** @type {Partial<SyncManifest>} */ (
      JSON.parse(raw.replace(/^\uFEFF/u, ""))
    );

    return {
      schemaVersion: typeof parsed.schemaVersion === "string" ? parsed.schemaVersion : "1.0.0",
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      rootPath: typeof parsed.rootPath === "string" ? parsed.rootPath : "",
      files:
        parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files)
          ? /** @type {SyncManifest["files"]} */ (parsed.files)
          : {}
    };
  } catch {
    return {
      schemaVersion: "1.0.0",
      generatedAt: "",
      projectId: "",
      rootPath: "",
      files: {}
    };
  }
}

/**
 * @param {string} filePath
 * @param {SyncManifest} manifest
 */
async function saveManifest(filePath, manifest) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * @param {SyncCandidateChunk} candidate
 */
function toManifestChecksumEntry(candidate) {
  return [candidate.chunk.id, candidate.contentHash];
}

/**
 * NEXUS:0 canonical internal sync runtime (detect -> chunk -> dedup -> version -> persist).
 *
 * @param {{
 *   rootPath: string,
 *   projectId?: string,
 *   stateFilePath?: string,
 *   manifestFilePath?: string,
 *   versionFilePath?: string,
 *   repositoryBaseDir?: string,
 *   maxCharsPerChunk?: number,
 *   security?: Parameters<typeof resolveSecurityPolicy>[0]
 * }} options
 */
export function createSyncRuntime(options) {
  if (!options || typeof options.rootPath !== "string" || !options.rootPath.trim()) {
    throw new Error("createSyncRuntime requires a rootPath.");
  }

  const rootPath = path.resolve(options.rootPath);
  const projectId = String(options.projectId ?? "nexus").trim() || "nexus";
  const stateFilePath = path.resolve(
    options.stateFilePath ?? path.join(rootPath, ".lcs/sync-change-detector.json")
  );
  const manifestFilePath = path.resolve(
    options.manifestFilePath ?? path.join(rootPath, ".lcs/sync-manifest.json")
  );
  const versionFilePath = path.resolve(
    options.versionFilePath ?? path.join(rootPath, ".lcs/sync-version-tracker.jsonl")
  );
  const repositoryBaseDir = path.resolve(
    options.repositoryBaseDir ?? path.join(rootPath, ".lcs/chunks")
  );
  const maxCharsPerChunk = Math.max(500, Math.trunc(Number(options.maxCharsPerChunk ?? 1800)));
  const securityPolicy = resolveSecurityPolicy(options.security ?? {});
  const changeDetector = createChangeDetector({
    stateFilePath
  });
  const versionTracker = createVersionTracker({
    filePath: versionFilePath
  });
  const repository = createChunkRepository({
    baseDir: repositoryBaseDir
  });

  return {
    rootPath,
    projectId,
    stateFilePath: changeDetector.stateFilePath,
    manifestFilePath,
    versionFilePath: versionTracker.filePath,
    repositoryBaseDir,

    async run() {
      const startedAt = new Date().toISOString();
      const runId = createRunId();
      /** @type {string[]} */
      const errors = [];
      /** @type {string[]} */
      const warnings = [];
      const previousManifest = await loadManifest(manifestFilePath);
      const previousFiles = previousManifest.files ?? {};
      const changeSet = await changeDetector.detectChanges(rootPath);
      const changedPaths = [...changeSet.created, ...changeSet.changed];

      /** @type {Map<string, SyncCandidateChunk[]>} */
      const candidatesBySource = new Map();
      let redactionsApplied = 0;
      let skippedForPolicy = 0;
      let skippedUnsupported = 0;

      for (const source of changedPaths) {
        if (!isSupportedForSync(source)) {
          skippedUnsupported += 1;
          warnings.push(`sync-skip-unsupported:${source}`);

          if (previousFiles[source]) {
            previousFiles[source].updatedAt = new Date().toISOString();
          }
          continue;
        }

        if (shouldIgnoreSensitiveFile(source, securityPolicy)) {
          skippedForPolicy += 1;
          warnings.push(`sync-skip-sensitive:${source}`);
          continue;
        }

        const absolutePath = path.resolve(rootPath, source);
        const kind = classifyKind(source);

        try {
          const raw = await readFile(absolutePath, "utf8");
          const redaction = redactSensitiveContent(raw, securityPolicy);
          redactionsApplied += redaction.redactionCount;
          const processedChunks = chunkDocument(redaction.content, {
            source,
            maxCharsPerChunk
          });
          /** @type {SyncCandidateChunk[]} */
          const candidates = [];

          for (let index = 0; index < processedChunks.length; index += 1) {
            const processed = processedChunks[index];
            const content = String(processed.content ?? "").trim();

            if (!content) {
              continue;
            }

            const chunkId = `${source}::${index}`;
            const contentHash = hashContent(content);
            const signals = defaultSignals(kind);
            const metadataTags = tagChunkMetadata({
              source,
              kind,
              content
            });
            const entities = extractEntities(content);

            candidates.push({
              source,
              contentHash,
              chunk: {
                id: chunkId,
                source,
                kind,
                content,
                ...signals,
                tags: {
                  ...metadataTags,
                  entities,
                  sync: {
                    runId,
                    chunkIndex: index,
                    contentHash,
                    redacted: redaction.redacted
                  }
                }
              }
            });
          }

          candidatesBySource.set(source, candidates);
        } catch (error) {
          errors.push(
            `sync-read-failed:${source}:${error instanceof Error ? error.message : String(error)}`
          );

          if (previousFiles[source]) {
            warnings.push(`sync-retain-previous-manifest:${source}`);
          }
        }
      }

      const candidates = [...candidatesBySource.values()].flat();
      const deduped = deduplicateCandidates(candidates);
      const uniqueCandidates = deduped.unique;

      /** @type {Map<string, SyncCandidateChunk[]>} */
      const uniqueBySource = new Map();

      for (const candidate of uniqueCandidates) {
        if (!uniqueBySource.has(candidate.source)) {
          uniqueBySource.set(candidate.source, []);
        }

        uniqueBySource.get(candidate.source)?.push(candidate);
      }

      let chunksCreated = 0;
      let chunksUpdated = 0;
      let chunksUnchanged = 0;
      /** @type {Chunk[]} */
      const chunksToPersist = [];

      for (const candidate of uniqueCandidates) {
        try {
          const latest = await versionTracker.getLatest(candidate.chunk.id);

          if (latest && latest.checksum === candidate.contentHash) {
            chunksUnchanged += 1;
            continue;
          }

          await versionTracker.recordVersion({
            documentId: candidate.chunk.id,
            source: candidate.chunk.source,
            checksum: candidate.contentHash,
            metadata: {
              runId,
              projectId,
              kind: candidate.chunk.kind
            }
          });

          if (latest) {
            chunksUpdated += 1;
          } else {
            chunksCreated += 1;
          }

          chunksToPersist.push(candidate.chunk);
        } catch (error) {
          errors.push(
            `sync-version-failed:${candidate.chunk.id}:${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      let chunksPersisted = 0;

      if (chunksToPersist.length) {
        try {
          const saved = await repository.save(projectId, chunksToPersist);
          chunksPersisted = saved.saved;
        } catch (error) {
          errors.push(`sync-persist-failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      /** @type {SyncManifest["files"]} */
      const nextFiles = {};

      for (const source of changeSet.unchanged) {
        if (source in previousFiles) {
          nextFiles[source] = previousFiles[source];
        }
      }

      for (const source of changedPaths) {
        if (!candidatesBySource.has(source)) {
          if (source in previousFiles) {
            nextFiles[source] = previousFiles[source];
          }
          continue;
        }

        const sourceUnique = uniqueBySource.get(source) ?? [];

        nextFiles[source] = {
          chunkIds: sourceUnique.map((entry) => entry.chunk.id),
          checksums: Object.fromEntries(sourceUnique.map(toManifestChecksumEntry)),
          updatedAt: new Date().toISOString()
        };
      }

      /** @type {Set<string>} */
      const removedChunkIds = new Set();

      for (const source of [...changedPaths, ...changeSet.deleted]) {
        const previousChunkIds = previousFiles[source]?.chunkIds ?? [];
        const nextChunkIds = new Set(nextFiles[source]?.chunkIds ?? []);

        for (const chunkId of previousChunkIds) {
          if (!nextChunkIds.has(chunkId)) {
            removedChunkIds.add(chunkId);
          }
        }
      }

      let chunksTombstoned = 0;

      if (removedChunkIds.size) {
        try {
          const removed = await repository.remove(projectId, [...removedChunkIds]);
          chunksTombstoned = removed.removed;
        } catch (error) {
          errors.push(
            `sync-remove-failed:${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      const manifest = {
        schemaVersion: "1.0.0",
        generatedAt: new Date().toISOString(),
        projectId,
        rootPath,
        files: nextFiles
      };
      await saveManifest(manifestFilePath, manifest);

      const finishedAt = new Date().toISOString();
      const filesChanged = changeSet.summary.created + changeSet.summary.changed + changeSet.summary.deleted;
      const summary = {
        discovered: changeSet.summary.discovered,
        created: changeSet.summary.created,
        changed: changeSet.summary.changed,
        deleted: changeSet.summary.deleted,
        unchanged: changeSet.summary.unchanged,
        filesChanged,
        filesSkipped: changeSet.summary.unchanged + skippedForPolicy + skippedUnsupported,
        chunksProcessed: candidates.length,
        chunksPersisted,
        chunksCreated,
        chunksUpdated,
        chunksUnchanged,
        chunksTombstoned,
        duplicatesDetected: deduped.duplicates.length,
        redactionsApplied
      };

      let status = "ok";

      if (errors.length) {
        status = chunksPersisted > 0 || chunksTombstoned > 0 ? "partial" : "error";
      }

      return {
        status,
        runId,
        startedAt,
        finishedAt,
        rootPath,
        stateFilePath: changeDetector.stateFilePath,
        manifestFilePath,
        versionFilePath: versionTracker.filePath,
        projectId,
        summary,
        files: {
          created: changeSet.created,
          changed: changeSet.changed,
          deleted: changeSet.deleted,
          unchanged: changeSet.unchanged
        },
        duplicates: deduped.duplicates,
        errors,
        warnings,
        runtime: {
          engine: "nexus-sync-internal",
          dedupScope: "per-source",
          repositoryBaseDir
        }
      };
    }
  };
}
