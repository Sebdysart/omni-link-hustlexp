// engine/index.ts — Top-level orchestrator: wires scanner -> grapher -> context -> evolution -> quality

import type {
  AuthorityStatusResult,
  DaemonStatus,
  EcosystemDigest,
  EcosystemGraph,
  ExecutionPlan,
  ImpactPath,
  OmniLinkConfig,
  OwnerAssignment,
  RepoManifest,
  ReviewArtifact,
  ReviewPublishResult,
  EvolutionSuggestion,
} from './types.js';
import pLimit from 'p-limit';

import { analyzeImpact } from './grapher/impact-analyzer.js';
import { buildEcosystemGraph } from './grapher/index.js';
import { CacheManager } from './context/cache-manager.js';
import { buildContext } from './context/index.js';
import {
  configSha,
  updateDaemonState,
  loadDaemonState,
  saveDaemonState,
  watchEcosystem,
  branchSignatureFromManifests,
  currentBranchSignature,
} from './daemon/index.js';
import { analyzeEvolution } from './evolution/index.js';
import {
  applyExecutionPlan,
  attachExecutionPlan,
  createExecutionPlan,
  rollbackExecutionPlan,
  type ExecutionResult,
} from './execution/index.js';
import { evaluatePolicies } from './policy/index.js';
import { detectSlop } from './quality/slop-detector.js';
import { validateConventions } from './quality/convention-validator.js';
import { scoreEcosystemHealth } from './quality/health-scorer.js';
import { checkReferences } from './quality/reference-checker.js';
import { checkRules } from './quality/rule-engine.js';
import {
  createReviewArtifact,
  gitChangedFilesBetween,
  gitResolveRefSha,
  loadReviewArtifact,
  mergeRiskReports,
  saveReviewArtifact,
  scoreRisk,
} from './review/index.js';
import { rankEvolutionSuggestions } from './runtime/index.js';
import { scanRepo } from './scanner/index.js';
import { defaultBaseRefForProvider, publishReviewArtifact } from './providers/index.js';
import { loadAuthorityState } from './authority/index.js';
import { analyzeSwiftTrpcBridge } from './bridges/swift-trpc.js';
import { enrichGraphForConfig } from './graph/enrichment.js';
import type { FileCache } from './scanner/index.js';
import type { HealthScoreResult } from './quality/health-scorer.js';
import type { ReferenceCheckResult } from './quality/reference-checker.js';
import type { ConventionCheckResult } from './quality/convention-validator.js';
import type { SlopCheckResult } from './quality/slop-detector.js';
import type { RuleCheckResult } from './quality/rule-engine.js';

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

export { SimulateOnlyError } from './quality/simulate-guard.js';

export type {
  OmniLinkConfig,
  RepoManifest,
  EcosystemGraph,
  EcosystemDigest,
  ImpactPath,
  EvolutionSuggestion,
  HealthScoreResult,
  ReferenceCheckResult,
  ConventionCheckResult,
  SlopCheckResult,
  RuleCheckResult,
  ReviewArtifact,
  ReviewPublishResult,
  OwnerAssignment,
  DaemonStatus,
  AuthorityStatusResult,
  ExecutionPlan,
};

export interface ScanResult {
  manifests: RepoManifest[];
  graph: EcosystemGraph;
  context: { digest: EcosystemDigest; markdown: string };
}

export interface HealthResult {
  perRepo: Record<string, HealthScoreResult>;
  overall: number;
}

export interface QualityCheckResult {
  references: ReferenceCheckResult;
  conventions: ConventionCheckResult;
  slop: SlopCheckResult;
  rules: RuleCheckResult;
}

export interface OwnersResult {
  owners: OwnerAssignment[];
  perRepo: Record<string, OwnerAssignment[]>;
}

const scanResultCache = new Map<string, ScanResult>();

function scanCacheKey(config: OmniLinkConfig): string {
  return configSha(config);
}

function cacheScanResult(config: OmniLinkConfig, result: ScanResult): void {
  scanResultCache.set(scanCacheKey(config), result);
}

function getCachedScanResult(config: OmniLinkConfig): ScanResult | undefined {
  return scanResultCache.get(scanCacheKey(config));
}

