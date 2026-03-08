import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-03-07T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-07T12:00:00Z',
    },
  })
    .toString()
    .trim();
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function initRepo(root, email, name) {
  run('git', ['init', '-q'], root);
  run('git', ['config', 'user.email', email], root);
  run('git', ['config', 'user.name', name], root);
}

function commitAll(root, message) {
  run('git', ['add', '.'], root);
  run('git', ['commit', '-qm', message], root);
}

function createCliRunner(cliPath, cwd) {
  return (args) => run(process.execPath, [cliPath, ...args], cwd);
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} did not emit JSON: ${String(error)}`);
  }
}

function normalizeObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeObjectKeys(entry));
  }

  if (value && typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeObjectKeys(value[key]);
    }
    return normalized;
  }

  return value;
}

function keysOf(value) {
  return Object.keys(value ?? {}).sort();
}

function sectionHeadings(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .map((line) => line.trim());
}

function writeCoverage(repoPath, pct) {
  writeFile(
    repoPath,
    'coverage/coverage-summary.json',
    JSON.stringify(
      {
        total: {
          lines: {
            pct,
          },
        },
      },
      null,
      2,
    ),
  );
}

function writeTestResults(repoPath, passed, failed) {
  writeFile(
    repoPath,
    'test-results.json',
    JSON.stringify(
      {
        passed,
        failed,
      },
      null,
      2,
    ),
  );
}

function normalizeBasicContracts(scan, scanMarkdown, health, evolve, impact) {
  return normalizeObjectKeys({
    scan: {
      topLevelKeys: keysOf(scan),
      repoKeys: keysOf(scan.repos[0]),
      contractStatusKeys: keysOf(scan.contractStatus),
      evolutionSuggestionKeys: keysOf(scan.evolutionOpportunities[0]),
      conventionSummaryKeys: keysOf(scan.conventionSummary),
    },
    scanMarkdown: {
      headings: sectionHeadings(scanMarkdown),
    },
    health: {
      topLevelKeys: keysOf(health),
      perRepoKeys: keysOf(health.perRepo.backend),
    },
    evolve: {
      topLevelKeys: keysOf(evolve[0]),
    },
    impact: {
      topLevelKeys: keysOf(impact[0]),
      affectedKeys: keysOf(impact[0].affected[0]),
      triggerKeys: keysOf(impact[0].trigger),
    },
  });
}

function normalizeMaxContracts(owners, watch, review, publishReview, apply, rollback) {
  return normalizeObjectKeys({
    owners: {
      topLevelKeys: keysOf(owners),
      ownerKeys: keysOf(owners.owners[0]),
      perRepoKeys: keysOf(owners.perRepo),
    },
    watch: {
      topLevelKeys: keysOf(watch),
    },
    review: {
      topLevelKeys: keysOf(review),
      riskKeys: keysOf(review.risk),
      executionPlanKeys: keysOf(review.executionPlan),
      changeKeys: keysOf(review.executionPlan.changes[0]),
      rollbackKeys: keysOf(review.executionPlan.rollback),
    },
    publishReview: {
      topLevelKeys: keysOf(publishReview),
      capabilityKeys: keysOf(publishReview.capabilities),
      metadataKind: publishReview.metadata === null ? 'null' : typeof publishReview.metadata,
      targetKeys: keysOf(publishReview.target),
      commentKeys: keysOf(publishReview.comment),
      checkRunKeys: keysOf(publishReview.checkRun),
    },
    apply: {
      topLevelKeys: keysOf(apply),
    },
    rollback: {
      topLevelKeys: keysOf(rollback),
    },
  });
}

export async function runContractFixtureSmoke(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scratchRoot = options.scratchRoot ?? path.join(cwd, '.tmp');
  const cliPath = options.cliPath ?? path.join(cwd, 'dist', 'cli.js');
  const executeCli = options.executeCli ?? createCliRunner(cliPath, cwd);
  const logger = options.logger ?? console.log;
  const fixtureRoot = options.fixtureRoot ?? path.join(cwd, 'tests', 'fixtures', 'contracts');
  const compareFixtures = options.compareFixtures ?? true;
  const printContracts = options.printContracts ?? false;

  if (!options.executeCli) {
    assert(
      fs.existsSync(cliPath),
      'dist/cli.js not found. Run `npm run build` before `npm run smoke:contracts`.',
    );
  }

  fs.mkdirSync(scratchRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchRoot, 'omni-link-contracts-'));

  try {
    const backendDir = path.join(root, 'backend');
    const clientDir = path.join(root, 'client');
    const cacheDir = path.join(root, '.cache');
    const artifactPath = path.join(root, '.omni-link', 'review-artifact.json');
    const replayDirectory = path.join(root, '.omni-link', 'provider-replay');
    const daemonStatePath = path.join(root, '.omni-link', 'daemon-state.sqlite');
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    initRepo(backendDir, 'backend@example.com', 'Backend Contracts');
    initRepo(clientDir, 'client@example.com', 'Client Contracts');

    writeFile(
      backendDir,
      'src/routes/users.ts',
      `export interface User {
  id: string;
  email: string;
}

