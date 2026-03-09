import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDaemonState, updateDaemonState, watchEcosystem } from '../../engine/daemon/index.js';
import type { OmniLinkConfig } from '../../engine/types.js';

function makeConfig(repoPath: string, cacheDir: string): OmniLinkConfig {
  return {
    repos: [{ name: 'repo', path: repoPath, language: 'typescript', role: 'backend' }],
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 4000,
      prioritize: 'api-surface-first',
      includeRecentCommits: 10,
    },
    cache: {
      directory: cacheDir,
      maxAgeDays: 7,
    },
    daemon: {
      enabled: true,
      preferDaemon: true,
      statePath: path.join(cacheDir, 'daemon-state.sqlite'),
      pollIntervalMs: 250,
      cacheRetentionDays: 7,
    },
  };
}

describe('daemon/index', () => {
  let tmpDir: string;
  let repoDir: string;
  let cacheDir: string;
  let config: OmniLinkConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-daemon-index-'));
    repoDir = path.join(tmpDir, 'repo');
    cacheDir = path.join(tmpDir, 'cache');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    execSync('git init -q', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
    execSync('git add .', { cwd: repoDir, stdio: 'ignore' });
    execSync('git commit -qm "initial commit"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git branch -M main', { cwd: repoDir, stdio: 'ignore' });

    config = makeConfig(repoDir, cacheDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reuses the matching branch snapshot and invalidates on branch changes', async () => {
    const mainState = await updateDaemonState(config);
    const loadedMain = await loadDaemonState(config);

    expect(loadedMain?.branchSignature).toBe(mainState.branchSignature);
    expect(loadedMain?.context.digest.configSha).toBe(mainState.context.digest.configSha);

    execSync('git checkout -qb feature/branch-aware', { cwd: repoDir, stdio: 'ignore' });

    expect(await loadDaemonState(config)).toBeNull();

    const featureState = await updateDaemonState(config);
    const loadedFeature = await loadDaemonState(config);
    expect(loadedFeature?.branchSignature).toBe(featureState.branchSignature);
    expect(loadedFeature?.branchSignature).not.toBe(mainState.branchSignature);

    execSync('git checkout -q main', { cwd: repoDir, stdio: 'ignore' });

    const restoredMain = await loadDaemonState(config);
    expect(restoredMain?.branchSignature).toBe(mainState.branchSignature);
    expect(restoredMain?.context.markdown).toBe(mainState.context.markdown);
  }, 15_000);

  it('watch once reuses a matching cached snapshot without rescanning', async () => {
    const existingState = await updateDaemonState(config);

    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const value = 999;\n', 'utf8');
    execSync('git checkout -- src/index.ts', { cwd: repoDir, stdio: 'ignore' });

    const status = await watchEcosystem(config, { once: true });

    expect(status.running).toBe(true);
    expect(status.updatedAt).toBe(existingState.updatedAt);

    const loaded = await loadDaemonState(config);
    expect(loaded?.updatedAt).toBe(existingState.updatedAt);
    expect(loaded?.context.markdown).toBe(existingState.context.markdown);
  }, 15_000);
});
