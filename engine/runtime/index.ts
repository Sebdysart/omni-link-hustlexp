import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  EcosystemGraph,
  EvolutionSuggestion,
  OmniLinkConfig,
  RepoManifest,
  RiskLevel,
  RuntimeSignal,
} from '../types.js';

const DISCOVERABLE_RUNTIME_ARTIFACTS: Record<
  | 'coverageSummaryPath'
  | 'testResultsPath'
  | 'openApiPath'
  | 'graphQlSchemaPath'
  | 'telemetrySummaryPath'
  | 'traceSummaryPath',
  string[]
> = {
  coverageSummaryPath: [
    path.join('coverage', 'coverage-summary.json'),
    path.join('backend', 'coverage', 'coverage-summary.json'),
  ],
  testResultsPath: [
    path.join('artifacts', 'test-results.json'),
    path.join('reports', 'test-results.json'),
    path.join('backend', 'artifacts', 'test-results.json'),
    path.join('backend', 'reports', 'test-results.json'),
    path.join('artifacts', 'ios-test-summary.json'),
  ],
  openApiPath: [
    path.join('contracts', 'openapi.json'),
    path.join('backend', 'contracts', 'openapi.json'),
    path.join('openapi.json'),
  ],
  graphQlSchemaPath: [
    path.join('contracts', 'schema.graphql'),
    path.join('backend', 'contracts', 'schema.graphql'),
    path.join('schema.graphql'),
  ],
  telemetrySummaryPath: [
    path.join('artifacts', 'telemetry-summary.json'),
    path.join('reports', 'telemetry.json'),
    path.join('backend', 'artifacts', 'telemetry-summary.json'),
  ],
  traceSummaryPath: [
    path.join('artifacts', 'trace-summary.json'),
    path.join('reports', 'traces.json'),
    path.join('backend', 'artifacts', 'trace-summary.json'),
  ],
};

function readJsonIfPresent(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTextIfPresent(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function resolveRuntimeArtifactPath(
  manifest: RepoManifest,
  config: OmniLinkConfig,
  key:
    | 'coverageSummaryPath'
    | 'testResultsPath'
    | 'openApiPath'
    | 'graphQlSchemaPath'
    | 'telemetrySummaryPath'
    | 'traceSummaryPath',
): string | null {
  const configuredPath = config.runtime?.[key];
  const configuredCandidates =
    configuredPath === undefined
      ? []
      : [
          path.isAbsolute(configuredPath)
            ? configuredPath
            : path.join(manifest.path, configuredPath),
        ];
  const discoveredCandidates = DISCOVERABLE_RUNTIME_ARTIFACTS[key].map((candidate) =>
    path.join(manifest.path, candidate),
  );

  for (const candidate of [...configuredCandidates, ...discoveredCandidates]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return configuredCandidates[0] ?? null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function numberLike(value: unknown, keys: string[]): number | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

function coverageSignal(manifest: RepoManifest): RuntimeSignal | null {
  if (manifest.health.testCoverage === null) return null;
  const weight = Math.max(0, Math.min(1, manifest.health.testCoverage / 100));

  return {
    kind: 'coverage',
    source: 'manifest.health.testCoverage',
    weight,
    value: manifest.health.testCoverage,
    detail: `coverage=${manifest.health.testCoverage}`,
    sourceKind: 'runtime',
    confidence: 0.8,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: 'coverage-ingestion',
        detail: 'coverage summary',
        confidence: 0.8,
      },
    ],
  };
}

function externalCoverageSignal(
  manifest: RepoManifest,
  config: OmniLinkConfig,
): RuntimeSignal | null {
  if (!config.runtime?.enabled) return null;
  const resolvedPath = resolveRuntimeArtifactPath(manifest, config, 'coverageSummaryPath');
  if (!resolvedPath) return null;
  const json = readJsonIfPresent(resolvedPath);
  const total = json?.total as { lines?: { pct?: number } } | undefined;
  const pct = total?.lines?.pct;

  if (typeof pct !== 'number') return null;

  return {
    kind: 'coverage',
    source: resolvedPath,
    weight: Math.max(0, Math.min(1, pct / 100)),
    value: pct,
    detail: `coverage=${pct}`,
    sourceKind: 'runtime',
    confidence: 0.85,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: 'coverage-artifact',
        detail: 'coverage summary artifact',
        confidence: 0.85,
      },
    ],
  };
}

