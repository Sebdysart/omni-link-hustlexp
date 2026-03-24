/**
 * PluginManager
 *
 * Manages plugin lifecycle, dependencies, and extension point invocation.
 */

import { EventEmitter } from 'events';
import type {
  RufloPlugin,
  ExtensionPoint,
  PluginMetadata,
  PluginManagerInterface,
} from '../../shared/types.js';
import { RufloPluginError } from '../../shared/types.js';

export interface PluginManagerOptions {
  eventBus?: EventEmitter;
  coreVersion?: string;
}

export class PluginManager implements PluginManagerInterface {
  private plugins: Map<string, RufloPlugin>;
  private extensionPoints: Map<
    string,
    Array<{
      pluginId: string;
      handler: ExtensionPoint['handler'];
      priority: number;
    }>
  >;
  private eventBus: EventEmitter;
  private coreVersion: string;
  private initialized: boolean = false;

  constructor(options: PluginManagerOptions = {}) {
    this.plugins = new Map();
    this.extensionPoints = new Map();
    this.eventBus = options.eventBus || new EventEmitter();
    this.coreVersion = options.coreVersion || '3.0.0';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    const pluginIds = Array.from(this.plugins.keys()).reverse();
    for (const pluginId of pluginIds) {
      await this.unloadPlugin(pluginId);
    }
    this.extensionPoints.clear();
    this.initialized = false;
  }

  async loadPlugin(plugin: RufloPlugin, config?: Record<string, unknown>): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      await this.unloadPlugin(plugin.id);
    }

    if (plugin.configSchema && config) {
      this.validateConfig(plugin.configSchema, config);
    }

    if (plugin.minCoreVersion || plugin.maxCoreVersion) {
      this.checkVersionCompatibility(plugin);
    }

    if (plugin.dependencies) {
      for (const depId of plugin.dependencies) {
        if (!this.plugins.has(depId)) {
          throw new RufloPluginError(
            `Plugin ${plugin.id} depends on ${depId} which is not loaded`,
            { pluginId: plugin.id, dependency: depId },
          );
        }
      }
    }

    await plugin.initialize(config);

    this.plugins.set(plugin.id, plugin);

    const extensionPoints = plugin.getExtensionPoints();
    for (const ep of extensionPoints) {
      this.registerExtensionPoint(plugin.id, ep, plugin.priority);
    }

    this.eventBus.emit('plugin:loaded', {
      id: plugin.id,
      name: plugin.name,
    });
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    for (const [otherId, other] of this.plugins.entries()) {
      if (other.dependencies?.includes(pluginId)) {
        throw new RufloPluginError(`Cannot unload ${pluginId}: plugin ${otherId} depends on it`, {
          pluginId,
          dependentPluginId: otherId,
        });
      }
    }

    await plugin.shutdown();

    for (const [name, handlers] of this.extensionPoints.entries()) {
      this.extensionPoints.set(
        name,
        handlers.filter((h) => h.pluginId !== pluginId),
      );
    }

    this.plugins.delete(pluginId);

    this.eventBus.emit('plugin:unloaded', { id: pluginId });
  }

  async reloadPlugin(pluginId: string, plugin: RufloPlugin): Promise<void> {
    await this.unloadPlugin(pluginId);
    await this.loadPlugin(plugin);
  }

  listPlugins(): RufloPlugin[] {
    return Array.from(this.plugins.values());
  }

  getPluginMetadata(pluginId: string): PluginMetadata | undefined {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return undefined;

    return {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      homepage: plugin.homepage,
    };
  }

  async invokeExtensionPoint(name: string, context: unknown): Promise<unknown[]> {
    const handlers = this.extensionPoints.get(name) || [];

    const sorted = [...handlers].sort((a, b) => b.priority - a.priority);

    const results: unknown[] = [];
    for (const { handler, pluginId } of sorted) {
      try {
        const result = await handler(context);
        results.push(result);
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
          pluginId,
        });
      }
    }

    return results;
  }

  getCoreVersion(): string {
    return this.coreVersion;
  }

  private registerExtensionPoint(
    pluginId: string,
    ep: ExtensionPoint,
    pluginPriority?: number,
  ): void {
    const handlers = this.extensionPoints.get(ep.name) || [];
    handlers.push({
      pluginId,
      handler: ep.handler,
      priority: ep.priority ?? pluginPriority ?? 0,
    });
    this.extensionPoints.set(ep.name, handlers);
  }

  private validateConfig(schema: Record<string, unknown>, config: Record<string, unknown>): void {
    const required = (schema as Record<string, unknown> & { required?: string[] }).required;
    if (required) {
      for (const field of required) {
        if (!(field in config)) {
          throw new RufloPluginError(`Missing required configuration field: ${field}`, {
            field,
            validation: 'required',
          });
        }
      }
    }
  }

  private checkVersionCompatibility(plugin: RufloPlugin): void {
    const currentVersion = this.getCoreVersion();
    const coreVersion = this.parseVersion(currentVersion);

    if (plugin.minCoreVersion) {
      const minVersion = this.parseVersion(plugin.minCoreVersion);
      if (this.compareVersions(coreVersion, minVersion) < 0) {
        throw new RufloPluginError(
          `Plugin ${plugin.id} requires core version >= ${plugin.minCoreVersion}, but core version is ${currentVersion}`,
          {
            pluginId: plugin.id,
            minVersion: plugin.minCoreVersion,
            coreVersion: currentVersion,
          },
        );
      }
    }

    if (plugin.maxCoreVersion) {
      const maxVersion = this.parseVersion(plugin.maxCoreVersion);
      if (this.compareVersions(coreVersion, maxVersion) > 0) {
        throw new RufloPluginError(
          `Plugin ${plugin.id} requires core version <= ${plugin.maxCoreVersion}, but core version is ${currentVersion}`,
          {
            pluginId: plugin.id,
            maxVersion: plugin.maxCoreVersion,
            coreVersion: currentVersion,
          },
        );
      }
    }
  }

  private parseVersion(version: string): number[] {
    return version.split('.').map((n) => parseInt(n, 10) || 0);
  }

  private compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }
}
