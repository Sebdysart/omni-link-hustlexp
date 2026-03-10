// engine/evolution/bottleneck-finder.ts — Pattern-based detection of performance issues from manifest data

import {
  UNKNOWN_FILE,
  type RepoManifest,
  type RouteDefinition,
  type ProcedureDef,
} from '../types.js';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface BottleneckFinding {
  kind:
    | 'missing-pagination'
    | 'unbounded-query'
    | 'no-caching'
    | 'sync-in-async'
    | 'no-rate-limiting'
    | 'no-queue';
  description: string;
  repo: string;
  file: string;
  line: number;
  severity: 'low' | 'medium' | 'high';
}

// ─── Pagination Keywords ─────────────────────────────────────────────────────

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

function hasPaginationIndicator(name: string): boolean {
  const lower = name.toLowerCase();
  return PAGINATION_INDICATORS.some((kw) => lower.includes(kw));
}

/**
 * Returns true if the route looks like a list/collection endpoint (no path param at end).
 * e.g., GET /api/users → true, GET /api/users/:id → false
 */
function isListRoute(route: RouteDefinition): boolean {
  if (route.method.toUpperCase() !== 'GET') return false;

  const segments = route.path.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  const lastSegment = segments[segments.length - 1];
  // If the last segment is a path parameter, this is a detail route
  if (lastSegment.startsWith(':') || lastSegment.startsWith('{')) return false;

  return true;
}

/**
 * Returns true if the procedure looks like a list query (name starts with "list", "getAll", etc.).
 */
function isListProcedure(proc: ProcedureDef): boolean {
  if (proc.kind !== 'query') return false;
  const lower = proc.name.toLowerCase();
  return (
    lower.startsWith('list') ||
    lower.startsWith('getall') ||
    lower.startsWith('findall') ||
    lower.startsWith('search') ||
    lower.includes('list')
  );
}

// ─── Caching Detection ──────────────────────────────────────────────────────

const CACHING_PATTERNS = [
  'cache',
  'caching',
  'redis',
  'memcache',
  'cdn',
  'etag',
  'stale-while-revalidate',
];
const CACHING_PACKAGES = [
  'ioredis',
  'redis',
  'node-cache',
  'lru-cache',
  'keyv',
  'catbox',
  'apicache',
];

function hasCachingStrategy(manifest: RepoManifest): boolean {
  const patterns = manifest.conventions.patterns.map((p) => p.toLowerCase());
  if (patterns.some((p) => CACHING_PATTERNS.some((cp) => p.includes(cp)))) return true;

  const externalPkgs = manifest.dependencies.external.map((d) => d.name.toLowerCase());
  if (externalPkgs.some((pkg) => CACHING_PACKAGES.some((cp) => pkg.includes(cp)))) return true;

  return false;
}

// ─── Rate Limiting Detection ────────────────────────────────────────────────

const RATE_LIMIT_PATTERNS = ['rate-limit', 'rate_limit', 'ratelimit', 'throttle', 'throttling'];
const RATE_LIMIT_PACKAGES = [
  'express-rate-limit',
  'rate-limiter-flexible',
  'bottleneck',
  'p-throttle',
  'p-limit',
];

function hasRateLimiting(manifest: RepoManifest): boolean {
  const patterns = manifest.conventions.patterns.map((p) => p.toLowerCase());
  if (patterns.some((p) => RATE_LIMIT_PATTERNS.some((rl) => p.includes(rl)))) return true;

  const externalPkgs = manifest.dependencies.external.map((d) => d.name.toLowerCase());
  if (externalPkgs.some((pkg) => RATE_LIMIT_PACKAGES.some((rl) => pkg.includes(rl)))) return true;

  return false;
}

// ─── Detectors ──────────────────────────────────────────────────────────────

function detectMissingPagination(manifest: RepoManifest): BottleneckFinding[] {
  const findings: BottleneckFinding[] = [];

  // Check routes
  for (const route of manifest.apiSurface.routes) {
    if (!isListRoute(route)) continue;

    // Check if handler or output type has pagination indicators
    const handlerHasPagination = hasPaginationIndicator(route.handler);
    const outputHasPagination = route.outputType ? hasPaginationIndicator(route.outputType) : false;
    const inputHasPagination = route.inputType ? hasPaginationIndicator(route.inputType) : false;

    if (!handlerHasPagination && !outputHasPagination && !inputHasPagination) {
      findings.push({
        kind: 'missing-pagination',
        description: `List route '${route.method} ${route.path}' has no pagination indicators in handler or type names`,
        repo: manifest.repoId,
        file: route.file,
        line: route.line,
        severity: 'high',
      });
    }
  }

  // Check procedures
  for (const proc of manifest.apiSurface.procedures) {
    if (!isListProcedure(proc)) continue;

    const nameHasPagination = hasPaginationIndicator(proc.name);
    const inputHasPagination = proc.inputType ? hasPaginationIndicator(proc.inputType) : false;
    const outputHasPagination = proc.outputType ? hasPaginationIndicator(proc.outputType) : false;

    if (!nameHasPagination && !inputHasPagination && !outputHasPagination) {
      findings.push({
        kind: 'missing-pagination',
        description: `List procedure '${proc.name}' has no pagination indicators in name or type names`,
        repo: manifest.repoId,
        file: proc.file,
        line: proc.line,
        severity: 'high',
      });
    }
  }

  return findings;
}