function testResultsSignal(manifest: RepoManifest, config: OmniLinkConfig): RuntimeSignal | null {
  if (!config.runtime?.enabled) return null;
  const resolvedPath = resolveRuntimeArtifactPath(manifest, config, 'testResultsPath');
  if (!resolvedPath) return null;
  const json = readJsonIfPresent(resolvedPath);
  if (!json) return null;

  const passed =
    typeof json.passed === 'number'
      ? json.passed
      : typeof json.numPassedTests === 'number'
        ? json.numPassedTests
        : 0;
  const failed =
    typeof json.failed === 'number'
      ? json.failed
      : typeof json.numFailedTests === 'number'
        ? json.numFailedTests
        : 0;
  const total = passed + failed;
  if (total === 0) return null;

  return {
    kind: 'tests',
    source: resolvedPath,
    weight: passed / total,
    value: passed / total,
    detail: `passed=${passed},failed=${failed}`,
    sourceKind: 'runtime',
    confidence: 0.78,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: 'test-results-artifact',
        detail: 'test results artifact',
        confidence: 0.78,
      },
    ],
  };
}

function openApiSignal(manifest: RepoManifest, config: OmniLinkConfig): RuntimeSignal | null {
  if (!config.runtime?.enabled) return null;
  const resolvedPath = resolveRuntimeArtifactPath(manifest, config, 'openApiPath');
  if (!resolvedPath) return null;
  const json = readJsonIfPresent(resolvedPath);
  if (json) {
    const pathsObject = json.paths as Record<string, Record<string, unknown>> | undefined;
    if (pathsObject) {
      const operations = Object.values(pathsObject).reduce((total, value) => {
        if (typeof value !== 'object' || value === null) {
          return total;
        }
        return total + Object.keys(value).length;
      }, 0);

      return {
        kind: 'openapi',
        source: resolvedPath,
        weight: clamp01(0.3 + operations / 50),
        value: operations,
        detail: `operations=${operations}`,
        sourceKind: 'runtime',
        confidence: 0.82,
        provenance: [
          {
            sourceKind: 'runtime',
            adapter: 'openapi-artifact',
            detail: 'OpenAPI paths and operations',
            confidence: 0.82,
          },
        ],
      };
    }
  }

  const source = readTextIfPresent(resolvedPath);
  if (!source) return null;
  const pathMatches = source.match(/^\s*\/[^:\n]+:/gm) ?? [];
  const methodMatches = source.match(/^\s*(get|post|put|patch|delete|head|options):/gim) ?? [];
  const operations = Math.max(methodMatches.length, pathMatches.length);
  if (operations === 0) return null;

  return {
    kind: 'openapi',
    source: resolvedPath,
    weight: clamp01(0.25 + operations / 60),
    value: operations,
    detail: `operations=${operations}`,
    sourceKind: 'runtime',
    confidence: 0.72,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: 'openapi-artifact',
        detail: 'OpenAPI text artifact',
        confidence: 0.72,
      },
    ],
  };
}

function graphQlSignal(manifest: RepoManifest, config: OmniLinkConfig): RuntimeSignal | null {
  if (!config.runtime?.enabled) return null;
  const resolvedPath = resolveRuntimeArtifactPath(manifest, config, 'graphQlSchemaPath');
  if (!resolvedPath) return null;
  const json = readJsonIfPresent(resolvedPath);
  if (json) {
    const schema =
      (json.data as { __schema?: { types?: unknown[]; queryType?: { name?: string } } } | undefined)
        ?.__schema ??
      (json.__schema as { types?: unknown[]; queryType?: { name?: string } } | undefined);
    const typeCount = schema?.types?.length;
    if (typeof typeCount === 'number' && typeCount > 0) {
      return {
        kind: 'graphql',
        source: resolvedPath,
        weight: clamp01(0.25 + typeCount / 100),
        value: typeCount,
        detail: `types=${typeCount}`,
        sourceKind: 'runtime',
        confidence: 0.8,
        provenance: [
          {
            sourceKind: 'runtime',
            adapter: 'graphql-introspection',
            detail: 'GraphQL introspection schema',
            confidence: 0.8,
          },
        ],
      };
    }
  }

  const source = readTextIfPresent(resolvedPath);
  if (!source) return null;
  const operationFields = (source.match(/^\s+[A-Za-z0-9_]+\s*(?:\(|:)/gm) ?? []).length;
  const rootTypes = (source.match(/\btype\s+(Query|Mutation|Subscription)\b/g) ?? []).length;
  const value = operationFields + rootTypes;
  if (value === 0) return null;

  return {
    kind: 'graphql',
    source: resolvedPath,
    weight: clamp01(0.25 + value / 80),
    value,
    detail: `schemaNodes=${value}`,
    sourceKind: 'runtime',
    confidence: 0.74,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: 'graphql-schema',
        detail: 'GraphQL SDL artifact',
        confidence: 0.74,
      },
    ],
  };
}

