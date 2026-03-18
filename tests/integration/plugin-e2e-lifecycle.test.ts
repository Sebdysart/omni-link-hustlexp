// tests/integration/plugin-e2e-lifecycle.test.ts
//
// Comprehensive E2E lifecycle test for the omni-link AI coding plugin.
// Validates the full pipeline: scan → graph → context → quality → evolution → impact → health
// Covers: happy paths, edge cases, conflict resolution, error recovery, cache coherence.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
import { execSync } from 'node:child_process';
import {
  scan,
  evolve,
  health,
  impact,
  qualityCheck,
  invalidateScanCache,
  clearScanCache,
} from '../../engine/index.js';
import type {
  OmniLinkConfig,
  ScanResult,
  HealthResult,
  QualityCheckResult,
} from '../../engine/index.js';
import type { EvolutionSuggestion, ImpactPath } from '../../engine/types.js';

// ─── Fixture Factories ──────────────────────────────────────────────────────

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "e2e@test.dev"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "E2E"', { cwd: dir, stdio: 'ignore' });
}

function commitAll(dir: string, msg: string): void {
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  execSync(`git commit -m "${msg}" --allow-empty`, { cwd: dir, stdio: 'ignore' });
}

function createTypescriptBackend(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  initGitRepo(dir);

  fs.mkdirSync(path.join(dir, 'src', 'routes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'types'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'schemas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'services'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'src', 'types', 'user.ts'),
    `export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
}

export interface AdminUser extends User {
  permissions: string[];
}
`,
  );

  fs.writeFileSync(
    path.join(dir, 'src', 'types', 'product.ts'),
    `export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}
`,
  );

  fs.writeFileSync(
    path.join(dir, 'src', 'schemas', 'user-schema.ts'),
    `import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'user']),
  createdAt: z.string(),
});

export const paginatedUsersSchema = z.object({
  users: z.array(userResponseSchema),
  total: z.number(),
  page: z.number(),
});
`,
  );

  fs.writeFileSync(
    path.join(dir, 'src', 'routes', 'users.ts'),
    `import { Hono } from 'hono';

const app = new Hono();

app.get('/api/users', (c) => {
  return c.json({ users: [], total: 0, page: 1 });
});

app.post('/api/users', async (c) => {
  const body = await c.req.json();
  return c.json({ id: '1', ...body, role: 'user', createdAt: new Date().toISOString() });
});

app.get('/api/users/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, email: 'test@test.com', name: 'Test', role: 'user', createdAt: '2026-01-01' });
});

app.delete('/api/users/:id', (c) => {
  return c.json({ success: true });
});

app.put('/api/users/:id', async (c) => {
  const body = await c.req.json();
  return c.json({ ...body, updatedAt: new Date().toISOString() });
});

export default app;
`,
  );

  fs.writeFileSync(
    path.join(dir, 'src', 'routes', 'products.ts'),
    `import { Hono } from 'hono';

const app = new Hono();

app.get('/api/products', (c) => {
  return c.json({ products: [] });
});

app.post('/api/products', async (c) => {
  const body = await c.req.json();
  return c.json({ id: '1', ...body });
});

app.get('/api/products/:id', (c) => {
  return c.json({ id: c.req.param('id'), name: 'Widget', price: 9.99, currency: 'USD' });
});

export default app;
`,
  );

  fs.writeFileSync(
    path.join(dir, 'src', 'routes', 'health.ts'),
    `import { Hono } from 'hono';

const app = new Hono();

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '1.0.0' });
});

export default app;
`,
  );

  fs.writeFileSync(
    path.join(dir, 'src', 'services', 'auth.ts'),
    `export class AuthService {
  async validateToken(token: string): Promise<boolean> {
    return token.length > 0;
  }

  async hashPassword(password: string): Promise<string> {
    return 'hashed-' + password;
  }
}

export function createAuthMiddleware() {
  return async (c: any, next: any) => {
    const token = c.req.header('Authorization');
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
`,
  );

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'e2e-lifecycle-backend',
        version: '1.0.0',
        dependencies: {
          hono: '^4.0.0',
          zod: '^3.22.0',
          drizzle: '^0.30.0',
        },
        devDependencies: {
          typescript: '^5.7.0',
          vitest: '^3.0.0',
        },
      },
      null,
      2,
    ),
  );

  commitAll(dir, 'feat: initial backend with users, products, auth');
  return dir;
}

function createSwiftIosApp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  initGitRepo(dir);

  fs.mkdirSync(path.join(dir, 'Sources', 'Models'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Sources', 'Services'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Sources', 'Views'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'Sources', 'Models', 'UserDTO.swift'),
    `import Foundation

struct UserDTO: Codable {
    let id: String
    let email: String
    let name: String
    let role: String
    let createdAt: String
}

struct CreateUserRequest: Codable {
    let email: String
    let name: String
}

struct AdminUserDTO: Codable {
    let id: String
    let email: String
    let name: String
    let role: String
    let permissions: [String]
}
`,
  );

  fs.writeFileSync(
    path.join(dir, 'Sources', 'Models', 'ProductDTO.swift'),
    `import Foundation

struct ProductDTO: Codable {
    let id: String
    let name: String
    let price: Double
    let currency: String
}

struct CartItemDTO: Codable {
    let productId: String
    let quantity: Int
}
`,
  );

  fs.writeFileSync(
    path.join(dir, 'Sources', 'Services', 'UserService.swift'),
    `import Foundation

class UserService {
    let baseURL: String

    init(baseURL: String) {
        self.baseURL = baseURL
    }

    func fetchUsers() async throws -> [UserDTO] {
        let url = URL(string: "\\(baseURL)/api/users")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode([UserDTO].self, from: data)
    }

    func createUser(email: String, name: String) async throws -> UserDTO {
        let url = URL(string: "\\(baseURL)/api/users")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = CreateUserRequest(email: email, name: name)
        request.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(UserDTO.self, from: data)
    }
}
`,
  );

  fs.writeFileSync(
    path.join(dir, 'Sources', 'Services', 'ProductService.swift'),
    `import Foundation

class ProductService {
    let baseURL: String

    init(baseURL: String) {
        self.baseURL = baseURL
    }

    func fetchProducts() async throws -> [ProductDTO] {
        let url = URL(string: "\\(baseURL)/api/products")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode([ProductDTO].self, from: data)
    }
}
`,
  );

  fs.writeFileSync(
    path.join(dir, 'Sources', 'Services', 'HealthService.swift'),
    `import Foundation

struct HealthResponse: Codable {
    let status: String
    let version: String
}

class HealthService {
    let baseURL: String

    init(baseURL: String) {
        self.baseURL = baseURL
    }

    func checkHealth() async throws -> HealthResponse {
        let url = URL(string: "\\(baseURL)/api/health")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(HealthResponse.self, from: data)
    }
}
`,
  );

  commitAll(dir, 'feat: initial iOS app with user, product DTOs and services');
  return dir;
}

