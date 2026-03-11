import { describe, it, expect } from 'vitest';
import { scoreHealth, scoreEcosystemHealth } from '../../engine/quality/health-scorer.js';
import type { RepoManifest, EcosystemGraph, OmniLinkConfig } from '../../engine/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<RepoManifest> = {}): RepoManifest {
  return {
    repoId: overrides.repoId ?? 'test-repo',
    path: overrides.path ?? '/repos/test-repo',
    language: overrides.language ?? 'typescript',
    gitState: {
      branch: 'main',
      headSha: 'head123',
      uncommittedChanges: [],
      recentCommits: [],
      ...overrides.gitState,
    },
    apiSurface: {
      routes: [],
      procedures: [],
      exports: [],
      ...overrides.apiSurface,
    },
    typeRegistry: {
      types: [],
      schemas: [],
      models: [],
      ...overrides.typeRegistry,
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'feature-based',
      errorHandling: 'try-catch',
      patterns: [],
      testingPatterns: 'co-located',
      ...overrides.conventions,
    },
    dependencies: {
      internal: [],
      external: [],
      ...overrides.dependencies,
    },
    health: {
      testCoverage: null,
      lintErrors: 0,
      typeErrors: 0,
      todoCount: 0,
      deadCode: [],
      ...overrides.health,
    },
  };
}

function makeGraph(repos: RepoManifest[]): EcosystemGraph {
  return {
    repos,
    bridges: [],
    sharedTypes: [],
    contractMismatches: [],
    impactPaths: [],
  };
}

