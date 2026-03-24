/**
 * Ruflo Engine — Multi-agent orchestration engine
 *
 * Integrated into omni-link-hustlexp as the orchestration layer.
 * Provides swarm coordination, workflow execution, hybrid memory,
 * plugin management, and MCP tool infrastructure.
 */

// Shared Types
export * from './shared/types.js';

// Domain Entities
export { Agent } from './agent-lifecycle/domain/Agent.js';
export { Task } from './task-execution/domain/Task.js';
export { MemoryEntity } from './memory/domain/Memory.js';

// Application Services
export {
  SwarmCoordinator,
  type SwarmCoordinatorOptions,
} from './coordination/application/SwarmCoordinator.js';
export {
  WorkflowEngine,
  type WorkflowEngineOptions,
} from './task-execution/application/WorkflowEngine.js';

// Memory Infrastructure
export { HybridBackend } from './memory/infrastructure/HybridBackend.js';
export { SQLiteBackend } from './memory/infrastructure/SQLiteBackend.js';
export { AgentDBBackend } from './memory/infrastructure/AgentDBBackend.js';

// Plugin Infrastructure
export {
  PluginManager,
  type PluginManagerOptions,
} from './infrastructure/plugins/PluginManager.js';
export { BasePlugin } from './infrastructure/plugins/BasePlugin.js';

// MCP Infrastructure
export { MCPServer } from './infrastructure/mcp/MCPServer.js';
export { AgentTools } from './infrastructure/mcp/tools/AgentTools.js';
