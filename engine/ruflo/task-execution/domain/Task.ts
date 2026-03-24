/**
 * Task Domain Entity
 *
 * Represents a task to be executed by agents in the ruflo system.
 */

import type {
  RufloTask,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkflowDefinition,
} from '../../shared/types.js';

export class Task implements RufloTask {
  public readonly id: string;
  public readonly type: TaskType;
  public description: string;
  public priority: TaskPriority;
  public status: TaskStatus;
  public assignedTo?: string;
  public dependencies: string[];
  public metadata?: Record<string, unknown>;
  public workflow?: WorkflowDefinition;
  public onExecute?: () => void | Promise<void>;
  public onRollback?: () => void | Promise<void>;

  private startedAt?: number;
  private completedAt?: number;

  constructor(config: RufloTask) {
    this.id = config.id;
    this.type = config.type;
    this.description = config.description;
    this.priority = config.priority;
    this.status = config.status || 'pending';
    this.assignedTo = config.assignedTo;
    this.dependencies = config.dependencies || [];
    this.metadata = config.metadata || {};
    this.workflow = config.workflow;
    this.onExecute = config.onExecute;
    this.onRollback = config.onRollback;
  }

  areDependenciesResolved(completedTasks: Set<string>): boolean {
    return this.dependencies.every((dep) => completedTasks.has(dep));
  }

  start(): void {
    if (this.status === 'pending') {
      this.status = 'in-progress';
      this.startedAt = Date.now();
    }
  }

  complete(): void {
    if (this.status === 'in-progress') {
      this.status = 'completed';
      this.completedAt = Date.now();
    }
  }

  fail(error?: string): void {
    this.status = 'failed';
    this.completedAt = Date.now();
    if (error && this.metadata) {
      this.metadata.error = error;
    }
  }

  cancel(): void {
    if (this.status !== 'completed' && this.status !== 'failed') {
      this.status = 'cancelled';
      this.completedAt = Date.now();
    }
  }

  getDuration(): number | undefined {
    if (this.startedAt && this.completedAt) {
      return this.completedAt - this.startedAt;
    }
    if (this.startedAt) {
      return Date.now() - this.startedAt;
    }
    return undefined;
  }

  isWorkflow(): boolean {
    return this.type === 'workflow' && this.workflow !== undefined;
  }

  assignTo(agentId: string): void {
    this.assignedTo = agentId;
  }

  getPriorityValue(): number {
    const values: Record<TaskPriority, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };
    return values[this.priority] || 2;
  }

  toJSON(): RufloTask {
    return {
      id: this.id,
      type: this.type,
      description: this.description,
      priority: this.priority,
      status: this.status,
      assignedTo: this.assignedTo,
      dependencies: this.dependencies,
      metadata: {
        ...this.metadata,
        startedAt: this.startedAt,
        completedAt: this.completedAt,
        duration: this.getDuration(),
      },
      workflow: this.workflow,
    };
  }

  static fromConfig(config: RufloTask): Task {
    return new Task(config);
  }

  static sortByPriority(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => b.getPriorityValue() - a.getPriorityValue());
  }

  static resolveExecutionOrder(tasks: Task[]): Task[] {
    const resolved: Task[] = [];
    const resolvedIds = new Set<string>();
    const remaining = [...tasks];

    while (remaining.length > 0) {
      const ready = remaining.filter((task) => task.areDependenciesResolved(resolvedIds));

      if (ready.length === 0 && remaining.length > 0) {
        throw new Error('Circular dependency detected in tasks');
      }

      const sorted = Task.sortByPriority(ready);

      for (const task of sorted) {
        resolved.push(task);
        resolvedIds.add(task.id);
        const index = remaining.indexOf(task);
        if (index > -1) {
          remaining.splice(index, 1);
        }
      }
    }

    return resolved;
  }
}
