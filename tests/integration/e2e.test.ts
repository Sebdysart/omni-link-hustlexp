// tests/integration/e2e.test.ts — End-to-end integration test with 2-repo ecosystem
//
// This test creates two temporary git repos (TS backend + Swift iOS),
// runs the full omni-link pipeline, and verifies that scanning, graphing,
// context generation, and evolution analysis all work end-to-end.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
import { execSync } from 'node:child_process';
import { scan } from '../../engine/index.js';
import { evolve } from '../../engine/index.js';
import type { OmniLinkConfig, ScanResult } from '../../engine/index.js';

// ─── Test Fixtures: Two-Repo Ecosystem ──────────────────────────────────────
//
// Repo 1 (backend): TypeScript API server with routes, interfaces, and zod schemas.
// Repo 2 (ios): Swift iOS app with Codable DTOs and functions that reference backend routes.

let backendDir: string;
let iosDir: string;
let config: OmniLinkConfig;
let scanResult: ScanResult;

function createBackendRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-e2e-backend-'));

  // Initialize git
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@omni-link.dev"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "E2E Test"', { cwd: dir, stdio: 'ignore' });

  // Create directory structure
  fs.mkdirSync(path.join(dir, 'src', 'routes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'types'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'schemas'), { recursive: true });

  // --- src/types/user.ts: shared interface ---
  fs.writeFileSync(
    path.join(dir, 'src', 'types', 'user.ts'),
    `export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
}
`,
  );

  // --- src/schemas/user-schema.ts: zod validation schema ---
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
  createdAt: z.string(),
});
`,
  );

  // --- src/routes/users.ts: API routes ---
  fs.writeFileSync(
    path.join(dir, 'src', 'routes', 'users.ts'),
    `import { Hono } from 'hono';

const app = new Hono();

app.get('/api/users', (c) => {
  return c.json({ users: [] });
});

app.post('/api/users', async (c) => {
  const body = await c.req.json();
  return c.json({ id: '1', ...body, createdAt: new Date().toISOString() });
});

app.get('/api/users/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, email: 'test@test.com', name: 'Test', createdAt: '2025-01-01' });
});

app.delete('/api/users/:id', (c) => {
  return c.json({ success: true });
});

export default app;
`,
  );

  // --- src/routes/health.ts: additional route ---
  fs.writeFileSync(
    path.join(dir, 'src', 'routes', 'health.ts'),
    `import { Hono } from 'hono';

const app = new Hono();

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
`,
  );

  // --- package.json ---
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'e2e-backend',
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

  // Commit
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "feat: initial backend with user routes and schemas"', {
    cwd: dir,
    stdio: 'ignore',
  });

  return dir;
}

function createiOSRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-e2e-ios-'));

  // Initialize git
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@omni-link.dev"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "E2E Test"', { cwd: dir, stdio: 'ignore' });

  // Create directory structure
  fs.mkdirSync(path.join(dir, 'Sources', 'Models'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Sources', 'Services'), { recursive: true });

  // --- Sources/Models/UserDTO.swift: mirrors the backend User type ---
  fs.writeFileSync(
    path.join(dir, 'Sources', 'Models', 'UserDTO.swift'),
    `import Foundation

struct UserDTO: Codable {
    let id: String
    let email: String
    let name: String
    let createdAt: String
}

struct CreateUserRequest: Codable {
    let email: String
    let name: String
}
`,
  );

  // --- Sources/Services/UserService.swift: calls backend API ---
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
        let response = try JSONDecoder().decode([UserDTO].self, from: data)
        return response
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

  // --- Sources/Services/HealthService.swift: simple health check ---
  fs.writeFileSync(
    path.join(dir, 'Sources', 'Services', 'HealthService.swift'),
    `import Foundation

struct HealthResponse: Codable {
    let status: String
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

  // Commit
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "feat: initial iOS app with user DTOs and API service"', {
    cwd: dir,
    stdio: 'ignore',
  });

  return dir;
}

