import { describe, it, expect } from 'vitest';
import { detectConventions } from '../../engine/scanner/convention-detector.js';

describe('convention-detector', () => {
  // ─── Naming Convention ──────────────────────────────────────────────────────

  it('detects camelCase naming in TS', () => {
    const files = [
      { path: 'src/userService.ts', exports: ['createUser', 'deleteUser', 'getUserById'] },
      { path: 'src/jobService.ts', exports: ['createJob', 'listJobs'] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.naming).toBe('camelCase');
  });

  it('detects snake_case naming in Python', () => {
    const files = [{ path: 'src/user_service.py', exports: ['create_user', 'delete_user'] }];
    const conventions = detectConventions(files, 'python');
    expect(conventions.naming).toBe('snake_case');
  });

  it('detects PascalCase naming from exports', () => {
    const files = [
      { path: 'src/UserView.swift', exports: ['UserView', 'ProfileView', 'SettingsView'] },
    ];
    const conventions = detectConventions(files, 'swift');
    expect(conventions.naming).toBe('PascalCase');
  });

  it('detects kebab-case naming from file names when no exports', () => {
    const files = [
      { path: 'src/user-service.ts', exports: [] },
      { path: 'src/job-handler.ts', exports: [] },
      { path: 'src/api-router.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.naming).toBe('kebab-case');
  });

  it('returns mixed when naming is inconclusive', () => {
    const files = [
      { path: 'src/a.ts', exports: ['createUser', 'deleteUser'] },
      { path: 'src/b.ts', exports: ['JobHandler', 'UserView'] },
      { path: 'src/c.py', exports: ['parse_input', 'write_output'] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.naming).toBe('mixed');
  });

  it('returns mixed for empty files list (naming)', () => {
    const conventions = detectConventions([], 'typescript');
    expect(conventions.naming).toBe('mixed');
  });

  // ─── File Organization ──────────────────────────────────────────────────────

  it('detects feature-based file organization', () => {
    const files = [
      { path: 'src/users/service.ts', exports: [] },
      { path: 'src/users/router.ts', exports: [] },
      { path: 'src/jobs/service.ts', exports: [] },
      { path: 'src/jobs/router.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.fileOrganization).toBe('feature-based');
  });

  it('detects layer-based file organization', () => {
    const files = [
      { path: 'src/services/userService.ts', exports: [] },
      { path: 'src/services/jobService.ts', exports: [] },
      { path: 'src/routes/userRoutes.ts', exports: [] },
      { path: 'src/routes/jobRoutes.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.fileOrganization).toBe('layer-based');
  });

  it('detects layer-based for iOS Screens/Views directories', () => {
    const files = [
      { path: 'App/Screens/HomeView.swift', exports: [] },
      { path: 'App/Screens/ProfileView.swift', exports: [] },
      { path: 'App/Views/CardView.swift', exports: [] },
      { path: 'App/Views/BadgeView.swift', exports: [] },
    ];
    const conventions = detectConventions(files, 'swift');
    expect(conventions.fileOrganization).toBe('layer-based');
  });

  it('detects layer-based for deeply nested layer directories', () => {
    const files = [
      { path: 'src/app/services/UserService.ts', exports: [] },
      { path: 'src/app/middleware/auth.ts', exports: [] },
      { path: 'src/app/routes/api.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.fileOrganization).toBe('layer-based');
  });

  it('detects doc-based organization for documentation repos', () => {
    const files = [
      { path: 'specs/backend/API_CONTRACT.md', exports: [] },
      { path: 'specs/frontend/COMPONENTS.md', exports: [] },
      { path: 'guides/GETTING_STARTED.md', exports: [] },
      { path: 'guides/DEPLOYMENT.md', exports: [] },
    ];
    const conventions = detectConventions(files, 'markdown');
    expect(conventions.fileOrganization).toBe('doc-based');
  });

  it('returns flat for single-directory projects', () => {
    const files = [
      { path: 'src/app.ts', exports: [] },
      { path: 'src/config.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.fileOrganization).toBe('flat');
  });

  it('returns unknown for empty files list (organization)', () => {
    const conventions = detectConventions([], 'typescript');
    expect(conventions.fileOrganization).toBe('unknown');
  });

  // ─── Error Handling ─────────────────────────────────────────────────────────

  it('detects try-catch error handling in JS/TS', () => {
    const sourceSnippets = [
      'try { await doThing(); } catch (e) { logger.error(e); }',
      'try { x(); } catch (err) { throw new AppError(err); }',
    ];
    const conventions = detectConventions([], 'typescript', sourceSnippets);
    expect(conventions.errorHandling).toBe('try-catch');
  });

  it('detects promise-catch error handling', () => {
    const sourceSnippets = [
      'fetchData().catch(err => console.error(err));',
      'api.get("/users").then(res => res.data).catch(e => handleError(e));',
    ];
    const conventions = detectConventions([], 'typescript', sourceSnippets);
    expect(conventions.errorHandling).toBe('promise-catch');
  });

  it('detects result-type error handling', () => {
    const sourceSnippets = [
      'function parse(input: string): Result<Data, ParseError> { ... }',
      'const result: Either<Error, User> = await getUser(id);',
    ];
    const conventions = detectConventions([], 'typescript', sourceSnippets);
    expect(conventions.errorHandling).toBe('result-type');
  });

  it('detects Swift do-catch error handling', () => {
    const sourceSnippets = [
      'do { let data = try JSONDecoder().decode(User.self, from: raw) } catch { print(error) }',
      'do { try fileManager.removeItem(at: url) } catch { logger.error(error) }',
    ];
    const conventions = detectConventions([], 'swift', sourceSnippets);
    expect(conventions.errorHandling).toBe('do-catch');
  });

  it('detects Swift throws annotations', () => {
    const sourceSnippets = [
      'func loadUser(id: String) throws -> User {\n  guard let user = cache[id] else { throw AppError.notFound }\n  return user\n}',
      'func saveData() throws {\n  try encoder.encode(data)\n}',
    ];
    const conventions = detectConventions([], 'swift', sourceSnippets);
    expect(conventions.errorHandling).toBe('do-catch');
  });

  it('returns unknown for empty source snippets', () => {
    const conventions = detectConventions([], 'typescript', []);
    expect(conventions.errorHandling).toBe('unknown');
  });

  it('returns unknown when no error patterns found in source', () => {
    const sourceSnippets = ['const x = 1 + 2;', 'function hello() { return "world"; }'];
    const conventions = detectConventions([], 'typescript', sourceSnippets);
    expect(conventions.errorHandling).toBe('unknown');
  });

  // ─── Testing Patterns ──────────────────────────────────────────────────────

  it('detects co-located testing pattern', () => {
    const files = [
      { path: 'src/services/user.ts', exports: [] },
      { path: 'src/services/user.test.ts', exports: [] },
      { path: 'src/services/job.ts', exports: [] },
      { path: 'src/services/job.test.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.testingPatterns).toBe('co-located');
  });

  it('detects separate-directory testing pattern', () => {
    const files = [
      { path: 'src/services/user.ts', exports: [] },
      { path: 'src/services/job.ts', exports: [] },
      { path: 'tests/user.test.ts', exports: [] },
      { path: 'tests/job.test.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.testingPatterns).toBe('separate-directory');
  });

  it('returns none when no test files are present', () => {
    const files = [
      { path: 'src/services/user.ts', exports: [] },
      { path: 'src/services/job.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.testingPatterns).toBe('none');
  });

  // ─── Patterns ──────────────────────────────────────────────────────────────

  it('detects barrel-exports pattern', () => {
    const files = [
      { path: 'src/services/index.ts', exports: [] },
      { path: 'src/services/user.ts', exports: [] },
    ];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.patterns).toContain('barrel-exports');
  });

  it('detects service-pattern', () => {
    const files = [{ path: 'src/userService.ts', exports: ['UserService'] }];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.patterns).toContain('service-pattern');
  });

  it('detects trpc pattern for TS repos with router files', () => {
    const files = [{ path: 'src/routers/user.router.ts', exports: [] }];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.patterns).toContain('trpc');
  });

  it('detects SwiftUI pattern from exports', () => {
    const files = [{ path: 'App/HomeView.swift', exports: ['HomeView', 'body'] }];
    const conventions = detectConventions(files, 'swift');
    expect(conventions.patterns).toContain('swiftui');
  });

  it('detects MVVM pattern in Swift', () => {
    const files = [
      { path: 'App/UserViewModel.swift', exports: [] },
      { path: 'App/UserView.swift', exports: [] },
    ];
    const conventions = detectConventions(files, 'swift');
    expect(conventions.patterns).toContain('mvvm');
  });

  it('returns empty patterns for minimal projects', () => {
    const files = [{ path: 'src/app.ts', exports: ['main'] }];
    const conventions = detectConventions(files, 'typescript');
    expect(conventions.patterns).toEqual([]);
  });

  // ─── Integration: full result shape ────────────────────────────────────────

  it('returns a complete ConventionResult with all fields populated', () => {
    const files = [
      { path: 'src/services/userService.ts', exports: ['createUser', 'deleteUser'] },
      { path: 'src/services/userService.test.ts', exports: [] },
      { path: 'src/routers/user.router.ts', exports: [] },
      { path: 'src/routers/index.ts', exports: [] },
    ];
    const sourceSnippets = ['try { await db.query(); } catch (e) { throw new HttpError(500); }'];
    const conventions = detectConventions(files, 'typescript', sourceSnippets);

    expect(conventions.naming).toBe('camelCase');
    expect(conventions.fileOrganization).toBe('layer-based');
    expect(conventions.errorHandling).toBe('try-catch');
    expect(conventions.patterns).toContain('barrel-exports');
    expect(conventions.patterns).toContain('service-pattern');
    expect(conventions.patterns).toContain('trpc');
    expect(conventions.testingPatterns).toBe('co-located');
  });
});