function invalidateCachedScanResult(config: OmniLinkConfig): void {
  scanResultCache.delete(scanCacheKey(config));
}

function authorityRecommendations(status: AuthorityStatusResult): string[] {
  if (!status.authority) {
    return ['configure the docs authority repo before relying on apply or review gating'];
  }

  const recommendations: string[] = [];
  if (status.authority.currentPhase.toLowerCase().includes('bootstrap')) {
    recommendations.push('reconcile CURRENT_PHASE.md upward to the implemented app/backend state');
  }
  if (status.procedureCoverage.backendOnly.length > 0) {
    recommendations.push(
      'update API_CONTRACT.md to declare backend procedures that are already live',
    );
  }
  if (status.procedureCoverage.docsOnly.length > 0) {
    recommendations.push(
      'either implement docs-declared procedures or remove stale docs contract entries',
    );
  }
  if (status.procedureCoverage.obsoleteCalls.length > 0) {
    recommendations.push('remove or retarget obsolete Swift tRPC calls');
  }
  if (status.procedureCoverage.payloadDrift.length > 0) {
    recommendations.push('reconcile Swift payload models against the docs contract fields');
  }
  if (recommendations.length === 0) {
    recommendations.push('authority reconciliation is clean on the current scan surface');
  }

  return recommendations;
}

const DEFAULT_SCAN_CONCURRENCY = 4;

async function scanConfiguredRepos(config: OmniLinkConfig): Promise<RepoManifest[]> {
  const fileCache: FileCache = new Map();
  const manifestCache: CacheManager | undefined = config.cache?.directory
    ? new CacheManager(config.cache.directory)
    : undefined;

  if (manifestCache && config.cache.maxAgeDays) {
    manifestCache.pruneOld(config.cache.maxAgeDays);
  }

  const limit = pLimit(DEFAULT_SCAN_CONCURRENCY);
  return Promise.all(
    config.repos.map((repo) => limit(() => scanRepo(repo, fileCache, manifestCache, { config }))),
  );
}

async function scanLive(config: OmniLinkConfig): Promise<ScanResult> {
  const manifests = await scanConfiguredRepos(config);
  const graph = enrichGraphForConfig(buildEcosystemGraph(manifests), config);
  const context = buildContext(graph, config);
  return { manifests, graph, context };
}

async function loadScanResult(
  config: OmniLinkConfig,
  options: { bypassSessionCache?: boolean } = {},
): Promise<ScanResult> {
  if (config.daemon?.enabled && config.daemon.preferDaemon) {
    const cached = options.bypassSessionCache ? undefined : getCachedScanResult(config);
    if (cached) {
      return cached;
    }

    const state = await loadDaemonState(config);
    if (state) {
      const graph = enrichGraphForConfig(state.graph, config);
      const context = buildContext(graph, config);
      const result = {
        manifests: state.manifests,
        graph,
        context,
      };
      cacheScanResult(config, result);
      return result;
    }
  }

  const result = await scanLive(config);
  if (config.daemon?.enabled) {
    await saveDaemonState(config, {
      updatedAt: new Date().toISOString(),
      configSha: result.context.digest.configSha,
      branchSignature: '',
      manifests: result.manifests,
      graph: result.graph,
      context: result.context,
      dirtyRepos: [],
    });
  }
  if (config.daemon?.enabled && config.daemon.preferDaemon) {
    cacheScanResult(config, result);
  }

  return result;
}

export async function scan(config: OmniLinkConfig): Promise<ScanResult> {
  return loadScanResult(config);
}

export async function impact(
  config: OmniLinkConfig,
  changedFiles: Array<{ repo: string; file: string; change: string }>,
): Promise<ImpactPath[]> {
  const result = await loadScanResult(config);
  return analyzeImpact(result.graph, changedFiles);
}

export async function impactFromUncommitted(config: OmniLinkConfig): Promise<ImpactPath[]> {
  const result = await loadScanResult(config, { bypassSessionCache: true });
  const changedFiles = result.manifests.flatMap((manifest) =>
    manifest.gitState.uncommittedChanges.map((file) => ({
      repo: manifest.repoId,
      file,
      change: 'uncommitted' as const,
    })),
  );
  return analyzeImpact(result.graph, changedFiles);
}

