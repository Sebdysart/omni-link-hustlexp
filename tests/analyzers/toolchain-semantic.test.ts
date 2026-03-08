import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeRepoSemantics } from '../../engine/analyzers/index.js';
import type { OmniLinkConfig, RepoConfig } from '../../engine/types.js';

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
        languages: ['python', 'go', 'swift', 'java'],
      },
    },
  };
}

function hasSwiftToolchain(): boolean {
  try {
    execFileSync('swiftc', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function hasJavaToolchain(): boolean {
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : null,
    '/opt/homebrew/opt/openjdk@21/bin/java',
    'java',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('toolchain semantic analyzer selection', () => {
  const swiftIt = hasSwiftToolchain() ? it : it.skip;
  const javaIt = hasJavaToolchain() ? it : it.skip;

  it('selects the Python compiler analyzer through the registry', async () => {
    const repoPath = makeTmpDir('omni-link-python-toolchain-');
    fs.mkdirSync(path.join(repoPath, 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, 'app', 'models.py'),
      [
        'class User:',
        '    id: str',
        '',
        'def format_user(user: User) -> str:',
        '    return user.id',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(repoPath, 'app', 'main.py'),
      [
        'from .models import User, format_user',
        '',
        '@app.get("/users")',
        'def list_users(user: User) -> list[User]:',
        '    format_user(user)',
        '    return [user]',
      ].join('\n'),
    );

    const repo: RepoConfig = {
      name: 'python-toolchain',
      path: repoPath,
      language: 'python',
      role: 'backend',
    };

    const selection = await analyzeRepoSemantics(
      repo,
      collectFiles(repoPath, '.py'),
      semanticConfig(repo),
    );

    const mainAnalysis = selection.analysis?.files.get('app/main.py');

    expect(selection.analysis?.adapter).toBe('python-compiler');
    expect(mainAnalysis?.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'GET',
          path: '/users',
          handler: 'list_users',
        }),
      ]),
    );
    expect(mainAnalysis?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'app/models.py',
          imports: ['User', 'format_user'],
        }),
      ]),
    );
    expect(mainAnalysis?.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'list_users',
          signature: 'def list_users(user: User) -> list[User]',
        }),
      ]),
    );
    expect(mainAnalysis?.symbolReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'format_user',
          kind: 'call',
          toFile: 'app/models.py',
        }),
      ]),
    );
  }, 20000);

  it('selects the Go type-checker analyzer through the registry', async () => {
    const repoPath = makeTmpDir('omni-link-go-toolchain-');
    fs.mkdirSync(path.join(repoPath, 'internal', 'users'), { recursive: true });
    fs.mkdirSync(path.join(repoPath, 'cmd', 'api'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'go.mod'), 'module backend\n\ngo 1.25\n');
    fs.writeFileSync(
      path.join(repoPath, 'internal', 'users', 'service.go'),
      [
        'package users',
        '',
        'type User struct { ID string }',
        '',
        'func GetUser() User {',
        '  return User{}',
        '}',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(repoPath, 'cmd', 'api', 'server.go'),
      [
        'package api',
        '',
        'import users "backend/internal/users"',
        '',
        'func LoadUser() users.User {',
        '  return users.GetUser()',
        '}',
        '',
        'func register(router *Router) {',
        '  router.GET("/users", listUsers)',
        '  router.HandleFunc("/users/{id}", getUser).Methods("GET")',
        '  _ = LoadUser()',
        '}',
      ].join('\n'),
    );

    const repo: RepoConfig = {
      name: 'go-toolchain',
      path: repoPath,
      language: 'go',
      role: 'backend',
    };

    const selection = await analyzeRepoSemantics(
      repo,
      collectFiles(repoPath, '.go'),
      semanticConfig(repo),
    );

    const serverAnalysis = selection.analysis?.files.get('cmd/api/server.go');

    expect(selection.analysis?.adapter).toBe('go-typechecker');
    expect(serverAnalysis?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'internal/users/service.go',
          imports: ['users'],
        }),
      ]),
    );
    expect(serverAnalysis?.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'GET',
          path: '/users',
        }),
        expect.objectContaining({
          method: 'GET',
          path: '/users/{id}',
        }),
      ]),
    );
    expect(serverAnalysis?.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'LoadUser',
          signature: expect.stringContaining('func() users.User'),
        }),
      ]),
    );
    expect(serverAnalysis?.symbolReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'GetUser',
          kind: 'call',
          toFile: 'internal/users/service.go',
        }),
        expect.objectContaining({
          name: 'LoadUser',
          kind: 'call',
          toFile: 'cmd/api/server.go',
        }),
      ]),
    );
  }, 30000);

  swiftIt(
    'selects the Swift type-checker analyzer through the registry',
    async () => {
      const repoPath = makeTmpDir('omni-link-swift-toolchain-');
      fs.mkdirSync(path.join(repoPath, 'Sources', 'Models'), { recursive: true });
      fs.mkdirSync(path.join(repoPath, 'Sources', 'Services'), { recursive: true });
      fs.writeFileSync(
        path.join(repoPath, 'Sources', 'Models', 'User.swift'),
        ['struct User {', '  let id: String', '}'].join('\n'),
      );
      fs.writeFileSync(
        path.join(repoPath, 'Sources', 'Services', 'UserService.swift'),
        ['class UserService {', '  func loadUser() -> User? {', '    nil', '  }', '}'].join('\n'),
      );

      const repo: RepoConfig = {
        name: 'swift-toolchain',
        path: repoPath,
        language: 'swift',
        role: 'client',
      };

      const selection = await analyzeRepoSemantics(
        repo,
        collectFiles(repoPath, '.swift'),
        semanticConfig(repo),
      );

      const serviceAnalysis = selection.analysis?.files.get('Sources/Services/UserService.swift');
      const modelAnalysis = selection.analysis?.files.get('Sources/Models/User.swift');

      expect(selection.analysis?.adapter).toBe('swift-typechecker');
      expect(serviceAnalysis?.imports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            to: 'Sources/Models/User.swift',
            imports: ['User'],
          }),
        ]),
      );
      expect(serviceAnalysis?.symbolReferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'User',
            kind: 'type',
            toFile: 'Sources/Models/User.swift',
          }),
        ]),
      );
      expect(modelAnalysis?.types).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'User',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'id',
                type: 'String',
              }),
            ]),
          }),
        ]),
      );
    },
    30000,
  );

  javaIt(
    'selects the Java compiler analyzer through the registry',
    async () => {
      const repoPath = makeTmpDir('omni-link-java-toolchain-');
      fs.mkdirSync(path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'models'), {
        recursive: true,
      });
      fs.mkdirSync(path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'api'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'models', 'User.java'),
        ['package com.acme.models;', '', 'public record User(String id, String email) {}'].join(
          '\n',
        ),
      );
      fs.writeFileSync(
        path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'api', 'UserController.java'),
        [
          'package com.acme.api;',
          '',
          'import com.acme.models.User;',
          '',
          '@RequestMapping("/api")',
          'public class UserController {',
          '  @GetMapping("/users")',
          '  public User listUsers() {',
          '    return null;',
          '  }',
          '}',
        ].join('\n'),
      );

      const repo: RepoConfig = {
        name: 'java-toolchain',
        path: repoPath,
        language: 'java',
        role: 'backend',
      };

      const selection = await analyzeRepoSemantics(
        repo,
        collectFiles(repoPath, '.java'),
        semanticConfig(repo),
      );

      const controllerAnalysis = selection.analysis?.files.get(
        'src/main/java/com/acme/api/UserController.java',
      );
      const modelAnalysis = selection.analysis?.files.get(
        'src/main/java/com/acme/models/User.java',
      );

      expect(selection.analysis?.adapter).toBe('java-compiler');
      expect(controllerAnalysis?.imports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            to: 'src/main/java/com/acme/models/User.java',
            imports: ['User'],
          }),
        ]),
      );
      expect(controllerAnalysis?.routes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'GET',
            path: '/api/users',
            handler: 'listUsers',
          }),
        ]),
      );
      expect(controllerAnalysis?.symbolReferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'User',
            kind: 'type',
            toFile: 'src/main/java/com/acme/models/User.java',
          }),
        ]),
      );
      expect(modelAnalysis?.types).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'User',
          }),
        ]),
      );
    },
    30000,
  );
});
