import { describe, it, expect } from 'vitest';
import { formatDigest } from '../../engine/context/digest-formatter.js';
import type {
  EcosystemGraph,
  RepoManifest,
  OmniLinkConfig,
  Mismatch,
  ApiBridge,
  TypeLineage,
  TypeDef,
} from '../../engine/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<OmniLinkConfig> = {}): OmniLinkConfig {
  return {
    repos: [
      { name: 'backend', path: '/repos/backend', language: 'typescript', role: 'api' },
      { name: 'ios-app', path: '/repos/ios-app', language: 'swift', role: 'client' },
    ],
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature', 'performance'],
      ...overrides.evolution,
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
      ...overrides.quality,
    },
    context: {
      tokenBudget: 8000,
      prioritize: 'changed-files-first',
      includeRecentCommits: 20,
      ...overrides.context,
    },
    cache: {
      directory: '/tmp/cache',
      maxAgeDays: 7,
      ...overrides.cache,
    },
  };
}

function makeManifest(overrides: Partial<RepoManifest> & { repoId: string }): RepoManifest {
  return {
    repoId: overrides.repoId,
    path: overrides.path ?? `/repos/${overrides.repoId}`,
    language: overrides.language ?? 'typescript',
    gitState: {
      branch: overrides.gitState?.branch ?? 'main',
      headSha: overrides.gitState?.headSha ?? 'abc123',
      uncommittedChanges: overrides.gitState?.uncommittedChanges ?? [],
      recentCommits: overrides.gitState?.recentCommits ?? [],
    },
    apiSurface: {
      routes: overrides.apiSurface?.routes ?? [],
      procedures: overrides.apiSurface?.procedures ?? [],
      exports: overrides.apiSurface?.exports ?? [],
    },
    typeRegistry: {
      types: overrides.typeRegistry?.types ?? [],
      schemas: overrides.typeRegistry?.schemas ?? [],
      models: overrides.typeRegistry?.models ?? [],
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'feature-based',
      errorHandling: 'try-catch',
      patterns: ['singleton'],
      testingPatterns: 'co-located',
      ...overrides.conventions,
    },
    dependencies: {
      internal: overrides.dependencies?.internal ?? [],
      external: overrides.dependencies?.external ?? [],
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

function makeTypeDef(name: string, repo: string): TypeDef {
  return {
    name,
    fields: [
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string' },
    ],
    source: { repo, file: `src/types/${name}.ts`, line: 1 },
  };
}

function makeGraph(): EcosystemGraph {
  const backend = makeManifest({
    repoId: 'backend',
    gitState: {
      branch: 'develop',
      headSha: 'abc123',
      uncommittedChanges: ['src/routes.ts', 'src/types.ts'],
      recentCommits: [
        {
          sha: 'commit-1',
          message: 'Add user endpoint',
          author: 'dev',
          date: '2026-02-27T00:00:00Z',
          filesChanged: ['src/routes.ts'],
        },
        {
          sha: 'commit-2',
          message: 'Fix type mismatch',
          author: 'dev',
          date: '2026-02-26T00:00:00Z',
          filesChanged: ['src/types.ts'],
        },
      ],
    },
    apiSurface: {
      routes: [
        { method: 'GET', path: '/api/users', handler: 'getUsers', file: 'src/routes.ts', line: 10 },
        {
          method: 'POST',
          path: '/api/users',
          handler: 'createUser',
          file: 'src/routes.ts',
          line: 25,
        },
      ],
      procedures: [],
      exports: [],
    },
    typeRegistry: {
      types: [makeTypeDef('User', 'backend')],
      schemas: [],
      models: [],
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'feature-based',
      errorHandling: 'try-catch',
      patterns: ['singleton', 'repository'],
      testingPatterns: 'co-located',
    },
  });

  const ios = makeManifest({
    repoId: 'ios-app',
    language: 'swift',
    gitState: {
      branch: 'main',
      headSha: 'def456',
      uncommittedChanges: [],
      recentCommits: [
        {
          sha: 'commit-3',
          message: 'Update user model',
          author: 'dev',
          date: '2026-02-26T00:00:00Z',
          filesChanged: ['Models/User.swift'],
        },
      ],
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'group-based',
      errorHandling: 'Result type',
      patterns: ['MVVM', 'coordinator'],
      testingPatterns: 'separate directory',
    },
  });

  const mismatch: Mismatch = {
    kind: 'missing-field',
    description: "Consumer ios-app missing field 'email' from User",
    provider: { repo: 'backend', file: 'src/types.ts', line: 5, field: 'email' },
    consumer: { repo: 'ios-app', file: 'Models/User.swift', line: 3 },
    severity: 'breaking',
  };

  const bridge: ApiBridge = {
    consumer: { repo: 'ios-app', file: 'Services/UserService.swift', line: 10 },
    provider: { repo: 'backend', route: '/api/users', handler: 'getUsers' },
    contract: {
      inputType: makeTypeDef('Void', 'backend'),
      outputType: makeTypeDef('UserList', 'backend'),
      matchStatus: 'mismatch',
    },
  };

  const sharedType: TypeLineage = {
    concept: 'User',
    instances: [
      { repo: 'backend', type: makeTypeDef('User', 'backend') },
      { repo: 'ios-app', type: makeTypeDef('User', 'ios-app') },
    ],
    alignment: 'diverged',
  };

  return {
    repos: [backend, ios],
    bridges: [bridge],
    sharedTypes: [sharedType],
    contractMismatches: [mismatch],
    impactPaths: [
      {
        trigger: { repo: 'backend', file: 'src/types.ts', change: 'type-change' },
        affected: [
          {
            repo: 'ios-app',
            file: 'Models/User.swift',
            line: 1,
            reason: 'Uses User type',
            severity: 'breaking',
          },
        ],
      },
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('formatDigest', () => {
  it('returns an object with digest and markdown', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const result = formatDigest(graph, config);

    expect(result).toHaveProperty('digest');
    expect(result).toHaveProperty('markdown');
    expect(typeof result.markdown).toBe('string');
    expect(result.digest).toHaveProperty('generatedAt');
    expect(result.digest).toHaveProperty('repos');
  });

  it('markdown contains the OMNI-LINK header', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('# OMNI-LINK ECOSYSTEM STATE');
  });

  it('includes an architecture diagram when bridges exist', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { digest, markdown } = formatDigest(graph, config);

    expect(digest.architectureDiagram).toContain('```mermaid');
    expect(markdown).toContain('## Architecture');
    expect(markdown).toContain('graph TD');
  });

  it('markdown contains Generated timestamp', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('Generated:');
  });

  it('markdown contains Repos section with repo details', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## Repos');
    expect(markdown).toContain('backend');
    expect(markdown).toContain('typescript');
    expect(markdown).toContain('develop');
    expect(markdown).toContain('2 uncommitted changes');
    expect(markdown).toContain('ios-app');
    expect(markdown).toContain('swift');
  });

  it('markdown contains API Contracts section', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## API Contracts');
    expect(markdown).toContain('2 total');
    expect(markdown).toContain('mismatch');
  });

  it('markdown contains Shared Types section', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## Shared Types');
    expect(markdown).toContain('User');
    expect(markdown).toContain('diverged');
  });

  it('markdown contains Recent Changes section', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## Recent Changes');
    expect(markdown).toContain('Add user endpoint');
    expect(markdown).toContain('Fix type mismatch');
  });

  it('markdown contains Conventions section', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## Conventions');
    expect(markdown).toContain('camelCase');
  });

  it('digest has correct contractStatus counts', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { digest } = formatDigest(graph, config);

    expect(digest.contractStatus.total).toBe(2);
    expect(digest.contractStatus.mismatches).toHaveLength(1);
  });

  it('contractStatus.total includes mismatches when bridges array is empty', () => {
    const graph: EcosystemGraph = {
      repos: [],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [
        {
          kind: 'missing-procedure' as const,
          description: "Swift and backend both use 'task.create', docs don't declare it",
          provider: {
            repo: 'hustlexp-docs',
            file: 'API_CONTRACT.md',
            line: 1,
            field: 'task.create',
          },
          consumer: { repo: 'hustlexp-ios', file: 'TaskService.swift', line: 10 },
          severity: 'warning' as const,
        },
        {
          kind: 'type-mismatch' as const,
          description: "field 'amount' is number in backend but String in iOS",
          provider: { repo: 'backend', file: 'types.ts', line: 5, field: 'amount' },
          consumer: { repo: 'ios', file: 'Models/Escrow.swift', line: 12 },
          severity: 'breaking' as const,
        },
      ],
      impactPaths: [],
    };
    const config = makeConfig();
    const { digest } = formatDigest(graph, config);

    expect(digest.contractStatus.total).toBe(2);
    expect(digest.contractStatus.exact).toBe(0);
    expect(digest.contractStatus.compatible).toBe(0);
  });

  it('contractStatus separates doc-coverage-gaps from functional mismatches', () => {
    const graph: EcosystemGraph = {
      repos: [],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [
        {
          kind: 'missing-procedure' as const,
          description:
            "Swift client and backend both use 'task.create', but the docs authority does not declare it.",
          provider: {
            repo: 'hustlexp-docs',
            file: 'API_CONTRACT.md',
            line: 1,
            field: 'task.create',
          },
          consumer: { repo: 'hustlexp-ios', file: 'TaskService.swift', line: 10 },
          severity: 'warning' as const,
        },
        {
          kind: 'missing-procedure' as const,
          description:
            "Swift client and backend both use 'user.me', but the docs authority does not declare it.",
          provider: { repo: 'hustlexp-docs', file: 'API_CONTRACT.md', line: 1, field: 'user.me' },
          consumer: { repo: 'hustlexp-ios', file: 'UserService.swift', line: 5 },
          severity: 'warning' as const,
        },
        {
          kind: 'type-mismatch' as const,
          description: "field 'amount' is number in backend but String in iOS",
          provider: { repo: 'backend', file: 'types.ts', line: 5, field: 'amount' },
          consumer: { repo: 'ios', file: 'Models/Escrow.swift', line: 12 },
          severity: 'breaking' as const,
        },
        {
          kind: 'obsolete-call' as const,
          description: "iOS calls 'task.legacyCreate' which no longer exists in backend",
          provider: {
            repo: 'backend',
            file: 'routers/task.ts',
            line: 1,
            field: 'task.legacyCreate',
          },
          consumer: { repo: 'ios', file: 'TaskService.swift', line: 55 },
          severity: 'breaking' as const,
        },
      ],
      impactPaths: [],
    };
    const config = makeConfig();
    const { digest } = formatDigest(graph, config);

    expect(digest.contractStatus.total).toBe(4);
    expect(digest.contractStatus.docCoverageGaps).toBe(2);
    expect(digest.contractStatus.mismatches).toHaveLength(2);
    expect(
      digest.contractStatus.mismatches.every(
        (m: { kind: string }) => m.kind !== 'missing-procedure',
      ),
    ).toBe(true);
  });

  it('digest repos array has correct data', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { digest } = formatDigest(graph, config);

    expect(digest.repos).toHaveLength(2);

    const backendDigest = digest.repos.find((r) => r.name === 'backend');
    expect(backendDigest).toBeDefined();
    expect(backendDigest!.language).toBe('typescript');
    expect(backendDigest!.branch).toBe('develop');
    expect(backendDigest!.uncommittedCount).toBe(2);

    const iosDigest = digest.repos.find((r) => r.name === 'ios-app');
    expect(iosDigest).toBeDefined();
    expect(iosDigest!.language).toBe('swift');
    expect(iosDigest!.uncommittedCount).toBe(0);
  });

  it('digest has a tokenCount', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { digest } = formatDigest(graph, config);

    expect(typeof digest.tokenCount).toBe('number');
    expect(digest.tokenCount).toBeGreaterThan(0);
  });

  it('handles empty graph gracefully', () => {
    const graph: EcosystemGraph = {
      repos: [],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    };
    const config = makeConfig();
    const { digest, markdown } = formatDigest(graph, config);

    expect(markdown).toContain('# OMNI-LINK ECOSYSTEM STATE');
    expect(digest.repos).toHaveLength(0);
    expect(digest.contractStatus.total).toBe(0);
  });

  it('markdown contains Evolution Opportunities section', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## Evolution Opportunities');
  });

  it('markdown lists mismatches when present', () => {
    const graph = makeGraph();
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain("missing field 'email'");
  });

  it('markdown includes Key Type Signatures section when shared types present', () => {
    const graph = makeGraph(); // uses existing makeGraph() that has sharedTypes with User type
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## Key Type Signatures');
    expect(markdown).toContain('interface User');
    expect(markdown).toContain('id: string');
    expect(markdown).toContain('name: string');
  });

  it('markdown includes API Route Signatures section when routes present', () => {
    const graph = makeGraph(); // makeGraph() backend has GET /api/users and POST /api/users routes
    const config = makeConfig();
    const { markdown } = formatDigest(graph, config);

    expect(markdown).toContain('## API Route Signatures');
    expect(markdown).toContain('GET /api/users');
    expect(markdown).toContain('getUsers');
  });

  it('does NOT include Key Type Signatures section when no shared types', () => {
    const graph: EcosystemGraph = {
      repos: [],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    };
    const { markdown } = formatDigest(graph, makeConfig());
    expect(markdown).not.toContain('## Key Type Signatures');
  });

  it('does NOT include API Route Signatures section when no routes', () => {
    const graph: EcosystemGraph = {
      repos: [],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    };
    const { markdown } = formatDigest(graph, makeConfig());
    expect(markdown).not.toContain('## API Route Signatures');
  });
});
