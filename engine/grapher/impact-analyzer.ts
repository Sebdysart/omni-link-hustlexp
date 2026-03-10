// engine/grapher/impact-analyzer.ts — Trace change ripples across repos

import { UNKNOWN_LINE, type EcosystemGraph, type ImpactPath, type ApiBridge } from '../types.js';

/**
 * Analyze the impact of a set of changed files across the ecosystem.
 *
 * For each changed file:
 * 1. Find all internal dependents (files that import the changed file) — transitively
 * 2. Find all cross-repo consumers via API bridges where the changed file
 *    contains a provider route
 * 3. Assess severity based on change type
 */
export function analyzeImpact(
  graph: EcosystemGraph,
  changedFiles: Array<{ repo: string; file: string; change: string }>,
): ImpactPath[] {
  if (changedFiles.length === 0) return [];

  const paths: ImpactPath[] = [];

  for (const changed of changedFiles) {
    const affected: ImpactPath['affected'] = [];

    // 1. Find internal dependents (transitive)
    const internalAffected = findInternalDependents(graph, changed.repo, changed.file);
    for (const dep of internalAffected) {
      affected.push({
        repo: changed.repo,
        file: dep.file,
        line: UNKNOWN_LINE, // line info not available from dep graph alone
        reason: `imports from ${changed.file} via [${dep.imports.join(', ')}]`,
        severity: assessSeverity(changed.change),
      });
    }

    // 2. Find cross-repo consumers via API bridges
    const crossRepoAffected = findCrossRepoBridgeConsumers(graph, changed.repo, changed.file);
    for (const bridge of crossRepoAffected) {
      affected.push({
        repo: bridge.consumer.repo,
        file: bridge.consumer.file,
        line: bridge.consumer.line,
        reason: `consumes ${bridge.provider.route} from ${bridge.provider.repo}`,
        severity: assessCrossRepoSeverity(changed.change),
      });
    }

    paths.push({
      trigger: {
        repo: changed.repo,
        file: changed.file,
        change: changed.change,
      },
      affected,
    });
  }

  return paths;
}

// ─── Internal Dependency Tracing ────────────────────────────────────────────

interface InternalDependent {
  file: string;
  imports: string[];
}

/**
 * Find all files in the same repo that depend on the given file, transitively.
 *
 * Uses BFS to traverse the dependency graph in reverse (from target to dependents).
 */
function findInternalDependents(
  graph: EcosystemGraph,
  repoId: string,
  changedFile: string,
): InternalDependent[] {
  const repo = graph.repos.find((r) => r.repoId === repoId);
  if (!repo) return [];

  const internalDeps = repo.dependencies.internal;

  // Build reverse adjacency: file -> files that import it
  const reverseAdj = new Map<string, Array<{ from: string; imports: string[] }>>();
  for (const dep of internalDeps) {
    const existing = reverseAdj.get(dep.to) ?? [];
    existing.push({ from: dep.from, imports: dep.imports });
    reverseAdj.set(dep.to, existing);
  }

  // BFS from changedFile through reverse edges
  const visited = new Set<string>();
  const queue: string[] = [changedFile];
  visited.add(changedFile);

  const results: InternalDependent[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverseAdj.get(current) ?? [];

    for (const dep of dependents) {
      if (visited.has(dep.from)) continue;
      visited.add(dep.from);

      results.push({
        file: dep.from,
        imports: dep.imports,
      });

      // Continue tracing transitively
      queue.push(dep.from);
    }
  }

  return results;
}

// ─── Cross-Repo Bridge Consumers ────────────────────────────────────────────

/**
 * Find all API bridges where the changed file is the provider.
 *
 * A bridge matches if:
 * - The provider repo matches the changed file's repo
 * - The provider route's handler file matches the changed file path, OR
 * - The changed file is a route file referenced by the bridge
 */
function findCrossRepoBridgeConsumers(
  graph: EcosystemGraph,
  repoId: string,
  changedFile: string,
): ApiBridge[] {
  const matches: ApiBridge[] = [];

  for (const bridge of graph.bridges) {
    if (bridge.provider.repo !== repoId) continue;

    // Check if the changed file is referenced by this bridge's provider route
    // The route string format is "METHOD /path", and we check if the changed file
    // is the source file for that route
    const providerRepo = graph.repos.find((r) => r.repoId === repoId);
    if (!providerRepo) continue;

    // Find the route definition in the provider repo
    const routeMatch = providerRepo.apiSurface.routes.find((r) => {
      const routeLabel = `${r.method} ${r.path}`;
      return routeLabel === bridge.provider.route && r.file === changedFile;
    });

    // Also match procedure-based bridges
    const procMatch = providerRepo.apiSurface.procedures.find((p) => {
      const procLabel = `${p.kind} ${p.name}`;
      return procLabel === bridge.provider.route && p.file === changedFile;
    });

    if (routeMatch || procMatch) {
      matches.push(bridge);
    }
  }

  return matches;
}

// ─── Severity Assessment ────────────────────────────────────────────────────

/**
 * Assess the severity of an internal impact based on change type.
 */
function assessSeverity(change: string): 'breaking' | 'warning' | 'info' {
  if (change.includes('type-change') || change.includes('type change')) return 'breaking';
  if (change.includes('route-change') || change.includes('route change')) return 'breaking';
  if (change.includes('implementation-change') || change.includes('implementation change'))
    return 'warning';
  if (change.includes('rename')) return 'breaking';
  if (change.includes('delete') || change.includes('remove')) return 'breaking';
  return 'info';
}

/**
 * Assess the severity of a cross-repo impact.
 * Cross-repo changes are generally more severe since they cross boundaries.
 */
function assessCrossRepoSeverity(change: string): 'breaking' | 'warning' | 'info' {
  if (change.includes('type-change') || change.includes('type change')) return 'breaking';
  if (change.includes('route-change') || change.includes('route change')) return 'breaking';
  if (change.includes('implementation-change') || change.includes('implementation change'))
    return 'warning';
  if (change.includes('rename')) return 'breaking';
  if (change.includes('delete') || change.includes('remove')) return 'breaking';
  return 'warning';
}
