import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyzeRepoSemantics } from '../../engine/analyzers/index.js';
import { typeScriptSemanticAnalyzer } from '../../engine/analyzers/typescript-semantic.js';
import type { AnalysisMetadata, OmniLinkConfig, RepoConfig } from '../../engine/types.js';

function collectTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }

    if (entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function assertSemanticMetadata(entries: AnalysisMetadata[]): void {
  for (const entry of entries) {
    expect(entry.sourceKind).toBe('semantic');
    expect(entry.confidence).toBeGreaterThan(0.75);
    expect(entry.provenance).toHaveLength(1);
    expect(entry.provenance?.[0]?.sourceKind).toBe('semantic');
    expect(entry.provenance?.[0]?.adapter).toBe('typescript-compiler');
    expect(entry.provenance?.[0]?.confidence).toBe(entry.confidence);
  }
}

function createSemanticConfig(repo: RepoConfig): OmniLinkConfig {
  return {
    repos: [repo],
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 2000,
      prioritize: 'api-surface-first',
      includeRecentCommits: 5,
    },
    cache: {
      directory: path.join(repo.path, '.cache'),
      maxAgeDays: 7,
    },
    maxTier: {
      enabled: true,
      semanticAnalysis: {
        enabled: true,
        preferSemantic: true,
        confidenceThreshold: 0.6,
        languages: ['typescript', 'javascript', 'tsx'],
      },
    },
  };
}

describe('TypeScript semantic analyzer', () => {
  let tmpDir: string;
  let repo: RepoConfig;
  let filePaths: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-typescript-semantic-'));
    fs.cpSync(path.join(process.cwd(), 'tests', 'fixtures', 'semantic', 'typescript'), tmpDir, {
      recursive: true,
    });

    repo = {
      name: 'semantic-fixture',
      path: tmpDir,
      language: 'typescript',
      role: 'backend',
    };
    filePaths = collectTypeScriptFiles(path.join(tmpDir, 'src'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts semantic exports, routes, procedures, imports, and symbol references', async () => {
    const analysis = await typeScriptSemanticAnalyzer.analyzeRepo(repo, filePaths);

    expect(analysis?.adapter).toBe('typescript-compiler');
    expect([...(analysis?.files.keys() ?? [])].sort()).toEqual([
      'src/router.ts',
      'src/shared.ts',
      'src/trpc.ts',
    ]);

    const sharedFile = analysis?.files.get('src/shared.ts');
    const routerFile = analysis?.files.get('src/router.ts');
    const trpcFile = analysis?.files.get('src/trpc.ts');

    expect(sharedFile).toBeDefined();
    expect(routerFile).toBeDefined();
    expect(trpcFile).toBeDefined();

    expect(sharedFile?.exports.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        'AuditRecord',
        'UserInput',
        'UserResult',
        'USER_LIMIT',
        'createUser',
      ]),
    );
    expect(routerFile?.exports.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['RouterPayload', 'getAudit']),
    );
    expect(routerFile?.routes.map((entry) => `${entry.method} ${entry.path}`)).toEqual(
      expect.arrayContaining(['GET /api/users', 'POST /api/users']),
    );
    expect(trpcFile?.procedures.map((entry) => `${entry.kind}:${entry.name}`)).toEqual(
      expect.arrayContaining(['mutation:users.create', 'query:users.list']),
    );

    const routerImport = routerFile?.imports.find((entry) => entry.to === 'src/shared.ts');
    expect(routerImport).toBeDefined();
    expect(routerImport?.imports).toEqual(
      expect.arrayContaining(['AuditRecord', 'USER_LIMIT', 'UserInput', 'createUser']),
    );

    const auditRecord = sharedFile?.types.find((entry) => entry.name === 'AuditRecord');
    expect(auditRecord?.extends).toContain('UserInput');
    expect(auditRecord?.fields.map((field) => field.name)).toContain('id');

    const importReferences = (routerFile?.symbolReferences ?? []).filter(
      (entry) => entry.kind === 'import' && entry.toFile === 'src/shared.ts',
    );
    expect(importReferences.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['AuditRecord', 'USER_LIMIT', 'UserInput', 'createUser']),
    );

    assertSemanticMetadata(sharedFile?.exports ?? []);
    assertSemanticMetadata(sharedFile?.types ?? []);
    assertSemanticMetadata(routerFile?.routes ?? []);
    assertSemanticMetadata(trpcFile?.procedures ?? []);
    assertSemanticMetadata(routerFile?.imports ?? []);
    assertSemanticMetadata(importReferences);
  }, 15000);

  it('is selected through the analyzer registry when max-tier semantic analysis is enabled', async () => {
    const selection = await analyzeRepoSemantics(repo, filePaths, createSemanticConfig(repo));

    expect(selection.preferSemantic).toBe(true);
    expect(selection.analysis?.adapter).toBe('typescript-compiler');
    expect(selection.analysis?.files.get('src/router.ts')?.routes).toHaveLength(2);
  }, 15000);
});
