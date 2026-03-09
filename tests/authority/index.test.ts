import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeAuthorityDrift, loadAuthorityState } from '../../engine/authority/index.js';
import type { EcosystemGraph, OmniLinkConfig, RepoManifest } from '../../engine/types.js';

const fixtureRoot = path.resolve(
  '/Users/sebastiandysart/omni-link-hustlexp/tests/fixtures/hustlexp-workspace',
);

function makeManifest(
  repoId: string,
  repoPath: string,
  language: string,
  overrides: Partial<RepoManifest> = {},
): RepoManifest {
  return {
    repoId,
    path: repoPath,
    language,
    gitState: {
      branch: 'main',
      headSha: 'head',
      uncommittedChanges: [],
      recentCommits: [],
    },
    apiSurface: {
      routes: [],
      procedures: [],
      exports: [],
    },
    typeRegistry: {
      types: [],
      schemas: [],
      models: [],
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'domain',
      errorHandling: 'throws',
      patterns: [],
      testingPatterns: '',
    },
    dependencies: {
      internal: [],
      external: [],
    },
    health: {
      testCoverage: null,
      lintErrors: 0,
      typeErrors: 0,
      todoCount: 0,
      deadCode: [],
    },
    ...overrides,
  };
}

function makeConfig(): OmniLinkConfig {
  return {
    workflowProfile: 'hustlexp',
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
    reviewProvider: 'github',
    evolution: {
      aggressiveness: 'aggressive',
      maxSuggestionsPerSession: 5,
      categories: ['feature', 'security'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 8000,
      prioritize: 'api-surface-first',
      includeRecentCommits: 20,
      focus: 'mismatches',
    },
    cache: {
      directory: path.join(fixtureRoot, '.cache'),
      maxAgeDays: 7,
    },
    authority: {
      enabled: true,
      docsRepo: path.join(fixtureRoot, 'docs'),
      phaseMode: 'reconciliation',
      authorityFiles: {
        currentPhase: 'CURRENT_PHASE.md',
        finishedState: 'FINISHED_STATE.md',
        featureFreeze: 'FEATURE_FREEZE.md',
        aiGuardrails: 'AI_GUARDRAILS.md',
        apiContract: 'specs/04-backend/API_CONTRACT.md',
        schema: 'specs/02-architecture/schema.sql',
      },
    },
  };
}

describe('authority adapter', () => {
  it('parses current phase, authoritative procedures, and schema surface', () => {
    const authority = loadAuthorityState(makeConfig());

    expect(authority?.currentPhase).toBe('BOOTSTRAP');
    expect(authority?.authoritativeApiSurface.procedures).toEqual(
      expect.arrayContaining(['task.create', 'notification.getList']),
    );
    expect(authority?.authoritativeSchemaSurface.tables).toEqual(
      expect.arrayContaining(['users', 'tasks']),
    );
    expect(authority?.authoritativeSchemaSurface.views).toContain('active_tasks');
  });

  it('reports phase and contract drift against advanced code evidence', () => {
    const authority = loadAuthorityState(makeConfig());
    const graph: EcosystemGraph = {
      repos: [
        makeManifest('hustlexp-ios', path.join(fixtureRoot, 'ios'), 'swift', {
          apiSurface: {
            routes: [],
            procedures: [],
            exports: Array.from({ length: 30 }, (_, index) => ({
              name: `Screen${index}`,
              kind: 'class',
              signature: 'struct Screen',
              file: `Screens/Screen${index}.swift`,
              line: index + 1,
            })),
          },
        }),
        makeManifest('hustlexp-backend', path.join(fixtureRoot, 'backend'), 'typescript', {
          apiSurface: {
            routes: [],
            procedures: [
              {
                name: 'create',
                kind: 'mutation',
                file: 'backend/src/routers/task.ts',
                line: 3,
              },
            ],
            exports: [],
          },
        }),
        makeManifest('hustlexp-docs', path.join(fixtureRoot, 'docs'), 'javascript'),
      ],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    };

    const findings = analyzeAuthorityDrift(graph, authority, {
      backendProcedureIds: ['task.create', 'messaging.sendMessage'],
      iosCallCount: 3,
    });

    expect(findings.map((finding) => finding.title)).toEqual(
      expect.arrayContaining([
        'Docs phase lags iOS implementation',
        'Docs phase lags backend implementation',
        'Backend API exceeds the docs authority',
        'Docs API contract is ahead of the backend',
      ]),
    );
  });
});
