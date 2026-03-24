/**
 * BasePlugin — abstract base class for ruflo plugins.
 */

import type { RufloPlugin, ExtensionPoint, PluginMetadata } from '../../shared/types.js';

export abstract class BasePlugin implements RufloPlugin {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;
  public description?: string;
  public author?: string;
  public homepage?: string;
  public priority?: number;
  public dependencies?: string[];
  public configSchema?: Record<string, unknown>;
  public minCoreVersion?: string;
  public maxCoreVersion?: string;

  protected config?: Record<string, unknown>;
  protected extensionPoints: ExtensionPoint[] = [];

  constructor(metadata: PluginMetadata) {
    this.id = metadata.id;
    this.name = metadata.name;
    this.version = metadata.version;
    this.description = metadata.description;
    this.author = metadata.author;
    this.homepage = metadata.homepage;
  }

  async initialize(config?: Record<string, unknown>): Promise<void> {
    this.config = config;
    await this.onInitialize();
  }

  async shutdown(): Promise<void> {
    await this.onShutdown();
  }

  getExtensionPoints(): ExtensionPoint[] {
    return this.extensionPoints;
  }

  protected registerExtensionPoint(
    name: string,
    handler: (context: unknown) => Promise<unknown>,
    priority?: number,
  ): void {
    this.extensionPoints.push({ name, handler, priority });
  }

  getMetadata(): PluginMetadata {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      homepage: this.homepage,
    };
  }

  protected async onInitialize(): Promise<void> {
    // Override in subclass
  }

  protected async onShutdown(): Promise<void> {
    // Override in subclass
  }
}
