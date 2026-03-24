import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SwarmCoordinator } from '../../engine/ruflo/coordination/application/SwarmCoordinator.js';
import { WorkflowEngine } from '../../engine/ruflo/task-execution/application/WorkflowEngine.js';
import { PluginManager } from '../../engine/ruflo/infrastructure/plugins/PluginManager.js';
import { MCPServer } from '../../engine/ruflo/infrastructure/mcp/MCPServer.js';
import { AgentTools } from '../../engine/ruflo/infrastructure/mcp/tools/AgentTools.js';
import { HybridBackend } from '../../engine/ruflo/memory/infrastructure/HybridBackend.js';
import { SQLiteBackend } from '../../engine/ruflo/memory/infrastructure/SQLiteBackend.js';
import { AgentDBBackend } from '../../engine/ruflo/memory/infrastructure/AgentDBBackend.js';
import { HustleXPEngineeringPlugin } from '../../engine/ruflo/plugins/hustlexp-engineering.js';

describe('ruflo + omni-link Integration', () => {
  let coordinator: SwarmCoordinator;
  let workflowEngine: WorkflowEngine;
  let pluginManager: PluginManager;
  let mcpServer: MCPServer;
  let memoryBackend: HybridBackend;

  beforeEach(async () => {
    const sqlite = new SQLiteBackend(':memory:');
    const agentdb = new AgentDBBackend({ dbPath: ':memory:', dimensions: 3 });
    memoryBackend = new HybridBackend(sqlite, agentdb);
    await memoryBackend.initialize();

    pluginManager = new PluginManager({ coreVersion: '3.0.0' });
    await pluginManager.initialize();

    coordinator = new SwarmCoordinator({
      topology: 'hierarchical',
      memoryBackend,
      pluginManager,
    });
    await coordinator.initialize();

    workflowEngine = new WorkflowEngine({
      coordinator,
      memoryBackend,
      pluginManager,
    });
    await workflowEngine.initialize();

    const agentTools = new AgentTools(coordinator);
    mcpServer = new MCPServer({ tools: [agentTools] });
    await mcpServer.start();
  });

  afterEach(async () => {
    await mcpServer.stop();
    await workflowEngine.shutdown();
    await coordinator.shutdown();
    await pluginManager.shutdown();
    await memoryBackend.close();
  });

  it('full stack: plugin + swarm + workflow + memory + MCP', async () => {
    const hustlexpPlugin = new HustleXPEngineeringPlugin();
    await pluginManager.loadPlugin(hustlexpPlugin, {
      workflowProfile: 'hustlexp',
      simulateOnly: true,
      authority: { enabled: true, phaseMode: 'reconciliation' },
      bridges: { swiftTrpc: { enabled: true } },
    });

    expect(pluginManager.listPlugins()).toHaveLength(1);

    const spawnResponse = await mcpServer.handleRequest({
      id: 'int-1',
      method: 'agent_spawn',
      params: {
        id: 'queen',
        type: 'coordinator',
        capabilities: ['coordinate', 'manage'],
        role: 'leader',
      },
    });
    expect((spawnResponse.result as { success: boolean }).success).toBe(true);

    await coordinator.spawnAgent({
      id: 'attack-auth',
      type: 'tester',
      capabilities: ['test', 'security-audit', 'review'],
      role: 'worker',
      parent: 'queen',
    });
    await coordinator.spawnAgent({
      id: 'attack-fin',
      type: 'tester',
      capabilities: ['test', 'validate', 'review'],
      role: 'worker',
      parent: 'queen',
    });
    await coordinator.spawnAgent({
      id: 'fixer-auth',
      type: 'coder',
      capabilities: ['code', 'refactor'],
      role: 'worker',
      parent: 'queen',
    });
    await coordinator.spawnAgent({
      id: 'fixer-fin',
      type: 'coder',
      capabilities: ['code', 'debug'],
      role: 'worker',
      parent: 'queen',
    });

    const state = await coordinator.getSwarmState();
    expect(state.agents).toHaveLength(5);
    expect(state.leader).toBe('queen');

    const result = await workflowEngine.executeWorkflow({
      id: 'orbit-loop-r52',
      name: 'HustleXP Orbit Loop R52',
      tasks: [
        {
          id: 'attack-phase',
          type: 'test',
          description: 'Attack: find bugs in auth and fin domains',
          priority: 'high',
        },
        {
          id: 'triage-phase',
          type: 'review',
          description: 'Triage: classify and prioritize findings',
          priority: 'high',
          dependencies: ['attack-phase'],
        },
        {
          id: 'fix-phase',
          type: 'code',
          description: 'Fix: resolve prioritized findings',
          priority: 'high',
          dependencies: ['triage-phase'],
        },
        {
          id: 'verify-phase',
          type: 'test',
          description: 'Verify: confirm all fixes pass',
          priority: 'medium',
          dependencies: ['fix-phase'],
        },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.tasksCompleted).toBe(4);
    expect(result.executionOrder).toEqual([
      'attack-phase',
      'triage-phase',
      'fix-phase',
      'verify-phase',
    ]);
    expect(result.errors).toHaveLength(0);

    const memories = await memoryBackend.query({});
    expect(memories.length).toBeGreaterThan(0);

    const authority = await hustlexpPlugin.checkAuthority();
    expect(authority).toHaveProperty('hasAuthorityDrift');

    const bridge = await hustlexpPlugin.analyzeBridge();
    expect(bridge).toHaveProperty('swiftCalls');

    const metrics = await coordinator.getAgentMetrics('attack-auth');
    expect(metrics.agentId).toBe('attack-auth');
  });

  it('queen agent delegates across swarm with load balancing', async () => {
    await coordinator.spawnAgent({
      id: 'lb-queen',
      type: 'coordinator',
      capabilities: ['coordinate'],
      role: 'leader',
    });

    for (let i = 0; i < 4; i++) {
      await coordinator.spawnAgent({
        id: `lb-worker-${i}`,
        type: 'coder',
        capabilities: ['code', 'test'],
        role: 'worker',
        parent: 'lb-queen',
      });
    }

    const tasks = Array.from({ length: 8 }, (_, i) => ({
      id: `lb-task-${i}`,
      type: 'code' as const,
      description: `Load balanced task ${i}`,
      priority: 'high' as const,
    }));

    const assignments = await coordinator.distributeTasks(tasks);
    expect(assignments).toHaveLength(8);

    const agentCounts = new Map<string, number>();
    for (const assignment of assignments) {
      agentCounts.set(assignment.agentId, (agentCounts.get(assignment.agentId) || 0) + 1);
    }

    for (const count of agentCounts.values()) {
      expect(count).toBe(2);
    }
  });

  it('memory persists findings across workflow phases', async () => {
    await coordinator.spawnAgent({
      id: 'persist-agent',
      type: 'coder',
      capabilities: ['code'],
    });

    await memoryBackend.store({
      id: 'finding-1',
      agentId: 'persist-agent',
      content: 'Auth endpoint missing rate limiting',
      type: 'event',
      timestamp: Date.now(),
      metadata: { domain: 'auth', severity: 'high', round: 'R52' },
      embedding: [0.9, 0.1, 0.0],
    });

    await memoryBackend.store({
      id: 'finding-2',
      agentId: 'persist-agent',
      content: 'Payment webhook not idempotent',
      type: 'event',
      timestamp: Date.now(),
      metadata: { domain: 'fin', severity: 'critical', round: 'R52' },
      embedding: [0.1, 0.9, 0.0],
    });

    const authFindings = await memoryBackend.query({
      metadata: { domain: 'auth' },
    });
    expect(authFindings).toHaveLength(1);
    expect(authFindings[0].content).toContain('rate limiting');

    const similarToAuth = await memoryBackend.vectorSearch([0.9, 0.1, 0.0], 1);
    expect(similarToAuth).toHaveLength(1);
    expect(similarToAuth[0].id).toBe('finding-1');
  });
});