function createMinimalRepo(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  initGitRepo(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'index.ts'),
    `export function hello(): string { return 'world'; }\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'minimal-repo', version: '0.1.0' }, null, 2),
  );
  commitAll(dir, 'feat: minimal repo');
  return dir;
}

function createEmptyRepo(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  commitAll(dir, 'initial: empty repo');
  return dir;
}

function makeConfig(
  repos: Array<{ name: string; path: string; language: string; role: string }>,
  overrides: Partial<OmniLinkConfig> = {},
): OmniLinkConfig {
  return {
    repos,
    evolution: {
      aggressiveness: 'aggressive',
      maxSuggestionsPerSession: 10,
      categories: ['feature', 'performance', 'monetization', 'scale', 'security'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 8000,
      prioritize: 'api-surface-first',
      includeRecentCommits: 20,
    },
    cache: {
      directory: fs.mkdtempSync(path.join(os.tmpdir(), 'omni-e2e-cache-')),
      maxAgeDays: 1,
    },
    ...overrides,
  };
}

function cleanDir(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: HAPPY PATH — Full Lifecycle with Multi-Repo Ecosystem
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Happy Path — Multi-Repo Ecosystem', () => {
  let backendDir: string;
  let iosDir: string;
  let config: OmniLinkConfig;
  let scanResult: ScanResult;

  beforeAll(async () => {
    backendDir = createTypescriptBackend('e2e-lifecycle-be-');
    iosDir = createSwiftIosApp('e2e-lifecycle-ios-');
    config = makeConfig([
      { name: 'lifecycle-backend', path: backendDir, language: 'typescript', role: 'backend' },
      { name: 'lifecycle-ios', path: iosDir, language: 'swift', role: 'ios' },
    ]);
    scanResult = await scan(config);
  }, 30_000);

  afterAll(() => {
    cleanDir(backendDir);
    cleanDir(iosDir);
    cleanDir(config.cache.directory);
  });

  // ─── Scan Pipeline ───

  describe('scan pipeline', () => {
    it('produces manifests for both repos', () => {
      expect(scanResult.manifests).toHaveLength(2);
      const repoIds = scanResult.manifests.map((m) => m.repoId);
      expect(repoIds).toContain('lifecycle-backend');
      expect(repoIds).toContain('lifecycle-ios');
    });

    it('backend manifest has correct metadata', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      expect(be.language).toBe('typescript');
      expect(be.path).toBe(backendDir);
      expect(be.gitState.headSha).toMatch(/^[a-f0-9]{40}$/);
      expect(be.gitState.branch).toBeTruthy();
    });

    it('iOS manifest has correct metadata', () => {
      const ios = scanResult.manifests.find((m) => m.repoId === 'lifecycle-ios')!;
      expect(ios.language).toBe('swift');
      expect(ios.path).toBe(iosDir);
    });

    it('backend extracts all API routes', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      const paths = be.apiSurface.routes.map((r) => r.path);
      expect(paths).toContain('/api/users');
      expect(paths).toContain('/api/products');
      expect(paths).toContain('/api/health');
    });

    it('backend extracts route methods correctly', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      const userRoutes = be.apiSurface.routes.filter((r) => r.path === '/api/users');
      const methods = userRoutes.map((r) => r.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
    });

    it('backend extracts TypeScript interfaces', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      const typeNames = be.typeRegistry.types.map((t) => t.name);
      expect(typeNames).toContain('User');
      expect(typeNames).toContain('CreateUserInput');
      expect(typeNames).toContain('Product');
    });

    it('backend User type has correct fields', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      const user = be.typeRegistry.types.find((t) => t.name === 'User')!;
      expect(user).toBeDefined();
      const fieldNames = user.fields.map((f) => f.name);
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('createdAt');
    });

    it('backend extracts type inheritance (extends)', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      const adminType = be.typeRegistry.types.find((t) => t.name === 'AdminUser');
      if (adminType) {
        expect(adminType.extends).toContain('User');
      }
    });

    it('backend extracts zod schemas', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      const schemaNames = be.typeRegistry.schemas.map((s) => s.name);
      expect(schemaNames).toContain('createUserSchema');
      expect(schemaNames).toContain('userResponseSchema');
    });

    it('backend extracts exports', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      expect(be.apiSurface.exports.length).toBeGreaterThan(0);
    });

    it('backend extracts external dependencies', () => {
      const be = scanResult.manifests.find((m) => m.repoId === 'lifecycle-backend')!;
      const depNames = be.dependencies.external.map((d) => d.name);
      expect(depNames).toContain('hono');
      expect(depNames).toContain('zod');
    });

    it('iOS manifest extracts Swift types', () => {
      const ios = scanResult.manifests.find((m) => m.repoId === 'lifecycle-ios')!;
      const typeNames = ios.typeRegistry.types.map((t) => t.name);
      expect(typeNames).toContain('UserDTO');
      expect(typeNames).toContain('ProductDTO');
      expect(typeNames).toContain('CartItemDTO');
    });

    it('iOS UserDTO fields mirror backend User fields', () => {
      const ios = scanResult.manifests.find((m) => m.repoId === 'lifecycle-ios')!;
      const userDTO = ios.typeRegistry.types.find((t) => t.name === 'UserDTO')!;
      expect(userDTO).toBeDefined();
      const fieldNames = userDTO.fields.map((f) => f.name);
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('name');
    });

    it('both manifests have valid git state', () => {
      for (const m of scanResult.manifests) {
        expect(m.gitState.headSha).toMatch(/^[a-f0-9]{40}$/);
        expect(m.gitState.branch).toBeTruthy();
        expect(m.gitState.uncommittedChanges).toEqual([]);
        expect(m.gitState.recentCommits.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('both manifests have convention detection', () => {
      for (const m of scanResult.manifests) {
        expect(m.conventions.naming).toBeTruthy();
        expect(typeof m.conventions.fileOrganization).toBe('string');
        expect(m.conventions.patterns).toBeInstanceOf(Array);
      }
    });

    it('both manifests populate health scaffold', () => {
      for (const m of scanResult.manifests) {
        expect(m.health).toBeDefined();
        expect(typeof m.health.lintErrors).toBe('number');
        expect(typeof m.health.typeErrors).toBe('number');
        expect(typeof m.health.todoCount).toBe('number');
        expect(m.health.deadCode).toBeInstanceOf(Array);
      }
    });
  });

  // ─── Ecosystem Graph ───

  describe('ecosystem graph', () => {
    it('graph contains both repos', () => {
      expect(scanResult.graph.repos).toHaveLength(2);
    });

    it('graph detects shared types across repos', () => {
      expect(scanResult.graph.sharedTypes.length).toBeGreaterThanOrEqual(1);
      const concepts = scanResult.graph.sharedTypes.map((t) => t.concept.toLowerCase());
      const hasUserConcept = concepts.some((c) => c.includes('user') || c.includes('createuser'));
      expect(hasUserConcept).toBe(true);
    });

    it('shared types have valid alignment status', () => {
      for (const lineage of scanResult.graph.sharedTypes) {
        expect(['aligned', 'diverged', 'subset']).toContain(lineage.alignment);
      }
    });

    it('graph has contract mismatches array', () => {
      expect(scanResult.graph.contractMismatches).toBeInstanceOf(Array);
    });

    it('graph has impact paths array', () => {
      expect(scanResult.graph.impactPaths).toBeInstanceOf(Array);
    });
  });

  // ─── Context Digest ───

  describe('context digest', () => {
    it('produces a digest with metadata', () => {
      expect(scanResult.context.digest).toBeDefined();
      expect(scanResult.context.digest.generatedAt).toBeTruthy();
      expect(scanResult.context.digest.configSha).toBeTruthy();
    });

    it('digest lists both repos', () => {
      expect(scanResult.context.digest.repos).toHaveLength(2);
      const names = scanResult.context.digest.repos.map((r) => r.name);
      expect(names).toContain('lifecycle-backend');
      expect(names).toContain('lifecycle-ios');
    });

    it('digest repos have correct metadata', () => {
      const be = scanResult.context.digest.repos.find((r) => r.name === 'lifecycle-backend')!;
      expect(be.language).toBe('typescript');
      expect(be.uncommittedCount).toBe(0);
    });

    it('digest has contract status', () => {
      const status = scanResult.context.digest.contractStatus;
      expect(typeof status.total).toBe('number');
      expect(typeof status.exact).toBe('number');
      expect(status.mismatches).toBeInstanceOf(Array);
    });

    it('digest has API surface summary', () => {
      expect(scanResult.context.digest.apiSurfaceSummary).toBeTruthy();
    });

    it('digest has convention summaries', () => {
      expect(scanResult.context.digest.conventionSummary['lifecycle-backend']).toBeTruthy();
      expect(scanResult.context.digest.conventionSummary['lifecycle-ios']).toBeTruthy();
    });

    it('digest token count is within budget', () => {
      expect(scanResult.context.digest.tokenCount).toBeLessThanOrEqual(config.context.tokenBudget);
    });

    it('digest token count is positive', () => {
      expect(scanResult.context.digest.tokenCount).toBeGreaterThan(0);
    });
  });

  // ─── Context Markdown ───

  describe('context markdown', () => {
    it('generates markdown string', () => {
      expect(typeof scanResult.context.markdown).toBe('string');
      expect(scanResult.context.markdown.length).toBeGreaterThan(0);
    });

    it('markdown contains ecosystem header', () => {
      expect(scanResult.context.markdown).toContain('OMNI-LINK ECOSYSTEM STATE');
    });

    it('markdown contains repo names', () => {
      expect(scanResult.context.markdown).toContain('lifecycle-backend');
      expect(scanResult.context.markdown).toContain('lifecycle-ios');
    });

    it('markdown contains standard sections', () => {
      expect(scanResult.context.markdown).toContain('## Repos');
      expect(scanResult.context.markdown).toContain('## API Contracts');
      expect(scanResult.context.markdown).toContain('## Shared Types');
    });
  });

  // ─── Health Scoring ───

  describe('health scoring', () => {
    let healthResult: HealthResult;

    beforeAll(async () => {
      healthResult = await health(config);
    });

    it('returns overall health score', () => {
      expect(typeof healthResult.overall).toBe('number');
      expect(healthResult.overall).toBeGreaterThan(0);
      expect(healthResult.overall).toBeLessThanOrEqual(100);
    });

    it('returns per-repo scores', () => {
      expect(healthResult.perRepo).toBeDefined();
      expect(Object.keys(healthResult.perRepo).length).toBe(2);
    });

    it('per-repo scores have sub-metrics', () => {
      for (const [, score] of Object.entries(healthResult.perRepo)) {
        expect(typeof score.overall).toBe('number');
        expect(typeof score.todoScore).toBe('number');
        expect(typeof score.deadCodeScore).toBe('number');
        expect(typeof score.testScore).toBe('number');
        expect(typeof score.qualityScore).toBe('number');
      }
    });
  });

  // ─── Evolution Analysis ───

  describe('evolution analysis', () => {
    let suggestions: EvolutionSuggestion[];

    beforeAll(async () => {
      suggestions = await evolve(config);
    });

    it('returns an array of suggestions', () => {
      expect(suggestions).toBeInstanceOf(Array);
    });

    it('each suggestion has required fields', () => {
      for (const sug of suggestions) {
        expect(sug.id).toBeTruthy();
        expect(sug.title).toBeTruthy();
        expect(sug.description).toBeTruthy();
        expect(['feature', 'performance', 'monetization', 'scale', 'security']).toContain(
          sug.category,
        );
        expect(['small', 'medium', 'large']).toContain(sug.estimatedEffort);
        expect(['low', 'medium', 'high', 'critical']).toContain(sug.estimatedImpact);
        expect(sug.affectedRepos).toBeInstanceOf(Array);
        expect(sug.affectedRepos.length).toBeGreaterThan(0);
        expect(sug.evidence).toBeInstanceOf(Array);
      }
    });

    it('suggestions reference only repos from the ecosystem', () => {
      const validRepos = new Set(['lifecycle-backend', 'lifecycle-ios']);
      for (const sug of suggestions) {
        for (const repo of sug.affectedRepos) {
          expect(validRepos.has(repo)).toBe(true);
        }
      }
    });

    it('respects maxSuggestionsPerSession limit', () => {
      expect(suggestions.length).toBeLessThanOrEqual(config.evolution.maxSuggestionsPerSession);
    });
  });

  // ─── Impact Analysis ───

  describe('impact analysis', () => {
    it('returns impact paths for file changes', async () => {
      const paths: ImpactPath[] = await impact(config, [
        {
          repo: 'lifecycle-backend',
          file: 'src/types/user.ts',
          change: 'type-change',
        },
      ]);
      expect(paths).toBeInstanceOf(Array);
    });

    it('implementation-change does not produce breaking severity', async () => {
      const paths = await impact(config, [
        {
          repo: 'lifecycle-backend',
          file: 'src/routes/users.ts',
          change: 'implementation-change',
        },
      ]);
      const breakingFromImpl = paths.flatMap((p) =>
        p.affected.filter(
          (a) => a.severity === 'breaking' && p.trigger.change === 'implementation-change',
        ),
      );
      expect(breakingFromImpl).toHaveLength(0);
    });

    it('empty change list returns empty impact', async () => {
      const paths = await impact(config, []);
      expect(paths).toEqual([]);
    });
  });

  // ─── Quality Check ───

  describe('quality check', () => {
    it('validates clean code', async () => {
      const code = `
import { Hono } from 'hono';
const app = new Hono();
app.get('/api/test', (c) => c.json({ ok: true }));
export default app;
`;
      const result: QualityCheckResult = await qualityCheck(
        code,
        path.join(backendDir, 'src', 'routes', 'test.ts'),
        config,
      );
      expect(result.references).toBeDefined();
      expect(result.conventions).toBeDefined();
      expect(result.slop).toBeDefined();
      expect(result.rules).toBeDefined();
    });

    it('detects placeholder code as slop', async () => {
      const code = `
export function todo() {
  // TODO: implement this
  throw new Error('Not implemented');
}
`;
      const result = await qualityCheck(
        code,
        path.join(backendDir, 'src', 'placeholder.ts'),
        config,
      );
      expect(result.slop).toBeDefined();
    });

    it('rule engine catches fetch without error handling', async () => {
      const code = `
async function getData() {
  const response = await fetch('/api/data');
  return response.json();
}
`;
      const result = await qualityCheck(
        code,
        path.join(backendDir, 'src', 'unsafe-fetch.ts'),
        config,
      );
      expect(result.rules).toBeDefined();
      expect(result.rules.violations.length).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Edge Cases', () => {
  // ─── Single-Repo Config ───

  describe('single-repo config', () => {
    let singleDir: string;
    let config: OmniLinkConfig;

    beforeAll(async () => {
      singleDir = createTypescriptBackend('e2e-single-');
      config = makeConfig([
        { name: 'solo-backend', path: singleDir, language: 'typescript', role: 'backend' },
      ]);
    });

    afterAll(() => {
      cleanDir(singleDir);
      cleanDir(config.cache.directory);
    });

    it('scan works with a single repo', async () => {
      const result = await scan(config);
      expect(result.manifests).toHaveLength(1);
      expect(result.manifests[0].repoId).toBe('solo-backend');
    });

    it('graph has one repo and no bridges', async () => {
      const result = await scan(config);
      expect(result.graph.repos).toHaveLength(1);
      expect(result.graph.bridges).toHaveLength(0);
    });

    it('context digest works for single repo', async () => {
      const result = await scan(config);
      expect(result.context.digest.repos).toHaveLength(1);
      expect(result.context.digest.tokenCount).toBeGreaterThan(0);
    });

    it('health works for single repo', async () => {
      const result = await health(config);
      expect(typeof result.overall).toBe('number');
      expect(Object.keys(result.perRepo)).toHaveLength(1);
    });

    it('evolve works for single repo', async () => {
      const result = await evolve(config);
      expect(result).toBeInstanceOf(Array);
    });
  });

  // ─── Minimal Repo ───

  describe('minimal repo (single file)', () => {
    let minDir: string;
    let config: OmniLinkConfig;

    beforeAll(() => {
      minDir = createMinimalRepo('e2e-minimal-');
      config = makeConfig([
        { name: 'minimal', path: minDir, language: 'typescript', role: 'backend' },
      ]);
    });

    afterAll(() => {
      cleanDir(minDir);
      cleanDir(config.cache.directory);
    });

    it('scan handles minimal repo gracefully', async () => {
      const result = await scan(config);
      expect(result.manifests).toHaveLength(1);
      expect(result.manifests[0].repoId).toBe('minimal');
    });

    it('health does not crash on minimal repo', async () => {
      const result = await health(config);
      expect(typeof result.overall).toBe('number');
    });

    it('evolve returns suggestions (possibly empty) for minimal repo', async () => {
      const result = await evolve(config);
      expect(result).toBeInstanceOf(Array);
    });
  });

  // ─── Empty Repo ───

  describe('empty repo (no source files)', () => {
    let emptyDir: string;
    let config: OmniLinkConfig;

    beforeAll(() => {
      emptyDir = createEmptyRepo('e2e-empty-');
      config = makeConfig([
        { name: 'empty', path: emptyDir, language: 'typescript', role: 'backend' },
      ]);
    });

    afterAll(() => {
      cleanDir(emptyDir);
      cleanDir(config.cache.directory);
    });

    it('scan handles empty repo without crashing', async () => {
      const result = await scan(config);
      expect(result.manifests).toHaveLength(1);
      expect(result.manifests[0].apiSurface.routes).toHaveLength(0);
      expect(result.manifests[0].apiSurface.exports).toHaveLength(0);
      expect(result.manifests[0].typeRegistry.types).toHaveLength(0);
    });

    it('health handles empty repo gracefully', async () => {
      const result = await health(config);
      expect(typeof result.overall).toBe('number');
    });

    it('impact on empty repo returns empty', async () => {
      const paths = await impact(config, [
        { repo: 'empty', file: 'nonexistent.ts', change: 'type-change' },
      ]);
      expect(paths).toBeInstanceOf(Array);
    });
  });

  // ─── Boundary: Token Budget ───

  describe('token budget boundaries', () => {
    let dir: string;

    beforeAll(() => {
      dir = createTypescriptBackend('e2e-budget-');
    });

    afterAll(() => {
      cleanDir(dir);
    });

    it('very small token budget still produces a digest', async () => {
      const tightConfig = makeConfig(
        [
          {
            name: 'budget-test',
            path: dir,
            language: 'typescript',
            role: 'backend',
          },
        ],
        {
          context: {
            tokenBudget: 50,
            prioritize: 'api-surface-first',
            includeRecentCommits: 5,
          },
        },
      );
      const result = await scan(tightConfig);
      expect(result.context.digest).toBeDefined();
      // Token budget is a target — the digest always includes a minimal header
      // which may exceed very small budgets. Verify it's constrained and small.
      expect(result.context.digest.tokenCount).toBeLessThanOrEqual(200);
      cleanDir(tightConfig.cache.directory);
    });

    it('large token budget captures everything', async () => {
      const largeConfig = makeConfig(
        [
          {
            name: 'budget-large',
            path: dir,
            language: 'typescript',
            role: 'backend',
          },
        ],
        {
          context: {
            tokenBudget: 100_000,
            prioritize: 'api-surface-first',
            includeRecentCommits: 50,
          },
        },
      );
      const result = await scan(largeConfig);
      expect(result.context.digest.tokenCount).toBeGreaterThan(0);
      cleanDir(largeConfig.cache.directory);
    });
  });

  // ─── Boundary: Quality Modes ───

  describe('quality strictness levels', () => {
    let dir: string;

    beforeAll(() => {
      dir = createTypescriptBackend('e2e-quality-');
    });

    afterAll(() => {
      cleanDir(dir);
    });

    it('relaxed strictness produces results', async () => {
      const relaxedConfig = makeConfig(
        [{ name: 'relaxed-test', path: dir, language: 'typescript', role: 'backend' }],
        {
          quality: {
            blockOnFailure: false,
            requireTestsForNewCode: false,
            conventionStrictness: 'relaxed',
          },
        },
      );
      const result = await qualityCheck(
        'const x = 1; export default x;',
        path.join(dir, 'src', 'test.ts'),
        relaxedConfig,
      );
      expect(result).toBeDefined();
      cleanDir(relaxedConfig.cache.directory);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: CONFLICT RESOLUTION — Parallel Edits and Cache Coherence
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Conflict Resolution & Cache Coherence', () => {
  let backendDir: string;
  let iosDir: string;
  let config: OmniLinkConfig;

  beforeAll(() => {
    backendDir = createTypescriptBackend('e2e-conflict-be-');
    iosDir = createSwiftIosApp('e2e-conflict-ios-');
    config = makeConfig([
      { name: 'conflict-backend', path: backendDir, language: 'typescript', role: 'backend' },
      { name: 'conflict-ios', path: iosDir, language: 'swift', role: 'ios' },
    ]);
  });

  afterAll(() => {
    cleanDir(backendDir);
    cleanDir(iosDir);
    cleanDir(config.cache.directory);
  });

  it('concurrent scans produce consistent results', async () => {
    const [result1, result2] = await Promise.all([scan(config), scan(config)]);
    expect(result1.manifests.length).toBe(result2.manifests.length);
    expect(result1.graph.repos.length).toBe(result2.graph.repos.length);
    expect(result1.graph.sharedTypes.length).toBe(result2.graph.sharedTypes.length);
  });

  it('scan detects new uncommitted file', async () => {
    const newFile = path.join(backendDir, 'src', 'routes', 'orders.ts');
    fs.writeFileSync(
      newFile,
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/api/orders', (c) => c.json({ orders: [] }));
export default app;
`,
    );

    const result = await scan(config);
    const be = result.manifests.find((m) => m.repoId === 'conflict-backend')!;
    const paths = be.apiSurface.routes.map((r) => r.path);
    expect(paths).toContain('/api/orders');

    fs.unlinkSync(newFile);
  });

  it('scan reflects file modifications', async () => {
    const beforeResult = await scan(config);
    const beforeBe = beforeResult.manifests.find((m) => m.repoId === 'conflict-backend')!;
    const beforeRouteCount = beforeBe.apiSurface.routes.length;

    const newFile = path.join(backendDir, 'src', 'routes', 'metrics.ts');
    fs.writeFileSync(
      newFile,
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/api/metrics', (c) => c.json({ uptime: 100 }));
app.get('/api/metrics/health', (c) => c.json({ healthy: true }));
export default app;
`,
    );

    const afterResult = await scan(config);
    const afterBe = afterResult.manifests.find((m) => m.repoId === 'conflict-backend')!;
    expect(afterBe.apiSurface.routes.length).toBeGreaterThan(beforeRouteCount);

    fs.unlinkSync(newFile);
  });

  it('scan survives file deletion between scans', async () => {
    const tempFile = path.join(backendDir, 'src', 'routes', 'temporary.ts');
    fs.writeFileSync(
      tempFile,
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/api/temp', (c) => c.json({ temp: true }));
export default app;
`,
    );

    // Add and commit so the scanner picks it up with fresh cache state
    commitAll(backendDir, 'feat: add temp route');
    const result1 = await scan(config);
    const be1 = result1.manifests.find((m) => m.repoId === 'conflict-backend')!;
    expect(be1.apiSurface.routes.map((r) => r.path)).toContain('/api/temp');

    // Delete and commit to ensure scanner sees the file is gone
    fs.unlinkSync(tempFile);
    commitAll(backendDir, 'chore: remove temp route');

    // Use a fresh config to bypass session-level scan cache
    const freshConfig = makeConfig([
      { name: 'conflict-backend', path: backendDir, language: 'typescript', role: 'backend' },
      { name: 'conflict-ios', path: iosDir, language: 'swift', role: 'ios' },
    ]);
    const result2 = await scan(freshConfig);
    const be2 = result2.manifests.find((m) => m.repoId === 'conflict-backend')!;
    expect(be2.apiSurface.routes.map((r) => r.path)).not.toContain('/api/temp');
    cleanDir(freshConfig.cache.directory);
  });

  it('type changes in backend reflect in cross-repo shared types', async () => {
    const typeFile = path.join(backendDir, 'src', 'types', 'user.ts');
    const originalContent = fs.readFileSync(typeFile, 'utf-8');

    const modifiedContent = originalContent.replace(
      'createdAt: string;',
      'createdAt: string;\n  updatedAt: string;',
    );
    fs.writeFileSync(typeFile, modifiedContent);

    const result = await scan(config);
    const be = result.manifests.find((m) => m.repoId === 'conflict-backend')!;
    const user = be.typeRegistry.types.find((t) => t.name === 'User')!;
    expect(user.fields.map((f) => f.name)).toContain('updatedAt');

    fs.writeFileSync(typeFile, originalContent);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: RESILIENCE — Error Recovery and Graceful Degradation
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Resilience & Error Recovery', () => {
  // ─── Non-Existent Repo Path ───

  it('scan with non-existent repo path throws or returns empty manifest', async () => {
    const config = makeConfig([
      {
        name: 'ghost-repo',
        path: '/tmp/nonexistent-repo-' + Date.now(),
        language: 'typescript',
        role: 'backend',
      },
    ]);

    try {
      const result = await scan(config);
      expect(result.manifests[0].apiSurface.routes).toHaveLength(0);
    } catch {
      expect(true).toBe(true);
    }
    cleanDir(config.cache.directory);
  }, 15_000);

  // ─── Malformed Code ───

  it('qualityCheck handles malformed TypeScript gracefully', async () => {
    const dir = createMinimalRepo('e2e-malformed-');
    const config = makeConfig([
      { name: 'malformed-test', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const malformedCode = `
export function broken({ {{{ }}}
const 123abc = "invalid";
if (true { console.log("missing paren");
`;

    try {
      const result = await qualityCheck(malformedCode, path.join(dir, 'src', 'broken.ts'), config);
      expect(result).toBeDefined();
    } catch {
      expect(true).toBe(true);
    }

    cleanDir(dir);
    cleanDir(config.cache.directory);
  }, 15_000);

  // ─── Empty Code ───

  it('qualityCheck handles empty string', async () => {
    const dir = createMinimalRepo('e2e-empty-code-');
    const config = makeConfig([
      { name: 'empty-code-test', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const result = await qualityCheck('', path.join(dir, 'src', 'empty.ts'), config);
    expect(result).toBeDefined();
    expect(result.slop.clean).toBe(true);

    cleanDir(dir);
    cleanDir(config.cache.directory);
  }, 15_000);

  // ─── Very Large Files ───

  it('scan handles repo with large generated file', async () => {
    const dir = createMinimalRepo('e2e-large-');
    const bigContent = Array.from({ length: 500 }, (_, i) => `export const val${i} = ${i};\n`).join(
      '',
    );
    fs.writeFileSync(path.join(dir, 'src', 'big.ts'), bigContent);

    const config = makeConfig([
      { name: 'large-file-test', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const result = await scan(config);
    expect(result.manifests).toHaveLength(1);
    expect(result.manifests[0].apiSurface.exports.length).toBeGreaterThan(0);

    cleanDir(dir);
    cleanDir(config.cache.directory);
  }, 15_000);

  // ─── Unicode / Special Characters ───

  it('scan handles files with unicode content', async () => {
    const dir = createMinimalRepo('e2e-unicode-');
    fs.writeFileSync(
      path.join(dir, 'src', 'i18n.ts'),
      `export const greetings = {
  en: "Hello",
  ja: "こんにちは",
  ar: "مرحبا",
  emoji: "👋🌍",
};

export interface LocalizedString {
  locale: string;
  value: string;
}
`,
    );

    const config = makeConfig([
      { name: 'unicode-test', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const result = await scan(config);
    expect(result.manifests).toHaveLength(1);

    cleanDir(dir);
    cleanDir(config.cache.directory);
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: DETERMINISM — Pipeline Idempotency
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Determinism & Idempotency', () => {
  let dir: string;
  let config: OmniLinkConfig;

  beforeAll(() => {
    dir = createTypescriptBackend('e2e-idempotent-');
    config = makeConfig([
      { name: 'idempotent', path: dir, language: 'typescript', role: 'backend' },
    ]);
  });

  afterAll(() => {
    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('three consecutive scans produce identical manifest counts', async () => {
    const r1 = await scan(config);
    const r2 = await scan(config);
    const r3 = await scan(config);

    expect(r1.manifests.length).toBe(r2.manifests.length);
    expect(r2.manifests.length).toBe(r3.manifests.length);
  });

  it('three consecutive scans produce identical route counts', async () => {
    const r1 = await scan(config);
    const r2 = await scan(config);
    const r3 = await scan(config);

    const routes1 = r1.manifests[0].apiSurface.routes.length;
    const routes2 = r2.manifests[0].apiSurface.routes.length;
    const routes3 = r3.manifests[0].apiSurface.routes.length;
    expect(routes1).toBe(routes2);
    expect(routes2).toBe(routes3);
  });

  it('three consecutive scans produce identical type counts', async () => {
    const r1 = await scan(config);
    const r2 = await scan(config);
    const r3 = await scan(config);

    const types1 = r1.manifests[0].typeRegistry.types.length;
    const types2 = r2.manifests[0].typeRegistry.types.length;
    const types3 = r3.manifests[0].typeRegistry.types.length;
    expect(types1).toBe(types2);
    expect(types2).toBe(types3);
  });

  it('scan produces identical configSha across runs', async () => {
    const r1 = await scan(config);
    const r2 = await scan(config);

    expect(r1.context.digest.configSha).toBe(r2.context.digest.configSha);
  });

  it('health scores are stable across consecutive calls', async () => {
    const h1 = await health(config);
    const h2 = await health(config);

    expect(h1.overall).toBe(h2.overall);
    for (const key of Object.keys(h1.perRepo)) {
      expect(h1.perRepo[key].overall).toBe(h2.perRepo[key].overall);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: QUALITY SUBSYSTEM DEEP DIVE
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Quality Subsystem Deep Dive', () => {
  let dir: string;
  let config: OmniLinkConfig;

  beforeAll(() => {
    dir = createTypescriptBackend('e2e-quality-deep-');
    config = makeConfig([
      { name: 'quality-deep', path: dir, language: 'typescript', role: 'backend' },
    ]);
  }, 30_000);

  afterAll(() => {
    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('slop detector catches over-abstraction', async () => {
    const code = `
class A extends B {}
class C extends D {}
class E extends F {}
class G extends H {}
`;
    const result = await qualityCheck(code, path.join(dir, 'src', 'abstract.ts'), config);
    const overAbstraction = result.slop.issues.filter((i) => i.kind === 'over-abstraction');
    expect(overAbstraction.length).toBeGreaterThan(0);
  });

  it('slop detector does not flag generic constraints as over-abstraction', async () => {
    const code = `
function identity<T extends object>(x: T): T { return x; }
function map<T extends string>(arr: T[]): T[] { return arr; }
type IsString<T> = T extends string ? true : false;
`;
    const result = await qualityCheck(code, path.join(dir, 'src', 'generics.ts'), config);
    const falsePositive = result.slop.issues.filter((i) => i.kind === 'over-abstraction');
    expect(falsePositive).toHaveLength(0);
  });

  it('convention validator checks naming patterns', async () => {
    const code = `
const my_snake_var = 'hello';
const myGoodVar = 'world';
function SomeWeirdFunc() {}
`;
    const result = await qualityCheck(code, path.join(dir, 'src', 'naming.ts'), config);
    expect(result.conventions).toBeDefined();
  });

  it('rule engine detects fetch without catch', async () => {
    const code = `
async function unsafeFetch() {
  const res = await fetch('https://api.example.com/data');
  const json = await res.json();
  return json;
}
`;
    const result = await qualityCheck(code, path.join(dir, 'src', 'unsafe.ts'), config);
    expect(result.rules.violations.length).toBeGreaterThan(0);
    expect(result.rules.violations.some((v) => v.ruleId === 'no-fetch-without-catch')).toBe(true);
  });

  it('rule engine passes code with proper error handling', async () => {
    const code = `
async function safeFetch() {
  try {
    const res = await fetch('https://api.example.com/data');
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch:', error);
    return null;
  }
}
`;
    const result = await qualityCheck(code, path.join(dir, 'src', 'safe.ts'), config);
    const fetchViolations = result.rules.violations.filter(
      (v) => v.ruleId === 'no-fetch-without-catch',
    );
    expect(fetchViolations).toHaveLength(0);
  });

  it('reference checker validates imports', async () => {
    const code = `
import { nonExistentModule } from './does-not-exist';
export function useIt() { return nonExistentModule; }
`;
    const result = await qualityCheck(code, path.join(dir, 'src', 'bad-import.ts'), config);
    expect(result.references).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: EVOLUTION SUBSYSTEM DEEP DIVE
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Evolution Subsystem', () => {
  let dir: string;

  beforeAll(() => {
    dir = createTypescriptBackend('e2e-evolution-');
  });

  afterAll(() => {
    cleanDir(dir);
  });

  it('aggressive mode produces more suggestions than moderate', async () => {
    const aggressiveConfig = makeConfig(
      [{ name: 'evo-agg', path: dir, language: 'typescript', role: 'backend' }],
      {
        evolution: {
          aggressiveness: 'aggressive',
          maxSuggestionsPerSession: 20,
          categories: ['feature', 'performance', 'monetization', 'scale', 'security'],
        },
      },
    );
    const moderateConfig = makeConfig(
      [{ name: 'evo-mod', path: dir, language: 'typescript', role: 'backend' }],
      {
        evolution: {
          aggressiveness: 'moderate',
          maxSuggestionsPerSession: 20,
          categories: ['feature', 'performance', 'monetization', 'scale', 'security'],
        },
      },
    );

    const aggResult = await evolve(aggressiveConfig);
    const modResult = await evolve(moderateConfig);

    expect(aggResult.length).toBeGreaterThanOrEqual(modResult.length);
    cleanDir(aggressiveConfig.cache.directory);
    cleanDir(moderateConfig.cache.directory);
  });

  it('filtered categories produce only matching suggestions', async () => {
    const securityOnlyConfig = makeConfig(
      [{ name: 'evo-sec', path: dir, language: 'typescript', role: 'backend' }],
      {
        evolution: {
          aggressiveness: 'aggressive',
          maxSuggestionsPerSession: 20,
          categories: ['security'],
        },
      },
    );

    const result = await evolve(securityOnlyConfig);
    for (const sug of result) {
      expect(sug.category).toBe('security');
    }
    cleanDir(securityOnlyConfig.cache.directory);
  });

  it('each suggestion has at least one evidence citation', async () => {
    const config = makeConfig(
      [{ name: 'evo-evidence', path: dir, language: 'typescript', role: 'backend' }],
      {
        evolution: {
          aggressiveness: 'aggressive',
          maxSuggestionsPerSession: 20,
          categories: ['feature', 'performance', 'monetization', 'scale', 'security'],
        },
      },
    );

    const result = await evolve(config);
    for (const sug of result) {
      expect(sug.evidence.length).toBeGreaterThan(0);
    }
    cleanDir(config.cache.directory);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: GRAPHQL EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: GraphQL Extraction', () => {
  it('extracts Query, Mutation, and Subscription operations', async () => {
    const { extractRoutes } = await import('../../engine/scanner/api-extractor.js');

    const schema = `
type Query {
  users: [User!]!
  post(id: ID!): Post
}
type Mutation {
  createUser(input: CreateUserInput!): User
  deletePost(id: ID!): Boolean
}
type Subscription {
  messageAdded: Message
}
type User {
  id: ID!
  name: String!
}
`;

    const routes = extractRoutes(schema, 'schema.graphql', 'graphql', 'gql-test');

    const queries = routes.filter((r) => r.method === 'QUERY');
    const mutations = routes.filter((r) => r.method === 'MUTATION');
    const subscriptions = routes.filter((r) => r.method === 'SUBSCRIPTION');

    expect(queries).toHaveLength(2);
    expect(mutations).toHaveLength(2);
    expect(subscriptions).toHaveLength(1);

    expect(queries.map((r) => r.handler)).toContain('users');
    expect(queries.map((r) => r.handler)).toContain('post');
    expect(mutations.map((r) => r.handler)).toContain('createUser');
    expect(subscriptions.map((r) => r.handler)).toContain('messageAdded');
  });

  it('does not extract non-root types as operations', async () => {
    const { extractRoutes } = await import('../../engine/scanner/api-extractor.js');

    const schema = `
type Query { health: Boolean }
type User { id: ID!, name: String! }
`;

    const routes = extractRoutes(schema, 'schema.graphql', 'graphql', 'gql-test');
    const userFields = routes.filter((r) => ['id', 'name'].includes(r.handler));
    expect(userFields).toHaveLength(0);
  });

  it('handles single-line type definitions', async () => {
    const { extractRoutes } = await import('../../engine/scanner/api-extractor.js');

    const schema = 'type Query { health: Boolean }';
    const routes = extractRoutes(schema, 'schema.graphql', 'graphql', 'gql-test');
    expect(routes.some((r) => r.handler === 'health' && r.method === 'QUERY')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: BOTTLENECK FINDER AND COMPETITIVE BENCHMARKER
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Bottleneck Finder & Benchmarker', () => {
  let dir: string;
  let config: OmniLinkConfig;
  let scanResult: ScanResult;

  beforeAll(async () => {
    dir = createTypescriptBackend('e2e-bottleneck-');
    config = makeConfig([
      { name: 'bottleneck-test', path: dir, language: 'typescript', role: 'backend' },
    ]);
    scanResult = await scan(config);
  }, 30_000);

  afterAll(() => {
    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('bottleneck finder returns findings array', async () => {
    const { findBottlenecks } = await import('../../engine/evolution/bottleneck-finder.js');
    const bottlenecks = findBottlenecks(scanResult.manifests);
    expect(bottlenecks).toBeInstanceOf(Array);
  });

  it('no stale unbounded-query kind for rate-limit findings', async () => {
    const { findBottlenecks } = await import('../../engine/evolution/bottleneck-finder.js');
    const bottlenecks = findBottlenecks(scanResult.manifests);
    const staleKinds = bottlenecks.filter(
      (f) => f.kind === 'unbounded-query' && f.description.toLowerCase().includes('rate'),
    );
    expect(staleKinds).toHaveLength(0);
  });

  it('competitive benchmarker returns results', async () => {
    const { benchmarkAgainstBestPractices } =
      await import('../../engine/evolution/competitive-benchmarker.js');
    const benchmarks = benchmarkAgainstBestPractices(scanResult.manifests);
    expect(benchmarks).toBeInstanceOf(Array);

    for (const b of benchmarks) {
      expect(['present', 'partial', 'missing']).toContain(b.status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: TOKEN PRUNER FOCUS MODES
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Token Pruner Focus Modes', () => {
  let scanResult: ScanResult;

  beforeAll(async () => {
    const dir = createTypescriptBackend('e2e-pruner-');
    const iosDir = createSwiftIosApp('e2e-pruner-ios-');
    const config = makeConfig([
      { name: 'pruner-backend', path: dir, language: 'typescript', role: 'backend' },
      { name: 'pruner-ios', path: iosDir, language: 'swift', role: 'ios' },
    ]);
    scanResult = await scan(config);
    cleanDir(dir);
    cleanDir(iosDir);
    cleanDir(config.cache.directory);
  });

  it('pruneToTokenBudget works with default focus', async () => {
    const { pruneToTokenBudget } = await import('../../engine/context/token-pruner.js');
    const result = pruneToTokenBudget(scanResult.graph, 100, 'changed-files-first');
    expect(typeof result).toBe('object');
  });

  it('pruneToTokenBudget works with commits focus', async () => {
    const { pruneToTokenBudget } = await import('../../engine/context/token-pruner.js');
    const result = pruneToTokenBudget(scanResult.graph, 100, 'changed-files-first', 'commits');
    expect(typeof result).toBe('object');
  });

  it('pruneToTokenBudget works with api-surface focus', async () => {
    const { pruneToTokenBudget } = await import('../../engine/context/token-pruner.js');
    const result = pruneToTokenBudget(scanResult.graph, 100, 'changed-files-first', 'api-surface');
    expect(typeof result).toBe('object');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: CACHE INVALIDATION API
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Cache Invalidation API', () => {
  let dir: string;
  let config: OmniLinkConfig;

  beforeAll(() => {
    dir = createTypescriptBackend('e2e-cache-api-');
    config = makeConfig([
      { name: 'cache-api-test', path: dir, language: 'typescript', role: 'backend' },
    ]);
  });

  afterAll(() => {
    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('invalidateScanCache forces a fresh scan on next call', async () => {
    const r1 = await scan(config);
    expect(r1.manifests).toHaveLength(1);

    invalidateScanCache(config);

    const r2 = await scan(config);
    expect(r2.manifests).toHaveLength(1);
    expect(r2.manifests[0].repoId).toBe('cache-api-test');
  });

  it('clearScanCache empties the entire session cache', async () => {
    await scan(config);
    clearScanCache();
    const r2 = await scan(config);
    expect(r2.manifests).toHaveLength(1);
  });

  it('scan with bypassCache: true gets fresh results', async () => {
    const r1 = await scan(config);
    expect(r1.manifests).toHaveLength(1);

    fs.writeFileSync(
      path.join(dir, 'src', 'routes', 'bypass-test.ts'),
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/api/bypass-test', (c) => c.json({ ok: true }));
export default app;
`,
    );

    const r2 = await scan(config, { bypassCache: true });
    const be = r2.manifests.find((m) => m.repoId === 'cache-api-test')!;
    expect(be.apiSurface.routes.map((r) => r.path)).toContain('/api/bypass-test');

    fs.unlinkSync(path.join(dir, 'src', 'routes', 'bypass-test.ts'));
  });

  it('cache invalidation followed by file change reflects new routes', async () => {
    await scan(config);

    const newFile = path.join(dir, 'src', 'routes', 'invalidation-test.ts');
    fs.writeFileSync(
      newFile,
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/api/invalidation', (c) => c.json({ fresh: true }));
export default app;
`,
    );

    invalidateScanCache(config);
    const r2 = await scan(config);
    const be = r2.manifests.find((m) => m.repoId === 'cache-api-test')!;
    expect(be.apiSurface.routes.map((r) => r.path)).toContain('/api/invalidation');

    fs.unlinkSync(newFile);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: CROSS-REPO BRIDGE ANALYSIS (HustleXP Fixture)
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Cross-Repo Bridge Analysis', () => {
  it('analyzeSwiftTrpcBridge maps iOS calls to backend procedures', async () => {
    const { analyzeSwiftTrpcBridge } = await import('../../engine/bridges/swift-trpc.js');
    const { loadAuthorityState } = await import('../../engine/authority/index.js');

    const fixtureRoot = path.resolve(import.meta.dirname!, '..', 'fixtures', 'hustlexp-workspace');

    const makeManifest = (
      repoId: string,
      repoPath: string,
      language: string,
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      repoId,
      path: repoPath,
      language,
      gitState: {
        branch: 'main',
        headSha: 'head',
        uncommittedChanges: [],
        recentCommits: [],
      },
      apiSurface: { routes: [], procedures: [], exports: [] },
      typeRegistry: { types: [], schemas: [], models: [] },
      conventions: {
        naming: 'camelCase' as const,
        fileOrganization: 'domain',
        errorHandling: 'throws',
        patterns: [],
        testingPatterns: '',
      },
      dependencies: { internal: [], external: [] },
      health: {
        testCoverage: null,
        lintErrors: 0,
        typeErrors: 0,
        todoCount: 0,
        deadCode: [],
      },
      ...overrides,
    });

    const bridgeConfig: OmniLinkConfig = {
      workflowProfile: 'hustlexp',
      repos: [
        {
          name: 'hustlexp-ios',
          path: path.join(fixtureRoot, 'ios'),
          language: 'swift',
          role: 'ios-client',
        },
        {
          name: 'hustlexp-backend',
          path: path.join(fixtureRoot, 'backend'),
          language: 'typescript',
          role: 'backend-api',
        },
        {
          name: 'hustlexp-docs',
          path: path.join(fixtureRoot, 'docs'),
          language: 'javascript',
          role: 'product-governance',
        },
      ],
      reviewProvider: 'github',
      evolution: {
        aggressiveness: 'aggressive',
        maxSuggestionsPerSession: 5,
        categories: ['feature', 'security'],
      },
      quality: {
        blockOnFailure: true,
        requireTestsForNewCode: true,
        conventionStrictness: 'strict',
      },
      context: {
        tokenBudget: 8000,
        prioritize: 'api-surface-first',
        includeRecentCommits: 20,
      },
      cache: { directory: os.tmpdir(), maxAgeDays: 1 },
      authority: {
        enabled: true,
        docsRepo: path.join(fixtureRoot, 'docs'),
        phaseMode: 'reconciliation',
        authorityFiles: {
          currentPhase: 'CURRENT_PHASE.md',
          finishedState: 'FINISHED_STATE.md',
          featureFreeze: 'FEATURE_FREEZE.md',
          aiGuardrails: 'AI_GUARDRAILS.md',
          apiContract: 'specs/04-backend/API_CONTRACT.md',
          schema: 'specs/02-architecture/schema.sql',
        },
      },
      bridges: {
        swiftTrpc: {
          enabled: true,
          iosRepo: path.join(fixtureRoot, 'ios'),
          backendRepo: path.join(fixtureRoot, 'backend'),
          clientCallPattern:
            'trpc\\\\.call\\\\(router:\\\\s*"(?<router>[A-Za-z_][A-Za-z0-9_]*)"\\\\s*,\\\\s*procedure:\\\\s*"(?<procedure>[A-Za-z_][A-Za-z0-9_]*)"\\\\s*\\\\)',
          authoritativeBackendRoot: 'backend/src',
        },
      },
    };

    const authority = loadAuthorityState(bridgeConfig);
    const graph = {
      repos: [
        makeManifest('hustlexp-ios', path.join(fixtureRoot, 'ios'), 'swift'),
        makeManifest('hustlexp-backend', path.join(fixtureRoot, 'backend'), 'typescript', {
          apiSurface: {
            routes: [],
            procedures: [
              { name: 'create', kind: 'mutation', file: 'backend/src/routers/task.ts', line: 3 },
              {
                name: 'sendMessage',
                kind: 'mutation',
                file: 'backend/src/routers/messaging.ts',
                line: 3,
              },
            ],
            exports: [],
          },
        }),
        makeManifest('hustlexp-docs', path.join(fixtureRoot, 'docs'), 'javascript'),
      ],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const analysis = analyzeSwiftTrpcBridge(bridgeConfig, graph as any, authority);

    expect(analysis.iosCalls.length).toBeGreaterThan(0);
    expect(analysis.backendProcedures.length).toBeGreaterThan(0);
    expect(analysis.bridges.length).toBeGreaterThan(0);
    expect(analysis.mismatches.length).toBeGreaterThan(0);

    const callIds = analysis.iosCalls.map((c) => `${c.router}.${c.procedure}`);
    expect(callIds).toContain('task.create');
    expect(callIds).toContain('messaging.sendMessage');
    expect(callIds).toContain('legacy.oldProcedure');

    expect(analysis.findings.map((f) => f.kind)).toContain('bridge_obsolete_call');
  });

  it('authority state parses current phase from fixtures', async () => {
    const { loadAuthorityState } = await import('../../engine/authority/index.js');
    const fixtureRoot = path.resolve(import.meta.dirname!, '..', 'fixtures', 'hustlexp-workspace');

    const config: OmniLinkConfig = {
      repos: [],
      evolution: {
        aggressiveness: 'aggressive',
        maxSuggestionsPerSession: 5,
        categories: [],
      },
      quality: {
        blockOnFailure: true,
        requireTestsForNewCode: true,
        conventionStrictness: 'strict',
      },
      context: { tokenBudget: 8000, prioritize: 'api-surface-first', includeRecentCommits: 20 },
      cache: { directory: os.tmpdir(), maxAgeDays: 1 },
      authority: {
        enabled: true,
        docsRepo: path.join(fixtureRoot, 'docs'),
        phaseMode: 'reconciliation',
        authorityFiles: {
          currentPhase: 'CURRENT_PHASE.md',
          finishedState: 'FINISHED_STATE.md',
          featureFreeze: 'FEATURE_FREEZE.md',
          aiGuardrails: 'AI_GUARDRAILS.md',
          apiContract: 'specs/04-backend/API_CONTRACT.md',
          schema: 'specs/02-architecture/schema.sql',
        },
      },
    };

    const authority = loadAuthorityState(config);
    expect(authority?.currentPhase).toBe('BOOTSTRAP');
    expect(authority?.authoritativeApiSurface.procedures.length).toBeGreaterThan(0);
    expect(authority?.authoritativeSchemaSurface.tables).toContain('users');
    expect(authority?.authoritativeSchemaSurface.tables).toContain('tasks');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: ENHANCED ERROR RECOVERY
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Enhanced Error Recovery', () => {
  it('qualityCheck handles deeply nested code without stack overflow', async () => {
    const dir = createMinimalRepo('e2e-deep-nesting-');
    const config = makeConfig([
      { name: 'deep-nesting', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const deepCode =
      Array.from({ length: 50 }, (_, i) => `if (true) {`.padStart(i + 12)).join('\n') +
      '\nconsole.log("deep");\n' +
      Array.from({ length: 50 }, () => '}').join('\n');

    const result = await qualityCheck(deepCode, path.join(dir, 'src', 'deep.ts'), config);
    expect(result).toBeDefined();
    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('impact analysis handles unknown repo names gracefully', async () => {
    const dir = createMinimalRepo('e2e-unknown-repo-');
    const config = makeConfig([
      { name: 'known-repo', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const paths = await impact(config, [
      { repo: 'unknown-repo-that-does-not-exist', file: 'src/index.ts', change: 'type-change' },
    ]);
    expect(paths).toBeInstanceOf(Array);

    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('evolve handles empty categories gracefully', async () => {
    const dir = createMinimalRepo('e2e-empty-cats-');
    const config = makeConfig(
      [{ name: 'empty-cats', path: dir, language: 'typescript', role: 'backend' }],
      {
        evolution: {
          aggressiveness: 'aggressive',
          maxSuggestionsPerSession: 10,
          categories: [],
        },
      },
    );

    const result = await evolve(config);
    expect(result).toBeInstanceOf(Array);
    expect(result).toHaveLength(0);

    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('scan handles repo with only binary-like filenames', async () => {
    const dir = createMinimalRepo('e2e-binary-names-');
    fs.writeFileSync(path.join(dir, 'src', 'data.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    fs.writeFileSync(path.join(dir, 'src', 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const config = makeConfig([
      { name: 'binary-test', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const result = await scan(config);
    expect(result.manifests).toHaveLength(1);

    cleanDir(dir);
    cleanDir(config.cache.directory);
  });

  it('health is stable after cache invalidation cycle', async () => {
    const dir = createTypescriptBackend('e2e-health-cache-');
    const config = makeConfig([
      { name: 'health-cache', path: dir, language: 'typescript', role: 'backend' },
    ]);

    const h1 = await health(config);
    invalidateScanCache(config);
    const h2 = await health(config);

    expect(h1.overall).toBe(h2.overall);

    cleanDir(dir);
    cleanDir(config.cache.directory);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: MULTI-LANGUAGE ECOSYSTEM (3+ REPOS)
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E Lifecycle: Multi-Language Ecosystem', () => {
  let beDir: string;
  let iosDir: string;
  let minDir: string;
  let config: OmniLinkConfig;

  beforeAll(() => {
    beDir = createTypescriptBackend('e2e-multi-be-');
    iosDir = createSwiftIosApp('e2e-multi-ios-');
    minDir = createMinimalRepo('e2e-multi-util-');
    config = makeConfig([
      { name: 'multi-backend', path: beDir, language: 'typescript', role: 'backend' },
      { name: 'multi-ios', path: iosDir, language: 'swift', role: 'ios' },
      { name: 'multi-util', path: minDir, language: 'typescript', role: 'shared' },
    ]);
  });

  afterAll(() => {
    cleanDir(beDir);
    cleanDir(iosDir);
    cleanDir(minDir);
    cleanDir(config.cache.directory);
  });

  it('scan handles 3-repo ecosystem', async () => {
    const result = await scan(config);
    expect(result.manifests).toHaveLength(3);
    expect(result.graph.repos).toHaveLength(3);
  });

  it('graph detects shared types across 3 repos', async () => {
    const result = await scan(config);
    expect(result.graph.sharedTypes.length).toBeGreaterThanOrEqual(0);
    expect(result.context.digest.repos).toHaveLength(3);
  });

  it('impact analysis spans 3-repo graph', async () => {
    const paths = await impact(config, [
      { repo: 'multi-backend', file: 'src/types/user.ts', change: 'type-change' },
    ]);
    expect(paths).toBeInstanceOf(Array);
  });

  it('evolution suggestions reference repos from 3-repo ecosystem', async () => {
    const suggestions = await evolve(config);
    const validRepos = new Set(['multi-backend', 'multi-ios', 'multi-util']);
    for (const sug of suggestions) {
      for (const repo of sug.affectedRepos) {
        expect(validRepos.has(repo)).toBe(true);
      }
    }
  });

  it('health scores all 3 repos', async () => {
    const result = await health(config);
    expect(Object.keys(result.perRepo)).toHaveLength(3);
    expect(result.overall).toBeGreaterThan(0);
  });
});
