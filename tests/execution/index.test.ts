import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync,
}));

import { applyExecutionPlan, rollbackExecutionPlan } from '../../engine/execution/index.js';
import type { ExecutionPlan, OmniLinkConfig } from '../../engine/types.js';

function makeConfig(overrides: Partial<OmniLinkConfig> = {}): OmniLinkConfig {
  return {
    repos: [
      { name: 'backend', path: '/tmp/backend', language: 'typescript', role: 'backend' },
      { name: 'client', path: '/tmp/client', language: 'typescript', role: 'client' },
    ],
    reviewProvider: 'github',
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
      directory: '/tmp/cache',
      maxAgeDays: 7,
    },
    github: {
      enabled: true,
      owner: 'acme',
      repo: 'backend',
      defaultBaseBranch: 'main',
    },
    automation: {
      enabled: true,
      branchPrefix: 'codex/omni-link',
      createPullRequest: false,
      retryLimit: 2,
      allowedRiskTiers: ['low', 'medium'],
      autoApplyRiskTiers: ['low'],
      dryRunByDefault: false,
    },
    ...overrides,
  };
}

function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    planId: 'plan-1',
    mode: 'branch-pr',
    branchName: 'codex/omni-link/plan-1',
    baseBranch: 'main',
    changes: [
      {
        id: 'consumer-update-1',
        kind: 'consumer-update',
        title: 'Update client',
        description: 'Update the client after backend contract changes.',
        repo: 'backend',
        files: ['src/routes/users.ts'],
        confidence: 0.9,
        risk: 'medium',
        dependsOn: [],
        preconditions: [],
        validationSteps: ['lint', 'test', 'build'],
        rollbackSteps: ['delete branch'],
      },
    ],
    risk: {
      overallRisk: 'medium',
      score: 55,
      reasons: [],
      affectedRepos: ['backend'],
      blockedByPolicy: false,
    },
    approvals: ['platform-team'],
    blocked: false,
    policyDecisions: [],
    rollback: {
      steps: ['delete branch'],
      restoreTargets: ['src/routes/users.ts'],
      branchName: 'codex/omni-link/plan-1',
    },
    pullRequest: {
      title: 'omni-link plan',
      body: 'body',
    },
    ...overrides,
  };
}

