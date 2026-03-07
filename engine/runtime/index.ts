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

function readJsonIfPresent(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
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
  const coveragePath = config.runtime?.coverageSummaryPath;
  if (!config.runtime?.enabled || !coveragePath) return null;

  const resolvedPath = path.isAbsolute(coveragePath)
    ? coveragePath
    : path.join(manifest.path, coveragePath);
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
  const resultsPath = config.runtime?.testResultsPath;
  if (!config.runtime?.enabled || !resultsPath) return null;

  const resolvedPath = path.isAbsolute(resultsPath)
    ? resultsPath
    : path.join(manifest.path, resultsPath);
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

function artifactPresenceSignal(
  manifest: RepoManifest,
  config: OmniLinkConfig,
  key: 'openApiPath' | 'graphQlSchemaPath' | 'telemetrySummaryPath' | 'traceSummaryPath',
  kind: RuntimeSignal['kind'],
  weight: number,
): RuntimeSignal | null {
  const configuredPath = config.runtime?.[key];
  if (!config.runtime?.enabled || !configuredPath) return null;

  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(manifest.path, configuredPath);
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
    artifactPresenceSignal(manifest, config, 'openApiPath', 'openapi', 0.65),
    artifactPresenceSignal(manifest, config, 'graphQlSchemaPath', 'graphql', 0.65),
    artifactPresenceSignal(manifest, config, 'telemetrySummaryPath', 'telemetry', 0.75),
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
