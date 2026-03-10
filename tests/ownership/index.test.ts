import { describe, it, expect } from 'vitest';

import { resolveManifestOwners, attachOwnersToGraph } from '../../engine/ownership/index.js';
import type { EcosystemGraph, OmniLinkConfig, RepoManifest } from '../../engine/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<RepoManifest> = {}): RepoManifest {
  return {
    repoId: 'test-repo',
    path: '/tmp/test-repo',
    language: 'typescript',
    gitState: {
      branch: 'main',
      headSha: 'abc123',
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
      fileOrganization: 'feature-based',
      errorHandling: 'try-catch',
      patterns: [],
      testingPatterns: 'vitest',
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

function makeConfig(overrides: Partial<OmniLinkConfig> = {}): OmniLinkConfig {
  return {
    repos: [{ name: 'test-repo', path: '/tmp/test-repo', language: 'typescript', role: 'backend' }],
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
    ...overrides,
  };
}

function makeGraph(overrides: Partial<EcosystemGraph> = {}): EcosystemGraph {
  return {
    repos: [],
    bridges: [],
    sharedTypes: [],
    contractMismatches: [],
    impactPaths: [],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveManifestOwners', () => {
  it('returns empty array when ownership not configured and no defaultOwner', () => {
    const manifest = makeManifest();
    const config = makeConfig(); // no ownership key at all

    const result = resolveManifestOwners(manifest, config);

    expect(result).toEqual([]);
  });

  it('returns default owner when ownership.enabled=false but defaultOwner set', () => {
    const manifest = makeManifest({ repoId: 'my-repo' });
    const config = makeConfig({
      ownership: {
        enabled: false,
        defaultOwner: 'fallback-team',
      },
    });

    const result = resolveManifestOwners(manifest, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      owner: 'fallback-team',
      kind: 'team',
      scope: 'repo',
      repoId: 'my-repo',
      matchedBy: 'ownership.defaultOwner',
    });
  });

  it('matches repo scope rules', () => {
    const manifest = makeManifest({ repoId: 'hustlexp-backend' });
    const config = makeConfig({
      ownership: {
        enabled: true,
        rules: [
          {
            owner: 'backend-team',
            kind: 'team',
            scope: 'repo',
            repo: 'hustlexp-backend',
          },
        ],
      },
    });

    const result = resolveManifestOwners(manifest, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      owner: 'backend-team',
      kind: 'team',
      scope: 'repo',
      repoId: 'hustlexp-backend',
      matchedBy: 'repo:hustlexp-backend',
    });
  });

  it('matches path scope rules (uses glob pattern)', () => {
    const manifest = makeManifest({
      repoId: 'hustlexp-backend',
      apiSurface: {
        routes: [
          {
            method: 'POST',
            path: '/api/escrow/release',
            handler: 'releaseEscrow',
            file: 'src/routers/escrow.ts',
            line: 42,
          },
        ],
        procedures: [],
        exports: [],
      },
    });
    const config = makeConfig({
      ownership: {
        enabled: true,
        rules: [
          {
            owner: 'payments-team',
            kind: 'team',
            scope: 'path',
            pattern: 'src/routers/escrow*',
          },
        ],
      },
    });

    const result = resolveManifestOwners(manifest, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      owner: 'payments-team',
      scope: 'path',
      matchedBy: 'path:src/routers/escrow.ts',
    });
  });

  it('matches api scope rules (route path pattern)', () => {
    const manifest = makeManifest({
      repoId: 'hustlexp-backend',
      apiSurface: {
        routes: [
          {
            method: 'GET',
            path: '/api/users/:id',
            handler: 'getUser',
            file: 'src/routers/user.ts',
            line: 10,
          },
        ],
        procedures: [],
        exports: [],
      },
    });
    const config = makeConfig({
      ownership: {
        enabled: true,
        rules: [
          {
            owner: 'user-team',
            kind: 'team',
            scope: 'api',
            pattern: '/api/users/*',
          },
        ],
      },
    });

    const result = resolveManifestOwners(manifest, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      owner: 'user-team',
      scope: 'api',
      matchedBy: 'api:/api/users/:id',
    });
  });

  it('matches api scope rules (procedure name pattern)', () => {
    const manifest = makeManifest({
      repoId: 'hustlexp-backend',
      apiSurface: {
        routes: [],
        procedures: [
          {
            name: 'escrow.release',
            kind: 'mutation',
            file: 'src/routers/escrow.ts',
            line: 55,
          },
        ],
        exports: [],
      },
    });
    const config = makeConfig({
      ownership: {
        enabled: true,
        rules: [
          {
            owner: 'payments',
            kind: 'team',
            scope: 'api',
            pattern: 'escrow.*',
          },
        ],
      },
    });

    const result = resolveManifestOwners(manifest, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      owner: 'payments',
      scope: 'api',
      matchedBy: 'procedure:escrow.release',
    });
  });

  it('matches package scope rules', () => {
    const manifest = makeManifest({
      repoId: 'hustlexp-backend',
      dependencies: {
        internal: [],
        external: [
          { name: 'stripe', version: '^14.0.0', dev: false },
          { name: 'hono', version: '^4.0.0', dev: false },
        ],
      },
    });
    const config = makeConfig({
      ownership: {
        enabled: true,
        rules: [
          {
            owner: 'payments',
            kind: 'team',
            scope: 'package',
            pattern: 'stripe',
          },
        ],
      },
    });

    const result = resolveManifestOwners(manifest, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      owner: 'payments',
      scope: 'package',
      matchedBy: 'package:stripe',
    });
  });

  it('falls back to defaultOwner when no rules match', () => {
    const manifest = makeManifest({ repoId: 'unowned-repo' });
    const config = makeConfig({
      ownership: {
        enabled: true,
        defaultOwner: 'platform',
        rules: [
          {
            owner: 'backend-team',
            kind: 'team',
            scope: 'repo',
            repo: 'other-repo',
          },
        ],
      },
    });

    const result = resolveManifestOwners(manifest, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      owner: 'platform',
      kind: 'team',
      scope: 'repo',
      repoId: 'unowned-repo',
      matchedBy: 'ownership.defaultOwner',
    });
  });

  it('deduplicates owner assignments', () => {
    const manifest = makeManifest({
      repoId: 'hustlexp-backend',
      apiSurface: {
        routes: [
          {
            method: 'POST',
            path: '/api/escrow/release',
            handler: 'releaseEscrow',
            file: 'src/routers/escrow.ts',
            line: 42,
          },
          {
            method: 'GET',
            path: '/api/escrow/status',
            handler: 'getStatus',
            file: 'src/routers/escrow.ts',
            line: 100,
          },
        ],
        procedures: [],
        exports: [],
      },
    });
    const config = makeConfig({
      ownership: {
        enabled: true,
        rules: [
          {
            owner: 'payments',
            kind: 'team',
            scope: 'api',
            pattern: '/api/escrow/*',
          },
          // Duplicate rule with identical owner/kind/scope/pattern
          {
            owner: 'payments',
            kind: 'team',
            scope: 'api',
            pattern: '/api/escrow/*',
          },
        ],
      },
    });

    const result = resolveManifestOwners(manifest, config);

    // Both routes match the same pattern, so the dedupe key is the same.
    // Two rules with same owner/kind/scope/pattern only produce unique entries.
    const paymentsOwners = result.filter((o) => o.owner === 'payments');
    // The deduplication key includes repoId, owner, kind, scope, pattern.
    // Both rules have pattern '/api/escrow/*' so duplicates are removed.
    expect(paymentsOwners.length).toBeLessThanOrEqual(2);
    // At minimum, we should not have 4 entries (2 routes x 2 rules)
    expect(result.length).toBeLessThan(4);
  });
});

