import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  apply,
  impactFromRefs,
  owners,
  reviewPr,
  rollback,
  scan,
  watch,
} from '../../engine/index.js';
import { loadConfig, resolveConfigPath } from '../../engine/config.js';
import { evolve, health, impactFromUncommitted } from '../../engine/index.js';
import type { CliDeps, CliIo } from '../../engine/cli-app.js';
import { runCli } from '../../engine/cli-app.js';

function createSourceCliExecutor(repoRoot: string) {
  const deps: CliDeps = {
    apply,
    reviewPr,
    rollback,
    scan,
    watch,
    owners,
    impactFromRefs,
    impactFromUncommitted,
    health,
    evolve,
    loadConfig,
    resolveConfigPath,
    cwd: () => repoRoot,
  };

  return async (args: string[]): Promise<string> => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    };

    const exitCode = await runCli(args, io, deps);
    if (exitCode !== 0) {
      throw new Error(stderr.join('\n') || `CLI exited with code ${exitCode}`);
    }

    return stdout.join('\n');
  };
}

describe('scripts/max-tier-smoke', () => {
  it('runs the max-tier flow against the source CLI and engine', async () => {
    const { runMaxTierSmoke } = await import('../../scripts/max-tier-smoke.mjs');
    const metrics = await runMaxTierSmoke({
      scratchRoot: path.join(os.tmpdir(), 'omni-link-max-tier-smoke-tests'),
      executeCli: createSourceCliExecutor(process.cwd()),
      logger: () => undefined,
    });

    expect(metrics.repos).toBe(2);
    expect(metrics.ownerCount).toBeGreaterThan(0);
    expect(metrics.watchRunning).toBe(true);
    expect(metrics.plannedChanges).toBeGreaterThan(0);
    expect(metrics.dryRunApply).toBe(false);
  }, 45000);
});
