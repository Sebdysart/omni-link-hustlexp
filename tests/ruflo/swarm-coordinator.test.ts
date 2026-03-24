import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SwarmCoordinator } from '../../engine/ruflo/coordination/application/SwarmCoordinator.js';
import { SQLiteBackend } from '../../engine/ruflo/memory/infrastructure/SQLiteBackend.js';

describe('ruflo SwarmCoordinator', () => {
  let coordinator: SwarmCoordinator;
  let memoryBackend: SQLiteBackend;

  beforeEach(async () => {
    memoryBackend = new SQLiteBackend(':memory:');
    await memoryBackend.initialize();
    coordinator = new SwarmCoordinator({
      topology: 'hierarchical',
      memoryBackend,
    });
    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
    await memoryBackend.close();
  });

  it('spawns agents', async () => {
    const agent = await coordinator.spawnAgent({
      id: 'coder-1',
      type: 'coder',
      capabilities: ['code', 'refactor'],
      role: 'worker',
    });

    expect(agent.id).toBe('coder-1');
    expect(agent.status).toBe('active');

    const agents = await coordinator.listAgents();
    expect(agents).toHaveLength(1);
  });

  it('terminates agents', async () => {
    await coordinator.spawnAgent({
      id: 'agent-term',
      type: 'tester',
      capabilities: ['test'],
    });

    await coordinator.terminateAgent('agent-term');

    const agents = await coordinator.listAgents();
    expect(agents).toHaveLength(0);
  });

  it('distributes tasks across agents with load balancing', async () => {
    await coordinator.spawnAgent({
      id: 'coder-a',
      type: 'coder',
      capabilities: ['code'],
    });
    await coordinator.spawnAgent({
      id: 'coder-b',
      type: 'coder',
      capabilities: ['code'],
    });

    const tasks = [
      { id: 't1', type: 'code', description: 'Task 1', priority: 'high' as const },
      { id: 't2', type: 'code', description: 'Task 2', priority: 'medium' as const },
    ];

    const assignments = await coordinator.distributeTasks(tasks);
    expect(assignments).toHaveLength(2);

    const assignedAgents = new Set(assignments.map((a) => a.agentId));
    expect(assignedAgents.size).toBe(2);
  });

  it('executes a task on a specific agent', async () => {
    await coordinator.spawnAgent({
      id: 'exec-agent',
      type: 'coder',
      capabilities: ['code'],
    });

    const result = await coordinator.executeTask('exec-agent', {
      id: 'exec-task',
      type: 'code',
      description: 'Execute this',
      priority: 'high',
    });

    expect(result.status).toBe('completed');
    expect(result.agentId).toBe('exec-agent');
  });

  it('executes tasks concurrently', async () => {
    await coordinator.spawnAgent({
      id: 'conc-1',
      type: 'coder',
      capabilities: ['code'],
    });
    await coordinator.spawnAgent({
      id: 'conc-2',
      type: 'coder',
      capabilities: ['code'],
    });

    const tasks = [
      { id: 'ct1', type: 'code', description: 'Concurrent 1', priority: 'high' as const },
      { id: 'ct2', type: 'code', description: 'Concurrent 2', priority: 'high' as const },
    ];

    const results = await coordinator.executeTasksConcurrently(tasks);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'completed')).toBe(true);
  });

  it('returns error for unknown agent', async () => {
    const result = await coordinator.executeTask('nonexistent', {
      id: 'fail-task',
      type: 'code',
      description: 'Should fail',
      priority: 'high',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('not found');
  });

  it('tracks agent metrics', async () => {
    await coordinator.spawnAgent({
      id: 'metrics-agent',
      type: 'coder',
      capabilities: ['code'],
    });

    await coordinator.executeTask('metrics-agent', {
      id: 'metric-task-1',
      type: 'code',
      description: 'Metric task',
      priority: 'high',
    });

    const metrics = await coordinator.getAgentMetrics('metrics-agent');
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.successRate).toBe(1.0);
    expect(metrics.health).toBe('healthy');
  });

  it('returns swarm state', async () => {
    await coordinator.spawnAgent({
      id: 'leader-1',
      type: 'coordinator',
      capabilities: ['coordinate'],
      role: 'leader',
    });
    await coordinator.spawnAgent({
      id: 'worker-1',
      type: 'coder',
      capabilities: ['code'],
      role: 'worker',
    });

    const state = await coordinator.getSwarmState();
    expect(state.agents).toHaveLength(2);
    expect(state.topology).toBe('hierarchical');
    expect(state.leader).toBe('leader-1');
  });

  it('builds hierarchy', async () => {
    await coordinator.spawnAgent({
      id: 'h-leader',
      type: 'coordinator',
      capabilities: ['coordinate'],
      role: 'leader',
    });
    await coordinator.spawnAgent({
      id: 'h-worker-1',
      type: 'coder',
      capabilities: ['code'],
      role: 'worker',
    });
    await coordinator.spawnAgent({
      id: 'h-worker-2',
      type: 'tester',
      capabilities: ['test'],
      role: 'worker',
    });

    const hierarchy = await coordinator.getHierarchy();
    expect(hierarchy.leader).toBe('h-leader');
    expect(hierarchy.workers).toHaveLength(2);
  });

  it('scales agents up and down', async () => {
    await coordinator.scaleAgents({ type: 'coder', count: 3 });
    let agents = await coordinator.listAgents();
    expect(agents).toHaveLength(3);

    await coordinator.scaleAgents({ type: 'coder', count: -2 });
    agents = await coordinator.listAgents();
    expect(agents).toHaveLength(1);
  });

  it('reconfigures topology', async () => {
    expect(coordinator.getTopology()).toBe('hierarchical');

    await coordinator.reconfigure({ topology: 'mesh' });
    expect(coordinator.getTopology()).toBe('mesh');
  });

  it('stores agent events in memory backend', async () => {
    await coordinator.spawnAgent({
      id: 'mem-agent',
      type: 'coder',
      capabilities: ['code'],
    });

    const memories = await memoryBackend.query({ type: 'event' });
    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories[0].content).toContain('mem-agent');
  });

  it('reaches consensus among agents', async () => {
    await coordinator.spawnAgent({
      id: 'voter-1',
      type: 'reviewer',
      capabilities: ['review'],
    });
    await coordinator.spawnAgent({
      id: 'voter-2',
      type: 'reviewer',
      capabilities: ['review'],
    });
    await coordinator.spawnAgent({
      id: 'voter-3',
      type: 'reviewer',
      capabilities: ['review'],
    });

    const result = await coordinator.reachConsensus(
      { id: 'decision-1', type: 'approval', payload: { change: 'merge PR' } },
      ['voter-1', 'voter-2', 'voter-3'],
    );

    expect(result.votes).toHaveLength(3);
    expect(typeof result.consensusReached).toBe('boolean');
  });
});