export async function impactFromRefs(
  config: OmniLinkConfig,
  baseRef: string,
  headRef: string,
): Promise<ImpactPath[]> {
  const result = await loadScanResult(config);
  const changedFiles = gitChangedFilesBetween(config, baseRef, headRef);
  return analyzeImpact(result.graph, changedFiles);
}

export async function health(config: OmniLinkConfig): Promise<HealthResult> {
  const result = await loadScanResult(config);
  return scoreEcosystemHealth(result.graph, config);
}

export async function evolve(config: OmniLinkConfig): Promise<EvolutionSuggestion[]> {
  const result = await loadScanResult(config);
  return rankEvolutionSuggestions(analyzeEvolution(result.graph, config), result.graph);
}

export async function watch(
  config: OmniLinkConfig,
  options: { once?: boolean } = {},
): Promise<DaemonStatus> {
  invalidateCachedScanResult(config);
  return watchEcosystem(config, options);
}

export async function owners(config: OmniLinkConfig): Promise<OwnersResult> {
  const result = await loadScanResult(config);
  return {
    owners: result.graph.owners ?? [],
    perRepo: Object.fromEntries(
      result.graph.repos.map((manifest) => [manifest.repoId, manifest.owners ?? []]),
    ),
  };
}

export async function authorityStatus(config: OmniLinkConfig): Promise<AuthorityStatusResult> {
  const result = await loadScanResult(config);
  const authority = result.graph.authority ?? loadAuthorityState(config);
  const bridgeAnalysis = analyzeSwiftTrpcBridge(config, result.graph, authority);
  const docsProcedures = new Set(authority?.authoritativeApiSurface.procedures ?? []);
  const backendProcedures = new Set(
    bridgeAnalysis.backendProcedures.map(
      (procedure) => `${procedure.router}.${procedure.procedure}`,
    ),
  );
  const iosProcedures = new Set(
    bridgeAnalysis.iosCalls.map((call) => `${call.router}.${call.procedure}`),
  );
  const docsOnly = [...docsProcedures].filter((procedure) => !backendProcedures.has(procedure));
  const backendOnly = [...backendProcedures].filter((procedure) => !docsProcedures.has(procedure));
  const obsoleteCalls = [...iosProcedures].filter((procedure) => !backendProcedures.has(procedure));
  const payloadDrift = uniqueBy(
    bridgeAnalysis.mismatches.filter((mismatch) =>
      ['missing-field', 'extra-field', 'type-mismatch'].includes(mismatch.kind),
    ),
    (mismatch) => `${mismatch.consumer.file}:${mismatch.consumer.field ?? mismatch.description}`,
  ).map((mismatch) => mismatch.description);
  const findings = uniqueBy(
    [
      ...(result.graph.findings ?? []).filter((finding) => finding.kind === 'authority_drift'),
      ...bridgeAnalysis.findings,
    ],
    (finding) => `${finding.kind}:${finding.repo}:${finding.file}:${finding.line}:${finding.title}`,
  );

  const status: AuthorityStatusResult = {
    authority,
    findings,
    blockedApply: findings.some((finding) => finding.kind === 'authority_drift'),
    procedureCoverage: {
      docs: docsProcedures.size,
      backend: backendProcedures.size,
      iosCalls: iosProcedures.size,
      bridges: bridgeAnalysis.bridges.length,
      docsOnly,
      backendOnly,
      obsoleteCalls,
      payloadDrift,
    },
    recommendations: [],
  };
  status.recommendations = authorityRecommendations(status);
  return status;
}

