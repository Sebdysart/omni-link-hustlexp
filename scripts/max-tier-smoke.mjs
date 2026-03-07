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

export async function runMaxTierSmoke(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scratchRoot = options.scratchRoot ?? path.join(cwd, '.tmp');
  const cliPath = options.cliPath ?? path.join(cwd, 'dist', 'cli.js');
  const executeCli = options.executeCli ?? createCliRunner(cliPath, cwd);
  const logger = options.logger ?? console.log;

  if (!options.executeCli) {
    assert(
      fs.existsSync(cliPath),
      'dist/cli.js not found. Run `npm run build` before `npm run smoke:max`.',
    );
  }

  fs.mkdirSync(scratchRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchRoot, 'omni-link-max-'));

  try {
    const backendDir = path.join(root, 'backend');
    const clientDir = path.join(root, 'client');
    const cacheDir = path.join(root, '.cache');
    const artifactPath = path.join(root, '.omni-link', 'review-artifact.json');
    const daemonStatePath = path.join(root, '.omni-link', 'daemon-state.json');
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    initRepo(backendDir, 'backend@example.com', 'Backend Smoke');
    initRepo(clientDir, 'client@example.com', 'Client Smoke');

    writeFile(
      backendDir,
      'src/routes/users.ts',
      `export interface User {
  id: string;
  email: string;
}

const app = { get: (..._args) => undefined, post: (..._args) => undefined };
app.get('/api/users', (_req, res) => res.json({ users: [] }));
app.post('/api/users', (_req, res) => res.json({ id: '1', email: 'user@example.com' }));
`,
    );
    writeFile(
      backendDir,
      'src/types/user.ts',
      `export interface UserPayload {
  email: string;
}
`,
    );
    writeFile(
      backendDir,
      'package.json',
      JSON.stringify(
        {
          name: 'max-backend',
          version: '1.0.0',
          dependencies: { hono: '^4.0.0' },
        },
        null,
        2,
      ),
    );
    writeCoverage(backendDir, 92);
    writeTestResults(backendDir, 24, 1);
    commitAll(backendDir, 'backend init');

    writeFile(
      clientDir,
      'src/client.ts',
      `import type { UserPayload } from '../../backend/src/types/user';

export async function fetchUsers(): Promise<UserPayload[]> {
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
          name: 'max-client',
          version: '1.0.0',
        },
        null,
        2,
      ),
    );
    writeCoverage(clientDir, 88);
    writeTestResults(clientDir, 18, 0);
    commitAll(clientDir, 'client init');

    writeFile(
      backendDir,
      'src/routes/users.ts',
      `export interface User {
  id: string;
  email: string;
  plan: string;
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
            enabled: false,
            defaultBaseBranch: 'main',
            artifactPath,
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
    const owners = parseJson(await executeCli(['owners', '--config', configPath]), 'owners');
    const watch = parseJson(await executeCli(['watch', '--once', '--config', configPath]), 'watch');
    const impact = parseJson(
      await executeCli(['impact', '--base', 'HEAD~1', '--head', 'HEAD', '--config', configPath]),
      'impact',
    );
    const review = parseJson(
      await executeCli(['review-pr', '--base', 'HEAD~1', '--head', 'HEAD', '--config', configPath]),
      'review-pr',
    );
    const apply = parseJson(
      await executeCli(['apply', '--base', 'HEAD~1', '--head', 'HEAD', '--config', configPath]),
      'apply',
    );
    const rollback = parseJson(await executeCli(['rollback', '--config', configPath]), 'rollback');

    assert(Array.isArray(scan.repos) && scan.repos.length === 2, 'scan should emit 2 repos');
    assert(
      Array.isArray(owners.owners) && owners.owners.some((entry) => entry.owner === 'backend-team'),
      'owners should resolve backend-team',
    );
    assert(watch.running === true && watch.repoCount === 2, 'watch should persist daemon state');
    assert(Array.isArray(impact), 'impact should emit an array');
    assert(
      review.executionPlan && review.executionPlan.branchName,
      'review-pr should emit an execution plan',
    );
    assert(fs.existsSync(artifactPath), 'review-pr should persist the review artifact');
    assert(apply.executed === false, 'apply should remain a dry run in smoke mode');
    assert(Array.isArray(rollback.branches), 'rollback should emit branch results');

    const metrics = {
      repos: scan.repos.length,
      ownerCount: owners.owners.length,
      watchRunning: watch.running,
      impactPaths: impact.length,
      reviewRisk: review.risk.overallRisk,
      plannedChanges: review.executionPlan.changes.length,
      dryRunApply: apply.executed,
      rollbackBranches: rollback.branches.length,
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
  await runMaxTierSmoke();
}
