import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanRepo } from '../../engine/scanner/index.js';
import type { RepoConfig } from '../../engine/types.js';
import type { FileCache } from '../../engine/scanner/index.js';
import { CacheManager } from '../../engine/context/cache-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';

describe('scanRepo orchestrator', () => {
  let tmpDir: string;
  let config: RepoConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-scanner-'));

    // Initialize a git repo with some commits
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });

    // Create a few TypeScript source files
    fs.mkdirSync(path.join(tmpDir, 'src', 'services'), { recursive: true });

    // File 1: exports a function and an interface
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'services', 'user-service.ts'),
      `export interface UserInput {
  name: string;
  email: string;
}

export function createUser(input: UserInput): void {
  // implementation
}

export const USER_LIMIT = 100;
`,
    );

    // File 2: exports a type and a route
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'router.ts'),
      `import { Hono } from 'hono';

export type ApiResponse = {
  success: boolean;
  data?: unknown;
};

const app = new Hono();
app.get('/api/users', (c) => c.json({ users: [] }));
app.post('/api/users', (c) => c.json({ created: true }));

export default app;
`,
    );

    // File 3: a types file with a zod schema
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'schemas.ts'),
      `import { z } from 'zod';

export const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
});

export type User = z.infer<typeof userSchema>;
`,
    );

    // Add a package.json for dependency extraction
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-repo',
        dependencies: { hono: '^4.0.0', zod: '^3.22.0' },
        devDependencies: { vitest: '^3.0.0' },
      }),
    );

    // Commit everything
    execSync('git add -A', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'ignore' });

    config = {
      name: 'test-repo',
      path: tmpDir,
      language: 'typescript',
      role: 'backend',
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a complete RepoManifest with correct structure', async () => {
    const manifest = await scanRepo(config);

    // Basic identity
    expect(manifest.repoId).toBe('test-repo');
    expect(manifest.path).toBe(tmpDir);
    expect(manifest.language).toBe('typescript');
  });

  it('extracts git state correctly', async () => {
    const manifest = await scanRepo(config);

    expect(manifest.gitState.branch).toBeTruthy();
    expect(manifest.gitState.headSha).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.gitState.uncommittedChanges).toEqual([]);
    expect(manifest.gitState.recentCommits.length).toBeGreaterThanOrEqual(1);
    expect(manifest.gitState.recentCommits[0].message).toBe('initial commit');
  });

  it('does not inherit git state from a parent repository', async () => {
    const nestedDir = path.join(tmpDir, 'nested-repo');
    fs.mkdirSync(path.join(nestedDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'src', 'index.ts'), 'export const value = 1;\n');

    const manifest = await scanRepo({
      ...config,
      name: 'nested-repo',
      path: nestedDir,
    });

    expect(manifest.gitState.branch).toBe('');
    expect(manifest.gitState.headSha).toBe('');
    expect(manifest.gitState.uncommittedChanges).toEqual([]);
    expect(manifest.gitState.recentCommits).toEqual([]);
  });

  it('detects uncommitted changes', async () => {
    // Modify a file without committing
    fs.writeFileSync(path.join(tmpDir, 'src', 'schemas.ts'), '// modified\n');

    const manifest = await scanRepo(config);
    expect(manifest.gitState.uncommittedChanges.length).toBeGreaterThan(0);
  });

  it('detects untracked files as uncommitted changes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'new-file.ts'), 'export const value = 1;\n');

    const manifest = await scanRepo(config);
    expect(manifest.gitState.uncommittedChanges).toContain('src/new-file.ts');
  });

  it('extracts exports from all files', async () => {
    const manifest = await scanRepo(config);
    const exportNames = manifest.apiSurface.exports.map((e) => e.name);

    // From user-service.ts
    expect(exportNames).toContain('UserInput');
    expect(exportNames).toContain('createUser');
    expect(exportNames).toContain('USER_LIMIT');

    // From router.ts
    expect(exportNames).toContain('ApiResponse');
    expect(exportNames).not.toContain('/api/users');
  });

  it('extracts routes', async () => {
    const manifest = await scanRepo(config);

    expect(manifest.apiSurface.routes.length).toBeGreaterThanOrEqual(2);
    const paths = manifest.apiSurface.routes.map((r) => r.path);
    expect(paths).toContain('/api/users');
  });

  it('extracts types and schemas', async () => {
    const manifest = await scanRepo(config);

    // Types (interfaces + type aliases)
    const typeNames = manifest.typeRegistry.types.map((t) => t.name);
    expect(typeNames).toContain('UserInput');
    expect(typeNames).toContain('ApiResponse');

    // Schemas (zod)
    const schemaNames = manifest.typeRegistry.schemas.map((s) => s.name);
    expect(schemaNames).toContain('userSchema');
  });

  it('extracts external dependencies from package.json', async () => {
    const manifest = await scanRepo(config);

    const depNames = manifest.dependencies.external.map((d) => d.name);
    expect(depNames).toContain('hono');
    expect(depNames).toContain('zod');
    expect(depNames).toContain('vitest');

    const vitest = manifest.dependencies.external.find((d) => d.name === 'vitest');
    expect(vitest?.dev).toBe(true);

    const hono = manifest.dependencies.external.find((d) => d.name === 'hono');
    expect(hono?.dev).toBe(false);
  });

  it('detects conventions', async () => {
    const manifest = await scanRepo(config);

    expect(manifest.conventions.naming).toBeTruthy();
    expect(manifest.conventions.fileOrganization).toBeTruthy();
    expect(manifest.conventions.patterns).toBeInstanceOf(Array);
    expect(typeof manifest.conventions.testingPatterns).toBe('string');
  });

  it('initializes health with defaults', async () => {
    const manifest = await scanRepo(config);

    expect(manifest.health).toBeDefined();
    expect(manifest.health.testCoverage).toBeNull();
    expect(manifest.health.lintErrors).toBe(0);
    expect(manifest.health.typeErrors).toBe(0);
  });

  it('skips node_modules and .git directories', async () => {
    // Create a file inside node_modules that would be picked up otherwise
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'some-pkg', 'index.ts'),
      'export const shouldNotAppear = true;',
    );

    const manifest = await scanRepo(config);
    const allFiles = manifest.apiSurface.exports.map((e) => e.file);
    const hasNodeModules = allFiles.some((f) => f.includes('node_modules'));
    expect(hasNodeModules).toBe(false);
  });

  it('skips test and example files when scanning API surface', async () => {
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'examples'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'tests', 'router.test.ts'),
      `export function testOnly() {}\nconst app = { get: (..._args: unknown[]) => undefined };\napp.get('/api/test-only', () => null);\n`,
    );
    fs.writeFileSync(
      path.join(tmpDir, 'examples', 'demo.ts'),
      `export const exampleOnly = true;\nconst app = { get: (..._args: unknown[]) => undefined };\napp.get('/api/example-only', () => null);\n`,
    );

    const manifest = await scanRepo(config);
    const exportNames = manifest.apiSurface.exports.map((entry) => entry.name);
    const routePaths = manifest.apiSurface.routes.map((entry) => entry.path);

    expect(exportNames).not.toContain('testOnly');
    expect(exportNames).not.toContain('exampleOnly');
    expect(routePaths).not.toContain('/api/test-only');
    expect(routePaths).not.toContain('/api/example-only');
  });

  it('respects .gitignore entries when scanning source files', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'generated/\n');
    fs.mkdirSync(path.join(tmpDir, 'generated'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'generated', 'ignored.ts'),
      'export const ignoredByGitignore = true;\n',
    );

    const manifest = await scanRepo(config);
    const exportNames = manifest.apiSurface.exports.map((entry) => entry.name);

    expect(exportNames).not.toContain('ignoredByGitignore');
  });

  it('respects .claudeignore entries when scanning source files', async () => {
    fs.writeFileSync(path.join(tmpDir, '.claudeignore'), 'private/\n');
    fs.mkdirSync(path.join(tmpDir, 'private'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'private', 'secret.ts'),
      'export const ignoredByClaudeignore = true;\n',
    );

    const manifest = await scanRepo(config);
    const exportNames = manifest.apiSurface.exports.map((entry) => entry.name);

    expect(exportNames).not.toContain('ignoredByClaudeignore');
  });
});