function telemetrySignal(manifest: RepoManifest, config: OmniLinkConfig): RuntimeSignal | null {
  if (!config.runtime?.enabled) return null;
  const resolvedPath = resolveRuntimeArtifactPath(manifest, config, 'telemetrySummaryPath');
  if (!resolvedPath) return null;
  const json = readJsonIfPresent(resolvedPath);
  if (!json) return null;

  const requests = numberLike(json, ['requests', 'requestCount', 'totalRequests']) ?? 0;
  const errors = numberLike(json, ['errors', 'errorCount', 'totalErrors']) ?? 0;
  const incidents = numberLike(json, ['incidents', 'incidentCount']) ?? 0;
  const p95Ms = numberLike(json, ['p95Ms', 'latencyP95Ms', 'durationP95Ms']) ?? 0;
  if (requests === 0 && errors === 0 && incidents === 0 && p95Ms === 0) return null;

  const errorRate = requests > 0 ? errors / requests : clamp01(errors / 10);
  const weight = clamp01(
    0.2 +
      clamp01(requests / 10_000) * 0.4 +
      clamp01(errorRate * 5) * 0.25 +
      clamp01(incidents / 10) * 0.1 +
      clamp01(p95Ms / 2_000) * 0.05,
  );

  return {
    kind: 'telemetry',
    source: resolvedPath,
    weight,
    value: requests,
    detail: `requests=${requests},errors=${errors},incidents=${incidents},p95Ms=${p95Ms}`,
    sourceKind: 'runtime',
    confidence: 0.83,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: 'telemetry-summary',
        detail: 'Telemetry summary artifact',
        confidence: 0.83,
      },
    ],
  };
}

function traceSignal(manifest: RepoManifest, config: OmniLinkConfig): RuntimeSignal | null {
  if (!config.runtime?.enabled) return null;
  const resolvedPath = resolveRuntimeArtifactPath(manifest, config, 'traceSummaryPath');
  if (!resolvedPath) return null;
  const json = readJsonIfPresent(resolvedPath);
  if (!json) return null;

  const spans = numberLike(json, ['spans', 'spanCount', 'traceCount']) ?? 0;
  const slowSpans = numberLike(json, ['slowSpans', 'slowSpanCount']) ?? 0;
  const errors = numberLike(json, ['errors', 'errorCount']) ?? 0;
  const p95Ms = numberLike(json, ['p95Ms', 'durationP95Ms']) ?? 0;
  if (spans === 0 && slowSpans === 0 && errors === 0 && p95Ms === 0) return null;

  const weight = clamp01(
    0.2 +
      clamp01(spans / 20_000) * 0.35 +
      clamp01(slowSpans / Math.max(1, spans / 10 || 1)) * 0.25 +
      clamp01(errors / Math.max(1, spans / 20 || 1)) * 0.1 +
      clamp01(p95Ms / 2_500) * 0.1,
  );

  return {
    kind: 'trace',
    source: resolvedPath,
    weight,
    value: spans,
    detail: `spans=${spans},slowSpans=${slowSpans},errors=${errors},p95Ms=${p95Ms}`,
    sourceKind: 'runtime',
    confidence: 0.81,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: 'trace-summary',
        detail: 'Trace summary artifact',
        confidence: 0.81,
      },
    ],
  };
}

function artifactPresenceSignal(
  manifest: RepoManifest,
  config: OmniLinkConfig,
  key: 'openApiPath' | 'graphQlSchemaPath' | 'telemetrySummaryPath' | 'traceSummaryPath',
  kind: RuntimeSignal['kind'],
  weight: number,
): RuntimeSignal | null {
  if (!config.runtime?.enabled) return null;
  const resolvedPath = resolveRuntimeArtifactPath(manifest, config, key);
  if (!resolvedPath) return null;
  if (!fs.existsSync(resolvedPath)) return null;

  return {
    kind,
    source: resolvedPath,
    weight,
    detail: `${kind} artifact present`,
    sourceKind: 'runtime',
    confidence: 0.7,
    provenance: [
      {
        sourceKind: 'runtime',
        adapter: `${kind}-artifact`,
        detail: 'artifact presence signal',
        confidence: 0.7,
      },
    ],
  };
}

function repoRuntimeWeight(manifest: RepoManifest): number {
  const signals = manifest.runtimeSignals ?? [];
  if (signals.length === 0) return 0;
  return signals.reduce((total, signal) => total + signal.weight, 0) / signals.length;
}

function severityWeight(severity: 'breaking' | 'warning' | 'info'): number {
  switch (severity) {
    case 'breaking':
      return 1;
    case 'warning':
      return 0.65;
    case 'info':
      return 0.25;
  }
}

