import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeRepoSemantics } from '../../engine/analyzers/index.js';
import type { AnalysisMetadata, OmniLinkConfig, RepoConfig } from '../../engine/types.js';

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function collectFiles(root: string, ext: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath, ext));
      continue;
    }
    if (entry.name.endsWith(ext)) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function semanticConfig(repo: RepoConfig): OmniLinkConfig {
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
        languages: ['graphql'],
      },
    },
  };
}

function assertSemanticMetadata(entries: AnalysisMetadata[]): void {
  for (const entry of entries) {
    expect(entry.sourceKind).toBe('semantic');
    expect(entry.confidence).toBeGreaterThan(0.85);
    expect(entry.provenance).toHaveLength(1);
  }
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('graphql semantic analyzer', () => {
  it('extracts schema, operations, and cross-file references through the GraphQL AST analyzer', async () => {
    const repoPath = makeTmpDir('omni-link-graphql-ast-');
    fs.writeFileSync(
      path.join(repoPath, 'schema.graphql'),
      `
type Query {
  user(id: ID!): User
}

type Mutation {
  createUser(input: CreateUserInput!): User
}

type User {
  id: ID!
  profile: Profile
}

input CreateUserInput {
  email: String!
  profile: ProfileInput
}
`,
    );
    fs.writeFileSync(
      path.join(repoPath, 'profile.graphql'),
      `
type Profile {
  bio: String
  avatar: Asset
}

input ProfileInput {
  bio: String
  avatarId: ID
}

type Asset {
  id: ID!
}
`,
    );
    fs.writeFileSync(
      path.join(repoPath, 'operations.graphql'),
      `
query FetchUser($id: ID!) {
  user(id: $id) {
    id
  }
}

mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
  }
}

fragment UserCard on User {
  id
}
`,
    );

    const repo: RepoConfig = {
      name: 'graphql-fixture',
      path: repoPath,
      language: 'graphql',
      role: 'schema',
    };

    const filePaths = collectFiles(repoPath, '.graphql');
    const selection = await analyzeRepoSemantics(repo, filePaths, semanticConfig(repo));
    const schemaFile = selection.analysis?.files.get('schema.graphql');
    const profileFile = selection.analysis?.files.get('profile.graphql');
    const operationsFile = selection.analysis?.files.get('operations.graphql');

    expect(selection.analysis?.adapter).toBe('graphql-ast');
    expect(schemaFile?.routes.map((entry) => `${entry.method} ${entry.handler}`)).toEqual(
      expect.arrayContaining(['QUERY user', 'MUTATION createUser']),
    );
    expect(schemaFile?.types.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['Query', 'Mutation', 'User', 'CreateUserInput']),
    );
    expect(profileFile?.types.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['Profile', 'ProfileInput', 'Asset']),
    );
    expect(schemaFile?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'profile.graphql',
          imports: expect.arrayContaining(['Profile', 'ProfileInput']),
        }),
      ]),
    );
    expect(operationsFile?.procedures.map((entry) => `${entry.kind} ${entry.name}`)).toEqual(
      expect.arrayContaining(['query FetchUser', 'mutation CreateUser']),
    );
    expect(operationsFile?.symbolReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'CreateUserInput',
          kind: 'type',
          toFile: 'schema.graphql',
        }),
        expect.objectContaining({
          name: 'user',
          kind: 'route',
          toFile: 'schema.graphql',
        }),
      ]),
    );
    assertSemanticMetadata(schemaFile?.routes ?? []);
    assertSemanticMetadata(schemaFile?.types ?? []);
    assertSemanticMetadata(schemaFile?.imports ?? []);
    assertSemanticMetadata(operationsFile?.procedures ?? []);
    assertSemanticMetadata(operationsFile?.symbolReferences ?? []);
  });
});
