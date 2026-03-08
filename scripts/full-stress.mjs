import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runBenchmarkSmoke } from './benchmark-smoke.mjs';
import { runCliSmoke } from './cli-smoke.mjs';
import { runContractFixtureSmoke } from './contract-fixture-smoke.mjs';
import { runMaxTierSmoke } from './max-tier-smoke.mjs';
import { runPackageInstallSmoke } from './package-install-smoke.mjs';

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
  run('git', ['branch', '-M', 'main'], root);
}

function commitAll(root, message) {
  run('git', ['add', '.'], root);
  run('git', ['commit', '-qm', message], root);
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

async function loadEngine(engine) {
  if (engine) {
    return engine;
  }

  const moduleUrl = new URL('../dist/index.js', import.meta.url);
  assert(fs.existsSync(fileURLToPath(moduleUrl)), 'dist/index.js not found. Run `npm run build`.');
  return import(moduleUrl.href);
}

async function loadProviders(providers) {
  if (providers) {
    return providers;
  }

  const moduleUrl = new URL('../dist/providers/index.js', import.meta.url);
  assert(
    fs.existsSync(fileURLToPath(moduleUrl)),
    'dist/providers/index.js not found. Run `npm run build`.',
  );
  return import(moduleUrl.href);
}

function createDirectEngineConfig(root, repos, options = {}) {
  const cacheDir = path.join(root, '.cache');
  const replayDirectory = path.join(root, '.omni-link', 'provider-replay');
  const artifactPath = path.join(root, '.omni-link', 'review-artifact.json');
  const gitlabArtifactPath = path.join(root, '.omni-link', 'review-artifact.gitlab.json');
  const daemonStatePath = path.join(root, '.omni-link', 'daemon-state.sqlite');

  fs.mkdirSync(cacheDir, { recursive: true });

  return {
    repos,
    reviewProvider: options.reviewProvider ?? 'github',
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 8,
      categories: ['feature', 'performance', 'security', 'scale'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 900,
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
      pollIntervalMs: 200,
      cacheRetentionDays: 7,
      workspaceGroups: {
        product: repos.map((repo) => repo.name),
      },
    },
    github: {
      enabled: true,
      owner: 'acme',
      repo: 'platform',
      defaultBaseBranch: 'main',
      artifactPath,
      publishMode: options.githubPublishMode ?? 'replay',
      replayDirectory,
      apiUrl: 'https://api.github.test',
    },
    gitlab: {
      enabled: true,
      namespace: 'acme',
      project: 'platform',
      defaultBaseBranch: 'main',
      artifactPath: gitlabArtifactPath,
      publishMode: options.gitlabPublishMode ?? 'replay',
      replayDirectory,
      apiUrl: 'https://gitlab.test/api/v4',
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
        { owner: 'web-team', kind: 'team', scope: 'repo', repo: 'web-client' },
        { owner: 'admin-team', kind: 'team', scope: 'repo', repo: 'admin-client' },
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
        languages: ['typescript', 'tsx', 'javascript', 'python', 'go', 'graphql', 'java', 'swift'],
      },
      runtimeIngestion: {
        enabled: true,
      },
      execution: {
        enabled: true,
      },
    },
    simulateOnly: false,
  };
}

