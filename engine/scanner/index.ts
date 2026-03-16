// engine/scanner/index.ts — Repo scanner orchestrator: walks a repo, extracts everything, assembles RepoManifest
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  InternalDep,
  OmniLinkConfig,
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
  SymbolReference,
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
import { createGitignoreResolver } from './gitignore-resolver.js';
import { analyzeRepoSemantics } from '../analyzers/index.js';

export interface ScanRepoOptions {
  config?: OmniLinkConfig;
}

const execFileAsync = promisify(execFile);

// Directories to always skip during recursive walk
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.claude']);

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
export async function scanRepo(
  config: RepoConfig,
  fileCache?: FileCache,
  manifestCache?: CacheManager,
  scanOptions?: ScanRepoOptions,
): Promise<RepoManifest> {
  const { name, path: repoPath, language } = config;

  // ── Manifest cache check ─────────────────────────────────────────────────
  // Only use the cached manifest when the working tree is clean — if there
  // are uncommitted or untracked changes the cached snapshot is stale.
  const gitRoot = await resolveOwnedGitRoot(repoPath);
  if (manifestCache && gitRoot) {
    const headSha = await gitExec(repoPath, ['rev-parse', 'HEAD']);
    const branchName =
      (await gitExec(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])) || 'detached';
    if (headSha) {
      const diffOutput = await gitExec(repoPath, ['status', '--porcelain']);
      const hasUncommittedChanges = diffOutput.trim().length > 0;
      if (!hasUncommittedChanges) {
        const cached = manifestCache.getCachedManifest(name, headSha, branchName);
        if (cached) {
          return cached;
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // 1. Walk and collect supported files
  const filePaths = await walkDirectory(repoPath, config.exclude ?? []);
  const semanticSelection = await analyzeRepoSemantics(config, filePaths, scanOptions?.config);

  // 2. Parse each file and extract everything
  const allExports: ExportDef[] = [];
  const allRoutes: RouteDefinition[] = [];
  const allProcedures: ProcedureDef[] = [];
  const allTypes: TypeDef[] = [];
  const allSchemas: SchemaDef[] = [];
  const allInternalDeps: InternalDep[] = [];
  const allSymbolReferences: SymbolReference[] = [];
  const sourceSnippets: string[] = [];
  const fileInfos: FileInfo[] = [];

  for (const filePath of filePaths) {
    const lang = detectLanguage(filePath);
    if (!lang) continue;

    let source: string;
    try {
      source = await fs.promises.readFile(filePath, 'utf-8');
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
    let imports: InternalDep[];
    let symbolReferences: SymbolReference[];
    const semanticResult = semanticSelection.analysis?.files.get(relPath);

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
        imports = cached.result.imports;
        symbolReferences = cached.result.symbolReferences ?? [];
      } else {
        const parserExports = extractExports(source, relPath, lang);
        const parserRoutes = extractRoutes(source, relPath, lang);
        const parserProcedures = extractProcedures(source, relPath, lang);
        const parserTypes = extractTypes(source, relPath, lang, name);
        const parserSchemas = extractSchemas(source, relPath, lang, name);
        const parserImports: InternalDep[] = [];
        const parserSymbolReferences: SymbolReference[] = [];

        exports = mergeArtifacts(
          parserExports,
          semanticResult?.exports ?? [],
          semanticSelection.preferSemantic,
          (entry) => `${entry.kind}:${entry.name}:${entry.file}:${entry.line}`,
        );
        routes = mergeArtifacts(
          parserRoutes,
          semanticResult?.routes ?? [],
          semanticSelection.preferSemantic,
          (entry) => `${entry.method}:${entry.path}:${entry.file}:${entry.line}`,
        );
        procedures = mergeArtifacts(
          parserProcedures,
          semanticResult?.procedures ?? [],
          semanticSelection.preferSemantic,
          (entry) => `${entry.kind}:${entry.name}:${entry.file}:${entry.line}`,
        );
        types = mergeArtifacts(
          parserTypes,
          semanticResult?.types ?? [],
          semanticSelection.preferSemantic,
          (entry) => `${entry.name}:${entry.source.file}:${entry.source.line}`,
        );
        schemas = mergeArtifacts(
          parserSchemas,
          semanticResult?.schemas ?? [],
          semanticSelection.preferSemantic,
          (entry) => `${entry.name}:${entry.source.file}:${entry.source.line}`,
        );
        imports = mergeArtifacts(
          parserImports,
          semanticResult?.imports ?? [],
          true,
          (entry) => `${entry.from}:${entry.to}:${entry.imports.join(',')}`,
        );
        symbolReferences = mergeArtifacts(
          parserSymbolReferences,
          semanticResult?.symbolReferences ?? [],
          true,
          (entry) =>
            `${entry.kind}:${entry.name}:${entry.fromFile}:${entry.toFile ?? ''}:${entry.line}`,
        );

        const result: FileScanResult = {
          filePath,
          sha: sha1,
          scannedAt: new Date().toISOString(),
          exports,
          imports,
          types,
          schemas,
          routes,
          procedures,
          symbolReferences,
        };
        fileCache.set(filePath, { sha1, result });
      }
    } else {
      const parserExports = extractExports(source, relPath, lang);
      const parserRoutes = extractRoutes(source, relPath, lang);
      const parserProcedures = extractProcedures(source, relPath, lang);
      const parserTypes = extractTypes(source, relPath, lang, name);
      const parserSchemas = extractSchemas(source, relPath, lang, name);
      exports = mergeArtifacts(
        parserExports,
        semanticResult?.exports ?? [],
        semanticSelection.preferSemantic,
        (entry) => `${entry.kind}:${entry.name}:${entry.file}:${entry.line}`,
      );
      routes = mergeArtifacts(
        parserRoutes,
        semanticResult?.routes ?? [],
        semanticSelection.preferSemantic,
        (entry) => `${entry.method}:${entry.path}:${entry.file}:${entry.line}`,
      );
      procedures = mergeArtifacts(
        parserProcedures,
        semanticResult?.procedures ?? [],
        semanticSelection.preferSemantic,
        (entry) => `${entry.kind}:${entry.name}:${entry.file}:${entry.line}`,
      );
      types = mergeArtifacts(
        parserTypes,
        semanticResult?.types ?? [],
        semanticSelection.preferSemantic,
        (entry) => `${entry.name}:${entry.source.file}:${entry.source.line}`,
      );
      schemas = mergeArtifacts(
        parserSchemas,
        semanticResult?.schemas ?? [],
        semanticSelection.preferSemantic,
        (entry) => `${entry.name}:${entry.source.file}:${entry.source.line}`,
      );
      imports = mergeArtifacts(
        [],
        semanticResult?.imports ?? [],
        true,
        (entry) => `${entry.from}:${entry.to}:${entry.imports.join(',')}`,
      );
      symbolReferences = mergeArtifacts(
        [],
        semanticResult?.symbolReferences ?? [],
        true,
        (entry) =>
          `${entry.kind}:${entry.name}:${entry.fromFile}:${entry.toFile ?? ''}:${entry.line}`,
      );
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
    allInternalDeps.push(...imports);
    allSymbolReferences.push(...symbolReferences);

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
  const gitState = await extractGitState(repoPath, gitRoot);

  // 4. Detect conventions
  const conventions = detectConventions(fileInfos, language, sourceSnippets);

  // 5. Extract external dependencies
  const externalDeps = await extractExternalDependencies(repoPath, language);

  // 6. Build health scaffold (actual values computed by quality gate later)
  const health: HealthScore = {
    testCoverage: await readCoverageReport(repoPath),
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
      internal: dedupeInternalDeps(allInternalDeps),
      external: externalDeps,
    },
    symbolReferences: dedupeSymbolReferences(allSymbolReferences),
    sourceKind: semanticSelection.analysis ? 'mixed' : 'parser',
    confidence: semanticSelection.analysis ? 0.82 : 0.7,
    provenance: semanticSelection.analysis
      ? [
          {
            sourceKind: 'parser',
            adapter: 'tree-sitter',
            detail: 'baseline scanner',
            confidence: 0.7,
          },
          {
            sourceKind: 'semantic',
            adapter: semanticSelection.analysis.adapter,
            detail: 'semantic analyzer overlay',
            confidence: 0.92,
          },
        ]
      : [
          {
            sourceKind: 'parser',
            adapter: 'tree-sitter',
            detail: 'baseline scanner',
            confidence: 0.7,
          },
        ],
    health,
  };

  // Store manifest in disk cache for next session warm-start
  if (manifestCache && manifest.gitState.headSha) {
    manifestCache.setCachedManifest(
      name,
      manifest.gitState.headSha,
      manifest,
      manifest.gitState.branch,
    );
  }

  return manifest;
}

// ─── Directory Walker ────────────────────────────────────────────────────────

/**
 * Recursively walk a directory, returning all file paths.
 * Skips SKIP_DIRS at any level.
 */
async function walkDirectory(dir: string, extraIgnorePatterns: string[] = []): Promise<string[]> {
  const results: string[] = [];
  const stack: string[] = [dir];
  const rootDir = dir;
  const ignoreResolver = createGitignoreResolver(rootDir, extraIgnorePatterns);

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (ignoreResolver.isIgnored(fullPath, true)) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        // Only include files with a detectable language
        if (
          detectLanguage(entry.name) !== null &&
          !ignoreResolver.isIgnored(fullPath) &&
          !shouldSkipSourceFile(rootDir, fullPath)
        ) {
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

async function extractGitState(
  repoPath: string,
  ownedGitRoot?: string | null,
): Promise<RepoManifest['gitState']> {
  if (!ownedGitRoot) {
    return {
      branch: '',
      headSha: '',
      uncommittedChanges: [],
      recentCommits: [],
    };
  }

  const [branch, headSha, diffOutput, stagedOutput, untrackedOutput, logOutput] = await Promise.all(
    [
      gitExec(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
      gitExec(repoPath, ['rev-parse', 'HEAD']),
      gitExec(repoPath, ['diff', '--name-only']),
      gitExec(repoPath, ['diff', '--cached', '--name-only']),
      gitExec(repoPath, ['ls-files', '--others', '--exclude-standard']),
      gitExec(repoPath, ['log', '-n', '20', '--format=%H|%s|%an|%aI']),
    ],
  );

  // Uncommitted changes (both staged and unstaged)
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

async function resolveOwnedGitRoot(repoPath: string): Promise<string | null> {
  const gitRoot = await gitExec(repoPath, ['rev-parse', '--show-toplevel']);
  if (!gitRoot) {
    return null;
  }

  try {
    const [resolvedRepoPath, resolvedGitRoot] = await Promise.all([
      fs.promises.realpath(repoPath),
      fs.promises.realpath(gitRoot),
    ]);
    return resolvedRepoPath === resolvedGitRoot ? resolvedGitRoot : null;
  } catch {
    return null;
  }
}

/**
 * Execute a git command in the given repo directory and return trimmed stdout.
 */
const GIT_TIMEOUT_MS = 15_000;

async function gitExec(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

// ─── Dependency Extraction ───────────────────────────────────────────────────

async function extractExternalDependencies(
  repoPath: string,
  language: string,
): Promise<PackageDep[]> {
  if (language === 'typescript' || language === 'tsx' || language === 'javascript') {
    return extractNpmDependencies(repoPath);
  }
  if (language === 'swift') {
    return extractSwiftDependencies(repoPath);
  }
  return [];
}

async function extractNpmDependencies(repoPath: string): Promise<PackageDep[]> {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const raw = await fs.promises.readFile(pkgPath, 'utf-8');
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

async function extractSwiftDependencies(repoPath: string): Promise<PackageDep[]> {
  const pkgPath = path.join(repoPath, 'Package.swift');
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const source = await fs.promises.readFile(pkgPath, 'utf-8');
    const deps: PackageDep[] = [];

    // Match .package(url: "https://github.com/org/Name.git", from: "1.0.0")
    const packagePattern = /\.package\(\s*url:\s*"([^"]+)"[^)]*(?:from:\s*"([^"]+)")?/g;
    let match: RegExpExecArray | null;
    while ((match = packagePattern.exec(source)) !== null) {
      const url = match[1];
      const version = match[2] ?? 'unknown';
      // Extract package name from URL
      const name =
        url
          .split('/')
          .pop()
          ?.replace(/\.git$/, '') ?? url;
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
async function readCoverageReport(repoPath: string): Promise<number | null> {
  // Candidate paths in priority order
  const candidates = [
    path.join(repoPath, 'coverage', 'coverage-summary.json'),
    path.join(repoPath, 'coverage', 'coverage.json'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
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

function mergeArtifacts<T>(
  parserArtifacts: T[],
  semanticArtifacts: T[],
  preferSemantic: boolean,
  keyFn: (entry: T) => string,
): T[] {
  const primary = preferSemantic ? semanticArtifacts : parserArtifacts;
  const secondary = preferSemantic ? parserArtifacts : semanticArtifacts;
  const merged = new Map<string, T>();

  for (const entry of primary) {
    merged.set(keyFn(entry), entry);
  }

  for (const entry of secondary) {
    const key = keyFn(entry);
    if (!merged.has(key)) {
      merged.set(key, entry);
    }
  }

  return [...merged.values()];
}

function dedupeInternalDeps(deps: InternalDep[]): InternalDep[] {
  const merged = new Map<string, InternalDep>();

  for (const dep of deps) {
    const key = `${dep.from}:${dep.to}`;
    const existing = merged.get(key);
    if (existing) {
      for (const imported of dep.imports) {
        if (!existing.imports.includes(imported)) {
          existing.imports.push(imported);
        }
      }
      continue;
    }

    merged.set(key, { ...dep, imports: [...dep.imports] });
  }

  return [...merged.values()];
}

function dedupeSymbolReferences(references: SymbolReference[]): SymbolReference[] {
  const merged = new Map<string, SymbolReference>();

  for (const reference of references) {
    const key = `${reference.kind}:${reference.name}:${reference.fromFile}:${reference.toFile ?? ''}:${reference.line}`;
    if (!merged.has(key)) {
      merged.set(key, reference);
    }
  }

  return [...merged.values()];
}