// ─── Incremental Caching Tests ───────────────────────────────────────────────

describe('scanRepo incremental caching', () => {
  let tmpDir: string;
  let config: RepoConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-cache-'));

    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });

    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'service.ts'),
      `export function hello(): string { return 'hello'; }\n`,
    );

    execSync('git add -A', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'ignore' });

    config = { name: 'cache-test-repo', path: tmpDir, language: 'typescript', role: 'backend' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scanRepo works without a cache parameter (no regression)', async () => {
    // Passing no cache should work identically to before
    const manifest = await scanRepo(config);
    expect(manifest.repoId).toBe('cache-test-repo');
    expect(manifest.apiSurface.exports.length).toBeGreaterThan(0);
  });

  it('scanRepo works with an empty cache (cold miss path)', async () => {
    const cache: FileCache = new Map();
    const manifest = await scanRepo(config, cache);
    expect(manifest.repoId).toBe('cache-test-repo');
    // After scan the cache should be populated with at least one entry
    expect(cache.size).toBeGreaterThan(0);
  });

  it('cache entries are keyed by absolute file path and contain sha1 + result', async () => {
    const cache: FileCache = new Map();
    await scanRepo(config, cache);

    const serviceFile = path.join(tmpDir, 'src', 'service.ts');
    expect(cache.has(serviceFile)).toBe(true);

    const entry = cache.get(serviceFile)!;
    expect(typeof entry.sha1).toBe('string');
    expect(entry.sha1).toHaveLength(40); // SHA1 hex
    expect(entry.result).toBeDefined();
    expect(Array.isArray(entry.result.exports)).toBe(true);
  });

  it('uses cached result when SHA1 matches (hit: cached exports survive a content-identical re-scan)', async () => {
    // First scan populates cache
    const cache: FileCache = new Map();
    await scanRepo(config, cache);

    const serviceFile = path.join(tmpDir, 'src', 'service.ts');
    const cachedEntry = cache.get(serviceFile)!;
    // Tamper with the cached result's exports to prove the second scan uses the cache
    cachedEntry.result.exports = [
      { name: '__CACHED__', kind: 'function', signature: '', file: 'service.ts', line: 1 },
    ];
    cache.set(serviceFile, cachedEntry);

    // Second scan: file on disk is unchanged — SHA1 matches — cached result should be used
    const manifest2 = await scanRepo(config, cache);
    const exportNames = manifest2.apiSurface.exports.map((e) => e.name);
    expect(exportNames).toContain('__CACHED__');
  });

  it('re-parses when file content changes (SHA1 mismatch)', async () => {
    const cache: FileCache = new Map();
    await scanRepo(config, cache);

    const serviceFile = path.join(tmpDir, 'src', 'service.ts');
    const originalSha1 = cache.get(serviceFile)!.sha1;

    // Change the file
    fs.writeFileSync(
      serviceFile,
      `export function hello(): string { return 'world'; }\nexport function goodbye(): void {}\n`,
    );

    await scanRepo(config, cache);

    const newSha1 = cache.get(serviceFile)!.sha1;
    expect(newSha1).not.toBe(originalSha1);
  });

  it('stale cache entry with old SHA1 is replaced after re-parse', async () => {
    const cache: FileCache = new Map();
    const serviceFile = path.join(tmpDir, 'src', 'service.ts');
    const content = fs.readFileSync(serviceFile, 'utf-8');
    const realSha1 = crypto.createHash('sha1').update(content).digest('hex');

    // Manually insert a cache entry with a WRONG sha1 (simulates stale cache)
    const staleSha1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    cache.set(serviceFile, {
      sha1: staleSha1,
      result: {
        filePath: serviceFile,
        sha: staleSha1,
        scannedAt: new Date().toISOString(),
        exports: [], // empty — intentionally wrong cached result
        imports: [],
        types: [],
        schemas: [],
        routes: [],
        procedures: [],
      },
    });

    // scanRepo should detect sha1 mismatch, re-parse, and update the cache
    const manifest = await scanRepo(config, cache);

    // After scan: cache should be updated with the real sha1
    expect(cache.get(serviceFile)!.sha1).toBe(realSha1);

    // And the manifest should contain the real exports (not the stale empty ones)
    expect(manifest.apiSurface.exports.length).toBeGreaterThan(0);
  });

  it('cache is shared across multiple scanRepo calls for the same files', async () => {
    const cache: FileCache = new Map();

    // First call populates cache
    await scanRepo(config, cache);
    const sizeAfterFirst = cache.size;

    // Second call: no new files, same SHA1s — cache size stays the same
    await scanRepo(config, cache);
    expect(cache.size).toBe(sizeAfterFirst);
  });
});

