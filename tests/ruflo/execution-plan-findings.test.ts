import { describe, it, expect } from 'vitest';
import { createExecutionPlan } from '../../engine/execution/index.js';
import type { EcosystemGraph, OmniLinkConfig, RiskReport } from '../../engine/types.js';

describe('Execution plan from findings (Fix 2: 0 steps → real steps)', () => {
  const minimalConfig: OmniLinkConfig = {
    repos: [
      {
        name: 'test-repo',
        path: '/tmp/test',
        language: 'typescript',
        role: 'backend-api',
      },
    ],
    workflowProfile: 'hustlexp',
    simulateOnly: true,
    reviewProvider: 'github',
    authority: {
      enabled: true,
      docsRepo: 'docs',
      phaseMode: 'reconciliation',
      reconciliationMode: 'reconciliation',
    },
    bridges: { swiftTrpc: { enabled: false } },
    quality: { conventionStrictness: 'strict', rules: [] },
    context: { tokenBudget: 8000, prioritize: 'api-surface-first' },
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['performance', 'security', 'reliability', 'maintainability', 'observability'],
    },
    cache: { directory: '.omni-link-cache' },
    daemon: { enabled: false, preferDaemon: false },
    policies: {
      protectedBranches: ['main'],
      requireReviewBeforeApply: true,
      simulateOnlyByDefault: true,
      riskThreshold: 'medium',
    },
    automation: {
      enabled: false,
      dryRunByDefault: true,
      branchPrefix: 'codex/omni-link',
      createPullRequest: false,
    },
  } as unknown as OmniLinkConfig;

  const risk: RiskReport = {
    overallRisk: 'medium',
    score: 45,
    reasons: ['authority drift detected'],
    affectedRepos: ['test-repo'],
    blockedByPolicy: false,
  };

  it('generates steps from findings when no mismatches/impact paths exist', () => {
    const graph: EcosystemGraph = {
      repos: [
        {
          repoId: 'test-repo',
          gitState: { branch: 'main', sha: 'abc', uncommittedChanges: [], recentCommits: [] },
          apiSurface: { routes: [], procedures: [], exports: [] },
          typeRegistry: { types: [], schemas: [], models: [] },
          conventions: {
            naming: 'camelCase',
            fileOrganization: 'flat',
            errorHandling: 'try-catch',
            testingPatterns: 'vitest',
            patterns: [],
          },
          dependencies: { internal: [], external: [] },
          health: {
            testCoverage: 80,
            lintErrors: 0,
            typeErrors: 0,
            deadCode: [],
          },
        },
      ],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
      findings: [
        {
          kind: 'authority_drift',
          severity: 'warning',
          title: 'Docs authority does not match backend procedures',
          description: '50 procedures exist in backend but not in API_CONTRACT.md',
          repo: 'test-repo',
          file: 'src/routers/index.ts',
          line: 1,
        },
        {
          kind: 'bridge_obsolete',
          severity: 'error',
          title: 'Swift calls obsolete procedure',
          description: 'iOS calls task.archive which was removed from backend',
          repo: 'test-repo',
          file: 'TaskService.swift',
          line: 42,
        },
      ],
    } as unknown as EcosystemGraph;

    const plan = createExecutionPlan(minimalConfig, graph, risk);

    expect(plan.changes.length).toBeGreaterThanOrEqual(2);

    const authorityStep = plan.changes.find((c) => c.title.includes('authority'));
    expect(authorityStep).toBeDefined();
    expect(authorityStep!.kind).toBe('docs-update');
    expect(authorityStep!.preconditions).toContain('reconcile authority docs before proceeding');

    const bridgeStep = plan.changes.find((c) => c.title.includes('obsolete'));
    expect(bridgeStep).toBeDefined();
    expect(bridgeStep!.kind).toBe('consumer-update');
  });

  it('still generates mismatch steps when both mismatches and findings exist', () => {
    const graph: EcosystemGraph = {
      repos: [
        {
          repoId: 'test-repo',
          gitState: { branch: 'main', sha: 'abc', uncommittedChanges: [], recentCommits: [] },
          apiSurface: { routes: [], procedures: [], exports: [] },
          typeRegistry: { types: [], schemas: [], models: [] },
          conventions: {
            naming: 'camelCase',
            fileOrganization: 'flat',
            errorHandling: 'try-catch',
            testingPatterns: 'vitest',
            patterns: [],
          },
          dependencies: { internal: [], external: [] },
          health: {
            testCoverage: 80,
            lintErrors: 0,
            typeErrors: 0,
            deadCode: [],
          },
        },
      ],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [
        {
          kind: 'input-mismatch',
          severity: 'breaking',
          description: 'Input type mismatch on createTask',
          provider: { repo: 'test-repo', file: 'src/routers/task.ts' },
          consumer: { repo: 'test-repo', file: 'TaskService.swift' },
          riskScore: 50,
        },
      ],
      impactPaths: [],
      findings: [
        {
          kind: 'authority_drift',
          severity: 'warning',
          title: 'Phase drift detected',
          description: 'Docs claim bootstrap but code is beyond it',
          repo: 'test-repo',
        },
      ],
    } as unknown as EcosystemGraph;

    const plan = createExecutionPlan(minimalConfig, graph, risk);

    expect(plan.changes.length).toBeGreaterThanOrEqual(2);

    const schemaStep = plan.changes.find((c) => c.kind === 'schema-sync');
    expect(schemaStep).toBeDefined();

    const findingStep = plan.changes.find((c) => c.title.includes('Phase drift'));
    expect(findingStep).toBeDefined();
  });
});
