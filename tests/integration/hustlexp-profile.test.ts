import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  apply,
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

describe('HustleXP workflow profile integration', () => {
  let tempRoot: string;
  let fixtureRoot: string;
  let configPath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-hustlexp-profile-'));
    fixtureRoot = path.join(tempRoot, 'fixtures');
    copyDirRecursive(fixtureSource, fixtureRoot);
    for (const sub of ['ios', 'backend', 'docs']) {
      initGitRepo(path.join(fixtureRoot, sub));
    }
    configPath = path.join(tempRoot, '.omni-link.json');
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
  }, 30_000);

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('scans the HustleXP fixture, exposes authority drift, and blocks apply', async () => {
    const config = loadConfig(configPath);

    const scanResult = await scan(config);
    const watchStatus = await watch(config, { once: true });
    const warmScanResult = await scan(config);
    const healthResult = await health(config);
    const impactResult = await impactFromUncommitted(config);
    const reviewArtifact = await reviewPr(config, 'main', 'HEAD');
    const authorityResult = await authorityStatus(config);
    const applyResult = await apply(config, 'main', 'HEAD');

    expect(config.workflowProfile).toBe('hustlexp');
    expect(config.authority?.enabled).toBe(true);
    expect(config.bridges?.swiftTrpc?.enabled).toBe(true);
    expect(scanResult.graph.authority?.currentPhase).toBe('BOOTSTRAP');
    expect(watchStatus.running).toBe(true);
    expect(warmScanResult.graph.authority?.currentPhase).toBe('BOOTSTRAP');
    expect(scanResult.graph.bridges.length).toBeGreaterThan(0);
    expect(warmScanResult.graph.bridges.length).toBeGreaterThan(0);
    expect(scanResult.graph.bridges.some((bridge) => bridge.provider.route === 'task.create')).toBe(
      true,
    );
    expect(
      warmScanResult.graph.bridges.some((bridge) => bridge.provider.route === 'task.create'),
    ).toBe(true);
    expect(
      (scanResult.graph.findings ?? []).some((finding) => finding.kind === 'authority_drift'),
    ).toBe(true);
    expect(
      (warmScanResult.graph.findings ?? []).some((finding) => finding.kind === 'authority_drift'),
    ).toBe(true);
    expect(scanResult.context.digest.authorityStatus?.findingCount).toBeGreaterThan(0);
    expect(scanResult.context.digest.reviewFindingSummary?.authority_drift).toBeGreaterThan(0);
    expect(healthResult.overall).toBeGreaterThan(0);
    expect(impactResult).toEqual([]);
    expect(reviewArtifact.findings.some((finding) => finding.kind === 'authority_drift')).toBe(
      true,
    );
    expect(authorityResult.procedureCoverage.backend).toBeGreaterThan(0);
    expect(authorityResult.procedureCoverage.iosCalls).toBeGreaterThan(0);
    expect(authorityResult.procedureCoverage.obsoleteCalls).toContain('legacy.oldProcedure');
    expect(authorityResult.recommendations).toEqual(
      expect.arrayContaining([
        'reconcile CURRENT_PHASE.md upward to the implemented app/backend state',
      ]),
    );
    expect(reviewArtifact.executionPlan?.blocked).toBe(true);
    expect(applyResult.executed).toBe(false);
    expect(applyResult.warnings).toContain('execution blocked by policy');
    expect(
      reviewArtifact.contractMismatches.some(
        (mismatch) =>
          mismatch.description.includes('legacy.oldProcedure') ||
          mismatch.description.includes('notification.getList'),
      ),
    ).toBe(true);
    expect(
      reviewArtifact.contractMismatches.some(
        (mismatch) =>
          mismatch.provider.file.includes('reference/components') ||
          mismatch.provider.file.includes('src/index.ts'),
      ),
    ).toBe(false);
  }, 60_000);
});