export interface CreateUserPayload {
  email: string;
}

const app = { get: (..._args) => undefined, post: (..._args) => undefined };
app.get('/api/users', (_req, res) => res.json({ users: [] }));
app.post('/api/users', (_req, res) => res.json({ id: '1', email: 'user@example.com' }));
`,
    );
    writeFile(
      backendDir,
      'package.json',
      JSON.stringify(
        {
          name: 'contracts-backend',
          version: '1.0.0',
          dependencies: { hono: '^4.0.0' },
        },
        null,
        2,
      ),
    );
    writeCoverage(backendDir, 94);
    writeTestResults(backendDir, 20, 0);
    commitAll(backendDir, 'backend init');

    writeFile(
      clientDir,
      'src/client.ts',
      `export async function fetchUsers() {
  const response = await fetch('/api/users').catch(() => ({ json: async () => [] }));
  return response.json();
}
`,
    );
    writeFile(
      clientDir,
      'package.json',
      JSON.stringify(
        {
          name: 'contracts-client',
          version: '1.0.0',
        },
        null,
        2,
      ),
    );
    writeCoverage(clientDir, 87);
    writeTestResults(clientDir, 16, 0);
    commitAll(clientDir, 'client init');

    writeFile(clientDir, 'src/uncommitted.ts', "export const changed = '/api/users';\n");
    writeFile(
      backendDir,
      'src/routes/users.ts',
      `export interface User {
  id: string;
  email: string;
  plan: string;
}

export interface CreateUserPayload {
  email: string;
}