describe('attachOwnersToGraph', () => {
  it('adds owners to each repo manifest', () => {
    const backendManifest = makeManifest({ repoId: 'hustlexp-backend' });
    const iosManifest = makeManifest({ repoId: 'hustlexp-ios' });
    const graph = makeGraph({
      repos: [backendManifest, iosManifest],
    });
    const config = makeConfig({
      ownership: {
        enabled: true,
        rules: [
          {
            owner: 'backend-team',
            kind: 'team',
            scope: 'repo',
            repo: 'hustlexp-backend',
          },
          {
            owner: 'ios-team',
            kind: 'team',
            scope: 'repo',
            repo: 'hustlexp-ios',
          },
        ],
      },
    });

    const result = attachOwnersToGraph(graph, config);

    const backendRepo = result.repos.find((r) => r.repoId === 'hustlexp-backend');
    const iosRepo = result.repos.find((r) => r.repoId === 'hustlexp-ios');

    expect(backendRepo?.owners).toHaveLength(1);
    expect(backendRepo?.owners?.[0]).toMatchObject({ owner: 'backend-team' });

    expect(iosRepo?.owners).toHaveLength(1);
    expect(iosRepo?.owners?.[0]).toMatchObject({ owner: 'ios-team' });
  });

  it('collects all owners into graph.owners', () => {
    const backendManifest = makeManifest({ repoId: 'hustlexp-backend' });
    const iosManifest = makeManifest({ repoId: 'hustlexp-ios' });
    const docsManifest = makeManifest({ repoId: 'hustlexp-docs' });
    const graph = makeGraph({
      repos: [backendManifest, iosManifest, docsManifest],
    });
    const config = makeConfig({
      ownership: {
        enabled: true,
        defaultOwner: 'platform',
        rules: [
          {
            owner: 'backend-team',
            kind: 'team',
            scope: 'repo',
            repo: 'hustlexp-backend',
          },
          {
            owner: 'ios-team',
            kind: 'team',
            scope: 'repo',
            repo: 'hustlexp-ios',
          },
        ],
      },
    });

    const result = attachOwnersToGraph(graph, config);

    // graph.owners should contain backend-team, ios-team, and platform (default for docs)
    expect(result.owners).toBeDefined();
    expect(result.owners!.length).toBeGreaterThanOrEqual(3);

    const ownerNames = result.owners!.map((o) => o.owner);
    expect(ownerNames).toContain('backend-team');
    expect(ownerNames).toContain('ios-team');
    expect(ownerNames).toContain('platform');
  });
});
