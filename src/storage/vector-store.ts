export interface VectorStoreRecord {
  id: string;
  text: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  record: VectorStoreRecord;
}

export interface VectorStore {
  upsert(record: VectorStoreRecord): Promise<VectorStoreRecord>;
  search(vector: number[], options?: { limit?: number }): Promise<VectorSearchResult[]>;
  remove(id: string): Promise<boolean>;
  list(): Promise<VectorStoreRecord[]>;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);

  if (!length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(left[index]) ? left[index] : 0;
    const rightValue = Number.isFinite(right[index]) ? right[index] : 0;

    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (!leftNorm || !rightNorm) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function createInMemoryVectorStore(): VectorStore {
  const records = new Map<string, VectorStoreRecord>();

  return {
    async upsert(record) {
      if (!record.id || !record.text || !Array.isArray(record.vector) || !record.vector.length) {
        throw new Error("Vector record must include id, text and a non-empty vector.");
      }

      records.set(record.id, {
        ...record,
        vector: [...record.vector]
      });
      return records.get(record.id)!;
    },

    async search(vector, options = {}) {
      const limit = Math.max(1, Math.trunc(options.limit ?? 5));
      const scored = [...records.values()]
        .map((record) => ({
          id: record.id,
          record,
          score: Number(cosineSimilarity(vector, record.vector).toFixed(6))
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);

      return scored;
    },

    async remove(id) {
      return records.delete(id);
    },

    async list() {
      return [...records.values()];
    }
  };
}
