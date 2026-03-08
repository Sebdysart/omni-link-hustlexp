import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';

import type {
  EcosystemGraph,
  OmniLinkConfig,
  OwnerAssignment,
  ReviewArtifact,
  RiskLevel,
  RiskReport,
} from '../types.js';
import { resolveReviewProvider } from '../providers/index.js';

export interface ReviewSnapshotKey {
  configSha: string;
  branchSignature: string;
  baseRef: string;
  headRef: string;
}

function riskOrder(level: RiskLevel): number {
  switch (level) {
    case 'low':
      return 0;
    case 'medium':
      return 1;
    case 'high':
      return 2;
    case 'critical':
      return 3;
  }
}

function toRiskLevel(score: number): RiskLevel {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

export function scoreRisk(graph: EcosystemGraph): RiskReport {
  const reasons: string[] = [];
  const severityScore =
    graph.contractMismatches.reduce((total, mismatch) => total + (mismatch.riskScore ?? 0), 0) +
    graph.impactPaths.reduce((total, impactPath) => total + (impactPath.riskScore ?? 0), 0) +
    graph.bridges.reduce((total, bridge) => total + (bridge.riskScore ?? 0), 0);
  const itemCount =
    graph.contractMismatches.length + graph.impactPaths.length + graph.bridges.length || 1;
  const average = Math.round(severityScore / itemCount);

  if (graph.contractMismatches.some((mismatch) => mismatch.severity === 'breaking')) {
    reasons.push('breaking contract mismatches detected');
  }
  if (graph.impactPaths.some((impactPath) => impactPath.affected.length > 3)) {
    reasons.push('broad cross-repo impact detected');
  }
  if (graph.repos.some((repo) => (repo.runtimeSignals ?? []).length > 0)) {
    reasons.push('runtime-weighted signals increased priority');
  }

  return {
    overallRisk: toRiskLevel(average),
    score: average,
    reasons,
    affectedRepos: [
      ...new Set(
        graph.impactPaths.flatMap((impactPath) => [
          impactPath.trigger.repo,
          ...impactPath.affected.map((affected) => affected.repo),
        ]),
      ),
    ],
    blockedByPolicy: false,
  };
}

export function createReviewArtifact(
  graph: EcosystemGraph,
  baseRef: string,
  headRef: string,
  owners: OwnerAssignment[],
  risk: RiskReport,
): ReviewArtifact {
  return {
    generatedAt: new Date().toISOString(),
    baseRef,
    headRef,
    affectedRepos: [
      ...new Set(
        graph.impactPaths.flatMap((impactPath) => [
          impactPath.trigger.repo,
          ...impactPath.affected.map((affected) => affected.repo),
        ]),
      ),
    ],
    impact: graph.impactPaths,
    contractMismatches: graph.contractMismatches,
    owners,
    risk,
    policyDecisions: [],
  };
}

function snapshotCachePathFor(config: OmniLinkConfig, key: ReviewSnapshotKey): string {
  const provider = resolveReviewProvider(config);
  const latestArtifactPath = provider.resolveArtifactPath(config);
  const snapshotHash = crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        configSha: key.configSha,
        branchSignature: key.branchSignature,
        baseRef: key.baseRef,
        headRef: key.headRef,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  const fileName = `${provider.id}-${snapshotHash}.json`;
  return path.join(path.dirname(latestArtifactPath), 'review-snapshots', fileName);
}

export function saveReviewArtifact(
  config: OmniLinkConfig,
  artifact: ReviewArtifact,
  snapshotKey?: ReviewSnapshotKey,
): string {
  const provider = resolveReviewProvider(config);
  const artifactPath = provider.resolveArtifactPath(config);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const serialized = provider.serializeArtifact(artifact);
  fs.writeFileSync(artifactPath, serialized, 'utf-8');
  if (snapshotKey) {
    const snapshotPath = snapshotCachePathFor(config, snapshotKey);
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, serialized, 'utf-8');
  }
  return artifactPath;
}

export function loadReviewArtifact(
  config: OmniLinkConfig,
  snapshotKey?: ReviewSnapshotKey,
): ReviewArtifact | null {
  const provider = resolveReviewProvider(config);
  const artifactPath = snapshotKey
    ? snapshotCachePathFor(config, snapshotKey)
    : provider.resolveArtifactPath(config);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    return provider.deserializeArtifact(fs.readFileSync(artifactPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function gitChangedFilesBetween(
  config: OmniLinkConfig,
  baseRef: string,
  headRef: string,
): Array<{ repo: string; file: string; change: string }> {
  const changedFiles: Array<{ repo: string; file: string; change: string }> = [];

  for (const repo of config.repos) {
    try {
      const diffOutput = execFileSync(
        'git',
        ['-C', repo.path, 'diff', '--name-only', `${baseRef}...${headRef}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();

      if (!diffOutput) continue;
      for (const file of diffOutput
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean)) {
        const lower = file.toLowerCase();
        const change =
          lower.includes('type') || lower.includes('schema') || lower.includes('model')
            ? 'type-change'
            : lower.includes('route') || lower.includes('api')
              ? 'route-change'
              : 'implementation-change';
        changedFiles.push({ repo: repo.name, file, change });
      }
    } catch {
      continue;
    }
  }

  return changedFiles;
}

export function gitResolveRefSha(config: OmniLinkConfig, ref: string): string | null {
  const prioritizedRepos = [...config.repos].sort((left, right) => {
    const leftPriority = left.name === config.github?.repo ? 0 : 1;
    const rightPriority = right.name === config.github?.repo ? 0 : 1;
    return leftPriority - rightPriority;
  });

  for (const repo of prioritizedRepos) {
    try {
      return execFileSync('git', ['-C', repo.path, 'rev-parse', ref], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      continue;
    }
  }

  return null;
}

export function mergeRiskReports(base: RiskReport, decisionsBlocked: boolean): RiskReport {
  return {
    ...base,
    blockedByPolicy: decisionsBlocked,
    overallRisk:
      decisionsBlocked && riskOrder(base.overallRisk) < riskOrder('high')
        ? 'high'
        : base.overallRisk,
  };
}