function detectNoCaching(manifest: RepoManifest): BottleneckFinding[] {
  const findings: BottleneckFinding[] = [];

  // Only check if there are multiple GET routes on the same base resource
  const getRoutes = manifest.apiSurface.routes.filter((r) => r.method.toUpperCase() === 'GET');
  if (getRoutes.length < 2) return [];

  // Group by first two path segments (resource base)
  const resourceBases = new Map<string, RouteDefinition[]>();
  for (const route of getRoutes) {
    const segments = route.path.split('/').filter(Boolean);
    const base = '/' + segments.slice(0, 2).join('/');
    const existing = resourceBases.get(base) ?? [];
    existing.push(route);
    resourceBases.set(base, existing);
  }

  if (hasCachingStrategy(manifest)) return [];

  for (const [base, routes] of resourceBases) {
    if (routes.length < 2) continue;

    findings.push({
      kind: 'no-caching',
      description: `Resource '${base}' has ${routes.length} GET routes but no caching strategy detected`,
      repo: manifest.repoId,
      file: routes[0].file,
      line: routes[0].line,
      severity: 'medium',
    });
  }

  return findings;
}

function detectMissingRateLimiting(manifest: RepoManifest): BottleneckFinding[] {
  const findings: BottleneckFinding[] = [];

  if (hasRateLimiting(manifest)) return [];

  const hasMutationProcedures = manifest.apiSurface.procedures.some((p) => p.kind === 'mutation');
  const hasMutationRoutes = manifest.apiSurface.routes.some((r) =>
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method.toUpperCase()),
  );

  if (!hasMutationRoutes && !hasMutationProcedures) return [];

  // Count all mutation surfaces for the description
  const mutationRoutes = manifest.apiSurface.routes.filter((r) =>
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method.toUpperCase()),
  );
  const mutationProcedures = manifest.apiSurface.procedures.filter((p) => p.kind === 'mutation');
  const totalMutations = mutationRoutes.length + mutationProcedures.length;

  // Resolve a representative file/line — prefer routes, fall back to procedures
  const representativeFile = mutationRoutes[0]?.file || mutationProcedures[0]?.file || UNKNOWN_FILE;
  const representativeLine = mutationRoutes[0]?.line ?? mutationProcedures[0]?.line ?? 1;

  findings.push({
    kind: 'no-rate-limiting',
    description: `${totalMutations} mutation route(s)/procedure(s) found but no rate-limiting middleware detected`,
    repo: manifest.repoId,
    file: representativeFile,
    line: representativeLine,
    severity: 'high',
  });

  return findings;
}

// ─── Queue Detection ────────────────────────────────────────────────────────

const QUEUE_PACKAGES = ['bullmq', 'bull', 'bee-queue', 'agenda', 'amqplib', 'kafkajs'];

function detectNoQueue(manifest: RepoManifest): BottleneckFinding[] {
  const mutationCount = manifest.apiSurface.procedures.filter((p) => p.kind === 'mutation').length;
  if (mutationCount < 20) return [];

  const hasQueue = manifest.dependencies.external.some((d) =>
    QUEUE_PACKAGES.some((pkg) => d.name.toLowerCase().includes(pkg)),
  );
  if (hasQueue) return [];

  return [
    {
      kind: 'no-queue',
      repo: manifest.repoId,
      severity: 'medium',
      description: `${mutationCount} mutation procedures with no job queue detected. Consider adding a queue (e.g., BullMQ) for background processing.`,
      file: manifest.apiSurface.procedures[0]?.file || UNKNOWN_FILE,
      line: manifest.apiSurface.procedures[0]?.line ?? 1,
    },
  ];
}

// ─── Client-Language Guard ──────────────────────────────────────────────────

/**
 * Languages that are inherently client-side or non-server. Repos with these
 * languages are skipped by the bottleneck finder — their API surface data may
 * contain spurious detections (e.g. JS documentation files inside an iOS repo
 * that contain `window.get()` calls misidentified as HTTP list routes).
 */
const CLIENT_LANGUAGES = new Set(['swift', 'kotlin', 'dart', 'objective-c', 'markdown']);

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Find performance bottleneck patterns from manifest data.
 * Repos whose language is a known client-only language (swift, markdown, etc.)
 * are skipped to avoid false positives from incidental JS files in those repos.
 */
export function findBottlenecks(manifests: RepoManifest[]): BottleneckFinding[] {
  const findings: BottleneckFinding[] = [];

  for (const manifest of manifests) {
    if (CLIENT_LANGUAGES.has(manifest.language.toLowerCase())) continue;

    findings.push(
      ...detectMissingPagination(manifest),
      ...detectNoCaching(manifest),
      ...detectMissingRateLimiting(manifest),
      ...detectNoQueue(manifest),
    );
  }

  return findings;
}
