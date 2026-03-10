import { describe, it, expect } from 'vitest';
import { generateArchitectureDiagram } from '../../engine/context/diagram-generator.js';
import type { EcosystemGraph, RepoManifest, ApiBridge } from '../../engine/types.js';

function makeRepo(repoId: string): RepoManifest {
  return {
    repoId,
    path: `/tmp/${repoId}`,
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
    },
    conventions: {
      patterns: [],
      testingPatterns: '',
    },
    dependencies: {
      internal: [],
      external: [],
    },
    health: {
      score: 100,
      testScore: 100,
      qualityScore: 100,
      deadCodeScore: 100,
      todoScore: 100,
      lintErrors: 0,
      typeErrors: 0,
      todoCount: 0,
      deadCode: [],
    },
  } as RepoManifest;
}

function makeBridge(consumerRepo: string, providerRepo: string, route: string): ApiBridge {
  return {
    consumer: { repo: consumerRepo, file: 'client.ts', line: 10 },
    provider: { repo: providerRepo, route, handler: 'handler' },
    contract: {
      inputType: { kind: 'object', fields: [] },
      outputType: { kind: 'object', fields: [] },
      matchStatus: 'exact',
    },
  } as ApiBridge;
}

function makeGraph(repos: RepoManifest[], bridges: ApiBridge[] = []): EcosystemGraph {
  return {
    repos,
    bridges,
    sharedTypes: [],
    contractMismatches: [],
    impactPaths: [],
  };
}

describe('diagram-generator', () => {
  it('returns empty string for empty graph (0 repos)', () => {
    const result = generateArchitectureDiagram(makeGraph([]));
    expect(result).toBe('');
  });

  it('generates valid mermaid diagram for 1 repo', () => {
    const graph = makeGraph([makeRepo('backend')]);
    const result = generateArchitectureDiagram(graph);

    expect(result).toContain('```mermaid');
    expect(result).toContain('graph TD');
    expect(result).toContain('backend["backend"]');
    expect(result).toContain('```');
    // Verify it ends with closing fence
    expect(result.trimEnd().endsWith('```')).toBe(true);
  });

  it('generates valid mermaid with edges for repos connected by bridges', () => {
    const repos = [makeRepo('ios-app'), makeRepo('api-server')];
    const bridges = [makeBridge('ios-app', 'api-server', 'user.create')];
    const graph = makeGraph(repos, bridges);
    const result = generateArchitectureDiagram(graph);

    expect(result).toContain('ios_app["ios-app"]');
    expect(result).toContain('api_server["api-server"]');
    expect(result).toContain('ios_app -->|"user.create"| api_server');
  });

  it('sanitizes special characters in repo IDs (node IDs)', () => {
    const repos = [makeRepo('my-repo.v2'), makeRepo('other@repo')];
    const graph = makeGraph(repos);
    const result = generateArchitectureDiagram(graph);

    // Special chars replaced with underscores
    expect(result).toContain('my_repo_v2["my-repo.v2"]');
    expect(result).toContain('other_repo["other@repo"]');
  });

  it('escapes quotes in labels', () => {
    const repos = [makeRepo('repo-with-"quotes"')];
    const graph = makeGraph(repos);
    const result = generateArchitectureDiagram(graph);

    // Quotes in the label should be escaped
    expect(result).toContain('repo_with__quotes_["repo-with-\\"quotes\\""]');
  });

  it('handles repos with no bridges (just nodes, no edges)', () => {
    const repos = [makeRepo('alpha'), makeRepo('beta'), makeRepo('gamma')];
    const graph = makeGraph(repos);
    const result = generateArchitectureDiagram(graph);

    expect(result).toContain('alpha["alpha"]');
    expect(result).toContain('beta["beta"]');
    expect(result).toContain('gamma["gamma"]');
    // No edge arrows
    expect(result).not.toContain('-->');
  });

  it('skips bridges with unknown repos (consumer or provider not in graph)', () => {
    const repos = [makeRepo('known-repo')];
    const bridges = [
      makeBridge('unknown-consumer', 'known-repo', 'route.a'),
      makeBridge('known-repo', 'unknown-provider', 'route.b'),
      makeBridge('ghost-a', 'ghost-b', 'route.c'),
    ];
    const graph = makeGraph(repos, bridges);
    const result = generateArchitectureDiagram(graph);

    expect(result).toContain('known_repo["known-repo"]');
    // None of the bridges should produce edges since at least one side is unknown
    expect(result).not.toContain('-->');
  });
});
