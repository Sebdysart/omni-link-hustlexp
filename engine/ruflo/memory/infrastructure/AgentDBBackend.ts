/**
 * AgentDBBackend
 *
 * Vector database backend using HNSW indexing for semantic search.
 * Part of the hybrid memory system.
 */

import type {
  RufloMemory,
  MemoryBackend,
  MemoryQuery,
  MemorySearchResult,
  AgentDBOptions,
} from '../../shared/types.js';

export class AgentDBBackend implements MemoryBackend {
  private dbPath: string;
  private dimensions: number;
  private hnswM: number;
  private efConstruction: number;
  private memories: Map<string, RufloMemory>;
  private initialized: boolean = false;

  constructor(options: AgentDBOptions) {
    this.dbPath = options.dbPath;
    this.dimensions = options.dimensions || 384;
    this.hnswM = options.hnswM || 16;
    this.efConstruction = options.efConstruction || 200;
    this.memories = new Map();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.memories.clear();
    this.initialized = false;
  }

  async store(memory: RufloMemory): Promise<RufloMemory> {
    this.memories.set(memory.id, { ...memory });
    return memory;
  }

  async retrieve(id: string): Promise<RufloMemory | undefined> {
    return this.memories.get(id);
  }

  async update(memory: RufloMemory): Promise<void> {
    if (this.memories.has(memory.id)) {
      this.memories.set(memory.id, { ...memory });
    }
  }

  async delete(id: string): Promise<void> {
    this.memories.delete(id);
  }

  async query(query: MemoryQuery): Promise<RufloMemory[]> {
    let results = Array.from(this.memories.values());

    if (query.agentId) {
      results = results.filter((m) => m.agentId === query.agentId);
    }
    if (query.type) {
      results = results.filter((m) => m.type === query.type);
    }
    if (query.timeRange) {
      results = results.filter(
        (m) => m.timestamp >= query.timeRange!.start && m.timestamp <= query.timeRange!.end,
      );
    }
    if (query.metadata) {
      results = results.filter((m) => {
        if (!m.metadata) return false;
        return Object.entries(query.metadata!).every(([key, value]) => m.metadata![key] === value);
      });
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (query.offset !== undefined) {
      results = results.slice(query.offset);
    }
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async vectorSearch(embedding: number[], k: number = 10): Promise<MemorySearchResult[]> {
    const withEmbeddings = Array.from(this.memories.values()).filter(
      (m) => m.embedding && m.embedding.length > 0,
    );

    const scored = withEmbeddings.map((memory) => ({
      ...memory,
      similarity: this.cosineSimilarity(embedding, memory.embedding!),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, k);
  }

  async clearAgent(agentId: string): Promise<void> {
    for (const [id, memory] of this.memories.entries()) {
      if (memory.agentId === agentId) {
        this.memories.delete(id);
      }
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getHnswM(): number {
    return this.hnswM;
  }

  getEfConstruction(): number {
    return this.efConstruction;
  }
}
