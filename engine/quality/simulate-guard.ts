// engine/quality/simulate-guard.ts — Dry-run mode enforcement

import type { OmniLinkConfig } from '../types.js';

/**
 * Thrown when an operation is attempted in simulate-only (dry-run) mode.
 * Consumers should catch this and present the dry-run explanation to the user.
 */
export class SimulateOnlyError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(
      `[simulate-only] The '${operation}' operation was blocked because simulateOnly is enabled. ` +
        `Review the plan and run /apply to execute for real.`,
    );
    this.name = 'SimulateOnlyError';
    this.operation = operation;
  }
}

/**
 * Assert that the config is NOT in simulate-only mode before executing a mutating operation.
 * Read-only analysis commands should remain available in simulate-only mode.
 *
 * @throws {SimulateOnlyError} if config.simulateOnly is true
 */
export function assertNotSimulateOnly(config: OmniLinkConfig, operation: string): void {
  if (config.simulateOnly === true) {
    throw new SimulateOnlyError(operation);
  }
}
