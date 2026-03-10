// engine/evolution/index.ts — Evolution orchestrator: wires gap + bottleneck + benchmark → ranked suggestions

import {
  UNKNOWN_FILE,
  UNKNOWN_LINE,
  type EcosystemGraph,
  type OmniLinkConfig,
  type EvolutionSuggestion,
  type RepoManifest,
} from '../types.js';
import { analyzeGaps } from './gap-analyzer.js';
import { findBottlenecks } from './bottleneck-finder.js';
import { benchmarkAgainstBestPractices } from './competitive-benchmarker.js';
import type { BenchmarkResult } from './competitive-benchmarker.js';
import { proposeUpgrades } from './upgrade-proposer.js';
import type { GapFinding } from './gap-analyzer.js';
import type { BottleneckFinding } from './bottleneck-finder.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAGINATION_INDICATORS = [
  'paginate',
  'paginated',
  'pagination',
  'page',
  'paged',
  'cursor',
  'offset',
  'limit',
];

/**
 * Given a manifest and benchmark category/practice, find the specific
 * procedures or routes that are affected (missing the benchmarked feature).
 */
function findAffectedLocations(
  manifest: RepoManifest,
  category: string,
  practice: string,
): Array<{ name: string; file: string; line: number }> {
  const locations: Array<{ name: string; file: string; line: number }> = [];

  if (category === 'security' && practice.toLowerCase().includes('validation')) {
    // Find mutation procedures (candidates missing input validation)
    for (const proc of manifest.apiSurface.procedures) {
      if (proc.kind === 'mutation' && proc.file && proc.file !== UNKNOWN_FILE && proc.line) {
        locations.push({ name: proc.name, file: proc.file, line: proc.line });
      }
    }
  } else if (category === 'security' && practice.toLowerCase().includes('rate')) {
    // Find mutation procedures/routes (candidates needing rate limiting)
    for (const proc of manifest.apiSurface.procedures) {
      if (proc.kind === 'mutation' && proc.file && proc.file !== UNKNOWN_FILE && proc.line) {
        locations.push({ name: proc.name, file: proc.file, line: proc.line });
      }
    }
    for (const route of manifest.apiSurface.routes) {
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method.toUpperCase()) &&
        route.file &&
        route.file !== UNKNOWN_FILE &&
        route.line
      ) {
        locations.push({
          name: `${route.method} ${route.path}`,
          file: route.file,
          line: route.line,
        });
      }
    }
  } else if (category === 'performance' && practice.toLowerCase().includes('pagination')) {
    // Find list procedures missing pagination
    for (const proc of manifest.apiSurface.procedures) {
      if (proc.kind !== 'query') continue;
      const lower = proc.name.toLowerCase();
      const isList =
        lower.startsWith('list') ||
        lower.startsWith('getall') ||
        lower.startsWith('findall') ||
        lower.startsWith('search') ||
        lower.includes('list');
      if (!isList) continue;

      const hasPagination =
        PAGINATION_INDICATORS.some((kw) => lower.includes(kw)) ||
        (proc.inputType
          ? PAGINATION_INDICATORS.some((kw) => proc.inputType!.toLowerCase().includes(kw))
          : false) ||
        (proc.outputType
          ? PAGINATION_INDICATORS.some((kw) => proc.outputType!.toLowerCase().includes(kw))
          : false);

      if (!hasPagination && proc.file && proc.file !== UNKNOWN_FILE && proc.line) {
        locations.push({ name: proc.name, file: proc.file, line: proc.line });
      }
    }
  } else if (
    (category === 'performance' || category === 'maintainability') &&
    practice.toLowerCase().includes('version')
  ) {
    // API versioning — affects all route files
    const seenFiles = new Set<string>();
    for (const route of manifest.apiSurface.routes) {
      if (route.file && route.file !== UNKNOWN_FILE && !seenFiles.has(route.file)) {
        seenFiles.add(route.file);
        locations.push({ name: route.path, file: route.file, line: route.line });
      }
    }
  } else if (category === 'reliability' && practice.toLowerCase().includes('error')) {
    // Error handling middleware — affects all route/procedure files
    const seenFiles = new Set<string>();
    for (const route of manifest.apiSurface.routes) {
      if (route.file && route.file !== UNKNOWN_FILE && !seenFiles.has(route.file)) {
        seenFiles.add(route.file);
        locations.push({
          name: `${route.method} ${route.path}`,
          file: route.file,
          line: route.line,
        });
      }
    }
  } else if (category === 'observability' && practice.toLowerCase().includes('log')) {
    // Structured logging — affects the main entry point or first route file
    const seenFiles = new Set<string>();
    for (const route of manifest.apiSurface.routes) {
      if (route.file && route.file !== UNKNOWN_FILE && !seenFiles.has(route.file)) {
        seenFiles.add(route.file);
        locations.push({
          name: `${route.method} ${route.path}`,
          file: route.file,
          line: route.line,
        });
        break; // logging is typically set up once — one representative file is enough
      }
    }
  }

  // Filter out any locations that have sentinel/empty file or line values
  return locations.filter(
    (loc) => loc.file && loc.file !== UNKNOWN_FILE && loc.line !== UNKNOWN_LINE,
  );
}

