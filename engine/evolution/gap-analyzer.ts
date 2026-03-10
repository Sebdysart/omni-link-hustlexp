// engine/evolution/gap-analyzer.ts — Scan manifests for incomplete features, dead code, orphaned schemas

import type { RepoManifest, RouteDefinition } from '../types.js';

const NON_SERVER_LANGUAGES = new Set(['swift', 'kotlin', 'dart', 'objective-c', 'markdown']);

// ─── Public Types ────────────────────────────────────────────────────────────

export interface GapFinding {
  kind: 'incomplete-crud' | 'dead-route' | 'orphaned-schema' | 'dead-export';
  description: string;
  repo: string;
  file: string;
  line: number;
}

// ─── Resource Path Normalization ─────────────────────────────────────────────

/**
 * Normalize a route path to its base resource path.
 * Strips path parameters (`:id`, `{id}`) and trailing slashes.
 * `/api/users/:id` → `/api/users`
 * `/api/posts/{postId}/comments` → `/api/posts/comments`
 */
function normalizeResourcePath(path: string): string {
  return (
    path
      .split('/')
      .filter((seg) => !seg.startsWith(':') && !seg.startsWith('{'))
      .join('/')
      .replace(/\/+$/, '') || '/'
  );
}

// ─── CRUD Detection ─────────────────────────────────────────────────────────

const CRUD_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function detectIncompleteCrud(manifest: RepoManifest): GapFinding[] {
  const findings: GapFinding[] = [];
  const routes = manifest.apiSurface.routes;

  // Group routes by normalized resource path
  const resourceMap = new Map<string, RouteDefinition[]>();

  for (const route of routes) {
    const method = route.method.toUpperCase();
    if (!CRUD_METHODS.has(method)) continue;

    const resource = normalizeResourcePath(route.path);
    const existing = resourceMap.get(resource) ?? [];
    existing.push(route);
    resourceMap.set(resource, existing);
  }

  for (const [resource, routeGroup] of resourceMap) {
    const methods = new Set(routeGroup.map((r) => r.method.toUpperCase()));

    // Only check resources that have at least 2 CRUD methods (indicates intentional CRUD resource)
    if (methods.size < 2) continue;

    const missing: string[] = [];

    // If has POST (create) or GET (read), expect the full set
    if (methods.has('POST') || (methods.has('GET') && methods.size >= 2)) {
      if (!methods.has('GET')) missing.push('GET');
      if (!methods.has('POST')) missing.push('POST');
      if (!methods.has('PUT') && !methods.has('PATCH')) missing.push('PUT/PATCH');
      if (!methods.has('DELETE')) missing.push('DELETE');
    }

    if (missing.length > 0) {
      const firstRoute = routeGroup[0];
      findings.push({
        kind: 'incomplete-crud',
        description: `Resource '${resource}' has ${[...methods].sort().join(', ')} but is missing: ${missing.join(', ')}`,
        repo: manifest.repoId,
        file: firstRoute.file,
        line: firstRoute.line,
      });
    }
  }

  return findings;
}

// ─── Dead Export Detection ───────────────────────────────────────────────────

function detectDeadExports(manifest: RepoManifest): GapFinding[] {
  const findings: GapFinding[] = [];
  const exports = manifest.apiSurface.exports;
  const internalDeps = manifest.dependencies.internal;
  const routes = manifest.apiSurface.routes;
  const procedures = manifest.apiSurface.procedures;

  // Collect all imported names across all internal deps
  const importedNames = new Set<string>();
  for (const dep of internalDeps) {
    for (const imp of dep.imports) {
      importedNames.add(imp);
    }
  }

  // Collect route handler names
  const handlerNames = new Set<string>();
  for (const route of routes) {
    handlerNames.add(route.handler);
  }

  // Collect procedure names
  const procedureNames = new Set<string>();
  for (const proc of procedures) {
    procedureNames.add(proc.name);
  }

  for (const exp of exports) {
    // Skip type/interface exports — they are structural and often consumed implicitly
    if (exp.kind === 'type' || exp.kind === 'interface') continue;

    const isImported = importedNames.has(exp.name);
    const isHandler = handlerNames.has(exp.name);
    const isProcedure = procedureNames.has(exp.name);

    if (!isImported && !isHandler && !isProcedure) {
      findings.push({
        kind: 'dead-export',
        description: `Export '${exp.name}' (${exp.kind}) is not imported by any internal module`,
        repo: manifest.repoId,
        file: exp.file,
        line: exp.line,
      });
    }
  }

  return findings;
}

// ─── Orphaned Schema Detection ──────────────────────────────────────────────

function detectOrphanedSchemas(manifest: RepoManifest): GapFinding[] {
  const findings: GapFinding[] = [];
  const schemas = manifest.typeRegistry.schemas;
  const routes = manifest.apiSurface.routes;
  const procedures = manifest.apiSurface.procedures;

  // Collect all type names referenced by routes and procedures
  const referencedTypes = new Set<string>();

  for (const route of routes) {
    if (route.inputType) referencedTypes.add(route.inputType);
    if (route.outputType) referencedTypes.add(route.outputType);
  }

  for (const proc of procedures) {
    if (proc.inputType) referencedTypes.add(proc.inputType);
    if (proc.outputType) referencedTypes.add(proc.outputType);
  }

  for (const schema of schemas) {
    if (!referencedTypes.has(schema.name)) {
      findings.push({
        kind: 'orphaned-schema',
        description: `Schema '${schema.name}' (${schema.kind}) is not referenced by any route or procedure`,
        repo: manifest.repoId,
        file: schema.source.file,
        line: schema.source.line,
      });
    }
  }

  return findings;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Scan repo manifests for gaps: incomplete CRUD, dead exports, orphaned schemas.
 */
export function analyzeGaps(manifests: RepoManifest[]): GapFinding[] {
  const findings: GapFinding[] = [];

  for (const manifest of manifests) {
    // Skip non-server repos — gap detection (CRUD, dead exports, orphaned schemas) only applies to server codebases
    if (NON_SERVER_LANGUAGES.has(manifest.language.toLowerCase())) continue;

    findings.push(
      ...detectIncompleteCrud(manifest),
      ...detectDeadExports(manifest),
      ...detectOrphanedSchemas(manifest),
    );
  }

  return findings;
}
