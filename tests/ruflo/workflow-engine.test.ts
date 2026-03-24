import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SwarmCoordinator } from '../../engine/ruflo/coordination/application/SwarmCoordinator.js';
import { WorkflowEngine } from '../../engine/ruflo/task-execution/application/WorkflowEngine.js';
import { SQLiteBackend } from '../../engine/ruflo/memory/infrastructure/SQLiteBackend.js';

describe('ruflo WorkflowEngine', () => {
  let coordinator: SwarmCoordinator;
  let engine: WorkflowEngine;
  let memoryBackend: SQLiteBackend;

  beforeEach(async () => {
    memoryBackend = new SQLiteBackend(':memory:');
    await memoryBackend.initialize();
    coordinator = new SwarmCoordinator({
      topology: 'hierarchical',
      memoryBackend,
    });
    await coordinator.initialize();
    engine = new WorkflowEngine({
      coordinator,
      memoryBackend,
    });
    await engine.initialize();

    await coordinator.spawnAgent({
      id: 'wf-coder',
      type: 'coder',
      capabilities: ['code', 'refactor'],
    });
    await coordinator.spawnAgent({
      id: 'wf-tester',
      type: 'tester',
      capabilities: ['test', 'validate'],
    });
  });

  afterEach(async () => {
    await engine.shutdown();
    await coordinator.shutdown();
    await memoryBackend.close();
  });

  it('executes a simple workflow', async () => {
    const result = await engine.executeWorkflow({
      id: 'wf-1',
      name: 'Simple Workflow',
      tasks: [
        { id: 'wf1-t1', type: 'code', description: 'Write code', priority: 'high' },
        { id: 'wf1-t2', type: 'test', description: 'Test code', priority: 'medium' },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.tasksCompleted).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('executes tasks in dependency order', async () => {
    const result = await engine.executeWorkflow({
      id: 'wf-deps',
      name: 'Dependency Workflow',
      tasks: [
        {
          id: 'deploy',
          type: 'code',
          description: 'Deploy',
          priority: 'high',
          dependencies: ['test'],
        },
        {
          id: 'test',
          type: 'test',
          description: 'Test',
          priority: 'medium',
          dependencies: ['code'],
        },
        { id: 'code', type: 'code', description: 'Code', priority: 'low' },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.executionOrder).toEqual(['code', 'test', 'deploy']);
  });

  it('executes a task on a specific agent', async () => {
    const result = await engine.executeTask(
      { id: 'single-task', type: 'code', description: 'Single', priority: 'high' },
      'wf-coder',
    );

    expect(result.status).toBe('completed');
    expect(result.agentId).toBe('wf-coder');
  });

  it('stores task events in memory', async () => {
    await engine.executeTask(
      { id: 'mem-task', type: 'code', description: 'Memory task', priority: 'high' },
      'wf-coder',
    );

    const memories = await memoryBackend.query({ type: 'task-start' });
    expect(memories.length).toBeGreaterThanOrEqual(1);

    const completions = await memoryBackend.query({ type: 'task-complete' });
    expect(completions.length).toBeGreaterThanOrEqual(1);
  });

  it('handles rollback on failure', async () => {
    let rollbackCalled = false;

    const result = await engine.executeWorkflow({
      id: 'wf-rollback',
      name: 'Rollback Workflow',
      rollbackOnFailure: true,
      tasks: [
        {
          id: 'good-task',
          type: 'code',
          description: 'Success task',
          priority: 'high',
          onRollback: () => {
            rollbackCalled = true;
          },
        },
        {
          id: 'bad-task',
          type: 'code',
          description: 'Failing task',
          priority: 'high',
          onExecute: () => {
            throw new Error('Intentional failure');
          },
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(rollbackCalled).toBe(true);
  });

  it('executes tasks in parallel', async () => {
    const results = await engine.executeParallel([
      { id: 'par-1', type: 'code', description: 'Parallel 1', priority: 'high' },
      { id: 'par-2', type: 'test', description: 'Parallel 2', priority: 'high' },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'completed')).toBe(true);
  });

  it('tracks workflow state', async () => {
    const promise = engine.startWorkflow({
      id: 'wf-state',
      name: 'State Workflow',
      tasks: [{ id: 'st-1', type: 'code', description: 'State task', priority: 'high' }],
    });

    await promise;

    const state = await engine.getWorkflowState('wf-state');
    expect(state.status).toBe('completed');
    expect(state.completedTasks).toContain('st-1');
  });

  it('computes workflow metrics', async () => {
    await engine.executeWorkflow({
      id: 'wf-metrics',
      name: 'Metrics Workflow',
      tasks: [
        { id: 'met-1', type: 'code', description: 'Metric 1', priority: 'high' },
        { id: 'met-2', type: 'test', description: 'Metric 2', priority: 'medium' },
      ],
    });

    const metrics = await engine.getWorkflowMetrics('wf-metrics');
    expect(metrics.tasksTotal).toBe(2);
    expect(metrics.tasksCompleted).toBe(2);
    expect(metrics.successRate).toBe(1.0);
    expect(metrics.totalDuration).toBeGreaterThanOrEqual(0);
  });
});