const app = { get: (..._args) => undefined, post: (..._args) => undefined };
app.get('/api/users', (_req, res) => res.json({ users: [] }));
app.post('/api/users', (_req, res) =>
  res.json({ id: '1', email: 'user@example.com', plan: 'pro' }),
);
`,
    );
    commitAll(backendDir, 'backend contract change');

    const configPath = path.join(root, '.omni-link.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          repos: [
            { name: 'backend', path: backendDir, language: 'typescript', role: 'backend' },
            { name: 'client', path: clientDir, language: 'typescript', role: 'frontend' },
          ],
          evolution: {
            aggressiveness: 'moderate',
            maxSuggestionsPerSession: 5,
            categories: ['feature', 'performance', 'security'],
          },
          quality: {
            blockOnFailure: true,
            requireTestsForNewCode: true,
            conventionStrictness: 'strict',
          },
          context: {
            tokenBudget: 700,
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
            statePath: daemonStatePath,
            pollIntervalMs: 250,
            cacheRetentionDays: 7,
            workspaceGroups: {
              product: ['backend', 'client'],
            },
          },
          github: {
            enabled: true,
            owner: 'acme',
            repo: 'platform',
            defaultBaseBranch: 'main',
            artifactPath,
            publishMode: 'replay',
            replayDirectory,
          },
          automation: {
            enabled: true,
            branchPrefix: 'codex/omni-link',
            createPullRequest: false,
            retryLimit: 1,
            allowedRiskTiers: ['low', 'medium', 'high'],
            autoApplyRiskTiers: ['low', 'medium'],
            dryRunByDefault: true,
          },
          ownership: {
            enabled: true,
            defaultOwner: 'platform-team',
            rules: [
              { owner: 'backend-team', kind: 'team', scope: 'repo', repo: 'backend' },
              { owner: 'client-team', kind: 'team', scope: 'repo', repo: 'client' },
              { owner: 'api-team', kind: 'team', scope: 'api', pattern: '/api/*' },
            ],
          },
          runtime: {
            enabled: true,
            coverageSummaryPath: 'coverage/coverage-summary.json',
            testResultsPath: 'test-results.json',
          },
          policies: {
            enabled: true,
            protectedBranches: ['main'],
            requiredChecks: ['lint', 'test'],
            requiredOwners: ['backend-team'],
            maxAllowedRisk: 'high',
            forbidDirectMainMutation: true,
            forbidDestructiveChanges: true,
          },
          maxTier: {
            enabled: true,
            semanticAnalysis: {
              enabled: true,
              preferSemantic: true,
              confidenceThreshold: 0.6,
              languages: ['typescript', 'tsx', 'javascript'],
            },
            runtimeIngestion: {
              enabled: true,
            },
            execution: {
              enabled: true,
            },
          },
          simulateOnly: false,
        },
        null,
        2,
      ),
    );

    const scan = parseJson(await executeCli(['scan', '--config', configPath]), 'scan');
    const scanMarkdown = await executeCli(['scan', '--markdown', '--config', configPath]);
    const health = parseJson(await executeCli(['health', '--config', configPath]), 'health');
    const evolve = parseJson(await executeCli(['evolve', '--config', configPath]), 'evolve');
    const impact = parseJson(await executeCli(['impact', '--config', configPath]), 'impact');
    const owners = parseJson(await executeCli(['owners', '--config', configPath]), 'owners');
    const watch = parseJson(await executeCli(['watch', '--once', '--config', configPath]), 'watch');
    const review = parseJson(
      await executeCli(['review-pr', '--base', 'HEAD~1', '--head', 'HEAD', '--config', configPath]),
      'review-pr',
    );
    const publishReview = parseJson(
      await executeCli([
        'publish-review',
        '--pr',
        '42',
        '--base',
        'HEAD~1',
        '--head',
        'HEAD',
        '--config',
        configPath,
      ]),
      'publish-review',
    );
    const apply = parseJson(
      await executeCli(['apply', '--base', 'HEAD~1', '--head', 'HEAD', '--config', configPath]),
      'apply',
    );
    const rollback = parseJson(await executeCli(['rollback', '--config', configPath]), 'rollback');

    const actualBasic = normalizeBasicContracts(scan, scanMarkdown, health, evolve, impact);
    const actualMax = normalizeMaxContracts(owners, watch, review, publishReview, apply, rollback);

    if (printContracts) {
      logger(
        JSON.stringify(
          {
            basic: actualBasic,
            maxTier: actualMax,
          },
          null,
          2,
        ),
      );
    }

    if (compareFixtures) {
      const expectedBasic = normalizeObjectKeys(
        JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'basic.json'), 'utf8')),
      );
      const expectedMax = normalizeObjectKeys(
        JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'max-tier.json'), 'utf8')),
      );

      assert(
        JSON.stringify(actualBasic) === JSON.stringify(expectedBasic),
        'basic command contract fixture drift detected',
      );
      assert(
        JSON.stringify(actualMax) === JSON.stringify(expectedMax),
        'max-tier command contract fixture drift detected',
      );
    }

    const metrics = {
      basicCommandsLocked: Object.keys(actualBasic).length,
      maxCommandsLocked: Object.keys(actualMax).length,
      markdownSections: actualBasic.scanMarkdown.headings.length,
      reviewPlanKeys: actualMax.review.executionPlanKeys.length,
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
  await runContractFixtureSmoke();
}