// ─── Benchmark → BottleneckFinding Adapter ──────────────────────────────────

/**
 * Convert missing/partial benchmark results into bottleneck-style findings
 * so the upgrade proposer can process them uniformly.
 * Looks up concrete procedure/route locations from manifests instead of
 * emitting a single finding with empty file:line.
 */
function benchmarkToBottleneckFindings(
  results: BenchmarkResult[],
  manifests: RepoManifest[],
): BottleneckFinding[] {
  const findings: BottleneckFinding[] = [];

  for (const result of results) {
    if (result.status === 'present') continue;

    const severity = result.status === 'missing' ? ('high' as const) : ('medium' as const);
    const manifest = manifests.find((m) => m.repoId === result.repo);

    // Map benchmark category to bottleneck kind
    let kind: BottleneckFinding['kind'];
    switch (result.category) {
      case 'security':
        kind = 'unbounded-query';
        break;
      case 'performance':
        kind = 'missing-pagination';
        break;
      case 'reliability':
        kind = 'sync-in-async';
        break;
      case 'maintainability':
        kind = 'no-caching';
        break;
      case 'observability':
        kind = 'no-caching';
        break;
      default:
        kind = 'no-caching';
        break;
    }

    const description = `[Best Practice] ${result.practice}: ${result.suggestion}`;

    // Try to find specific affected procedures/routes
    if (manifest) {
      const specificLocations = findAffectedLocations(manifest, result.category, result.practice);

      if (specificLocations.length > 0) {
        for (const loc of specificLocations) {
          findings.push({
            kind,
            description: `${description} — affects ${loc.name}`,
            repo: result.repo,
            file: loc.file,
            line: loc.line,
            severity,
          });
        }
        continue;
      }
    }

    // Fallback: use first available procedure/route as representative.
    // Skip entirely if repo has no procedures or routes (e.g. markdown docs),
    // or if the fallback file/line would be sentinel/empty values.
    const fallbackFile =
      manifest?.apiSurface.procedures[0]?.file ?? manifest?.apiSurface.routes[0]?.file;
    const fallbackLine =
      manifest?.apiSurface.procedures[0]?.line ?? manifest?.apiSurface.routes[0]?.line;

    if (
      fallbackFile &&
      fallbackFile !== UNKNOWN_FILE &&
      fallbackLine != null &&
      fallbackLine !== UNKNOWN_LINE
    ) {
      findings.push({
        kind,
        description,
        repo: result.repo,
        file: fallbackFile,
        line: fallbackLine,
        severity,
      });
    }
  }

  return findings;
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

/**
 * Run the complete evolution analysis pipeline:
 * 1. Gap analyzer (incomplete CRUD, dead exports, orphaned schemas)
 * 2. Bottleneck finder (pagination, caching, rate-limiting)
 * 3. Competitive benchmarker (best practices comparison)
 * 4. Upgrade proposer (rank and merge all findings into suggestions)
 * 5. Filter by config categories
 * 6. Limit by maxSuggestionsPerSession
 */
export function analyzeEvolution(
  graph: EcosystemGraph,
  config: OmniLinkConfig,
): EvolutionSuggestion[] {
  const manifests = graph.repos;

  if (manifests.length === 0) return [];

  // Step 1: Run gap analyzer
  const gaps: GapFinding[] = analyzeGaps(manifests);

  // Step 2: Run bottleneck finder
  const bottlenecks: BottleneckFinding[] = findBottlenecks(manifests);

  // Step 3: Run competitive benchmarker
  const benchmarks: BenchmarkResult[] = benchmarkAgainstBestPractices(manifests);

  // Step 4: Convert benchmarks to bottleneck findings and merge
  const benchmarkFindings = benchmarkToBottleneckFindings(benchmarks, manifests);
  const allBottlenecks = [...bottlenecks, ...benchmarkFindings];

  // Step 5: Feed into upgrade proposer
  let suggestions = proposeUpgrades(gaps, allBottlenecks, manifests);

  // Step 6: Filter by config categories
  const allowedCategories = new Set(config.evolution.categories);
  suggestions = suggestions.filter((s) => allowedCategories.has(s.category));

  // Step 7: Limit to maxSuggestionsPerSession
  const limit = config.evolution.maxSuggestionsPerSession;
  if (suggestions.length > limit) {
    suggestions = suggestions.slice(0, limit);
  }

  return suggestions;
}

// Re-export sub-modules for direct access
export { analyzeGaps } from './gap-analyzer.js';
export type { GapFinding } from './gap-analyzer.js';
export { findBottlenecks } from './bottleneck-finder.js';
export type { BottleneckFinding } from './bottleneck-finder.js';
export { proposeUpgrades } from './upgrade-proposer.js';
export { benchmarkAgainstBestPractices } from './competitive-benchmarker.js';
export type { BenchmarkResult } from './competitive-benchmarker.js';
