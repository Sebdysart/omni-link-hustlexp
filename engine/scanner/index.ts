// engine/scanner/index.ts — Repo scanner orchestrator: walks a repo, extracts everything, assembles RepoManifest
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';

import type {
  RepoConfig,
  RepoManifest,
  CommitSummary,
  ExportDef,
  RouteDefinition,
  ProcedureDef,
  TypeDef,
  SchemaDef,
  PackageDep,
  HealthScore,
  FileScanResult,
} from '../types.js';

/**
 * Per-file incremental cache entry.
 * Keyed by absolute file path. Stores the SHA1 of the last-seen file
 * content alongside the parsed result so unchanged files can be skipped.
 */
export interface FileCacheEntry {
  sha1: string;
  result: FileScanResult;
}

/**
 * In-memory incremental file cache: Map<absoluteFilePath, FileCacheEntry>.
 * Pass the same Map across multiple scanRepo calls to avoid re-parsing
 * files whose content hasn't changed.
 */
export type FileCache = Map<string, FileCacheEntry>;

import type { CacheManager } from '../context/cache-manager.js';
import { detectLanguage } from './tree-sitter.js';
import {
  extractExports,
  extractRoutes,
  extractProcedures,
  extractScriptApiCallSites,
  extractSwiftApiCallSites,
} from './api-extractor.js';
import { extractTypes, extractSchemas } from './type-extractor.js';
import { detectConventions } from './convention-detector.js';
import type { FileInfo } from './convention-detector.js';

// Directories to always skip during recursive walk
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
]);

const SKIP_PATH_SEGMENTS = new Set([
  '__fixtures__',
  '__tests__',
  'bench',
  'benchmark',
  'benchmarks',
  'doc',
  'docs',
  'example',
  'examples',
  'fixture',
  'fixtures',
  'spec',
  'specs',
  'test',
  'tests',
]);

function shouldSkipSourceFile(rootDir: string, filePath: string): boolean {
  const normalized = path.relative(rootDir, filePath).replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/');
  if (segments.some((segment) => SKIP_PATH_SEGMENTS.has(segment))) {
    return true;
  }

  const baseName = segments[segments.length - 1] ?? '';
  return (
    baseName.endsWith('.d.ts') ||
    /\.(test|spec)\.[a-z0-9]+$/.test(baseName) ||
    /_test\.go$/.test(baseName)
  );
}

/**
 * Scan a repository and assemble a full RepoManifest.
 *
 * 1. Walk the directory tree, collecting files with supported extensions
 * 2. Parse each file: extract exports, routes, procedures, types, schemas
 *    - If an optional `fileCache` is provided and the file's SHA1 matches
 *      the cached entry, the cached parse result is reused (no re-parse).
 *    - On a cache miss the file is parsed normally and the result is stored.
 * 3. Extract git state via child_process
 * 4. Detect conventions from the collected data
 * 5. Extract external dependencies from package.json / Package.swift
 * 6. Assemble and return the RepoManifest
 *
 * @param config    Repository configuration
 * @param fileCache Optional in-memory incremental cache (Map keyed by absolute
 *                  file path). Pass the same Map across multiple calls to skip
 *                  re-parsing unchanged files.
 */
