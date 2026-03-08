import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  apply,
  evolve,
  health,
  impactFromRefs,
  impactFromUncommitted,
  owners,
  publishReview,
  reviewPr,
  rollback,
  scan,
  watch,
} from '../../engine/index.js';
import { loadConfig, resolveConfigPath } from '../../engine/config.js';
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
    publishReview,
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

describe('scripts/contract-fixture-smoke', () => {
  it('locks the public command contracts against committed fixtures', async () => {
    const { runContractFixtureSmoke } = await import('../../scripts/contract-fixture-smoke.mjs');
    const metrics = await runContractFixtureSmoke({
      scratchRoot: path.join(os.tmpdir(), 'omni-link-contract-fixture-tests'),
      executeCli: createSourceCliExecutor(process.cwd()),
      logger: () => undefined,
    });

    expect(metrics.basicCommandsLocked).toBe(5);
    expect(metrics.maxCommandsLocked).toBe(6);
    expect(metrics.markdownSections).toBeGreaterThan(4);
    expect(metrics.reviewPlanKeys).toBeGreaterThan(5);
  }, 45000);
});
