import { describe, expect, it } from 'vitest';

import { evaluatePolicies, policiesBlock } from '../../engine/policy/index.js';
import type { OmniLinkConfig, OwnerAssignment, RiskReport } from '../../engine/types.js';

function makeConfig(overrides: Partial<OmniLinkConfig> = {}): OmniLinkConfig {
  return {
    repos: [{ name: 'backend', path: '/tmp/backend', language: 'typescript', role: 'backend' }],
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
    policies: {
      enabled: true,
      protectedBranches: ['main'],
      requiredChecks: ['lint', 'test'],
      requiredOwners: ['platform-team'],
      maxAllowedRisk: 'medium',
      forbidDirectMainMutation: true,
      forbidDestructiveChanges: true,
    },
    ...overrides,
  };
}

function makeRisk(overrides: Partial<RiskReport> = {}): RiskReport {
  return {
    overallRisk: 'medium',
    score: 50,
    reasons: [],
    affectedRepos: ['backend'],
    blockedByPolicy: false,
    ...overrides,
  };
}

const owners: OwnerAssignment[] = [
  {
    owner: 'platform-team',
    kind: 'team',
    scope: 'repo',
    repoId: 'backend',
    matchedBy: 'ownership.defaultOwner',
  },
];

describe('policy engine', () => {
  it('blocks direct mutation of protected branches', () => {
    const decisions = evaluatePolicies(makeConfig(), 'main', makeRisk(), owners);

    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 'protected-branch',
          status: 'blocked',
        }),
      ]),
    );
    expect(policiesBlock(decisions)).toBe(true);
  });

  it('blocks risks above the configured threshold', () => {
    const decisions = evaluatePolicies(
      makeConfig(),
      'release',
      makeRisk({ overallRisk: 'high' }),
      owners,
    );

    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 'risk-threshold',
          status: 'blocked',
        }),
      ]),
    );
  });

  it('warns when required owners are missing', () => {
    const decisions = evaluatePolicies(makeConfig(), 'release', makeRisk(), []);

    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 'required-owners',
          status: 'warning',
        }),
      ]),
    );
    expect(policiesBlock(decisions)).toBe(false);
  });

  it('blocks destructive changes when configured', () => {
    const decisions = evaluatePolicies(makeConfig(), 'release', makeRisk(), owners, {
      destructive: true,
    });

    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 'destructive-change',
          status: 'blocked',
        }),
      ]),
    );
  });
});