export async function reviewPr(
  config: OmniLinkConfig,
  baseRef: string = defaultBaseRefForProvider(config),
  headRef = 'HEAD',
): Promise<ReviewArtifact> {
  const result = await loadScanResult(config);
  const snapshotKey = {
    configSha: result.context.digest.configSha,
    branchSignature: branchSignatureFromManifests(result.manifests),
    baseRef,
    headRef,
  };
  const cachedArtifact = loadReviewArtifact(config, snapshotKey);
  if (cachedArtifact) {
    return cachedArtifact;
  }

  const changedFiles = gitChangedFilesBetween(config, baseRef, headRef);
  const impactPaths = analyzeImpact(result.graph, changedFiles);
  const reviewGraph: EcosystemGraph = {
    ...result.graph,
    impactPaths,
  };
  const owners = reviewGraph.owners ?? [];
  const risk = scoreRisk(reviewGraph);
  const executionPlan = createExecutionPlan(config, reviewGraph, risk, owners);
  const policyDecisions = evaluatePolicies(config, executionPlan.baseBranch, risk, owners, {
    authorityDrift:
      config.authority?.phaseMode === 'strict' &&
      (reviewGraph.findings ?? []).some((finding) => finding.kind === 'authority_drift'),
  });
  const artifact = attachExecutionPlan(
    createReviewArtifact(
      reviewGraph,
      baseRef,
      headRef,
      owners,
      mergeRiskReports(risk, executionPlan.blocked),
    ),
    {
      ...executionPlan,
      policyDecisions,
      risk: mergeRiskReports(risk, executionPlan.blocked),
    },
  );
  saveReviewArtifact(config, artifact, snapshotKey);
  return artifact;
}

export async function apply(
  config: OmniLinkConfig,
  baseRef: string = defaultBaseRefForProvider(config),
  headRef = 'HEAD',
): Promise<ExecutionResult> {
  const existingArtifact = loadReviewArtifact(config);
  const artifact =
    existingArtifact?.executionPlan !== undefined &&
    existingArtifact.baseRef === baseRef &&
    existingArtifact.headRef === headRef
      ? existingArtifact
      : await reviewPr(config, baseRef, headRef);

  if (!artifact.executionPlan) {
    throw new Error('No execution plan available. Run review-pr first.');
  }

  return applyExecutionPlan(config, artifact.executionPlan);
}

export async function publishReview(
  config: OmniLinkConfig,
  pullRequestNumber: number,
  baseRef: string = defaultBaseRefForProvider(config),
  headRef = 'HEAD',
  headSha?: string,
): Promise<ReviewPublishResult> {
  const artifact = await reviewPr(config, baseRef, headRef);
  const resolvedHeadSha = headSha ?? gitResolveRefSha(config, headRef) ?? undefined;

  return publishReviewArtifact(
    config,
    artifact,
    {
      pullRequestNumber,
      headSha: resolvedHeadSha,
    },
    {
      snapshotKey: {
        configSha: configSha(config),
        branchSignature: currentBranchSignature(config),
        baseRef,
        headRef,
      },
    },
  );
}

export async function rollback(config: OmniLinkConfig): Promise<ExecutionResult> {
  const artifact = loadReviewArtifact(config);
  if (!artifact?.executionPlan) {
    throw new Error('No execution plan artifact found to roll back.');
  }

  return rollbackExecutionPlan(config, artifact.executionPlan);
}

export async function qualityCheck(
  code: string,
  file: string,
  config: OmniLinkConfig,
): Promise<QualityCheckResult> {
  const manifests = await scanConfiguredRepos(config);
  const manifest = manifests.find((entry) => file.startsWith(entry.path)) ?? manifests[0];

  if (!manifest) {
    return {
      references: { valid: true, violations: [] },
      conventions: { valid: true, violations: [] },
      slop: { clean: true, issues: [] },
      rules: { passed: true, violations: [] },
    };
  }

  const normalizedFile = file.startsWith(manifest.path)
    ? file.slice(manifest.path.length).replace(/^[/\\]+/, '')
    : file.replace(/\\/g, '/');

  return {
    references: checkReferences(code, normalizedFile, manifest, manifests),
    conventions: validateConventions(code, normalizedFile, manifest),
    slop: detectSlop(code, manifest),
    rules: checkRules(code, normalizedFile),
  };
}

export async function refreshDaemonState(config: OmniLinkConfig): Promise<ScanResult> {
  const state = await updateDaemonState(config);
  return {
    manifests: state.manifests,
    graph: state.graph,
    context: state.context,
  };
}