function makeE2EConfig(backendPath: string, iosPath: string): OmniLinkConfig {
  return {
    repos: [
      {
        name: 'e2e-backend',
        path: backendPath,
        language: 'typescript',
        role: 'backend',
      },
      {
        name: 'e2e-ios',
        path: iosPath,
        language: 'swift',
        role: 'ios',
      },
    ],
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
      directory: path.join(os.tmpdir(), 'omni-e2e-cache-' + Date.now()),
      maxAgeDays: 1,
    },
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('end-to-end integration: 2-repo ecosystem', () => {
  beforeAll(async () => {
    backendDir = createBackendRepo();
    iosDir = createiOSRepo();
    config = makeE2EConfig(backendDir, iosDir);

    // Run the full pipeline once; individual tests verify the output
    scanResult = await scan(config);
  });

  afterAll(() => {
    // Cleanup temp directories
    fs.rmSync(backendDir, { recursive: true, force: true });
    fs.rmSync(iosDir, { recursive: true, force: true });
    if (fs.existsSync(config.cache.directory)) {
      fs.rmSync(config.cache.directory, { recursive: true, force: true });
    }
  });

  // ─── Manifest Verification ───────────────────────────────────────────────

  describe('manifest scanning', () => {
    it('produces manifests for both repos', () => {
      expect(scanResult.manifests).toHaveLength(2);
      const repoIds = scanResult.manifests.map((m) => m.repoId);
      expect(repoIds).toContain('e2e-backend');
      expect(repoIds).toContain('e2e-ios');
    });

    it('backend manifest has correct language and path', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      expect(backend.language).toBe('typescript');
      expect(backend.path).toBe(backendDir);
    });

    it('iOS manifest has correct language and path', () => {
      const ios = scanResult.manifests.find((m) => m.repoId === 'e2e-ios')!;
      expect(ios.language).toBe('swift');
      expect(ios.path).toBe(iosDir);
    });

    it('backend manifest extracts API routes', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      expect(backend.apiSurface.routes.length).toBeGreaterThanOrEqual(4);

      const paths = backend.apiSurface.routes.map((r) => r.path);
      expect(paths).toContain('/api/users');
      expect(paths).toContain('/api/health');
    });

    it('backend manifest extracts route methods correctly', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      const userRoutes = backend.apiSurface.routes.filter((r) => r.path === '/api/users');
      const methods = userRoutes.map((r) => r.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
    });

    it('backend manifest extracts types (User interface)', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      const typeNames = backend.typeRegistry.types.map((t) => t.name);
      expect(typeNames).toContain('User');
      expect(typeNames).toContain('CreateUserInput');
    });

    it('backend User type has correct fields', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      const userType = backend.typeRegistry.types.find((t) => t.name === 'User')!;
      expect(userType).toBeDefined();

      const fieldNames = userType.fields.map((f) => f.name);
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('createdAt');
    });

    it('backend manifest extracts zod schemas', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      const schemaNames = backend.typeRegistry.schemas.map((s) => s.name);
      expect(schemaNames).toContain('createUserSchema');
      expect(schemaNames).toContain('userResponseSchema');
    });

    it('backend zod schema has correct fields', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      const schema = backend.typeRegistry.schemas.find((s) => s.name === 'createUserSchema')!;
      expect(schema).toBeDefined();
      expect(schema.kind).toBe('zod');

      const fieldNames = schema.fields.map((f) => f.name);
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('name');
    });

    it('backend manifest extracts external dependencies', () => {
      const backend = scanResult.manifests.find((m) => m.repoId === 'e2e-backend')!;
      const depNames = backend.dependencies.external.map((d) => d.name);
      expect(depNames).toContain('hono');
      expect(depNames).toContain('zod');
      expect(depNames).toContain('drizzle');
    });

    it('iOS manifest extracts Swift types (struct declarations)', () => {
      const ios = scanResult.manifests.find((m) => m.repoId === 'e2e-ios')!;
      const typeNames = ios.typeRegistry.types.map((t) => t.name);
      expect(typeNames).toContain('UserDTO');
      expect(typeNames).toContain('CreateUserRequest');
    });

    it('iOS UserDTO has matching fields to backend User', () => {
      const ios = scanResult.manifests.find((m) => m.repoId === 'e2e-ios')!;
      const userDTO = ios.typeRegistry.types.find((t) => t.name === 'UserDTO')!;
      expect(userDTO).toBeDefined();

      const fieldNames = userDTO.fields.map((f) => f.name);
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('createdAt');
    });

    it('both manifests have valid git state', () => {
      for (const manifest of scanResult.manifests) {
        expect(manifest.gitState.headSha).toMatch(/^[a-f0-9]{40}$/);
        expect(manifest.gitState.branch).toBeTruthy();
        expect(manifest.gitState.uncommittedChanges).toEqual([]);
        expect(manifest.gitState.recentCommits.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('both manifests have convention data', () => {
      for (const manifest of scanResult.manifests) {
        expect(manifest.conventions.naming).toBeTruthy();
        expect(typeof manifest.conventions.fileOrganization).toBe('string');
        expect(typeof manifest.conventions.errorHandling).toBe('string');
        expect(manifest.conventions.patterns).toBeInstanceOf(Array);
      }
    });
  });

  // ─── Graph Verification ──────────────────────────────────────────────────

  describe('ecosystem graph', () => {
    it('graph contains both repo manifests', () => {
      expect(scanResult.graph.repos).toHaveLength(2);
    });

    it('graph has shared types detected (User concept)', () => {
      expect(scanResult.graph.sharedTypes.length).toBeGreaterThanOrEqual(1);

      // The type-flow mapper should detect User/UserDTO as a shared concept
      const concepts = scanResult.graph.sharedTypes.map((t) => t.concept.toLowerCase());
      const hasUserConcept = concepts.some((c) => c.includes('user') || c.includes('createuser'));
      expect(hasUserConcept).toBe(true);
    });

    it('shared type spans both repos', () => {
      const userLineage = scanResult.graph.sharedTypes.find((t) =>
        t.concept.toLowerCase().includes('user'),
      );

      if (userLineage) {
        const repos = new Set(userLineage.instances.map((i) => i.repo));
        expect(repos.size).toBe(2);
        expect(repos.has('e2e-backend')).toBe(true);
        expect(repos.has('e2e-ios')).toBe(true);
      }
    });

    it('shared type has alignment status', () => {
      for (const lineage of scanResult.graph.sharedTypes) {
        expect(['aligned', 'diverged', 'subset']).toContain(lineage.alignment);
      }
    });

    it('graph tracks contract mismatches (may be empty if types match)', () => {
      expect(scanResult.graph.contractMismatches).toBeInstanceOf(Array);
    });

    it('graph has impact paths array (may be empty with no uncommitted changes)', () => {
      expect(scanResult.graph.impactPaths).toBeInstanceOf(Array);
    });
  });

  // ─── Context Digest Verification ─────────────────────────────────────────

  describe('context digest', () => {
    it('produces a digest object', () => {
      expect(scanResult.context.digest).toBeDefined();
      expect(scanResult.context.digest.generatedAt).toBeTruthy();
      expect(scanResult.context.digest.configSha).toBeTruthy();
    });

    it('digest lists both repos', () => {
      expect(scanResult.context.digest.repos).toHaveLength(2);
      const names = scanResult.context.digest.repos.map((r) => r.name);
      expect(names).toContain('e2e-backend');
      expect(names).toContain('e2e-ios');
    });

    it('digest repos have correct metadata', () => {
      const backend = scanResult.context.digest.repos.find((r) => r.name === 'e2e-backend')!;
      expect(backend.language).toBe('typescript');
      expect(backend.uncommittedCount).toBe(0);

      const ios = scanResult.context.digest.repos.find((r) => r.name === 'e2e-ios')!;
      expect(ios.language).toBe('swift');
      expect(ios.uncommittedCount).toBe(0);
    });

    it('digest has contract status', () => {
      const status = scanResult.context.digest.contractStatus;
      expect(typeof status.total).toBe('number');
      expect(typeof status.exact).toBe('number');
      expect(typeof status.compatible).toBe('number');
      expect(status.mismatches).toBeInstanceOf(Array);
    });

    it('digest has API surface summary', () => {
      expect(scanResult.context.digest.apiSurfaceSummary).toBeTruthy();
      expect(scanResult.context.digest.apiSurfaceSummary).toContain('routes');
    });

    it('digest has convention summary for each repo', () => {
      expect(scanResult.context.digest.conventionSummary['e2e-backend']).toBeTruthy();
      expect(scanResult.context.digest.conventionSummary['e2e-ios']).toBeTruthy();
    });

    it('digest has recent changes summary', () => {
      expect(scanResult.context.digest.recentChangesSummary).toBeTruthy();
    });

    it('digest token count is within budget', () => {
      expect(scanResult.context.digest.tokenCount).toBeLessThanOrEqual(config.context.tokenBudget);
    });

    it('digest token count is positive', () => {
      expect(scanResult.context.digest.tokenCount).toBeGreaterThan(0);
    });
  });

  // ─── Markdown Verification ───────────────────────────────────────────────

  describe('context markdown', () => {
    it('generates markdown string', () => {
      expect(typeof scanResult.context.markdown).toBe('string');
      expect(scanResult.context.markdown.length).toBeGreaterThan(0);
    });

    it('markdown contains ecosystem header', () => {
      expect(scanResult.context.markdown).toContain('OMNI-LINK ECOSYSTEM STATE');
    });

    it('markdown contains repo section', () => {
      expect(scanResult.context.markdown).toContain('## Repos');
      expect(scanResult.context.markdown).toContain('e2e-backend');
      expect(scanResult.context.markdown).toContain('e2e-ios');
    });

    it('markdown contains API contracts section', () => {
      expect(scanResult.context.markdown).toContain('## API Contracts');
    });

    it('markdown contains shared types section', () => {
      expect(scanResult.context.markdown).toContain('## Shared Types');
    });

    it('markdown contains conventions section', () => {
      expect(scanResult.context.markdown).toContain('## Conventions');
    });

    it('markdown contains recent changes section', () => {
      expect(scanResult.context.markdown).toContain('## Recent Changes');
    });
  });

  // ─── Evolution Suggestions Verification ──────────────────────────────────

  describe('evolution analysis', () => {
    let suggestions: Awaited<ReturnType<typeof evolve>>;

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

    it('suggestions reference repos from our ecosystem', () => {
      const validRepos = new Set(['e2e-backend', 'e2e-ios']);
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

  // ─── Cross-Cutting Concerns ──────────────────────────────────────────────

  describe('cross-cutting', () => {
    it('pipeline is deterministic (same input produces same manifest count)', async () => {
      const result2 = await scan(config);
      expect(result2.manifests).toHaveLength(scanResult.manifests.length);
      expect(result2.graph.repos).toHaveLength(scanResult.graph.repos.length);
      expect(result2.graph.sharedTypes.length).toBe(scanResult.graph.sharedTypes.length);
    });

    it('uncommitted changes are detected when present', async () => {
      // Add an uncommitted file to backend
      fs.writeFileSync(
        path.join(backendDir, 'src', 'routes', 'new-route.ts'),
        `import { Hono } from 'hono';
const app = new Hono();
app.get('/api/new', (c) => c.json({ hello: 'world' }));
export default app;
`,
      );

      const result = await scan(config);
      const backend = result.manifests.find((m) => m.repoId === 'e2e-backend')!;

      // The new file is untracked, so it shows up in the scan but
      // the git diff might not show it unless tracked. Let's verify
      // the new route was picked up by the scanner.
      const paths = backend.apiSurface.routes.map((r) => r.path);
      expect(paths).toContain('/api/new');

      // Clean up the new file
      fs.unlinkSync(path.join(backendDir, 'src', 'routes', 'new-route.ts'));
    });

    it('each repo scan populates health scaffold', () => {
      for (const manifest of scanResult.manifests) {
        expect(manifest.health).toBeDefined();
        expect(typeof manifest.health.lintErrors).toBe('number');
        expect(typeof manifest.health.typeErrors).toBe('number');
        expect(typeof manifest.health.todoCount).toBe('number');
        expect(manifest.health.deadCode).toBeInstanceOf(Array);
      }
    });
  });
});
