/**
 * HybridBackend
 *
 * Combines SQLite for structured queries with AgentDB for vector search.
 */

import type {
  RufloMemory,
  MemoryBackend,
  MemoryQuery,
  MemorySearchResult,
} from '../../shared/types.js';
import { SQLiteBackend } from './SQLiteBackend.js';
import { AgentDBBackend } from './AgentDBBackend.js';

export class HybridBackend implements MemoryBackend {
  private sqliteBackend: SQLiteBackend;
  private agentDbBackend: AgentDBBackend;
  private initialized: boolean = false;

  constructor(sqliteBackend: SQLiteBackend, agentDbBackend: AgentDBBackend) {
    this.sqliteBackend = sqliteBackend;
    this.agentDbBackend = agentDbBackend;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Promise.all([this.sqliteBackend.initialize(), this.agentDbBackend.initialize()]);

    this.initialized = true;
  }

  async close(): Promise<void> {
    await Promise.all([this.sqliteBackend.close(), this.agentDbBackend.close()]);
    this.initialized = false;
  }

  async store(memory: RufloMemory): Promise<RufloMemory> {
    await this.sqliteBackend.store(memory);

    if (memory.embedding && memory.embedding.length > 0) {
      await this.agentDbBackend.store(memory);
    }

    return memory;
  }

  async retrieve(id: string): Promise<RufloMemory | undefined> {
    return this.sqliteBackend.retrieve(id);
  }

  async update(memory: RufloMemory): Promise<void> {
    await this.sqliteBackend.update(memory);

    if (memory.embedding && memory.embedding.length > 0) {
      await this.agentDbBackend.update(memory);
    }
  }

  async delete(id: string): Promise<void> {
    await Promise.all([this.sqliteBackend.delete(id), this.agentDbBackend.delete(id)]);
  }

  async query(query: MemoryQuery): Promise<RufloMemory[]> {
    return this.sqliteBackend.query(query);
  }

  async vectorSearch(embedding: number[], k: number = 10): Promise<MemorySearchResult[]> {
    return this.agentDbBackend.vectorSearch(embedding, k);
  }

  async clearAgent(agentId: string): Promise<void> {
    await Promise.all([
      this.sqliteBackend.clearAgent(agentId),
      this.agentDbBackend.clearAgent(agentId),
    ]);
  }

  async hybridSearch(
    query: MemoryQuery,
    embedding?: number[],
    k: number = 10,
  ): Promise<MemorySearchResult[]> {
    if (!embedding) {
      const results = await this.query(query);
      return results.map((m) => ({ ...m, similarity: 1.0 }));
    }

    const vectorResults = await this.vectorSearch(embedding, k * 2);

    let filtered = vectorResults;

    if (query.agentId) {
      filtered = filtered.filter((m) => m.agentId === query.agentId);
    }
    if (query.type) {
      filtered = filtered.filter((m) => m.type === query.type);
    }
    if (query.timeRange) {
      filtered = filtered.filter(
        (m) => m.timestamp >= query.timeRange!.start && m.timestamp <= query.timeRange!.end,
      );
    }
    if (query.metadata) {
      filtered = filtered.filter((m) => {
        if (!m.metadata) return false;
        return Object.entries(query.metadata!).every(([key, value]) => m.metadata![key] === value);
      });
    }

    return filtered.slice(0, k);
  }

  getStats(): { sqlite: number; agentdb: number } {
    return {
      sqlite: this.sqliteBackend.getCount(),
      agentdb: 0,
    };
  }
}