async function runEngineStress(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scratchRoot = options.scratchRoot ?? path.join(cwd, '.tmp');
  const logger = options.logger ?? console.log;
  const engine = await loadEngine(options.engine);
  const providers = await loadProviders(options.providers);

  fs.mkdirSync(scratchRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchRoot, 'omni-link-engine-stress-'));

  try {
    const backendDir = path.join(root, 'backend');
    const webDir = path.join(root, 'web-client');
    const adminDir = path.join(root, 'admin-client');
    const goDir = path.join(root, 'go-service');
    const pythonDir = path.join(root, 'python-service');
    const graphqlDir = path.join(root, 'graphql-contracts');
    const javaDir = path.join(root, 'java-service');
    const swiftDir = path.join(root, 'swift-sdk');

    for (const [repoDir, email, name] of [
      [backendDir, 'backend@example.com', 'Backend Stress'],
      [webDir, 'web@example.com', 'Web Stress'],
      [adminDir, 'admin@example.com', 'Admin Stress'],
      [goDir, 'go@example.com', 'Go Stress'],
      [pythonDir, 'python@example.com', 'Python Stress'],
      [graphqlDir, 'graphql@example.com', 'GraphQL Stress'],
      [javaDir, 'java@example.com', 'Java Stress'],
      [swiftDir, 'swift@example.com', 'Swift Stress'],
    ]) {
      fs.mkdirSync(repoDir, { recursive: true });
      initRepo(repoDir, email, name);
    }

    writeFile(
      backendDir,
      'src/routes/users.ts',
      `export interface User {
  id: string;
  email: string;
}

const app = { get: (..._args) => undefined };
app.get('/api/users', (_req, res) => res.json({ users: [] }));
`,
    );
    writeFile(
      backendDir,
      'src/types/user.ts',
      `export interface UserPayload {
  id: string;
  email: string;
}
`,
    );
    writeFile(
      backendDir,
      'package.json',
      JSON.stringify({ name: 'stress-backend', version: '1.0.0' }, null, 2),
    );
    writeCoverage(backendDir, 94);
    writeTestResults(backendDir, 28, 0);
    commitAll(backendDir, 'backend init');

    writeFile(
      webDir,
      'src/client.ts',
      `interface UserPayload {
  id: string;
  email: string;
}

export async function fetchUsers(): Promise<UserPayload[]> {
  const response = await fetch('/api/users').catch(() => ({ json: async () => [] }));
  return response.json();
}
`,
    );
    writeFile(
      webDir,
      'package.json',
      JSON.stringify({ name: 'stress-web-client', version: '1.0.0' }, null, 2),
    );
    writeCoverage(webDir, 89);
    writeTestResults(webDir, 22, 0);
    commitAll(webDir, 'web init');

    writeFile(
      adminDir,
      'src/admin.ts',
      `export async function loadAdminUsers() {
  const response = await fetch('/api/users');
  return response.json();
}
`,
    );
    writeFile(
      adminDir,
      'package.json',
      JSON.stringify({ name: 'stress-admin-client', version: '1.0.0' }, null, 2),
    );
    writeCoverage(adminDir, 86);
    writeTestResults(adminDir, 18, 1);
    commitAll(adminDir, 'admin init');

    writeFile(
      goDir,
      'pkg/user.go',
      `package pkg

type User struct {
  ID string
  Email string
}

func GetUser() User {
  return User{}
}
`,
    );
    commitAll(goDir, 'go init');

    writeFile(
      pythonDir,
      'app/models.py',
      `
class User:
    id: str
    email: str
`,
    );
    writeFile(
      pythonDir,
      'app/api.py',
      `
from .models import User

@app.get("/api/python-users")
def list_users() -> list[User]:
    return []
`,
    );
    writeCoverage(pythonDir, 88);
    writeTestResults(pythonDir, 15, 0);
    commitAll(pythonDir, 'python init');

    writeFile(
      graphqlDir,
      'schema.graphql',
      `
type Query {
  product(id: ID!): Product
}

type Product {
  id: ID!
  name: String!
  owner: User
}

type User {
  id: ID!
  email: String!
}

input UpdateProductInput {
  name: String!
}
`,
    );
    writeFile(
      graphqlDir,
      'operations.graphql',
      `
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    name
  }
}
`,
    );
    writeCoverage(graphqlDir, 92);
    writeTestResults(graphqlDir, 12, 0);
    commitAll(graphqlDir, 'graphql init');

    writeFile(
      javaDir,
      'src/main/java/com/acme/models/User.java',
      `
package com.acme.models;

public record User(String id, String email) {}
`,
    );
    writeFile(
      javaDir,
      'src/main/java/com/acme/api/UserController.java',
      `
package com.acme.api;

import com.acme.models.User;

@RequestMapping("/api/java")
public class UserController {
  @GetMapping("/users")
  public User listUsers() {
    return new User("1", "java@example.com");
  }
}
`,
    );
    writeCoverage(javaDir, 84);
    writeTestResults(javaDir, 11, 0);
    commitAll(javaDir, 'java init');

    writeFile(
      swiftDir,
      'Sources/Models/User.swift',
      `
struct User {
  let id: String
  let email: String
}
`,
    );
    writeFile(
      swiftDir,
      'Sources/Services/UserService.swift',
      `
struct UserService {
  func loadUsers() -> [User] {
    [User(id: "1", email: "swift@example.com")]
  }
}
`,
    );
    writeCoverage(swiftDir, 83);
    writeTestResults(swiftDir, 9, 0);
    commitAll(swiftDir, 'swift init');

    writeFile(
      backendDir,
      'src/routes/users.ts',
      `export interface User {
  id: string;
  email: string;
  plan: string;
}

const app = { get: (..._args) => undefined };
app.get('/api/users', (_req, res) => res.json({ users: [{ id: '1', email: 'user@example.com', plan: 'pro' }] }));
`,
    );
    commitAll(backendDir, 'backend contract change');

    const config = createDirectEngineConfig(root, [
      { name: 'backend', path: backendDir, language: 'typescript', role: 'backend' },
      { name: 'web-client', path: webDir, language: 'typescript', role: 'frontend' },
      { name: 'admin-client', path: adminDir, language: 'typescript', role: 'frontend' },
      { name: 'go-service', path: goDir, language: 'go', role: 'backend' },
      { name: 'python-service', path: pythonDir, language: 'python', role: 'backend' },
      { name: 'graphql-contracts', path: graphqlDir, language: 'graphql', role: 'schema' },
      { name: 'java-service', path: javaDir, language: 'java', role: 'backend' },
      { name: 'swift-sdk', path: swiftDir, language: 'swift', role: 'sdk' },
    ]);

    const scanResult = await engine.scan(config);
    const refreshed = await engine.refreshDaemonState(config);
    const watchStatus = await engine.watch(config, { once: true });
    const health = await engine.health(config);
    const evolve = await engine.evolve(config);
    const owners = await engine.owners(config);
    const impactFromRefs = await engine.impactFromRefs(config, 'HEAD~1', 'HEAD');
    const review = await engine.reviewPr(config, 'HEAD~1', 'HEAD');
    const repeatedReview = await engine.reviewPr(config, 'HEAD~1', 'HEAD');
    const publishGitHub = await engine.publishReview(config, 42, 'HEAD~1', 'HEAD');

    const gitlabConfig = {
      ...config,
      reviewProvider: 'gitlab',
    };
    const publishGitLab = await engine.publishReview(gitlabConfig, 43, 'HEAD~1', 'HEAD');
    const apply = await engine.apply(config, 'HEAD~1', 'HEAD');
    const rollback = await engine.rollback(config);
    const quality = await engine.qualityCheck(
      fs.readFileSync(path.join(webDir, 'src/client.ts'), 'utf8'),
      path.join(webDir, 'src/client.ts'),
      config,
    );

    fs.appendFileSync(
      path.join(backendDir, 'src/routes/users.ts'),
      '\n// uncommitted stress change\n',
      'utf8',
    );
    const impactFromUncommitted = await engine.impactFromUncommitted(config);

    const liveConfig = createDirectEngineConfig(
      root,
      [
        { name: 'backend', path: backendDir, language: 'typescript', role: 'backend' },
        { name: 'web-client', path: webDir, language: 'typescript', role: 'frontend' },
      ],
      {
        reviewProvider: 'github',
        githubPublishMode: 'github',
      },
    );
    const originalGitHubToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'stress-token';
    const liveFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        state: 'open',
        locked: false,
        title: 'Stress cache reuse',
        html_url: 'https://github.test/acme/platform/pull/99',
        draft: false,
        head: {
          sha: 'stress-meta-sha',
          ref: 'feature/stress-cache',
        },
        base: {
          ref: 'main',
        },
      }),
    });
    let liveMetadataFetches = 0;
    try {
      const fetchImpl = async (...args) => {
        liveMetadataFetches += 1;
        return liveFetch(...args);
      };
      const liveSnapshotKey = {
        configSha: 'stress-cfg',
        branchSignature: 'backend:main:stress-head:000000000000',
        baseRef: 'main',
        headRef: 'HEAD',
      };
      const firstLiveContext = await providers.negotiateReviewPublishContext(
        liveConfig,
        {
          pullRequestNumber: 99,
        },
        {
          snapshotKey: liveSnapshotKey,
          fetchImpl,
        },
      );
      const secondLiveContext = await providers.negotiateReviewPublishContext(
        liveConfig,
        {
          pullRequestNumber: 99,
        },
        {
          snapshotKey: liveSnapshotKey,
          fetchImpl,
        },
      );
      assert(
        firstLiveContext.target.headSha === 'stress-meta-sha' &&
          secondLiveContext.target.headSha === 'stress-meta-sha',
        'live provider metadata should hydrate the publish target head SHA',
      );
      assert(
        liveMetadataFetches === 1,
        'live provider metadata should be reused from the snapshot cache',
      );
    } finally {
      if (originalGitHubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalGitHubToken;
      }
    }

    assert(scanResult.manifests.length === 8, 'engine stress scan should include all repos');
    assert(
      refreshed.manifests.length === 8,
      'refreshDaemonState should preserve the full repo set',
    );
    assert(watchStatus.running === true, 'watch once should report a running daemon state');
    assert(health.overall > 0, 'health should compute an overall score');
    assert(evolve.length > 0, 'evolve should produce suggestions');
    assert(owners.owners.length >= 3, 'owners should resolve configured ownership rules');
    assert(impactFromRefs.length > 0, 'impactFromRefs should detect the backend contract change');
    assert(review.executionPlan?.changes.length > 0, 'reviewPr should produce an execution plan');
    assert(
      repeatedReview.generatedAt === review.generatedAt,
      'reviewPr should reuse the cached snapshot',
    );
    assert(publishGitHub.mode === 'replay', 'GitHub publish should stay in replay mode for stress');
    assert(publishGitLab.provider === 'gitlab', 'GitLab publish should select the GitLab provider');
    assert(apply.executed === false, 'apply should remain a dry run');
    assert(Array.isArray(rollback.branches), 'rollback should emit a branch result list');
    assert(quality.references.valid, 'qualityCheck should remain valid for the sample client');
    assert(
      impactFromUncommitted.length > 0,
      'impactFromUncommitted should detect the uncommitted backend route change',
    );

    const metrics = {
      repos: scanResult.manifests.length,
      languages: [...new Set(scanResult.manifests.map((manifest) => manifest.language))].sort(),
      bridges: scanResult.graph.bridges.length,
      watchRunning: watchStatus.running,
      overallHealth: health.overall,
      evolutionSuggestions: evolve.length,
      owners: owners.owners.length,
      refImpactPaths: impactFromRefs.length,
      uncommittedImpactPaths: impactFromUncommitted.length,
      reviewRisk: review.risk.overallRisk,
      plannedChanges: review.executionPlan?.changes.length ?? 0,
      githubPublishMode: publishGitHub.mode,
      gitlabPublishMode: publishGitLab.mode,
      dryRunApply: apply.executed,
      applyLedgerEntries: apply.ledger.length,
      rollbackLedgerEntries: rollback.ledger.length,
      rollbackBranches: rollback.branches.length,
      liveMetadataFetches,
      tokenCount: scanResult.context.digest.tokenCount,
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };

    logger(JSON.stringify(metrics, null, 2));
    return metrics;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runFullStress(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scratchRoot = options.scratchRoot ?? path.join(cwd, '.tmp');
  const logger = options.logger ?? console.log;
  const summary = {
    engine: await runEngineStress({
      cwd,
      scratchRoot: path.join(scratchRoot, 'engine'),
      logger: () => undefined,
      engine: options.engine,
      providers: options.providers,
    }),
    cli: await runCliSmoke({
      cwd,
      scratchRoot: path.join(scratchRoot, 'cli'),
      logger: () => undefined,
      cliPath: options.cliPath,
      executeCli: options.executeCli,
    }),
    maxTier: await runMaxTierSmoke({
      cwd,
      scratchRoot: path.join(scratchRoot, 'max'),
      logger: () => undefined,
      cliPath: options.cliPath,
      executeCli: options.executeCli,
    }),
    contracts: await runContractFixtureSmoke({
      cwd,
      scratchRoot: path.join(scratchRoot, 'contracts'),
      logger: () => undefined,
      cliPath: options.cliPath,
      executeCli: options.executeCli,
    }),
    benchmark: await runBenchmarkSmoke({
      cwd,
      scratchRoot: path.join(scratchRoot, 'benchmark'),
      logger: () => undefined,
      engine: options.engine,
      backendRouteCount: options.backendRouteCount ?? 120,
      clientRouteCount: options.clientRouteCount ?? 120,
      goFileCount: options.goFileCount ?? 60,
      minimumBridges: options.minimumBridges ?? 180,
      maxRuntimeMs: options.maxRuntimeMs ?? 30000,
    }),
  };

  if (!options.skipPackage) {
    summary.packageInstall = await runPackageInstallSmoke({
      cwd,
      scratchRoot: path.join(scratchRoot, 'package'),
      logger: () => undefined,
    });
  }

  logger(JSON.stringify(summary, null, 2));
  return summary;
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  await runFullStress();
}
