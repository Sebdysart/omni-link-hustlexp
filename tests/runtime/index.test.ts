import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  attachRuntimeSignals,
  collectRuntimeSignals,
  graphRiskLevel,
  rankEvolutionSuggestions,
} from '../../engine/runtime/index.js';
import type { EcosystemGraph, OmniLinkConfig, RepoManifest } from '../../engine/types.js';

function makeConfig(repoPath: string): OmniLinkConfig {
  return {
    repos: [{ name: 'backend', path: repoPath, language: 'typescript', role: 'backend' }],
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature', 'scale', 'security'],
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
      directory: path.join(repoPath, '.cache'),
      maxAgeDays: 7,
    },
    runtime: {
      enabled: true,
      coverageSummaryPath: 'coverage/coverage-summary.json',
      testResultsPath: 'reports/test-results.json',
      openApiPath: 'contracts/openapi.json',
      graphQlSchemaPath: 'contracts/schema.graphql',
      telemetrySummaryPath: 'reports/telemetry.json',
      traceSummaryPath: 'reports/traces.json',
    },
  };
}

function makeManifest(repoPath: string): RepoManifest {
  return {
    repoId: 'backend',
    path: repoPath,
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
      fileOrganization: 'by-feature',
      errorHandling: 'try-catch',
      patterns: [],
      testingPatterns: 'co-located',
    },
    dependencies: {
      internal: [],
      external: [],
    },
    health: {
      testCoverage: 82,
      lintErrors: 0,
      typeErrors: 0,
      todoCount: 1,
      deadCode: [],
    },
  };
}

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-runtime-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('runtime signals', () => {
  it('parses OpenAPI, GraphQL, telemetry, and trace artifacts into weighted signals', () => {
    const repoPath = makeTmpDir();
    fs.mkdirSync(path.join(repoPath, 'coverage'), { recursive: true });
    fs.mkdirSync(path.join(repoPath, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(repoPath, 'contracts'), { recursive: true });

    fs.writeFileSync(
      path.join(repoPath, 'coverage', 'coverage-summary.json'),
      JSON.stringify({ total: { lines: { pct: 91 } } }),
    );
    fs.writeFileSync(
      path.join(repoPath, 'reports', 'test-results.json'),
      JSON.stringify({ numPassedTests: 48, numFailedTests: 2 }),
    );
    fs.writeFileSync(
      path.join(repoPath, 'contracts', 'openapi.json'),
      JSON.stringify({
        openapi: '3.1.0',
        paths: {
          '/users': { get: {}, post: {} },
          '/users/{id}': { get: {}, delete: {} },
        },
      }),
    );
    fs.writeFileSync(
      path.join(repoPath, 'contracts', 'schema.graphql'),
      `
type Query {
  users: [User!]!
  user(id: ID!): User
}

type Mutation {
  createUser(input: CreateUserInput!): User!
}
`,
    );
    fs.writeFileSync(
      path.join(repoPath, 'reports', 'telemetry.json'),
      JSON.stringify({ requestCount: 9000, errorCount: 45, incidentCount: 1, p95Ms: 320 }),
    );
    fs.writeFileSync(
      path.join(repoPath, 'reports', 'traces.json'),
      JSON.stringify({ spanCount: 12000, slowSpanCount: 160, errorCount: 12, p95Ms: 410 }),
    );

    const signals = collectRuntimeSignals(makeManifest(repoPath), makeConfig(repoPath));
    const kinds = new Set(signals.map((signal) => signal.kind));

    expect(kinds).toEqual(
      new Set(['coverage', 'tests', 'openapi', 'graphql', 'telemetry', 'trace']),
    );
    expect(signals.find((signal) => signal.kind === 'openapi')?.detail).toContain('operations=4');
    expect(signals.find((signal) => signal.kind === 'graphql')?.detail).toContain('schemaNodes=');
    expect(signals.find((signal) => signal.kind === 'telemetry')?.weight).toBeGreaterThan(0.4);
    expect(signals.find((signal) => signal.kind === 'trace')?.weight).toBeGreaterThan(0.3);
  });

  it('propagates runtime weight into graph risk scores', () => {
    const repoPath = makeTmpDir();
    fs.mkdirSync(path.join(repoPath, 'reports'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'reports', 'telemetry.json'),
      JSON.stringify({ requests: 10000, errors: 150, p95Ms: 700 }),
    );

    const manifest = makeManifest(repoPath);
    const graph: EcosystemGraph = {
      repos: [manifest],
      bridges: [
        {
          consumer: { repo: 'backend', file: 'src/client.ts', line: 12 },
          provider: { repo: 'backend', route: '/users', handler: 'getUsers' },
          contract: {
            inputType: {
              name: 'Empty',
              fields: [],
              source: { repo: 'backend', file: 'a.ts', line: 1 },
            },
            outputType: {
              name: 'User',
              fields: [],
              source: { repo: 'backend', file: 'b.ts', line: 1 },
            },
            matchStatus: 'compatible',
          },
        },
      ],
      sharedTypes: [],
      contractMismatches: [
        {
          kind: 'missing-field',
          description: 'Consumer expects field plan',
          provider: { repo: 'backend', file: 'src/routes.ts', line: 5, field: 'id' },
          consumer: { repo: 'backend', file: 'src/client.ts', line: 19, field: 'plan' },
          severity: 'breaking',
        },
      ],
      impactPaths: [
        {
          trigger: { repo: 'backend', file: 'src/routes.ts', change: 'route-change' },
          affected: [
            {
              repo: 'backend',
              file: 'src/client.ts',
              line: 19,
              reason: 'route consumer',
              severity: 'breaking',
            },
          ],
        },
      ],
    };

    const config = makeConfig(repoPath);
    config.runtime = {
      enabled: true,
      telemetrySummaryPath: 'reports/telemetry.json',
    };

    const enriched = attachRuntimeSignals(graph, config);

    expect(enriched.runtimeSignals?.length).toBeGreaterThan(0);
    expect(enriched.bridges[0].riskScore).toBeGreaterThan(0);
    expect(enriched.contractMismatches[0].riskScore).toBeGreaterThan(0);
    expect(enriched.impactPaths[0].riskScore).toBeGreaterThan(0);
    expect(graphRiskLevel(enriched)).toBe('high');
  });

  it('discovers common HustleXP runtime artifact paths when not explicitly configured', () => {
    const repoPath = makeTmpDir();
    fs.mkdirSync(path.join(repoPath, 'artifacts'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'artifacts', 'test-results.json'),
      JSON.stringify({ passed: 9, failed: 1 }),
    );
    fs.writeFileSync(
      path.join(repoPath, 'artifacts', 'telemetry-summary.json'),
      JSON.stringify({ requests: 1200, errors: 12, p95Ms: 220 }),
    );

    const manifest = makeManifest(repoPath);
    const config = makeConfig(repoPath);
    config.runtime = {
      enabled: true,
    };

    const signals = collectRuntimeSignals(manifest, config);

    expect(signals.find((signal) => signal.kind === 'tests')?.source).toContain(
      path.join('artifacts', 'test-results.json'),
    );
    expect(signals.find((signal) => signal.kind === 'telemetry')?.source).toContain(
      path.join('artifacts', 'telemetry-summary.json'),
    );
  });

  it('re-ranks evolution suggestions using runtime weight', () => {
    const repoPath = makeTmpDir();
    fs.mkdirSync(path.join(repoPath, 'reports'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'reports', 'telemetry.json'),
      JSON.stringify({ totalRequests: 12000, totalErrors: 80, p95Ms: 280 }),
    );

    const manifest = makeManifest(repoPath);
    const graph = attachRuntimeSignals(
      {
        repos: [manifest],
        bridges: [],
        sharedTypes: [],
        contractMismatches: [],
        impactPaths: [],
      },
      {
        ...makeConfig(repoPath),
        runtime: {
          enabled: true,
          telemetrySummaryPath: 'reports/telemetry.json',
        },
      },
    );

    const ranked = rankEvolutionSuggestions(
      [
        {
          id: 'a',
          category: 'feature',
          title: 'Add new dashboard',
          description: 'New surface',
          evidence: [],
          estimatedEffort: 'medium',
          estimatedImpact: 'high',
          affectedRepos: ['backend'],
        },
        {
          id: 'b',
          category: 'security',
          title: 'Tighten auth checks',
          description: 'Harden auth',
          evidence: [],
          estimatedEffort: 'small',
          estimatedImpact: 'medium',
          affectedRepos: [],
        },
      ],
      graph,
    );

    expect(ranked[0].id).toBe('a');
    expect(ranked[0].queue).toBe('business-opportunity');
    expect(ranked[0].runtimeWeight).toBeGreaterThan(0);
    expect(ranked[1].queue).toBe('risk-reduction');
  });
});
