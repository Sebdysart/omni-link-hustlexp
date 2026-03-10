import { describe, it, expect } from 'vitest';
import { enrichGraphForConfig } from '../../engine/graph/enrichment.js';
import type { EcosystemGraph, OmniLinkConfig, RepoManifest } from '../../engine/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<RepoManifest> & { repoId: string }): RepoManifest {
  return {
    repoId: overrides.repoId,
    path: overrides.path ?? `/repos/${overrides.repoId}`,
    language: overrides.language ?? 'typescript',
    gitState: {
      branch: 'main',
      headSha: 'abc123',
      uncommittedChanges: [],
      recentCommits: [],
    },
    apiSurface: {
      routes: overrides.apiSurface?.routes ?? [],
      procedures: overrides.apiSurface?.procedures ?? [],
      exports: overrides.apiSurface?.exports ?? [],
    },
    typeRegistry: {
      types: [],
      schemas: [],
      models: [],
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'feature-based',
      errorHandling: 'try-catch',
      patterns: [],
      testingPatterns: 'co-located',
    },
    dependencies: {
      internal: [],
      external: [],
    },
    health: { testCoverage: null, lintErrors: 0, typeErrors: 0, todoCount: 0, deadCode: [] },
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

function makeConfig(overrides: Partial<OmniLinkConfig> = {}): OmniLinkConfig {
  return {
    repos: overrides.repos ?? [
      { name: 'backend', path: '/repos/backend', language: 'typescript', role: 'backend-api' },
    ],
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
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('enrichGraphForConfig', () => {
  describe('non-hustlexp profiles', () => {
    it('returns graph with ownership attached when no workflowProfile', () => {
      const repo = makeManifest({ repoId: 'backend' });
      const graph = makeGraph([repo]);
      const config = makeConfig({
        ownership: {
          enabled: true,
          defaultOwner: 'platform',
          rules: [
            {
              owner: 'backend-team',
              kind: 'team',
              scope: 'repo',
              repo: 'backend',
            },
          ],
        },
      });

      const result = enrichGraphForConfig(graph, config);

      // Should have owners attached
      expect(result.repos[0].owners).toBeDefined();
      expect(result.repos[0].owners!.length).toBeGreaterThan(0);
      expect(result.repos[0].owners![0].owner).toBe('backend-team');
    });

    it('returns graph with default owner when ownership not explicitly enabled', () => {
      const repo = makeManifest({ repoId: 'backend' });
      const graph = makeGraph([repo]);
      const config = makeConfig({
        ownership: {
          enabled: false,
          defaultOwner: 'platform',
        },
      });

      const result = enrichGraphForConfig(graph, config);
      expect(result.repos[0].owners).toBeDefined();
      expect(result.repos[0].owners![0].owner).toBe('platform');
    });

    it('preserves graph structure without hustlexp enrichment', () => {
      const repo = makeManifest({ repoId: 'backend' });
      const graph = makeGraph([repo]);
      const config = makeConfig(); // no workflowProfile

      const result = enrichGraphForConfig(graph, config);

      // Should not add bridges or mismatches (no hustlexp enrichment)
      expect(result.bridges).toHaveLength(0);
      expect(result.contractMismatches).toHaveLength(0);
      expect(result.repos).toHaveLength(1);
    });

    it('handles empty graph', () => {
      const graph = makeGraph([]);
      const config = makeConfig();

      const result = enrichGraphForConfig(graph, config);
      expect(result.repos).toHaveLength(0);
    });

    it('handles multiple repos', () => {
      const backend = makeManifest({ repoId: 'backend' });
      const frontend = makeManifest({ repoId: 'frontend' });
      const graph = makeGraph([backend, frontend]);
      const config = makeConfig({
        repos: [
          { name: 'backend', path: '/repos/backend', language: 'typescript', role: 'backend-api' },
          {
            name: 'frontend',
            path: '/repos/frontend',
            language: 'typescript',
            role: 'ios-client',
          },
        ],
        ownership: {
          enabled: true,
          defaultOwner: 'platform',
          rules: [
            { owner: 'backend-team', kind: 'team', scope: 'repo', repo: 'backend' },
            { owner: 'frontend-team', kind: 'team', scope: 'repo', repo: 'frontend' },
          ],
        },
      });

      const result = enrichGraphForConfig(graph, config);
      expect(result.repos).toHaveLength(2);

      const backendOwners = result.repos.find((r) => r.repoId === 'backend')?.owners ?? [];
      const frontendOwners = result.repos.find((r) => r.repoId === 'frontend')?.owners ?? [];
      expect(backendOwners[0].owner).toBe('backend-team');
      expect(frontendOwners[0].owner).toBe('frontend-team');
    });

    it('collects all owners into graph.owners', () => {
      const backend = makeManifest({ repoId: 'backend' });
      const frontend = makeManifest({ repoId: 'frontend' });
      const graph = makeGraph([backend, frontend]);
      const config = makeConfig({
        repos: [
          { name: 'backend', path: '/repos/backend', language: 'typescript', role: 'backend-api' },
          {
            name: 'frontend',
            path: '/repos/frontend',
            language: 'typescript',
            role: 'ios-client',
          },
        ],
        ownership: {
          enabled: true,
          defaultOwner: 'platform',
          rules: [
            { owner: 'backend-team', kind: 'team', scope: 'repo', repo: 'backend' },
            { owner: 'frontend-team', kind: 'team', scope: 'repo', repo: 'frontend' },
          ],
        },
      });

      const result = enrichGraphForConfig(graph, config);
      expect(result.owners).toBeDefined();
      expect(result.owners!.length).toBeGreaterThanOrEqual(2);

      const ownerNames = result.owners!.map((o) => o.owner);
      expect(ownerNames).toContain('backend-team');
      expect(ownerNames).toContain('frontend-team');
    });
  });
});