function toRiskLevel(score: number): RiskLevel {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function queueForSuggestion(
  suggestion: EvolutionSuggestion,
): NonNullable<EvolutionSuggestion['queue']> {
  if (suggestion.category === 'feature' || suggestion.category === 'monetization') {
    return 'business-opportunity';
  }
  if (suggestion.category === 'security') {
    return 'risk-reduction';
  }
  return 'engineering-debt';
}

export function collectRuntimeSignals(
  manifest: RepoManifest,
  config: OmniLinkConfig,
): RuntimeSignal[] {
  const signals = [
    coverageSignal(manifest),
    externalCoverageSignal(manifest, config),
    testResultsSignal(manifest, config),
    openApiSignal(manifest, config) ??
      artifactPresenceSignal(manifest, config, 'openApiPath', 'openapi', 0.65),
    graphQlSignal(manifest, config) ??
      artifactPresenceSignal(manifest, config, 'graphQlSchemaPath', 'graphql', 0.65),
    telemetrySignal(manifest, config) ??
      artifactPresenceSignal(manifest, config, 'telemetrySummaryPath', 'telemetry', 0.75),
    traceSignal(manifest, config) ??
      artifactPresenceSignal(manifest, config, 'traceSummaryPath', 'trace', 0.7),
  ].filter((entry): entry is RuntimeSignal => entry !== null);

  return signals;
}

export function attachRuntimeSignals(
  graph: EcosystemGraph,
  config: OmniLinkConfig,
): EcosystemGraph {
  const repos = graph.repos.map((manifest) => ({
    ...manifest,
    runtimeSignals: collectRuntimeSignals(manifest, config),
  }));
  const runtimeSignals = repos.flatMap((manifest) => manifest.runtimeSignals ?? []);
  const runtimeWeightByRepo = new Map(
    repos.map((manifest) => [manifest.repoId, repoRuntimeWeight(manifest)]),
  );

  return {
    ...graph,
    repos,
    runtimeSignals,
    bridges: graph.bridges.map((bridge) => {
      const providerWeight = runtimeWeightByRepo.get(bridge.provider.repo) ?? 0;
      const consumerWeight = runtimeWeightByRepo.get(bridge.consumer.repo) ?? 0;
      const runtimeWeight = Number(((providerWeight + consumerWeight) / 2).toFixed(3));
      return {
        ...bridge,
        runtimeWeight,
        riskScore: Math.round(runtimeWeight * 100),
      };
    }),
    contractMismatches: graph.contractMismatches.map((mismatch) => {
      const providerWeight = runtimeWeightByRepo.get(mismatch.provider.repo) ?? 0;
      const consumerWeight = runtimeWeightByRepo.get(mismatch.consumer.repo) ?? 0;
      const runtimeWeight = Number(((providerWeight + consumerWeight) / 2).toFixed(3));
      return {
        ...mismatch,
        runtimeWeight,
        riskScore: Math.round(runtimeWeight * 100 * severityWeight(mismatch.severity)),
      };
    }),
    impactPaths: graph.impactPaths.map((impactPath) => {
      const runtimeWeight = runtimeWeightByRepo.get(impactPath.trigger.repo) ?? 0;
      const highestSeverity = impactPath.affected.reduce<'breaking' | 'warning' | 'info'>(
        (current, affected) => {
          if (current === 'breaking' || affected.severity === current) return current;
          if (affected.severity === 'breaking') return 'breaking';
          if (affected.severity === 'warning') return 'warning';
          return current;
        },
        'info',
      );

      return {
        ...impactPath,
        runtimeWeight,
        riskScore: Math.round(runtimeWeight * 100 * severityWeight(highestSeverity)),
      };
    }),
  };
}

export function rankEvolutionSuggestions(
  suggestions: EvolutionSuggestion[],
  graph: EcosystemGraph,
): EvolutionSuggestion[] {
  const runtimeWeightByRepo = new Map(
    graph.repos.map((manifest) => [manifest.repoId, repoRuntimeWeight(manifest)]),
  );

  return suggestions
    .map((suggestion) => {
      const runtimeWeight =
        suggestion.affectedRepos.reduce(
          (total, repoId) => total + (runtimeWeightByRepo.get(repoId) ?? 0),
          0,
        ) / Math.max(1, suggestion.affectedRepos.length);

      return {
        ...suggestion,
        runtimeWeight: Number(runtimeWeight.toFixed(3)),
        riskScore: Math.round(runtimeWeight * 100),
        queue: queueForSuggestion(suggestion),
      };
    })
    .sort((left, right) => {
      const rightRisk = right.riskScore ?? 0;
      const leftRisk = left.riskScore ?? 0;
      if (rightRisk !== leftRisk) {
        return rightRisk - leftRisk;
      }

      return right.title.localeCompare(left.title);
    });
}

export function graphRiskLevel(graph: EcosystemGraph): RiskLevel {
  const score =
    graph.contractMismatches.reduce((total, mismatch) => total + (mismatch.riskScore ?? 0), 0) +
    graph.impactPaths.reduce((total, impactPath) => total + (impactPath.riskScore ?? 0), 0);
  return toRiskLevel(
    score / Math.max(1, graph.contractMismatches.length + graph.impactPaths.length),
  );
}
