/**
 * MCPServer — Model Context Protocol server for the ruflo engine.
 */

import type {
  MCPServerOptions,
  MCPTool,
  MCPToolProvider,
  MCPRequest,
  MCPResponse,
} from '../../shared/types.js';

export class MCPServer {
  private tools: MCPToolProvider[];
  private port: number;
  private host: string;
  private running: boolean = false;
  private toolRegistry: Map<string, MCPTool>;

  constructor(options: MCPServerOptions = {}) {
    this.tools = options.tools || [];
    this.port = options.port || 3000;
    this.host = options.host || 'localhost';
    this.toolRegistry = new Map();
  }

  async start(): Promise<void> {
    if (this.running) return;

    for (const provider of this.tools) {
      if (provider.getTools) {
        for (const tool of provider.getTools()) {
          this.toolRegistry.set(tool.name, tool);
        }
      }
    }

    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.toolRegistry.clear();
  }

  registerTool(tool: MCPTool): void {
    this.toolRegistry.set(tool.name, tool);
  }

  listTools(): MCPTool[] {
    return Array.from(this.toolRegistry.values());
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      for (const provider of this.tools) {
        try {
          const result = await provider.execute(request.method, request.params);
          return {
            id: request.id,
            result,
          };
        } catch {
          continue;
        }
      }

      return {
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      };
    } catch (error) {
      return {
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
    }
  }

  getStatus(): {
    running: boolean;
    port: number;
    host: string;
    toolCount: number;
  } {
    return {
      running: this.running,
      port: this.port,
      host: this.host,
      toolCount: this.toolRegistry.size,
    };
  }
}
