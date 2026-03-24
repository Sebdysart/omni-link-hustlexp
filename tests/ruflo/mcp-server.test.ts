import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MCPServer } from '../../engine/ruflo/infrastructure/mcp/MCPServer.js';
import { AgentTools } from '../../engine/ruflo/infrastructure/mcp/tools/AgentTools.js';
import { SwarmCoordinator } from '../../engine/ruflo/coordination/application/SwarmCoordinator.js';

describe('ruflo MCPServer', () => {
  let server: MCPServer;
  let coordinator: SwarmCoordinator;

  beforeEach(async () => {
    coordinator = new SwarmCoordinator({ topology: 'hierarchical' });
    await coordinator.initialize();

    const agentTools = new AgentTools(coordinator);

    server = new MCPServer({
      tools: [agentTools],
      port: 3000,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await coordinator.shutdown();
  });

  it('starts and stops', () => {
    const status = server.getStatus();
    expect(status.running).toBe(true);
    expect(status.toolCount).toBe(4);
  });

  it('lists tools', () => {
    const tools = server.listTools();
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain('agent_spawn');
    expect(names).toContain('agent_list');
    expect(names).toContain('agent_terminate');
    expect(names).toContain('agent_metrics');
  });

  it('handles agent_spawn request', async () => {
    const response = await server.handleRequest({
      id: 'req-1',
      method: 'agent_spawn',
      params: { id: 'mcp-agent', type: 'coder', capabilities: ['code'] },
    });

    expect(response.id).toBe('req-1');
    expect(response.error).toBeUndefined();
    const result = response.result as { success: boolean };
    expect(result.success).toBe(true);
  });

  it('handles agent_list request', async () => {
    await coordinator.spawnAgent({
      id: 'list-agent',
      type: 'tester',
      capabilities: ['test'],
    });

    const response = await server.handleRequest({
      id: 'req-2',
      method: 'agent_list',
      params: {},
    });

    const result = response.result as { success: boolean; agents: unknown[] };
    expect(result.success).toBe(true);
    expect(result.agents).toHaveLength(1);
  });

  it('returns failure for unknown tool', async () => {
    const response = await server.handleRequest({
      id: 'req-3',
      method: 'unknown_method',
      params: {},
    });

    const result = response.result as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('validates agent_spawn parameters', async () => {
    const response = await server.handleRequest({
      id: 'req-4',
      method: 'agent_spawn',
      params: { id: '', type: 'coder' },
    });

    const result = response.result as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain('validation');
  });

  it('registers additional tools', () => {
    server.registerTool({
      name: 'custom_tool',
      description: 'A custom tool',
      parameters: {},
    });

    const tools = server.listTools();
    expect(tools.some((t) => t.name === 'custom_tool')).toBe(true);
  });
});