function makeConfig(repoRoles: Array<{ name: string; role: string }>): OmniLinkConfig {
  return {
    repos: repoRoles.map((r) => ({
      name: r.name,
      path: `/repos/${r.name}`,
      language: 'typescript',
      role: r.role,
    })),
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature'],
    },
    quality: {
      blockOnFailure: false,
      requireTestsForNewCode: false,
      conventionStrictness: 'relaxed',
    },
    context: {
      tokenBudget: 8000,
      prioritize: 'changed-files-first',
      includeRecentCommits: 10,
    },
    cache: {
      directory: '/tmp/cache',
      maxAgeDays: 7,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('scoreHealth', () => {
  it('returns a perfect score for a healthy repo', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: 85,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
      dependencies: {
        internal: [
          { from: 'src/index.ts', to: 'src/utils.ts', imports: ['helper'] },
          { from: 'src/app.ts', to: 'src/utils.ts', imports: ['helper'] },
          { from: 'tests/utils.test.ts', to: 'src/utils.ts', imports: ['helper'] },
        ],
        external: [],
      },
      apiSurface: {
        routes: [],
        procedures: [],
        exports: [
          {
            name: 'helper',
            kind: 'function',
            signature: 'function helper()',
            file: 'src/utils.ts',
            line: 1,
          },
          {
            name: 'main',
            kind: 'function',
            signature: 'function main()',
            file: 'src/index.ts',
            line: 1,
          },
        ],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.overall).toBeGreaterThanOrEqual(80);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('penalizes high TODO count', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: 80,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 20,
        deadCode: [],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.todoScore).toBeLessThan(100);
    expect(result.overall).toBeLessThan(90);
  });

  it('penalizes dead code', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: 80,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: ['unusedHelper', 'deprecatedFunction', 'oldParser'],
      },
      apiSurface: {
        routes: [],
        procedures: [],
        exports: [
          {
            name: 'unusedHelper',
            kind: 'function',
            signature: 'function unusedHelper()',
            file: 'src/old.ts',
            line: 1,
          },
          {
            name: 'deprecatedFunction',
            kind: 'function',
            signature: 'function deprecatedFunction()',
            file: 'src/old.ts',
            line: 10,
          },
          {
            name: 'oldParser',
            kind: 'function',
            signature: 'function oldParser()',
            file: 'src/old.ts',
            line: 20,
          },
          {
            name: 'usedHelper',
            kind: 'function',
            signature: 'function usedHelper()',
            file: 'src/utils.ts',
            line: 1,
          },
        ],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.deadCodeScore).toBeLessThan(100);
  });

  it('penalizes missing test coverage', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: null,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.testScore).toBeLessThan(100);
  });

  it('rewards high test coverage', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: 95,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.testScore).toBeGreaterThanOrEqual(90);
  });

  it('penalizes lint and type errors', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: 80,
        lintErrors: 15,
        typeErrors: 5,
        todoCount: 0,
        deadCode: [],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.qualityScore).toBeLessThan(100);
    expect(result.overall).toBeLessThan(90);
  });

  it('returns score between 0 and 100', () => {
    // Worst case scenario
    const manifest = makeManifest({
      health: {
        testCoverage: 0,
        lintErrors: 100,
        typeErrors: 50,
        todoCount: 50,
        deadCode: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });
});

describe('scoreEcosystemHealth', () => {
  it('calculates per-repo and overall scores for multiple repos', () => {
    const repoA = makeManifest({
      repoId: 'backend',
      health: {
        testCoverage: 80,
        lintErrors: 2,
        typeErrors: 0,
        todoCount: 3,
        deadCode: [],
      },
    });

    const repoB = makeManifest({
      repoId: 'frontend',
      health: {
        testCoverage: 60,
        lintErrors: 5,
        typeErrors: 1,
        todoCount: 8,
        deadCode: ['oldComponent'],
      },
    });

    const graph = makeGraph([repoA, repoB]);
    const result = scoreEcosystemHealth(graph);

    expect(result.perRepo['backend']).toBeDefined();
    expect(result.perRepo['frontend']).toBeDefined();
    expect(result.perRepo['backend'].overall).toBeGreaterThanOrEqual(0);
    expect(result.perRepo['frontend'].overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);

    // Backend should score higher (fewer issues)
    expect(result.perRepo['backend'].overall).toBeGreaterThan(result.perRepo['frontend'].overall);
  });

  it('handles a single repo ecosystem', () => {
    const repo = makeManifest({
      repoId: 'mono',
      health: {
        testCoverage: 70,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 2,
        deadCode: [],
      },
    });

    const graph = makeGraph([repo]);
    const result = scoreEcosystemHealth(graph);

    expect(result.perRepo['mono']).toBeDefined();
    expect(result.overall).toBe(result.perRepo['mono'].overall);
  });

  it('handles empty ecosystem', () => {
    const graph = makeGraph([]);
    const result = scoreEcosystemHealth(graph);

    expect(Object.keys(result.perRepo)).toHaveLength(0);
    expect(result.overall).toBe(0);
  });

  it('overall score is the average of per-repo scores', () => {
    const repoA = makeManifest({
      repoId: 'a',
      health: {
        testCoverage: 90,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const repoB = makeManifest({
      repoId: 'b',
      health: {
        testCoverage: 90,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const graph = makeGraph([repoA, repoB]);
    const result = scoreEcosystemHealth(graph);

    // Both repos have same config, so overall should equal per-repo score
    const expectedOverall = Math.round(
      (result.perRepo['a'].overall + result.perRepo['b'].overall) / 2,
    );
    expect(result.overall).toBe(expectedOverall);
  });

  it('uses role-based weights when config is provided', () => {
    const docsRepo = makeManifest({
      repoId: 'docs',
      health: {
        testCoverage: null,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 5,
        deadCode: [],
      },
    });

    const backendRepo = makeManifest({
      repoId: 'backend',
      health: {
        testCoverage: 50,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const config = makeConfig([
      { name: 'docs', role: 'product-governance' },
      { name: 'backend', role: 'backend-api' },
    ]);

    const graph = makeGraph([docsRepo, backendRepo]);

    // With config (role-aware)
    const withConfig = scoreEcosystemHealth(graph, config);
    // Without config (default weights)
    const withoutConfig = scoreEcosystemHealth(graph);

    // Scores should differ because roles assign different weights
    // product-governance has test weight 0.0, so null coverage doesn't matter
    // backend-api has test weight 0.25 (vs default 0.30), quality weight 0.35 (vs 0.25)
    expect(withConfig.perRepo['docs'].overall).not.toBe(withoutConfig.perRepo['docs'].overall);
    expect(withConfig.perRepo['backend'].overall).not.toBe(
      withoutConfig.perRepo['backend'].overall,
    );
  });
});

// ─── Role-Aware Scoring ─────────────────────────────────────────────────────

describe('scoreHealth — role-aware weights', () => {
  it('ios-client role returns 100 testScore for null coverage (xcrun unavailable in CLI)', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: null,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const result = scoreHealth(manifest, 'ios-client');
    expect(result.testScore).toBe(100);
  });

  it('scoreTests(null) returns 60 (neutral, not penalized)', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: null,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const result = scoreHealth(manifest);
    expect(result.testScore).toBe(60);
  });

  it('product-governance role does not penalize for tests (weight is 0)', () => {
    // A repo with null test coverage should get the same overall
    // as one with 100% coverage when role is product-governance (test weight = 0)
    const noTests = makeManifest({
      health: {
        testCoverage: null,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const fullTests = makeManifest({
      health: {
        testCoverage: 100,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const noTestsResult = scoreHealth(noTests, 'product-governance');
    const fullTestsResult = scoreHealth(fullTests, 'product-governance');

    // With test weight = 0, the test score should not affect overall
    expect(noTestsResult.overall).toBe(fullTestsResult.overall);
  });

  it('backend-api role weights test coverage at 25%', () => {
    // A perfect repo except for 0% test coverage.
    // backend-api: overall = 0*0.25 + 100*0.35 + 100*0.25 + 100*0.15 = 75
    // default:     overall = 0*0.30 + 100*0.25 + 100*0.25 + 100*0.20 = 70
    const manifest = makeManifest({
      health: {
        testCoverage: 0,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const backendResult = scoreHealth(manifest, 'backend-api');
    const defaultResult = scoreHealth(manifest);

    // backend-api penalizes tests less (25% vs 30%) but rewards quality more (35% vs 25%)
    // With 0% tests, backend-api scores higher because quality/deadCode weights are elevated
    expect(backendResult.overall).toBeGreaterThan(defaultResult.overall);
    // Verify the exact values
    expect(backendResult.overall).toBe(75); // 0*0.25 + 100*0.35 + 100*0.25 + 100*0.15
    expect(defaultResult.overall).toBe(70); // 0*0.30 + 100*0.25 + 100*0.25 + 100*0.20
  });

  it('unknown role falls back to default weights', () => {
    const manifest = makeManifest({
      health: {
        testCoverage: 80,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
    });

    const unknownRoleResult = scoreHealth(manifest, 'unknown-role');
    const noRoleResult = scoreHealth(manifest);

    expect(unknownRoleResult.overall).toBe(noRoleResult.overall);
  });
});
