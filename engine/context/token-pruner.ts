// engine/context/token-pruner.ts — Priority-ranked context trimming to fit token budget

import type {
  EcosystemGraph,
  RepoManifest,
  Mismatch,
  ApiBridge,
  TypeLineage,
  ImpactPath,
} from '../types.js';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface PrunedContext {
  graph: EcosystemGraph;
  droppedItems: string[];
  tokenEstimate: number;
}

// ─── Priority Sections ───────────────────────────────────────────────────────

// ─── Token Estimation ────────────────────────────────────────────────────────

/**
 * Estimate token count for a string using the ~4 chars/token heuristic.
 */
export function estimateTokens(content: string): number {
  if (content.length === 0) return 0;
  return Math.ceil(content.length / 4);
}

// ─── Pruner ──────────────────────────────────────────────────────────────────

/**
 * Prune an EcosystemGraph to fit within a token budget.
 *
 * Strategy:
 * 1. Serialize each section of the graph
 * 2. Assign priority weights
 * 3. If total exceeds budget, drop lowest-priority sections first
 * 4. Within sections, trim items from the end (oldest/least relevant)
 * 5. Reconstruct a pruned EcosystemGraph
 */
export function pruneToTokenBudget(
  graph: EcosystemGraph,
  budget: number,
  prioritize: 'changed-files-first' | 'api-surface-first',
  focus?: 'commits' | 'types' | 'api-surface' | 'mismatches' | 'auto',
): PrunedContext {
  const droppedItems: string[] = [];

  // Deep clone the graph so we can mutate freely
  const pruned: EcosystemGraph = {
    repos: graph.repos.map((r) => deepCloneManifest(r)),
    bridges: [...graph.bridges],
    sharedTypes: [...graph.sharedTypes],
    contractMismatches: [...graph.contractMismatches],
    impactPaths: [...graph.impactPaths],
    authority: graph.authority,
    findings: [...(graph.findings ?? [])],
  };

  // If graph is empty, return immediately
  if (pruned.repos.length === 0 && pruned.bridges.length === 0) {
    return { graph: pruned, droppedItems: [], tokenEstimate: 0 };
  }

  // Calculate total tokens
  let totalTokens = computeTotalTokens(pruned);

  if (totalTokens <= budget) {
    return { graph: pruned, droppedItems: [], tokenEstimate: totalTokens };
  }

  // ─── Trim Phase: Remove lowest-priority items first ──────────────────
  //
  // focus parameter shifts the phase order to preserve what the caller cares about:
  //   'commits'     — move commit-trimming to last (preserve commits)
  //   'api-surface' — move route-trimming to last (preserve routes)
  //   'types', 'mismatches', 'auto', undefined — default order

  // ── Commit trim helper ──────────────────────────────────────────────
  const trimCommits = (): void => {
    for (const repo of pruned.repos) {
      const commits = repo.gitState.recentCommits;
      while (commits.length > 0 && totalTokens > budget) {
        const removed = commits.pop()!;
        const savedTokens = estimateTokens(serializeCommit(removed));
        totalTokens -= savedTokens;
        droppedItems.push(`commit:${repo.repoId}:${removed.sha}`);
      }
    }
  };

  // ── Route trim helper ───────────────────────────────────────────────
  const trimRoutes = (): void => {
    for (const repo of pruned.repos) {
      while (repo.apiSurface.routes.length > 0 && totalTokens > budget) {
        const removed = repo.apiSurface.routes.pop()!;
        const savedTokens = estimateTokens(JSON.stringify(removed));
        totalTokens -= savedTokens;
        droppedItems.push(`route:${repo.repoId}:${removed.path}`);
      }
    }
  };

  // Phase 1: Trim recent commits (priority 10) — skipped when focus='commits'
  if (totalTokens > budget && focus !== 'commits') {
    trimCommits();
  }

  // Phase 2: Trim conventions (priority 20)
  if (totalTokens > budget) {
    for (const repo of pruned.repos) {
      const convTokens = estimateTokens(serializeConventions(repo));
      if (convTokens > 0) {
        // Clear conventions to minimal
        repo.conventions.patterns = [];
        repo.conventions.testingPatterns = '';
        repo.conventions.errorHandling = '';
        repo.conventions.fileOrganization = '';
        const savedTokens = convTokens - estimateTokens(serializeConventions(repo));
        totalTokens -= savedTokens;
        droppedItems.push(`conventions:${repo.repoId}`);
      }
    }
  }

  // Phase 3: Trim shared types (priority 40) — but not if api-surface-first
  if (totalTokens > budget && prioritize === 'changed-files-first') {
    while (pruned.sharedTypes.length > 0 && totalTokens > budget) {
      const removed = pruned.sharedTypes.pop()!;
      const savedTokens = estimateTokens(serializeTypeLineage(removed));
      totalTokens -= savedTokens;
      droppedItems.push(`shared-type:${removed.concept}`);
    }
  }

  // Phase 4: Trim type registry per repo (priority 40)
  if (totalTokens > budget) {
    for (const repo of pruned.repos) {
      while (repo.typeRegistry.types.length > 0 && totalTokens > budget) {
        const removed = repo.typeRegistry.types.pop()!;
        const savedTokens = estimateTokens(serializeTypeDef(removed));
        totalTokens -= savedTokens;
        droppedItems.push(`type:${repo.repoId}:${removed.name}`);
      }
    }
  }

  // Phase 5: Trim bridges/API surface (priority 60)
  if (totalTokens > budget) {
    while (pruned.bridges.length > 0 && totalTokens > budget) {
      const removed = pruned.bridges.pop()!;
      const savedTokens = estimateTokens(serializeBridge(removed));
      totalTokens -= savedTokens;
      droppedItems.push(`bridge:${removed.provider.route}`);
    }
  }

  // Phase 5b: Trim shared types if api-surface-first and still over budget
  if (totalTokens > budget && prioritize === 'api-surface-first') {
    while (pruned.sharedTypes.length > 0 && totalTokens > budget) {
      const removed = pruned.sharedTypes.pop()!;
      const savedTokens = estimateTokens(serializeTypeLineage(removed));
      totalTokens -= savedTokens;
      droppedItems.push(`shared-type:${removed.concept}`);
    }
  }

  // Phase 6: Trim impact paths (priority 80)
  if (totalTokens > budget) {
    while (pruned.impactPaths.length > 0 && totalTokens > budget) {
      const removed = pruned.impactPaths.pop()!;
      const savedTokens = estimateTokens(serializeImpactPath(removed));
      totalTokens -= savedTokens;
      droppedItems.push(`impact:${removed.trigger.file}`);
    }
  }

  // Phase 7: Trim routes from repos (priority 60) — skipped when focus='api-surface'
  if (totalTokens > budget && focus !== 'api-surface') {
    trimRoutes();
  }

  // NOTE: focus values 'types', 'mismatches', and 'auto' are reserved for future phase-order
  // customization. They currently produce the same behavior as the default (no focus).

  // Phase 8a (deferred — focus: commits): trim commits last
  if (totalTokens > budget && focus === 'commits') {
    trimCommits();
  }

  // Phase 8b (deferred — focus: api-surface): trim routes last
  if (totalTokens > budget && focus === 'api-surface') {
    trimRoutes();
  }

  // Contract mismatches (priority 100) — never trimmed
  // Authority/finding metadata is preserved for policy visibility.

  // Recalculate final token count accurately
  totalTokens = computeTotalTokens(pruned);

  return {
    graph: pruned,
    droppedItems,
    tokenEstimate: totalTokens,
  };
}

