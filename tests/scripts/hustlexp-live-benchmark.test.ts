import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authorityStatus,
  health,
  impactFromUncommitted,
  reviewPr,
  scan,
  watch,
} from '../../engine/index.js';
import { loadConfig } from '../../engine/config.js';

const fixtureSource = path.resolve(import.meta.dirname!, '..', 'fixtures', 'hustlexp-workspace');

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@omni-link.dev"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Fixture"', { cwd: dir, stdio: 'ignore' });
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "fixture"', { cwd: dir, stdio: 'ignore' });
}

describe('scripts/hustlexp-live-benchmark', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const next = tempRoots.pop();
      if (next) {
        fs.rmSync(next, { recursive: true, force: true });
      }
    }
  });

  it('benchmarks the HustleXP fixture with warm daemon expectations', async () => {
    const { runHustleXpLiveBenchmark } = await import('../../scripts/hustlexp-live-benchmark.mjs');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-hustlexp-benchmark-'));
    tempRoots.push(tempRoot);
    const fixtureRoot = path.join(tempRoot, 'fixtures');
    copyDirRecursive(fixtureSource, fixtureRoot);
    for (const sub of ['ios', 'backend', 'docs']) {
      initGitRepo(path.join(fixtureRoot, sub));
    }
    const configPath = path.join(tempRoot, '.omni-link.json');

    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          workflowProfile: 'hustlexp',
          simulateOnly: false,
          repos: [
            {
              name: 'hustlexp-ios',
              path: path.join(fixtureRoot, 'ios'),
              language: 'swift',
              role: 'ios-client',
            },
            {
              name: 'hustlexp-backend',
              path: path.join(fixtureRoot, 'backend'),
              language: 'typescript',
              role: 'backend-api',
            },
            {
              name: 'hustlexp-docs',
              path: path.join(fixtureRoot, 'docs'),
              language: 'javascript',
              role: 'product-governance',
            },
          ],
          cache: {
            directory: path.join(tempRoot, '.cache'),
            maxAgeDays: 7,
          },
          daemon: {
            enabled: true,
            preferDaemon: true,
            statePath: path.join(tempRoot, '.omni-link-daemon-state.sqlite'),
          },
          automation: {
            enabled: true,
            dryRunByDefault: false,
          },
        },
        null,
        2,
      ),
    );

    const summary = await runHustleXpLiveBenchmark({
      configPath,
      logger: () => undefined,
      engine: {
        loadConfig,
        watch,
        authorityStatus,
        scan,
        health,
        impactFromUncommitted,
        reviewPr,
      },
      minDocsProcedures: 2,
      minBackendProcedures: 2,
      minIosCalls: 3,
      minBridges: 2,
      maxObsoleteCalls: 10,
      minAuthorityFindings: 1,
      minHealthOverall: 1,
      maxColdWatchMs: 30000,
      maxWarmWatchMs: 30000,
      maxAuthorityMs: 30000,
      maxWarmScanMs: 30000,
      maxHealthMs: 30000,
      maxImpactMs: 30000,
      maxReviewMs: 30000,
    });

    expect(summary.scan.authorityPhase).toBe('BOOTSTRAP');
    expect(summary.authority.blockedApply).toBe(true);
    expect(summary.authority.bridges).toBeGreaterThanOrEqual(2);
    expect(summary.review.blocked).toBe(true);
  }, 60000);
});
