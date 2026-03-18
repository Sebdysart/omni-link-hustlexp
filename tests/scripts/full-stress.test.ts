import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 30_000 });

import { loadConfig, resolveConfigPath } from '../../engine/config.js';
import * as engine from '../../engine/index.js';
import * as providers from '../../engine/providers/index.js';
import type { CliDeps, CliIo } from '../../engine/cli-app.js';
import { runCli } from '../../engine/cli-app.js';

function createSourceCliExecutor(repoRoot: string) {
  const deps: CliDeps = {
    apply: engine.apply,
    reviewPr: engine.reviewPr,
    rollback: engine.rollback,
    scan: engine.scan,
    watch: engine.watch,
    owners: engine.owners,
    publishReview: engine.publishReview,
    impactFromRefs: engine.impactFromRefs,
    impactFromUncommitted: engine.impactFromUncommitted,
    health: engine.health,
    evolve: engine.evolve,
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

describe('scripts/full-stress', () => {
  it('runs the comprehensive stress harness against source modules', async () => {
    const { runFullStress } = await import('../../scripts/full-stress.mjs');
    const summary = await runFullStress({
      scratchRoot: path.join(os.tmpdir(), 'omni-link-full-stress-tests'),
      logger: () => undefined,
      skipPackage: true,
      engine,
      providers,
      executeCli: createSourceCliExecutor(process.cwd()),
      backendRouteCount: 40,
      clientRouteCount: 40,
      goFileCount: 20,
      minimumBridges: 40,
      maxRuntimeMs: 30000,
    });

    expect(summary.engine.repos).toBe(8);
    expect(summary.engine.languages).toEqual(
      expect.arrayContaining(['go', 'graphql', 'java', 'python', 'swift', 'typescript']),
    );
    expect(summary.engine.liveMetadataFetches).toBe(1);
    expect(summary.engine.applyLedgerEntries).toBeGreaterThan(0);
    expect(summary.engine.rollbackLedgerEntries).toBeGreaterThan(0);
    expect(summary.engine.uncommittedImpactPaths).toBeGreaterThan(0);
    expect(summary.cli.repos).toBe(2);
    expect(summary.maxTier.gitlabNegotiatedAnnotations).toBe(0);
    expect(summary.contracts.maxCommandsLocked).toBe(6);
    expect(summary.benchmark.bridges).toBeGreaterThanOrEqual(40);
  }, 120000);
});
