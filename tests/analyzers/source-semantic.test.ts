import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sourceSemanticAnalyzer } from '../../engine/analyzers/source-semantic.js';
import type { AnalysisMetadata, RepoConfig } from '../../engine/types.js';

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

function assertSemanticMetadata(entries: AnalysisMetadata[]): void {
  for (const entry of entries) {
    expect(entry.sourceKind).toBe('semantic');
    expect(entry.confidence).toBeGreaterThan(0.8);
    expect(entry.provenance).toHaveLength(1);
    expect(entry.provenance?.[0]?.adapter).toBeTruthy();
  }
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('source semantic analyzer', () => {
  it('extracts python imports, routes, and types with semantic metadata', async () => {
    const repoPath = makeTmpDir('omni-link-python-semantic-');
    fs.mkdirSync(path.join(repoPath, 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'app', 'models.py'),
      `
class User:
    id: str
    email: str
`,
    );
    fs.writeFileSync(
      path.join(repoPath, 'app', 'main.py'),
      `
from .models import User

@app.get("/users")
def list_users() -> list[User]:
    return []
`,
    );

    const repo: RepoConfig = {
      name: 'python-fixture',
      path: repoPath,
      language: 'python',
      role: 'backend',
    };

    const filePaths = collectFiles(repoPath, '.py');
    const analysis = await sourceSemanticAnalyzer.analyzeRepo(repo, filePaths);
    const mainFile = analysis?.files.get('app/main.py');
    const modelsFile = analysis?.files.get('app/models.py');

    expect(analysis?.adapter).toBe('source-structured');
    expect(mainFile?.routes.map((entry) => `${entry.method} ${entry.path}`)).toContain(
      'GET /users',
    );
    expect(mainFile?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'app/models.py',
          imports: ['User'],
        }),
      ]),
    );
    expect(mainFile?.symbolReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'User',
          kind: 'import',
          toFile: 'app/models.py',
        }),
      ]),
    );
    expect(modelsFile?.types.map((entry) => entry.name)).toContain('User');
    assertSemanticMetadata(mainFile?.routes ?? []);
    assertSemanticMetadata(mainFile?.imports ?? []);
    assertSemanticMetadata(modelsFile?.types ?? []);
  });

  it('extracts go imports and router calls with semantic metadata', async () => {
    const repoPath = makeTmpDir('omni-link-go-semantic-');
    fs.mkdirSync(path.join(repoPath, 'internal', 'users'), { recursive: true });
    fs.mkdirSync(path.join(repoPath, 'cmd', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'internal', 'users', 'service.go'),
      `
package users

type User struct {
    ID string
}

func GetUser() User { return User{} }
`,
    );
    fs.writeFileSync(
      path.join(repoPath, 'cmd', 'api', 'server.go'),
      `
package api

import (
    users "backend/internal/users"
)

func register(router *Router) {
    router.GET("/users", listUsers)
    router.HandleFunc("/users/{id}", getUser).Methods("GET")
    _ = users.GetUser
}
`,
    );

    const repo: RepoConfig = {
      name: 'go-fixture',
      path: repoPath,
      language: 'go',
      role: 'backend',
    };

    const filePaths = collectFiles(repoPath, '.go');
    const analysis = await sourceSemanticAnalyzer.analyzeRepo(repo, filePaths);
    const serverFile = analysis?.files.get('cmd/api/server.go');

    expect(serverFile?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'internal/users/service.go',
          imports: ['users'],
        }),
      ]),
    );
    expect(serverFile?.routes.map((entry) => `${entry.method} ${entry.path}`)).toEqual(
      expect.arrayContaining(['GET /users', 'GET /users/{id}']),
    );
    assertSemanticMetadata(serverFile?.imports ?? []);
    assertSemanticMetadata(serverFile?.routes ?? []);
  });

  it('extracts GraphQL schema types through the structured fallback analyzer', async () => {
    const repoPath = makeTmpDir('omni-link-graphql-semantic-');
    fs.writeFileSync(
      path.join(repoPath, 'schema.graphql'),
      `
type Query {
  users: [User!]!
}

type User {
  id: ID!
  email: String!
}

input CreateUserInput {
  email: String!
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
    const analysis = await sourceSemanticAnalyzer.analyzeRepo(repo, filePaths);
    const schemaFile = analysis?.files.get('schema.graphql');

    expect(analysis?.adapter).toBe('source-structured');
    expect(schemaFile?.types.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['Query', 'User', 'CreateUserInput']),
    );
    expect(schemaFile?.schemas.map((entry) => entry.name)).toContain('CreateUserInput');
    assertSemanticMetadata(schemaFile?.types ?? []);
    assertSemanticMetadata(schemaFile?.schemas ?? []);
  });

  it('extracts Java imports and Spring routes with semantic metadata', async () => {
    const repoPath = makeTmpDir('omni-link-java-semantic-');
    fs.mkdirSync(path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'models'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'api'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'models', 'User.java'),
      `
package com.acme.models;

public record User(String id, String email) {}
`,
    );
    fs.writeFileSync(
      path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'api', 'UserController.java'),
      `
package com.acme.api;

import com.acme.models.User;

@RequestMapping("/api")
public class UserController {
  @GetMapping("/users")
  public User listUsers() {
    return new User("1", "a@example.com");
  }
}
`,
    );

    const repo: RepoConfig = {
      name: 'java-fixture',
      path: repoPath,
      language: 'java',
      role: 'backend',
    };

    const filePaths = collectFiles(repoPath, '.java');
    const analysis = await sourceSemanticAnalyzer.analyzeRepo(repo, filePaths);
    const controllerFile = analysis?.files.get('src/main/java/com/acme/api/UserController.java');
    const modelFile = analysis?.files.get('src/main/java/com/acme/models/User.java');

    expect(analysis?.adapter).toBe('source-structured');
    expect(controllerFile?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'src/main/java/com/acme/models/User.java',
          imports: ['User'],
        }),
      ]),
    );
    expect(controllerFile?.routes.map((entry) => `${entry.method} ${entry.path}`)).toContain(
      'GET /api/users',
    );
    expect(modelFile?.types.map((entry) => entry.name)).toContain('User');
    assertSemanticMetadata(controllerFile?.imports ?? []);
    assertSemanticMetadata(controllerFile?.routes ?? []);
    assertSemanticMetadata(modelFile?.types ?? []);
  });

  it('extracts Swift cross-file type references with semantic metadata', async () => {
    const repoPath = makeTmpDir('omni-link-swift-semantic-');
    fs.mkdirSync(path.join(repoPath, 'Sources', 'Models'), { recursive: true });
    fs.mkdirSync(path.join(repoPath, 'Sources', 'Services'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'Sources', 'Models', 'User.swift'),
      `
struct User {
  let id: String
}
`,
    );
    fs.writeFileSync(
      path.join(repoPath, 'Sources', 'Services', 'UserService.swift'),
      `
class UserService {
  func loadUser() -> User? {
    return nil
  }
}
`,
    );

    const repo: RepoConfig = {
      name: 'swift-fixture',
      path: repoPath,
      language: 'swift',
      role: 'client',
    };

    const filePaths = collectFiles(repoPath, '.swift');
    const analysis = await sourceSemanticAnalyzer.analyzeRepo(repo, filePaths);
    const serviceFile = analysis?.files.get('Sources/Services/UserService.swift');
    const modelFile = analysis?.files.get('Sources/Models/User.swift');

    expect(analysis?.adapter).toBe('source-structured');
    expect(serviceFile?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'Sources/Models/User.swift',
          imports: ['User'],
        }),
      ]),
    );
    expect(serviceFile?.symbolReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'User',
          kind: 'type',
          toFile: 'Sources/Models/User.swift',
        }),
      ]),
    );
    expect(modelFile?.types.map((entry) => entry.name)).toContain('User');
    assertSemanticMetadata(serviceFile?.imports ?? []);
    assertSemanticMetadata(serviceFile?.symbolReferences ?? []);
    assertSemanticMetadata(modelFile?.types ?? []);
  });
});