// ─── Serialization Helpers ───────────────────────────────────────────────────

function serializeCommit(commit: {
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: string[];
}): string {
  return `${commit.sha} ${commit.message} ${commit.author} ${commit.date} ${commit.filesChanged.join(',')}`;
}

function serializeConventions(repo: RepoManifest): string {
  return `${repo.conventions.naming} ${repo.conventions.fileOrganization} ${repo.conventions.errorHandling} ${repo.conventions.patterns.join(',')} ${repo.conventions.testingPatterns}`;
}

function serializeTypeLineage(lineage: TypeLineage): string {
  return `${lineage.concept} ${lineage.alignment} ${lineage.instances.map((i) => `${i.repo}:${i.type.name}:${i.type.fields.length}fields`).join(' ')}`;
}

function serializeTypeDef(type: {
  name: string;
  fields: Array<{ name: string; type: string }>;
}): string {
  return `${type.name} ${type.fields.map((f) => `${f.name}:${f.type}`).join(' ')}`;
}

function serializeBridge(bridge: ApiBridge): string {
  return `${bridge.provider.route} ${bridge.provider.handler} ${bridge.consumer.repo}:${bridge.consumer.file} ${bridge.contract.matchStatus} ${serializeTypeDef(bridge.contract.inputType)} ${serializeTypeDef(bridge.contract.outputType)}`;
}

