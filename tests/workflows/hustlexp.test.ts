import { describe, it, expect } from 'vitest';

import { applyHustleXpWorkflowProfile } from '../../engine/workflows/hustlexp.js';
import type { OmniLinkConfig, RepoConfig } from '../../engine/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    name: 'test-repo',
    path: '/tmp/test-repo',
    language: 'typescript',
    role: 'backend-api',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<OmniLinkConfig> = {}): OmniLinkConfig {
  return {
    repos: [
      makeRepo({
        name: 'hustlexp-backend',
        path: '/tmp/backend',
        language: 'typescript',
        role: 'backend-api',
      }),
      makeRepo({ name: 'hustlexp-ios', path: '/tmp/ios', language: 'swift', role: 'ios-client' }),
      makeRepo({
        name: 'hustlexp-docs',
        path: '/tmp/docs',
        language: 'markdown',
        role: 'product-governance',
      }),
    ],
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
      prioritize: 'changed-files-first',
      includeRecentCommits: 10,
    },
    cache: {
      directory: '/tmp/cache',
      maxAgeDays: 7,
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyHustleXpWorkflowProfile', () => {
  it('returns config unchanged when workflowProfile is not hustlexp', () => {
    const config = makeConfig({ workflowProfile: undefined });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result).toBe(config); // strict reference equality -- no mutation
  });

  it('enables authority when workflowProfile is hustlexp', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.authority?.enabled).toBe(true);
  });

  it('enables bridges.swiftTrpc when workflowProfile is hustlexp', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.bridges?.swiftTrpc?.enabled).toBe(true);
    expect(result.bridges?.swiftTrpc?.iosRepo).toBe('/tmp/ios');
    expect(result.bridges?.swiftTrpc?.backendRepo).toBe('/tmp/backend');
  });

  it('sets context.prioritize to api-surface-first when default is changed-files-first', () => {
    const config = makeConfig({
      workflowProfile: 'hustlexp',
      context: {
        tokenBudget: 4000,
        prioritize: 'changed-files-first',
        includeRecentCommits: 10,
      },
    });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.context.prioritize).toBe('api-surface-first');
  });

  it('preserves context.prioritize if already api-surface-first', () => {
    const config = makeConfig({
      workflowProfile: 'hustlexp',
      context: {
        tokenBudget: 8000,
        prioritize: 'api-surface-first',
        includeRecentCommits: 20,
      },
    });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.context.prioritize).toBe('api-surface-first');
  });

  it('infers docs repo from role=product-governance', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.authority?.docsRepo).toBe('/tmp/docs');
  });

  it('infers ios repo from language=swift', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.bridges?.swiftTrpc?.iosRepo).toBe('/tmp/ios');
  });

  it('infers backend repo from name containing backend', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.bridges?.swiftTrpc?.backendRepo).toBe('/tmp/backend');
  });

  it('applies default excludes per role', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    const iosRepo = result.repos.find((r) => r.role === 'ios-client');
    const backendRepo = result.repos.find((r) => r.role === 'backend-api');
    const docsRepo = result.repos.find((r) => r.role === 'product-governance');

    // ios-client defaults include *.png, node_modules/, Pods/
    expect(iosRepo?.exclude).toEqual(expect.arrayContaining(['*.png', 'node_modules/', 'Pods/']));

    // backend-api defaults include node_modules/, dist/
    expect(backendRepo?.exclude).toEqual(expect.arrayContaining(['node_modules/', 'dist/']));

    // product-governance defaults include __mocks__/, _archive/
    expect(docsRepo?.exclude).toEqual(expect.arrayContaining(['__mocks__/', '_archive/']));
  });

  it('enables maxTier with semantic analysis', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.maxTier?.enabled).toBe(true);
    expect(result.maxTier?.semanticAnalysis?.enabled).toBe(true);
    expect(result.maxTier?.semanticAnalysis?.preferSemantic).toBe(true);
    expect(result.maxTier?.semanticAnalysis?.confidenceThreshold).toBe(0.7);
    expect(result.maxTier?.semanticAnalysis?.languages).toEqual(
      expect.arrayContaining(['typescript', 'swift', 'javascript']),
    );
    expect(result.maxTier?.runtimeIngestion?.enabled).toBe(true);
    expect(result.maxTier?.execution?.enabled).toBe(true);
  });

  it('sets simulateOnly=true as default', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.simulateOnly).toBe(true);
  });

  it('merges user-provided config with workflow defaults (does not override user settings)', () => {
    const config = makeConfig({
      workflowProfile: 'hustlexp',
      simulateOnly: false,
      authority: {
        enabled: true,
        docsRepo: '/custom/docs',
        phaseMode: 'strict',
      },
      bridges: {
        swiftTrpc: {
          enabled: true,
          iosRepo: '/custom/ios',
          backendRepo: '/custom/backend',
        },
      },
      daemon: {
        enabled: false,
        pollIntervalMs: 5000,
      },
      policies: {
        enabled: true,
        requiredChecks: ['custom-check'],
      },
    });

    const result = applyHustleXpWorkflowProfile(config);

    // User's simulateOnly=false should be preserved
    expect(result.simulateOnly).toBe(false);

    // User's custom docsRepo should be preserved
    expect(result.authority?.docsRepo).toBe('/custom/docs');
    expect(result.authority?.phaseMode).toBe('strict');

    // User's custom bridge repos should be preserved
    expect(result.bridges?.swiftTrpc?.iosRepo).toBe('/custom/ios');
    expect(result.bridges?.swiftTrpc?.backendRepo).toBe('/custom/backend');

    // User's daemon.enabled=false should be preserved
    expect(result.daemon?.enabled).toBe(false);
    expect(result.daemon?.pollIntervalMs).toBe(5000);

    // User's custom check should be merged with HustleXP required checks
    expect(result.policies?.requiredChecks).toEqual(
      expect.arrayContaining(['custom-check', 'ios-build', 'backend-tests']),
    );
  });

  it('adds HustleXP ownership rules', () => {
    const config = makeConfig({ workflowProfile: 'hustlexp' });
    const result = applyHustleXpWorkflowProfile(config);

    expect(result.ownership?.enabled).toBe(true);
    expect(result.ownership?.defaultOwner).toBe('platform');

    const rules = result.ownership?.rules ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(7);

    // Verify specific HustleXP ownership rules exist
    const repoRules = rules.filter((r) => r.scope === 'repo');
    const repoOwners = repoRules.map((r) => r.owner);
    expect(repoOwners).toContain('product-architecture');
    expect(repoOwners).toContain('ios-team');
    expect(repoOwners).toContain('backend-team');

    const pathRules = rules.filter((r) => r.scope === 'path');
    const pathOwners = pathRules.map((r) => r.owner);
    expect(pathOwners).toContain('payments');
    expect(pathOwners).toContain('trust-safety');
    expect(pathOwners).toContain('realtime-platform');
  });
});