describe('scanRepo — manifest cache', () => {
  let tmpDir: string;
  let config: RepoConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-cache-test-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;\n');
    execSync('git add -A', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });
    config = { name: 'cache-repo', path: tmpDir, language: 'typescript', role: 'backend' };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores manifest in cache on first scan and retrieves it on second scan', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-mfcache-'));
    try {
      const cache = new CacheManager(cacheDir);

      const manifest1 = await scanRepo(config, new Map(), cache);
      expect(manifest1.repoId).toBe('cache-repo');

      const manifest2 = await scanRepo(config, new Map(), cache);
      expect(manifest2.repoId).toBe(manifest1.repoId);
      expect(manifest2.gitState.headSha).toBe(manifest1.gitState.headSha);

      const stored = cache.getCachedManifest('cache-repo', manifest1.gitState.headSha);
      expect(stored).not.toBeNull();
      expect(stored!.repoId).toBe('cache-repo');
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('skips cache gracefully when no CacheManager provided (backward compat)', async () => {
    const manifest = await scanRepo(config, new Map());
    expect(manifest.repoId).toBe('cache-repo');
  });

  it('skips cache gracefully when CacheManager is undefined', async () => {
    const manifest = await scanRepo(config, new Map(), undefined);
    expect(manifest.repoId).toBe('cache-repo');
  });
});