function serializeImpactPath(impact: ImpactPath): string {
  return `${impact.trigger.repo}:${impact.trigger.file}:${impact.trigger.change} -> ${impact.affected.map((a) => `${a.repo}:${a.file}:${a.reason}`).join(', ')}`;
}

function serializeMismatch(mismatch: Mismatch): string {
  return `${mismatch.kind} ${mismatch.severity} ${mismatch.description}`;
}

// ─── Token Computation ───────────────────────────────────────────────────────

function computeTotalTokens(graph: EcosystemGraph): number {
  let total = 0;

  if (graph.authority) {
    total += estimateTokens(
      [
        graph.authority.currentPhase,
        graph.authority.blockedWorkClasses.join(','),
        graph.authority.frozenFeatures.join(','),
        graph.authority.authoritativeApiSurface.procedures.join(','),
        graph.authority.authoritativeSchemaSurface.tables.join(','),
      ].join(' '),
    );
  }

  for (const finding of graph.findings ?? []) {
    total += estimateTokens(
      `${finding.kind} ${finding.severity} ${finding.title} ${finding.description}`,
    );
  }

  // Mismatches
  for (const m of graph.contractMismatches) {
    total += estimateTokens(serializeMismatch(m));
  }

  // Impact paths
  for (const ip of graph.impactPaths) {
    total += estimateTokens(serializeImpactPath(ip));
  }

  // Bridges
  for (const b of graph.bridges) {
    total += estimateTokens(serializeBridge(b));
  }

  // Shared types
  for (const st of graph.sharedTypes) {
    total += estimateTokens(serializeTypeLineage(st));
  }

  // Per-repo content
  for (const repo of graph.repos) {
    // Commits
    for (const c of repo.gitState.recentCommits) {
      total += estimateTokens(serializeCommit(c));
    }

    // Conventions
    total += estimateTokens(serializeConventions(repo));

    // Types
    for (const t of repo.typeRegistry.types) {
      total += estimateTokens(serializeTypeDef(t));
    }

    // Routes
    for (const r of repo.apiSurface.routes) {
      total += estimateTokens(JSON.stringify(r));
    }
  }

  return total;
}

// ─── Deep Clone ──────────────────────────────────────────────────────────────

function deepCloneManifest(manifest: RepoManifest): RepoManifest {
  return {
    ...manifest,
    gitState: {
      ...manifest.gitState,
      uncommittedChanges: [...manifest.gitState.uncommittedChanges],
      recentCommits: [...manifest.gitState.recentCommits],
    },
    apiSurface: {
      routes: [...manifest.apiSurface.routes],
      procedures: [...manifest.apiSurface.procedures],
      exports: [...manifest.apiSurface.exports],
    },
    typeRegistry: {
      types: [...manifest.typeRegistry.types],
      schemas: [...manifest.typeRegistry.schemas],
      models: [...manifest.typeRegistry.models],
    },
    conventions: {
      ...manifest.conventions,
      patterns: [...manifest.conventions.patterns],
    },
    dependencies: {
      internal: [...manifest.dependencies.internal],
      external: [...manifest.dependencies.external],
    },
    health: { ...manifest.health, deadCode: [...manifest.health.deadCode] },
  };
}
