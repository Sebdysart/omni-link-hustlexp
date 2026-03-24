/**
 * Memory Domain Entity
 *
 * Represents a memory entry in the ruflo system.
 */

import type { RufloMemory, MemoryType } from '../../shared/types.js';

export class MemoryEntity implements RufloMemory {
  public readonly id: string;
  public readonly agentId: string;
  public content: string;
  public readonly type: MemoryType;
  public readonly timestamp: number;
  public embedding?: number[];
  public metadata?: Record<string, unknown>;

  constructor(config: RufloMemory) {
    this.id = config.id;
    this.agentId = config.agentId;
    this.content = config.content;
    this.type = config.type;
    this.timestamp = config.timestamp || Date.now();
    this.embedding = config.embedding;
    this.metadata = config.metadata || {};
  }

  hasEmbedding(): boolean {
    return this.embedding !== undefined && this.embedding.length > 0;
  }

  getEmbeddingDimension(): number | undefined {
    return this.embedding?.length;
  }

  updateContent(content: string): void {
    this.content = content;
  }

  setEmbedding(embedding: number[]): void {
    this.embedding = embedding;
  }

  updateMetadata(metadata: Record<string, unknown>): void {
    this.metadata = { ...this.metadata, ...metadata };
  }

  matches(query: Partial<RufloMemory>): boolean {
    if (query.agentId && this.agentId !== query.agentId) return false;
    if (query.type && this.type !== query.type) return false;
    if (query.id && this.id !== query.id) return false;
    return true;
  }

  getAge(): number {
    return Date.now() - this.timestamp;
  }

  toJSON(): RufloMemory {
    return {
      id: this.id,
      agentId: this.agentId,
      content: this.content,
      type: this.type,
      timestamp: this.timestamp,
      embedding: this.embedding,
      metadata: this.metadata,
    };
  }

  static fromConfig(config: RufloMemory): MemoryEntity {
    return new MemoryEntity(config);
  }

  static createTaskMemory(agentId: string, content: string, taskId: string): MemoryEntity {
    return new MemoryEntity({
      id: `task-${taskId}-${Date.now()}`,
      agentId,
      content,
      type: 'task',
      timestamp: Date.now(),
      metadata: { taskId },
    });
  }

  static createContextMemory(agentId: string, content: string): MemoryEntity {
    return new MemoryEntity({
      id: `context-${Date.now()}`,
      agentId,
      content,
      type: 'context',
      timestamp: Date.now(),
    });
  }

  static createEventMemory(agentId: string, eventType: string, content: string): MemoryEntity {
    return new MemoryEntity({
      id: `event-${Date.now()}`,
      agentId,
      content,
      type: 'event',
      timestamp: Date.now(),
      metadata: { eventType },
    });
  }
}