describe('execution', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    vi.unstubAllEnvs();
  });

  it('does not execute when automation is disabled', () => {
    const result = applyExecutionPlan(
      makeConfig({
        automation: {
          enabled: false,
          branchPrefix: 'codex/omni-link',
          createPullRequest: false,
          retryLimit: 2,
          allowedRiskTiers: ['low', 'medium'],
          autoApplyRiskTiers: ['low'],
          dryRunByDefault: false,
        },
      }),
      makePlan(),
    );

    expect(result.executed).toBe(false);
    expect(result.warnings).toContain('automation is disabled');
    expect(result.ledger).toEqual([
      expect.objectContaining({
        kind: 'preflight',
        status: 'failed',
      }),
    ]);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('does not execute when the plan risk exceeds allowed risk tiers', () => {
    const result = applyExecutionPlan(
      makeConfig(),
      makePlan({
        risk: {
          overallRisk: 'critical',
          score: 90,
          reasons: [],
          affectedRepos: ['backend'],
          blockedByPolicy: false,
        },
      }),
    );

    expect(result.executed).toBe(false);
    expect(result.warnings).toContain("risk tier 'critical' is not allowed for execution");
    expect(result.ledger).toEqual([
      expect.objectContaining({
        kind: 'preflight',
        status: 'failed',
      }),
    ]);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('creates a branch without checking it out when the worktree is clean', () => {
    execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command !== 'git') return '';
      const serialized = args.join(' ');
      if (serialized.includes('status --porcelain')) return '';
      if (serialized.includes('rev-parse --verify codex/omni-link/plan-1')) {
        throw new Error('missing branch');
      }
      if (serialized.includes('rev-parse --verify main')) return '';
      if (serialized.includes('branch codex/omni-link/plan-1 main')) return '';
      throw new Error(`Unexpected git call: ${serialized}`);
    });

    const result = applyExecutionPlan(makeConfig(), makePlan());

    expect(result.executed).toBe(true);
    expect(result.branches).toEqual([
      { repo: 'backend', branch: 'codex/omni-link/plan-1', created: true },
    ]);
    expect(result.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'branch',
          repo: 'backend',
          status: 'passed',
        }),
        expect.objectContaining({
          kind: 'push',
          repo: 'backend',
          status: 'skipped',
        }),
      ]),
    );
    expect(
      execFileSync.mock.calls.some(
        ([command, args]) => command === 'git' && Array.isArray(args) && args.includes('checkout'),
      ),
    ).toBe(false);
    expect(
      execFileSync.mock.calls.some(
        ([command, args]) =>
          command === 'git' &&
          Array.isArray(args) &&
          args.join(' ') === '-C /tmp/backend branch codex/omni-link/plan-1 main',
      ),
    ).toBe(true);
  });

  it('blocks execution on dirty worktrees', () => {
    execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command !== 'git') return '';
      const serialized = args.join(' ');
      if (serialized.includes('status --porcelain')) return ' M src/routes/users.ts';
      throw new Error(`Unexpected git call: ${serialized}`);
    });

    const result = applyExecutionPlan(makeConfig(), makePlan());

    expect(result.executed).toBe(false);
    expect(result.branches).toEqual([
      {
        repo: 'backend',
        branch: 'codex/omni-link/plan-1',
        created: false,
        error: 'working tree has uncommitted changes',
      },
    ]);
    expect(result.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'branch',
          repo: 'backend',
          status: 'failed',
        }),
      ]),
    );
  });

  it('switches away from the execution branch before deleting it during rollback', () => {
    execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command !== 'git') return '';
      const serialized = args.join(' ');
      if (serialized.includes('rev-parse --verify codex/omni-link/plan-1')) return '';
      if (serialized.includes('rev-parse --abbrev-ref HEAD')) return 'codex/omni-link/plan-1';
      if (serialized.includes('checkout main')) return '';
      if (serialized.includes('branch -D codex/omni-link/plan-1')) return '';
      if (serialized.includes('remote get-url origin')) return 'git@github.com:acme/backend.git';
      if (serialized.includes('push origin --delete codex/omni-link/plan-1')) return '';
      throw new Error(`Unexpected git call: ${serialized}`);
    });

    const result = rollbackExecutionPlan(makeConfig(), makePlan());

    expect(result.executed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rollback',
          repo: 'backend',
          status: 'passed',
        }),
      ]),
    );
    expect(
      execFileSync.mock.calls.some(
        ([command, args]) =>
          command === 'git' &&
          Array.isArray(args) &&
          args.join(' ') === '-C /tmp/backend checkout main',
      ),
    ).toBe(true);
  });

  it('creates a pull request through the GitHub API when gh is unavailable', () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    execFileSync.mockImplementation((command: string, args: string[]) => {
      const serialized = Array.isArray(args) ? args.join(' ') : '';
      if (command === 'gh' && serialized === '--version') {
        throw new Error('gh is unavailable');
      }
      if (command === 'git') {
        if (serialized.includes('status --porcelain')) return '';
        if (serialized.includes('rev-parse --verify codex/omni-link/plan-1')) {
          throw new Error('missing branch');
        }
        if (serialized.includes('rev-parse --verify main')) return '';
        if (serialized.includes('branch codex/omni-link/plan-1 main')) return '';
        if (serialized.includes('remote get-url origin'))
          return 'https://github.com/acme/backend.git';
        if (serialized.includes('push -u origin codex/omni-link/plan-1')) return '';
      }
      if (command === 'curl') {
        return JSON.stringify({ number: 42, html_url: 'https://github.com/acme/backend/pull/42' });
      }
      throw new Error(`Unexpected command: ${command} ${serialized}`);
    });

    const result = applyExecutionPlan(
      makeConfig({
        automation: {
          enabled: true,
          branchPrefix: 'codex/omni-link',
          createPullRequest: true,
          retryLimit: 2,
          allowedRiskTiers: ['low', 'medium'],
          autoApplyRiskTiers: ['low'],
          dryRunByDefault: false,
        },
      }),
      makePlan(),
    );

    expect(result.executed).toBe(true);
    expect(result.pullRequestCreated).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'push',
          repo: 'backend',
          status: 'passed',
        }),
        expect.objectContaining({
          kind: 'pull-request',
          status: 'passed',
        }),
      ]),
    );
    expect(
      execFileSync.mock.calls.some(
        ([command, args]) => command === 'curl' && Array.isArray(args) && args.includes('/pulls'),
      ),
    ).toBe(false);
    expect(
      execFileSync.mock.calls.some(
        ([command, args]) =>
          command === 'curl' &&
          Array.isArray(args) &&
          args.some(
            (arg) =>
              typeof arg === 'string' &&
              arg.includes('https://api.github.com/repos/acme/backend/pulls'),
          ),
      ),
    ).toBe(true);
  });
});
