import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginManager } from '../../engine/ruflo/infrastructure/plugins/PluginManager.js';
import { BasePlugin } from '../../engine/ruflo/infrastructure/plugins/BasePlugin.js';
import { HustleXPEngineeringPlugin } from '../../engine/ruflo/plugins/hustlexp-engineering.js';

class TestPlugin extends BasePlugin {
  public initCalled = false;
  public shutdownCalled = false;

  constructor(id: string = 'test-plugin') {
    super({ id, name: 'Test Plugin', version: '1.0.0' });
  }

  protected override async onInitialize(): Promise<void> {
    this.initCalled = true;
    this.registerExtensionPoint(
      'test.greet',
      async (ctx: unknown) => `Hello from ${this.id}: ${JSON.stringify(ctx)}`,
      10,
    );
  }

  protected override async onShutdown(): Promise<void> {
    this.shutdownCalled = true;
  }
}

describe('ruflo PluginManager', () => {
  let pm: PluginManager;

  beforeEach(async () => {
    pm = new PluginManager({ coreVersion: '3.0.0' });
    await pm.initialize();
  });

  afterEach(async () => {
    await pm.shutdown();
  });

  it('loads and unloads a plugin', async () => {
    const plugin = new TestPlugin();
    await pm.loadPlugin(plugin);

    expect(pm.listPlugins()).toHaveLength(1);
    expect(plugin.initCalled).toBe(true);

    await pm.unloadPlugin('test-plugin');
    expect(pm.listPlugins()).toHaveLength(0);
    expect(plugin.shutdownCalled).toBe(true);
  });

  it('invokes extension points', async () => {
    const plugin = new TestPlugin();
    await pm.loadPlugin(plugin);

    const results = await pm.invokeExtensionPoint('test.greet', { name: 'world' });
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('Hello from test-plugin');
  });

  it('returns plugin metadata', async () => {
    const plugin = new TestPlugin();
    await pm.loadPlugin(plugin);

    const meta = pm.getPluginMetadata('test-plugin');
    expect(meta).toBeDefined();
    expect(meta!.name).toBe('Test Plugin');
    expect(meta!.version).toBe('1.0.0');
  });

  it('reloads a plugin', async () => {
    const original = new TestPlugin();
    await pm.loadPlugin(original);

    const replacement = new TestPlugin('test-plugin');
    replacement.description = 'Updated';
    await pm.reloadPlugin('test-plugin', replacement);

    expect(pm.listPlugins()).toHaveLength(1);
    expect(original.shutdownCalled).toBe(true);
    expect(replacement.initCalled).toBe(true);
  });

  it('enforces plugin dependencies', async () => {
    const dependent = new TestPlugin('dependent');
    dependent.dependencies = ['required-plugin'];

    await expect(pm.loadPlugin(dependent)).rejects.toThrow('depends on required-plugin');
  });

  it('prevents unloading plugin with dependents', async () => {
    const base = new TestPlugin('base-plugin');
    await pm.loadPlugin(base);

    const dependent = new TestPlugin('dependent-plugin');
    dependent.dependencies = ['base-plugin'];
    await pm.loadPlugin(dependent);

    await expect(pm.unloadPlugin('base-plugin')).rejects.toThrow('dependent-plugin depends on it');
  });

  it('reports core version', () => {
    expect(pm.getCoreVersion()).toBe('3.0.0');
  });
});

describe('HustleXP Engineering Plugin', () => {
  let pm: PluginManager;

  beforeEach(async () => {
    pm = new PluginManager({ coreVersion: '3.0.0' });
    await pm.initialize();
  });

  afterEach(async () => {
    await pm.shutdown();
  });

  it('loads as a ruflo plugin', async () => {
    const plugin = new HustleXPEngineeringPlugin();
    await pm.loadPlugin(plugin, {
      workflowProfile: 'hustlexp',
      simulateOnly: true,
      authority: { enabled: true, phaseMode: 'reconciliation' },
      bridges: { swiftTrpc: { enabled: true } },
    });

    expect(pm.listPlugins()).toHaveLength(1);
    const meta = pm.getPluginMetadata('hustlexp-engineering');
    expect(meta!.name).toBe('HustleXP Engineering Control Plane');
  });

  it('registers extension points for authority gating', async () => {
    const plugin = new HustleXPEngineeringPlugin();
    await pm.loadPlugin(plugin, {
      authority: { enabled: true, phaseMode: 'reconciliation' },
    });

    const eps = plugin.getExtensionPoints();
    const names = eps.map((ep) => ep.name);
    expect(names).toContain('workflow.beforeExecute');
    expect(names).toContain('agent.beforeSpawn');
    expect(names).toContain('task.beforeAssign');
  });

  it('checks authority and reports no drift by default', async () => {
    const plugin = new HustleXPEngineeringPlugin();
    await pm.loadPlugin(plugin, {
      authority: { enabled: true, phaseMode: 'reconciliation' },
    });

    const result = await plugin.checkAuthority();
    expect(result.hasAuthorityDrift).toBe(false);
    expect(result.blocksExecution).toBe(false);
  });

  it('blocks execution in strict mode when drift detected', async () => {
    const plugin = new HustleXPEngineeringPlugin();
    await pm.loadPlugin(plugin, {
      authority: { enabled: true, phaseMode: 'strict' },
    });

    const result = await plugin.checkAuthority();
    expect(result.blocksExecution).toBe(true);
  });

  it('analyzes bridge status', async () => {
    const plugin = new HustleXPEngineeringPlugin();
    await pm.loadPlugin(plugin, {
      bridges: { swiftTrpc: { enabled: true } },
    });

    const bridge = await plugin.analyzeBridge();
    expect(bridge).toHaveProperty('swiftCalls');
    expect(bridge).toHaveProperty('backendProcedures');
    expect(bridge).toHaveProperty('matched');
    expect(bridge).toHaveProperty('obsolete');
  });

  it('retrieves plugin config after initialization', async () => {
    const plugin = new HustleXPEngineeringPlugin();
    await pm.loadPlugin(plugin, {
      workflowProfile: 'hustlexp',
      simulateOnly: true,
    });

    const config = plugin.getPluginConfig();
    expect(config).toBeDefined();
    expect(config!.workflowProfile).toBe('hustlexp');
    expect(config!.simulateOnly).toBe(true);
  });
});