export function scanRepo(config: RepoConfig, fileCache?: FileCache, manifestCache?: CacheManager): RepoManifest {
  const { name, path: repoPath, language } = config;

  // ── Manifest cache check ─────────────────────────────────────────────────
  // Only use the cached manifest when the working tree is clean — if there
  // are uncommitted or untracked changes the cached snapshot is stale.
  if (manifestCache) {
    const headSha = gitExec(repoPath, 'rev-parse HEAD');
    if (headSha) {
      const diffOutput = gitExec(repoPath, 'status --porcelain');
      const hasUncommittedChanges = diffOutput.trim().length > 0;
      if (!hasUncommittedChanges) {
        const cached = manifestCache.getCachedManifest(name, headSha);
        if (cached) return cached;
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // 1. Walk and collect supported files
  const filePaths = walkDirectory(repoPath);

  // 2. Parse each file and extract everything
  const allExports: ExportDef[] = [];
  const allRoutes: RouteDefinition[] = [];
  const allProcedures: ProcedureDef[] = [];
  const allTypes: TypeDef[] = [];
  const allSchemas: SchemaDef[] = [];
  const sourceSnippets: string[] = [];
  const fileInfos: FileInfo[] = [];

  for (const filePath of filePaths) {
    const lang = detectLanguage(filePath);
    if (!lang) continue;

    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // Skip files we cannot read
      continue;
    }

    // Relative path from repo root for cleaner file references
    const relPath = path.relative(repoPath, filePath);

    // ── Incremental cache check ──────────────────────────────────────────
    let exports: ExportDef[];
    let routes: RouteDefinition[];
    let procedures: ProcedureDef[];
    let types: TypeDef[];
    let schemas: SchemaDef[];

    if (fileCache !== undefined) {
      const sha1 = crypto.createHash('sha1').update(source).digest('hex');
      const cached = fileCache.get(filePath);

      if (cached !== undefined && cached.sha1 === sha1) {
        // Cache hit — reuse the previously parsed result
        exports = cached.result.exports;
        routes = cached.result.routes;
        procedures = cached.result.procedures;
        types = cached.result.types;
        schemas = cached.result.schemas;
      } else {
        // Cache miss or stale — parse and store
        exports = extractExports(source, relPath, lang);
        routes = extractRoutes(source, relPath, lang);
        procedures = extractProcedures(source, relPath, lang);
        types = extractTypes(source, relPath, lang, name);
        schemas = extractSchemas(source, relPath, lang, name);

        const result: FileScanResult = {
          filePath,
          sha: sha1,
          scannedAt: new Date().toISOString(),
          exports,
          imports: [], // Cross-file import resolution is done by the grapher
          types,
          schemas,
          routes,
          procedures,
        };
        fileCache.set(filePath, { sha1, result });
      }
    } else {
      // No cache provided — parse unconditionally (original behaviour)
      exports = extractExports(source, relPath, lang);
      routes = extractRoutes(source, relPath, lang);
      procedures = extractProcedures(source, relPath, lang);
      types = extractTypes(source, relPath, lang, name);
      schemas = extractSchemas(source, relPath, lang, name);
    }
    // ────────────────────────────────────────────────────────────────────

    allExports.push(...exports);

    // Consumer files can embed outbound API references in function bodies rather
    // than in their exported signatures. Capture those call sites explicitly so
    // bridge detection works for real clients, not just mocked test signatures.
    if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
      const definedRoutes = new Set(routes.map((route) => route.path));
      const definedProcedures = new Set(procedures.map((procedure) => procedure.name));
      const callSites = extractScriptApiCallSites(source, relPath).filter(
        (entry) => !definedRoutes.has(entry.signature) && !definedProcedures.has(entry.signature),
      );
      allExports.push(...callSites);
    }

    if (lang === 'swift') {
      const callSites = extractSwiftApiCallSites(source, relPath);
      allExports.push(...callSites);
    }

    allRoutes.push(...routes);
    allProcedures.push(...procedures);
    allTypes.push(...types);
    allSchemas.push(...schemas);

    // Collect for convention detection
    fileInfos.push({
      path: relPath,
      exports: exports.map((e) => e.name),
    });

    // Collect source snippets for error-handling detection (limit size)
    if (source.length < 50_000) {
      sourceSnippets.push(source);
    }
  }

  // 3. Extract git state
  const gitState = extractGitState(repoPath);

  // 4. Detect conventions
  const conventions = detectConventions(fileInfos, language, sourceSnippets);

  // 5. Extract external dependencies
  const externalDeps = extractExternalDependencies(repoPath, language);

  // 6. Build health scaffold (actual values computed by quality gate later)
  const health: HealthScore = {
    testCoverage: readCoverageReport(repoPath),
    lintErrors: 0,
    typeErrors: 0,
    todoCount: countTodos(sourceSnippets),
    deadCode: [],
  };

  // 7. Assemble the manifest
  const manifest: RepoManifest = {
    repoId: name,
    path: repoPath,
    language,
    gitState,
    apiSurface: {
      routes: allRoutes,
      procedures: allProcedures,
      exports: allExports,
    },
    typeRegistry: {
      types: allTypes,
      schemas: allSchemas,
      models: [], // Models extracted by a dedicated pass (ORM-specific)
    },
    conventions: {
      naming: conventions.naming,
      fileOrganization: conventions.fileOrganization,
      errorHandling: conventions.errorHandling,
      patterns: conventions.patterns,
      testingPatterns: conventions.testingPatterns,
    },
    dependencies: {
      internal: [], // Internal deps require cross-file import resolution (done by grapher)
      external: externalDeps,
    },
    health,
  };

  // Store manifest in disk cache for next session warm-start
  if (manifestCache && manifest.gitState.headSha) {
    manifestCache.setCachedManifest(name, manifest.gitState.headSha, manifest);
  }

  return manifest;
}

// ─── Directory Walker ────────────────────────────────────────────────────────

/**
 * Recursively walk a directory, returning all file paths.
 * Skips SKIP_DIRS at any level.
 */
function walkDirectory(dir: string): string[] {
  const results: string[] = [];
  const stack: string[] = [dir];
  const rootDir = dir;

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        // Only include files with a detectable language
        if (detectLanguage(entry.name) !== null && !shouldSkipSourceFile(rootDir, fullPath)) {
          results.push(fullPath);
        }
      }
    }
  }

  // Sort for deterministic output
  results.sort();
  return results;
}

