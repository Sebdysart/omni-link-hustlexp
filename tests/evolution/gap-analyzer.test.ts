import { describe, it, expect } from 'vitest';
import { analyzeGaps } from '../../engine/evolution/gap-analyzer.js';
import type { RepoManifest } from '../../engine/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<RepoManifest> & { repoId: string }): RepoManifest {
  return {
    repoId: overrides.repoId,
    path: overrides.path ?? `/repos/${overrides.repoId}`,
    language: overrides.language ?? 'typescript',
    gitState: {
      branch: 'main',
      headSha: 'abc123',
      uncommittedChanges: [],
      recentCommits: [],
    },
    apiSurface: {
      routes: overrides.apiSurface?.routes ?? [],
      procedures: overrides.apiSurface?.procedures ?? [],
      exports: overrides.apiSurface?.exports ?? [],
    },
    typeRegistry: {
      types: overrides.typeRegistry?.types ?? [],
      schemas: overrides.typeRegistry?.schemas ?? [],
      models: overrides.typeRegistry?.models ?? [],
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'feature-based',
      errorHandling: 'try-catch',
      patterns: [],
      testingPatterns: 'co-located',
    },
    dependencies: {
      internal: overrides.dependencies?.internal ?? [],
      external: overrides.dependencies?.external ?? [],
    },
    health: { testCoverage: null, lintErrors: 0, typeErrors: 0, todoCount: 0, deadCode: [] },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('analyzeGaps', () => {
  describe('incomplete CRUD detection', () => {
    it('flags resource with GET + POST but no DELETE', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [
            {
              method: 'GET',
              path: '/api/users',
              handler: 'getUsers',
              file: 'src/routes/users.ts',
              line: 10,
            },
            {
              method: 'POST',
              path: '/api/users',
              handler: 'createUser',
              file: 'src/routes/users.ts',
              line: 20,
            },
          ],
          procedures: [],
          exports: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const crudFindings = findings.filter((f) => f.kind === 'incomplete-crud');

      expect(crudFindings.length).toBeGreaterThan(0);
      const userFinding = crudFindings.find((f) => f.description.includes('/api/users'));
      expect(userFinding).toBeDefined();
      expect(userFinding!.repo).toBe('backend');
      expect(userFinding!.description).toMatch(/DELETE|PUT|PATCH/i);
    });

    it('does not flag resource with full CRUD', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [
            {
              method: 'GET',
              path: '/api/users',
              handler: 'getUsers',
              file: 'src/routes/users.ts',
              line: 10,
            },
            {
              method: 'POST',
              path: '/api/users',
              handler: 'createUser',
              file: 'src/routes/users.ts',
              line: 20,
            },
            {
              method: 'PUT',
              path: '/api/users/:id',
              handler: 'updateUser',
              file: 'src/routes/users.ts',
              line: 30,
            },
            {
              method: 'DELETE',
              path: '/api/users/:id',
              handler: 'deleteUser',
              file: 'src/routes/users.ts',
              line: 40,
            },
          ],
          procedures: [],
          exports: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const crudFindings = findings.filter((f) => f.kind === 'incomplete-crud');
      expect(crudFindings).toHaveLength(0);
    });

    it('groups routes by resource path, ignoring path params', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [
            {
              method: 'GET',
              path: '/api/posts',
              handler: 'getPosts',
              file: 'src/routes/posts.ts',
              line: 5,
            },
            {
              method: 'GET',
              path: '/api/posts/:id',
              handler: 'getPost',
              file: 'src/routes/posts.ts',
              line: 15,
            },
            {
              method: 'POST',
              path: '/api/posts',
              handler: 'createPost',
              file: 'src/routes/posts.ts',
              line: 25,
            },
            {
              method: 'PUT',
              path: '/api/posts/:id',
              handler: 'updatePost',
              file: 'src/routes/posts.ts',
              line: 35,
            },
            {
              method: 'DELETE',
              path: '/api/posts/:id',
              handler: 'deletePost',
              file: 'src/routes/posts.ts',
              line: 45,
            },
          ],
          procedures: [],
          exports: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const crudFindings = findings.filter((f) => f.kind === 'incomplete-crud');
      expect(crudFindings).toHaveLength(0);
    });
  });

  describe('dead export detection', () => {
    it('flags exports that are not imported anywhere', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [],
          procedures: [],
          exports: [
            {
              name: 'usedHelper',
              kind: 'function',
              signature: 'function usedHelper()',
              file: 'src/helpers.ts',
              line: 1,
            },
            {
              name: 'deadHelper',
              kind: 'function',
              signature: 'function deadHelper()',
              file: 'src/helpers.ts',
              line: 10,
            },
          ],
        },
        dependencies: {
          internal: [{ from: 'src/index.ts', to: 'src/helpers.ts', imports: ['usedHelper'] }],
          external: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const deadFindings = findings.filter((f) => f.kind === 'dead-export');

      expect(deadFindings.length).toBeGreaterThan(0);
      const deadHelperFinding = deadFindings.find((f) => f.description.includes('deadHelper'));
      expect(deadHelperFinding).toBeDefined();
      expect(deadHelperFinding!.repo).toBe('backend');
      expect(deadHelperFinding!.file).toBe('src/helpers.ts');
    });

    it('does not flag exports used as route handlers', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [
            {
              method: 'GET',
              path: '/api/users',
              handler: 'getUsers',
              file: 'src/routes.ts',
              line: 5,
            },
          ],
          procedures: [],
          exports: [
            {
              name: 'getUsers',
              kind: 'function',
              signature: 'function getUsers()',
              file: 'src/routes.ts',
              line: 5,
            },
          ],
        },
        dependencies: {
          internal: [],
          external: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const deadFindings = findings.filter(
        (f) => f.kind === 'dead-export' && f.description.includes('getUsers'),
      );
      expect(deadFindings).toHaveLength(0);
    });

    it('does not flag type/interface exports', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [],
          procedures: [],
          exports: [
            {
              name: 'UserType',
              kind: 'type',
              signature: 'type UserType',
              file: 'src/types.ts',
              line: 1,
            },
            {
              name: 'IUser',
              kind: 'interface',
              signature: 'interface IUser',
              file: 'src/types.ts',
              line: 10,
            },
          ],
        },
        dependencies: {
          internal: [],
          external: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const deadFindings = findings.filter((f) => f.kind === 'dead-export');
      expect(deadFindings).toHaveLength(0);
    });
  });

  describe('orphaned schema detection', () => {
    it('flags schemas not referenced in any route or procedure', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [
            {
              method: 'POST',
              path: '/api/users',
              handler: 'createUser',
              file: 'src/routes.ts',
              line: 10,
              inputType: 'CreateUserInput',
            },
          ],
          procedures: [],
          exports: [],
        },
        typeRegistry: {
          types: [],
          schemas: [
            {
              name: 'CreateUserInput',
              kind: 'zod',
              fields: [],
              source: { repo: 'backend', file: 'src/schemas.ts', line: 1 },
            },
            {
              name: 'OrphanedSchema',
              kind: 'zod',
              fields: [],
              source: { repo: 'backend', file: 'src/schemas.ts', line: 20 },
            },
          ],
          models: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const orphanedFindings = findings.filter((f) => f.kind === 'orphaned-schema');

      expect(orphanedFindings.length).toBeGreaterThan(0);
      const orphanFinding = orphanedFindings.find((f) => f.description.includes('OrphanedSchema'));
      expect(orphanFinding).toBeDefined();
      expect(orphanFinding!.repo).toBe('backend');
    });

    it('does not flag schemas used as route output types', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [
            {
              method: 'GET',
              path: '/api/users',
              handler: 'getUsers',
              file: 'src/routes.ts',
              line: 10,
              outputType: 'UserListOutput',
            },
          ],
          procedures: [],
          exports: [],
        },
        typeRegistry: {
          types: [],
          schemas: [
            {
              name: 'UserListOutput',
              kind: 'zod',
              fields: [],
              source: { repo: 'backend', file: 'src/schemas.ts', line: 1 },
            },
          ],
          models: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const orphanedFindings = findings.filter(
        (f) => f.kind === 'orphaned-schema' && f.description.includes('UserListOutput'),
      );
      expect(orphanedFindings).toHaveLength(0);
    });

    it('does not flag schemas used in procedures', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [],
          procedures: [
            {
              name: 'getUser',
              kind: 'query',
              file: 'src/routers.ts',
              line: 5,
              inputType: 'GetUserInput',
              outputType: 'UserOutput',
            },
          ],
          exports: [],
        },
        typeRegistry: {
          types: [],
          schemas: [
            {
              name: 'GetUserInput',
              kind: 'zod',
              fields: [],
              source: { repo: 'backend', file: 'src/schemas.ts', line: 1 },
            },
            {
              name: 'UserOutput',
              kind: 'zod',
              fields: [],
              source: { repo: 'backend', file: 'src/schemas.ts', line: 10 },
            },
          ],
          models: [],
        },
      });

      const findings = analyzeGaps([manifest]);
      const orphanedFindings = findings.filter((f) => f.kind === 'orphaned-schema');
      expect(orphanedFindings).toHaveLength(0);
    });
  });

  describe('language filtering', () => {
    it('skips markdown repos entirely', () => {
      const manifest = makeManifest({
        repoId: 'docs',
        language: 'markdown',
        apiSurface: {
          routes: [
            {
              method: 'GET',
              path: '/api/docs',
              handler: 'getDocs',
              file: 'src/routes.ts',
              line: 1,
            },
            {
              method: 'POST',
              path: '/api/docs',
              handler: 'createDoc',
              file: 'src/routes.ts',
              line: 10,
            },
          ],
          procedures: [],
          exports: [
            {
              name: 'deadExport',
              kind: 'function',
              signature: 'function deadExport()',
              file: 'src/helpers.ts',
              line: 1,
            },
          ],
        },
        dependencies: { internal: [], external: [] },
      });

      const findings = analyzeGaps([manifest]);
      expect(findings).toEqual([]);
    });

    it('skips swift repos entirely', () => {
      const manifest = makeManifest({
        repoId: 'ios-app',
        language: 'swift',
        apiSurface: {
          routes: [],
          procedures: [],
          exports: [
            {
              name: 'unusedHelper',
              kind: 'function',
              signature: 'function unusedHelper()',
              file: 'Sources/Helpers.swift',
              line: 5,
            },
          ],
        },
        dependencies: { internal: [], external: [] },
      });

      const findings = analyzeGaps([manifest]);
      expect(findings).toEqual([]);
    });

    it('does NOT skip typescript repos', () => {
      const manifest = makeManifest({
        repoId: 'backend',
        language: 'typescript',
        apiSurface: {
          routes: [],
          procedures: [],
          exports: [
            {
              name: 'unusedHelper',
              kind: 'function',
              signature: 'function unusedHelper()',
              file: 'src/helpers.ts',
              line: 5,
            },
          ],
        },
        dependencies: { internal: [], external: [] },
      });

      const findings = analyzeGaps([manifest]);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].kind).toBe('dead-export');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty manifests', () => {
      const findings = analyzeGaps([]);
      expect(findings).toEqual([]);
    });

    it('returns empty array for manifest with no routes, exports, or schemas', () => {
      const manifest = makeManifest({ repoId: 'empty' });
      const findings = analyzeGaps([manifest]);
      expect(findings).toEqual([]);
    });

    it('handles multiple manifests', () => {
      const backend = makeManifest({
        repoId: 'backend',
        apiSurface: {
          routes: [
            {
              method: 'GET',
              path: '/api/items',
              handler: 'getItems',
              file: 'src/routes.ts',
              line: 5,
            },
          ],
          procedures: [],
          exports: [
            {
              name: 'unusedUtil',
              kind: 'function',
              signature: 'function unusedUtil()',
              file: 'src/utils.ts',
              line: 1,
            },
          ],
        },
        dependencies: { internal: [], external: [] },
      });

      const frontend = makeManifest({
        repoId: 'frontend',
        apiSurface: {
          routes: [],
          procedures: [],
          exports: [
            {
              name: 'unusedComponent',
              kind: 'function',
              signature: 'function unusedComponent()',
              file: 'src/components.tsx',
              line: 1,
            },
          ],
        },
        dependencies: { internal: [], external: [] },
      });

      const findings = analyzeGaps([backend, frontend]);

      // Should find gaps in both repos
      const backendFindings = findings.filter((f) => f.repo === 'backend');
      const frontendFindings = findings.filter((f) => f.repo === 'frontend');
      expect(backendFindings.length).toBeGreaterThan(0);
      expect(frontendFindings.length).toBeGreaterThan(0);
    });
  });
});
