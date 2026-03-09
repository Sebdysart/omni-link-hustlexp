import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runCliSmoke } from './cli-smoke.mjs';
import { runMaxTierSmoke } from './max-tier-smoke.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
    .toString()
    .trim();
}

function parsePackJson(output) {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0].filename !== 'string') {
    throw new Error('npm pack --json did not return a tarball filename');
  }
  return parsed[0].filename;
}

export async function runPackageInstallSmoke(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scratchRoot = options.scratchRoot ?? path.join(cwd, '.tmp');
  const logger = options.logger ?? console.log;
  const rootPackage = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const packageName = rootPackage.name ?? 'omni-link';

  fs.mkdirSync(scratchRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchRoot, 'omni-link-package-'));

  try {
    const packRoot = path.join(root, 'pack');
    const installRoot = path.join(root, 'install');
    fs.mkdirSync(packRoot, { recursive: true });
    fs.mkdirSync(installRoot, { recursive: true });

    const tarballName = parsePackJson(run('npm', ['pack', cwd, '--json'], packRoot));
    const tarballPath = path.join(packRoot, tarballName);
    assert(fs.existsSync(tarballPath), 'expected npm pack to create a tarball');

    fs.writeFileSync(
      path.join(installRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'omni-link-package-smoke',
          private: true,
          version: '1.0.0',
        },
        null,
        2,
      ),
    );

    run('npm', ['install', tarballPath], installRoot);

    const installedPackageRoot = path.join(installRoot, 'node_modules', packageName);
    const installedCliPath = path.join(installedPackageRoot, 'dist', 'cli.js');
    assert(
      fs.existsSync(installedPackageRoot),
      `expected ${packageName} to install into node_modules`,
    );
    assert(fs.existsSync(installedCliPath), 'expected installed dist/cli.js to exist');

    const installedPkg = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, 'package.json'), 'utf8'),
    );

    const cliMetrics = await runCliSmoke({
      cwd: installRoot,
      scratchRoot: path.join(installRoot, '.tmp'),
      cliPath: installedCliPath,
      logger: () => undefined,
    });
    const maxMetrics = await runMaxTierSmoke({
      cwd: installRoot,
      scratchRoot: path.join(installRoot, '.tmp'),
      cliPath: installedCliPath,
      logger: () => undefined,
    });

    const metrics = {
      installedVersion: installedPkg.version,
      cliRepos: cliMetrics.repos,
      cliImpactPaths: cliMetrics.impactPaths,
      maxRepos: maxMetrics.repos,
      maxWatchRunning: maxMetrics.watchRunning,
      maxPlannedChanges: maxMetrics.plannedChanges,
      maxPublishMode: maxMetrics.publishedReviewMode,
      maxGitLabPublishMode: maxMetrics.gitlabPublishedReviewMode,
    };

    logger(JSON.stringify(metrics, null, 2));
    return metrics;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  await runPackageInstallSmoke();
}
