import { describe, it, expect } from 'vitest';
import { Agent } from '../../engine/ruflo/agent-lifecycle/domain/Agent.js';

describe('ruflo Agent', () => {
  it('creates an agent from config', () => {
    const agent = new Agent({
      id: 'agent-1',
      type: 'coder',
      capabilities: ['code', 'refactor'],
    });

    expect(agent.id).toBe('agent-1');
    expect(agent.type).toBe('coder');
    expect(agent.status).toBe('active');
    expect(agent.capabilities).toEqual(['code', 'refactor']);
    expect(agent.createdAt).toBeGreaterThan(0);
  });

  it('executes a task successfully', async () => {
    const agent = new Agent({
      id: 'agent-2',
      type: 'coder',
      capabilities: ['code'],
    });

    const result = await agent.executeTask({
      id: 'task-1',
      type: 'code',
      description: 'Write a function',
      priority: 'high',
    });

    expect(result.status).toBe('completed');
    expect(result.taskId).toBe('task-1');
    expect(result.agentId).toBe('agent-2');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('fails task execution when terminated', async () => {
    const agent = new Agent({
      id: 'agent-3',
      type: 'tester',
      capabilities: ['test'],
    });

    agent.terminate();

    const result = await agent.executeTask({
      id: 'task-2',
      type: 'test',
      description: 'Run tests',
      priority: 'medium',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('not available');
  });

  it('runs onExecute callback during task execution', async () => {
    const agent = new Agent({
      id: 'agent-4',
      type: 'coder',
      capabilities: ['code'],
    });

    let callbackRan = false;

    const result = await agent.executeTask({
      id: 'task-3',
      type: 'code',
      description: 'Task with callback',
      priority: 'high',
      onExecute: () => {
        callbackRan = true;
      },
    });

    expect(result.status).toBe('completed');
    expect(callbackRan).toBe(true);
  });

  it('checks capabilities correctly', () => {
    const agent = new Agent({
      id: 'agent-5',
      type: 'reviewer',
      capabilities: ['review', 'analyze'],
    });

    expect(agent.hasCapability('review')).toBe(true);
    expect(agent.hasCapability('code')).toBe(false);
    expect(agent.canExecute('review')).toBe(true);
    expect(agent.canExecute('code')).toBe(false);
    expect(agent.canExecute('unknown-type')).toBe(true);
  });

  it('transitions through lifecycle states', () => {
    const agent = new Agent({
      id: 'agent-6',
      type: 'coder',
      capabilities: ['code'],
    });

    expect(agent.status).toBe('active');

    agent.setIdle();
    expect(agent.status).toBe('idle');

    agent.activate();
    expect(agent.status).toBe('active');

    agent.terminate();
    expect(agent.status).toBe('terminated');

    agent.activate();
    expect(agent.status).toBe('terminated');
  });

  it('serializes to JSON correctly', () => {
    const agent = new Agent({
      id: 'agent-7',
      type: 'deployer',
      capabilities: ['deploy'],
      role: 'worker',
      parent: 'leader-1',
      metadata: { env: 'production' },
    });

    const json = agent.toJSON();
    expect(json.id).toBe('agent-7');
    expect(json.type).toBe('deployer');
    expect(json.role).toBe('worker');
    expect(json.parent).toBe('leader-1');
    expect(json.metadata).toEqual({ env: 'production' });
  });
});