// ─── Git State Extraction ────────────────────────────────────────────────────

function extractGitState(repoPath: string): RepoManifest['gitState'] {
  const branch = gitExec(repoPath, 'rev-parse --abbrev-ref HEAD');
  const headSha = gitExec(repoPath, 'rev-parse HEAD');

  // Uncommitted changes (both staged and unstaged)
  const diffOutput = gitExec(repoPath, 'diff --name-only');
  const stagedOutput = gitExec(repoPath, 'diff --cached --name-only');
  const untrackedOutput = gitExec(repoPath, 'ls-files --others --exclude-standard');
  const changedFiles = new Set<string>();
  for (const line of [
    ...diffOutput.split('\n'),
    ...stagedOutput.split('\n'),
    ...untrackedOutput.split('\n'),
  ]) {
    const trimmed = line.trim();
    if (trimmed) changedFiles.add(trimmed);
  }

  // Recent commits
  const logOutput = gitExec(repoPath, 'log -n 20 --format="%H|%s|%an|%aI"');
  const recentCommits: CommitSummary[] = [];
  for (const line of logOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, message, author, date] = trimmed.split('|');
    if (sha && message) {
      recentCommits.push({
        sha,
        message,
        author: author ?? '',
        date: date ?? '',
        filesChanged: [], // Could be enriched with --name-only per commit, but expensive
      });
    }
  }

  return {
    branch,
    headSha,
    uncommittedChanges: [...changedFiles],
    recentCommits,
  };
}

/**
 * Execute a git command in the given repo directory and return trimmed stdout.
 */
function gitExec(repoPath: string, args: string): string {
  try {
    return execSync(`git -C "${repoPath}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// ─── Dependency Extraction ───────────────────────────────────────────────────

function extractExternalDependencies(repoPath: string, language: string): PackageDep[] {
  if (language === 'typescript' || language === 'tsx' || language === 'javascript') {
    return extractNpmDependencies(repoPath);
  }
  if (language === 'swift') {
    return extractSwiftDependencies(repoPath);
  }
  return [];
}

function extractNpmDependencies(repoPath: string): PackageDep[] {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    const deps: PackageDep[] = [];

    const prodDeps = pkg.dependencies ?? {};
    for (const [name, version] of Object.entries(prodDeps)) {
      deps.push({ name, version: String(version), dev: false });
    }

    const devDeps = pkg.devDependencies ?? {};
    for (const [name, version] of Object.entries(devDeps)) {
      deps.push({ name, version: String(version), dev: true });
    }

    return deps;
  } catch {
    return [];
  }
}

function extractSwiftDependencies(repoPath: string): PackageDep[] {
  const pkgPath = path.join(repoPath, 'Package.swift');
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const source = fs.readFileSync(pkgPath, 'utf-8');
    const deps: PackageDep[] = [];

    // Match .package(url: "https://github.com/org/Name.git", from: "1.0.0")
    const packagePattern = /\.package\(\s*url:\s*"([^"]+)"[^)]*(?:from:\s*"([^"]+)")?/g;
    let match: RegExpExecArray | null;
    while ((match = packagePattern.exec(source)) !== null) {
      const url = match[1];
      const version = match[2] ?? 'unknown';
      // Extract package name from URL
      const name = url.split('/').pop()?.replace(/\.git$/, '') ?? url;
      deps.push({ name, version, dev: false });
    }

    return deps;
  } catch {
    return [];
  }
}

// ─── Health Helpers ──────────────────────────────────────────────────────────

/**
 * Read a vitest/Istanbul json-summary coverage report from the repo's coverage
 * directory and return the total lines coverage percentage (0-100), or null if
 * no report is found.
 *
 * Checks two locations in order:
 *   1. {repoPath}/coverage/coverage-summary.json  (vitest json-summary default)
 *   2. {repoPath}/coverage/coverage.json          (Istanbul full report)
 */
function readCoverageReport(repoPath: string): number | null {
  // Candidate paths in priority order
  const candidates = [
    path.join(repoPath, 'coverage', 'coverage-summary.json'),
    path.join(repoPath, 'coverage', 'coverage.json'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;

      // json-summary format: { total: { lines: { pct: 80 }, ... } }
      const total = data['total'] as Record<string, { pct?: number }> | undefined;
      if (total?.lines?.pct !== undefined) {
        const pct = Number(total.lines.pct);
        if (!isNaN(pct)) return Math.max(0, Math.min(100, pct));
      }
    } catch {
      // Malformed JSON or unexpected shape — try next candidate
    }
  }

  return null;
}

function countTodos(sourceSnippets: string[]): number {
  let count = 0;
  const todoPattern = /\b(?:TODO|FIXME|HACK|XXX)\b/gi;
  for (const snippet of sourceSnippets) {
    const matches = snippet.match(todoPattern);
    if (matches) count += matches.length;
  }
  return count;
}
