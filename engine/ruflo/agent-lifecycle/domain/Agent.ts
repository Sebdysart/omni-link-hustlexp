/**
 * Agent Domain Entity
 *
 * Represents an AI agent in the ruflo orchestration system.
 */

import type {
  RufloAgent,
  AgentConfig,
  AgentStatus,
  AgentType,
  AgentRole,
  RufloTask,
  TaskResult,
} from '../../shared/types.js';

export class Agent implements RufloAgent {
  public readonly id: string;
  public readonly type: AgentType;
  public status: AgentStatus;
  public capabilities: string[];
  public role?: AgentRole;
  public parent?: string;
  public metadata?: Record<string, unknown>;
  public createdAt: number;
  public lastActive: number;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.type = config.type;
    this.status = 'active';
    this.capabilities = config.capabilities || [];
    this.role = config.role;
    this.parent = config.parent;
    this.metadata = config.metadata || {};
    this.createdAt = Date.now();
    this.lastActive = Date.now();
  }

  async executeTask(task: RufloTask): Promise<TaskResult> {
    if (this.status !== 'active' && this.status !== 'idle') {
      return {
        taskId: task.id,
        status: 'failed',
        error: `Agent ${this.id} is not available (status: ${this.status})`,
        agentId: this.id,
      };
    }

    const startTime = Date.now();
    this.status = 'busy';
    this.lastActive = startTime;

    try {
      if (task.onExecute) {
        await task.onExecute();
      }

      await this.processTaskExecution(task);

      const duration = Date.now() - startTime;
      this.status = 'active';
      this.lastActive = Date.now();

      return {
        taskId: task.id,
        status: 'completed',
        result: `Task ${task.id} completed successfully`,
        duration,
        agentId: this.id,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.status = 'active';

      return {
        taskId: task.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        duration,
        agentId: this.id,
      };
    }
  }

  private async processTaskExecution(task: RufloTask): Promise<void> {
    const processingTime: Record<string, number> = {
      high: 1,
      medium: 5,
      low: 10,
    };
    const overhead = processingTime[task.priority] || 5;
    await new Promise((resolve) => setTimeout(resolve, overhead));
  }

  hasCapability(capability: string): boolean {
    return this.capabilities.includes(capability);
  }

  canExecute(taskType: string): boolean {
    const typeToCapability: Record<string, string> = {
      code: 'code',
      test: 'test',
      review: 'review',
      design: 'design',
      deploy: 'deploy',
      refactor: 'refactor',
      debug: 'debug',
    };

    const requiredCapability = typeToCapability[taskType];
    return requiredCapability ? this.hasCapability(requiredCapability) : true;
  }

  terminate(): void {
    this.status = 'terminated';
    this.lastActive = Date.now();
  }

  setIdle(): void {
    if (this.status === 'active' || this.status === 'busy') {
      this.status = 'idle';
      this.lastActive = Date.now();
    }
  }

  activate(): void {
    if (this.status !== 'terminated') {
      this.status = 'active';
      this.lastActive = Date.now();
    }
  }

  toJSON(): RufloAgent {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      capabilities: this.capabilities,
      role: this.role,
      parent: this.parent,
      metadata: this.metadata,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
    };
  }

  static fromConfig(config: AgentConfig): Agent {
    return new Agent(config);
  }
}
