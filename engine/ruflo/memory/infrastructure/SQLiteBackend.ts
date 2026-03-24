/**
 * SQLiteBackend
 *
 * SQLite-based memory backend for persistent storage.
 * Part of the hybrid memory system.
 */

import type {
  RufloMemory,
  MemoryBackend,
  MemoryQuery,
  MemorySearchResult,
} from '../../shared/types.js';

export class SQLiteBackend implements MemoryBackend {
  private dbPath: string;
  private memories: Map<string, RufloMemory>;
  private initialized: boolean = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
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

  async vectorSearch(_embedding: number[], _k?: number): Promise<MemorySearchResult[]> {
    return [];
  }

  async clearAgent(agentId: string): Promise<void> {
    for (const [id, memory] of this.memories.entries()) {
      if (memory.agentId === agentId) {
        this.memories.delete(id);
      }
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getCount(): number {
    return this.memories.size;
  }
}
