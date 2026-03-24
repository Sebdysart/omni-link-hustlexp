import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEntity } from '../../engine/ruflo/memory/domain/Memory.js';
import { SQLiteBackend } from '../../engine/ruflo/memory/infrastructure/SQLiteBackend.js';
import { AgentDBBackend } from '../../engine/ruflo/memory/infrastructure/AgentDBBackend.js';
import { HybridBackend } from '../../engine/ruflo/memory/infrastructure/HybridBackend.js';

describe('ruflo Memory', () => {
  describe('MemoryEntity', () => {
    it('creates a memory entity', () => {
      const memory = new MemoryEntity({
        id: 'mem-1',
        agentId: 'agent-1',
        content: 'Test memory',
        type: 'context',
        timestamp: Date.now(),
      });

      expect(memory.id).toBe('mem-1');
      expect(memory.agentId).toBe('agent-1');
      expect(memory.content).toBe('Test memory');
      expect(memory.hasEmbedding()).toBe(false);
    });

    it('handles embeddings', () => {
      const memory = new MemoryEntity({
        id: 'mem-2',
        agentId: 'agent-1',
        content: 'Embedded memory',
        type: 'context',
        timestamp: Date.now(),
        embedding: [0.1, 0.2, 0.3],
      });

      expect(memory.hasEmbedding()).toBe(true);
      expect(memory.getEmbeddingDimension()).toBe(3);
    });

    it('creates task memory', () => {
      const memory = MemoryEntity.createTaskMemory('agent-1', 'Task done', 'task-1');
      expect(memory.type).toBe('task');
      expect(memory.agentId).toBe('agent-1');
      expect(memory.metadata?.taskId).toBe('task-1');
    });

    it('creates context memory', () => {
      const memory = MemoryEntity.createContextMemory('agent-1', 'Project context');
      expect(memory.type).toBe('context');
    });

    it('creates event memory', () => {
      const memory = MemoryEntity.createEventMemory('agent-1', 'spawn', 'Agent spawned');
      expect(memory.type).toBe('event');
      expect(memory.metadata?.eventType).toBe('spawn');
    });

    it('matches queries', () => {
      const memory = new MemoryEntity({
        id: 'match-1',
        agentId: 'agent-1',
        content: 'Matchable',
        type: 'task',
        timestamp: Date.now(),
      });

      expect(memory.matches({ agentId: 'agent-1' })).toBe(true);
      expect(memory.matches({ agentId: 'agent-2' })).toBe(false);
      expect(memory.matches({ type: 'task' })).toBe(true);
      expect(memory.matches({ type: 'event' })).toBe(false);
    });
  });

  describe('SQLiteBackend', () => {
    let backend: SQLiteBackend;

    beforeEach(async () => {
      backend = new SQLiteBackend(':memory:');
      await backend.initialize();
    });

    afterEach(async () => {
      await backend.close();
    });

    it('stores and retrieves memories', async () => {
      await backend.store({
        id: 'sql-1',
        agentId: 'agent-1',
        content: 'SQL memory',
        type: 'context',
        timestamp: Date.now(),
      });

      const retrieved = await backend.retrieve('sql-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('SQL memory');
    });

    it('queries memories with filters', async () => {
      await backend.store({
        id: 'q-1',
        agentId: 'agent-1',
        content: 'Agent 1 task',
        type: 'task',
        timestamp: Date.now(),
      });
      await backend.store({
        id: 'q-2',
        agentId: 'agent-2',
        content: 'Agent 2 event',
        type: 'event',
        timestamp: Date.now(),
      });

      const agent1Memories = await backend.query({ agentId: 'agent-1' });
      expect(agent1Memories).toHaveLength(1);

      const taskMemories = await backend.query({ type: 'task' });
      expect(taskMemories).toHaveLength(1);
    });

    it('deletes memories', async () => {
      await backend.store({
        id: 'del-1',
        agentId: 'agent-1',
        content: 'To delete',
        type: 'context',
        timestamp: Date.now(),
      });

      await backend.delete('del-1');
      const retrieved = await backend.retrieve('del-1');
      expect(retrieved).toBeUndefined();
    });

    it('clears agent memories', async () => {
      await backend.store({
        id: 'clear-1',
        agentId: 'agent-clear',
        content: 'Memory 1',
        type: 'context',
        timestamp: Date.now(),
      });
      await backend.store({
        id: 'clear-2',
        agentId: 'agent-clear',
        content: 'Memory 2',
        type: 'task',
        timestamp: Date.now(),
      });

      await backend.clearAgent('agent-clear');
      const remaining = await backend.query({ agentId: 'agent-clear' });
      expect(remaining).toHaveLength(0);
    });
  });

  describe('AgentDBBackend', () => {
    let backend: AgentDBBackend;

    beforeEach(async () => {
      backend = new AgentDBBackend({ dbPath: ':memory:', dimensions: 3 });
      await backend.initialize();
    });

    afterEach(async () => {
      await backend.close();
    });

    it('performs vector search', async () => {
      await backend.store({
        id: 'vec-1',
        agentId: 'agent-1',
        content: 'Similar to query',
        type: 'context',
        timestamp: Date.now(),
        embedding: [1.0, 0.0, 0.0],
      });
      await backend.store({
        id: 'vec-2',
        agentId: 'agent-1',
        content: 'Dissimilar',
        type: 'context',
        timestamp: Date.now(),
        embedding: [0.0, 0.0, 1.0],
      });

      const results = await backend.vectorSearch([1.0, 0.0, 0.0], 2);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('vec-1');
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity!);
    });
  });

  describe('HybridBackend', () => {
    let hybrid: HybridBackend;
    let sqlite: SQLiteBackend;
    let agentdb: AgentDBBackend;

    beforeEach(async () => {
      sqlite = new SQLiteBackend(':memory:');
      agentdb = new AgentDBBackend({ dbPath: ':memory:', dimensions: 3 });
      hybrid = new HybridBackend(sqlite, agentdb);
      await hybrid.initialize();
    });

    afterEach(async () => {
      await hybrid.close();
    });

    it('stores in both backends when embedding present', async () => {
      await hybrid.store({
        id: 'hybrid-1',
        agentId: 'agent-1',
        content: 'Hybrid memory',
        type: 'context',
        timestamp: Date.now(),
        embedding: [1.0, 0.0, 0.0],
      });

      const fromSql = await sqlite.retrieve('hybrid-1');
      expect(fromSql).toBeDefined();

      const vectorResults = await agentdb.vectorSearch([1.0, 0.0, 0.0], 1);
      expect(vectorResults).toHaveLength(1);
    });

    it('queries through SQL', async () => {
      await hybrid.store({
        id: 'hq-1',
        agentId: 'agent-1',
        content: 'Query target',
        type: 'task',
        timestamp: Date.now(),
      });

      const results = await hybrid.query({ type: 'task' });
      expect(results).toHaveLength(1);
    });

    it('performs hybrid search', async () => {
      await hybrid.store({
        id: 'hs-1',
        agentId: 'agent-1',
        content: 'Searchable',
        type: 'context',
        timestamp: Date.now(),
        embedding: [1.0, 0.0, 0.0],
      });

      const results = await hybrid.hybridSearch({ agentId: 'agent-1' }, [1.0, 0.0, 0.0], 10);

      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBeGreaterThan(0);
    });

    it('reports stats', () => {
      const stats = hybrid.getStats();
      expect(stats).toHaveProperty('sqlite');
      expect(stats).toHaveProperty('agentdb');
    });
  });
});
