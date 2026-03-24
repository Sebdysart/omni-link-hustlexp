import { describe, it, expect } from 'vitest';
import { Task } from '../../engine/ruflo/task-execution/domain/Task.js';

describe('ruflo Task', () => {
  it('creates a task from config', () => {
    const task = new Task({
      id: 'task-1',
      type: 'code',
      description: 'Implement feature',
      priority: 'high',
    });

    expect(task.id).toBe('task-1');
    expect(task.type).toBe('code');
    expect(task.status).toBe('pending');
    expect(task.priority).toBe('high');
  });

  it('transitions through lifecycle states', () => {
    const task = new Task({
      id: 'task-2',
      type: 'test',
      description: 'Run tests',
      priority: 'medium',
    });

    expect(task.status).toBe('pending');

    task.start();
    expect(task.status).toBe('in-progress');

    task.complete();
    expect(task.status).toBe('completed');
  });

  it('tracks duration', () => {
    const task = new Task({
      id: 'task-3',
      type: 'code',
      description: 'Write code',
      priority: 'low',
    });

    expect(task.getDuration()).toBeUndefined();

    task.start();
    expect(task.getDuration()).toBeGreaterThanOrEqual(0);
  });

  it('sorts tasks by priority', () => {
    const tasks = [
      new Task({ id: 't1', type: 'code', description: 'Low', priority: 'low' }),
      new Task({ id: 't2', type: 'code', description: 'High', priority: 'high' }),
      new Task({ id: 't3', type: 'code', description: 'Med', priority: 'medium' }),
    ];

    const sorted = Task.sortByPriority(tasks);
    expect(sorted[0].priority).toBe('high');
    expect(sorted[1].priority).toBe('medium');
    expect(sorted[2].priority).toBe('low');
  });

  it('resolves execution order with dependencies', () => {
    const tasks = [
      new Task({
        id: 'deploy',
        type: 'deploy',
        description: 'Deploy',
        priority: 'high',
        dependencies: ['test'],
      }),
      new Task({
        id: 'test',
        type: 'test',
        description: 'Test',
        priority: 'medium',
        dependencies: ['code'],
      }),
      new Task({
        id: 'code',
        type: 'code',
        description: 'Code',
        priority: 'low',
      }),
    ];

    const ordered = Task.resolveExecutionOrder(tasks);
    expect(ordered[0].id).toBe('code');
    expect(ordered[1].id).toBe('test');
    expect(ordered[2].id).toBe('deploy');
  });

  it('detects circular dependencies', () => {
    const tasks = [
      new Task({
        id: 'a',
        type: 'code',
        description: 'A',
        priority: 'high',
        dependencies: ['b'],
      }),
      new Task({
        id: 'b',
        type: 'code',
        description: 'B',
        priority: 'high',
        dependencies: ['a'],
      }),
    ];

    expect(() => Task.resolveExecutionOrder(tasks)).toThrow('Circular dependency');
  });

  it('identifies workflow tasks', () => {
    const regular = new Task({
      id: 'regular',
      type: 'code',
      description: 'Regular task',
      priority: 'medium',
    });

    const workflow = new Task({
      id: 'wf',
      type: 'workflow',
      description: 'Workflow task',
      priority: 'high',
      workflow: {
        id: 'wf-def',
        name: 'Test Workflow',
        tasks: [],
      },
    });

    expect(regular.isWorkflow()).toBe(false);
    expect(workflow.isWorkflow()).toBe(true);
  });

  it('serializes to JSON', () => {
    const task = new Task({
      id: 'task-json',
      type: 'review',
      description: 'Review PR',
      priority: 'high',
      metadata: { prNumber: 42 },
    });

    const json = task.toJSON();
    expect(json.id).toBe('task-json');
    expect(json.type).toBe('review');
    expect(json.metadata?.prNumber).toBe(42);
  });
});
