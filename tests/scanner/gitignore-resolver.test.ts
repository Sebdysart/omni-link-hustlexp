import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGitignoreResolver } from '../../engine/scanner/gitignore-resolver.js';

describe('gitignore-resolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-gitignore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores node_modules by default', () => {
    const resolver = createGitignoreResolver(tmpDir);
    const target = path.join(tmpDir, 'node_modules', 'lodash', 'index.js');
    expect(resolver.isIgnored(target)).toBe(true);
  });

  it('ignores .git by default', () => {
    const resolver = createGitignoreResolver(tmpDir);
    const target = path.join(tmpDir, '.git', 'config');
    expect(resolver.isIgnored(target)).toBe(true);
  });

  it('ignores dist by default', () => {
    const resolver = createGitignoreResolver(tmpDir);
    const target = path.join(tmpDir, 'dist', 'cli.js');
    expect(resolver.isIgnored(target)).toBe(true);
  });

  it('does not ignore regular source files', () => {
    const resolver = createGitignoreResolver(tmpDir);
    const target = path.join(tmpDir, 'src', 'index.ts');
    expect(resolver.isIgnored(target)).toBe(false);
  });

  it('applies extra patterns', () => {
    const resolver = createGitignoreResolver(tmpDir, ['*.log', 'tmp/']);
    const logFile = path.join(tmpDir, 'app.log');
    const tmpFile = path.join(tmpDir, 'tmp', 'cache.json');
    expect(resolver.isIgnored(logFile)).toBe(true);
    expect(resolver.isIgnored(tmpFile)).toBe(true);
  });

  it('returns false for paths outside repo (relative starts with ..)', () => {
    const resolver = createGitignoreResolver(tmpDir);
    const outside = path.join(tmpDir, '..', 'other-repo', 'file.ts');
    expect(resolver.isIgnored(outside)).toBe(false);
  });

  it('returns false for empty relative path', () => {
    const resolver = createGitignoreResolver(tmpDir);
    // Passing the repoPath itself yields an empty relative path
    expect(resolver.isIgnored(tmpDir)).toBe(false);
  });

  it('handles directories correctly (appends / for directory check)', () => {
    // Write a .gitignore that ignores a pattern only with trailing slash
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'logs/\n');
    const resolver = createGitignoreResolver(tmpDir);

    const logsDir = path.join(tmpDir, 'logs');
    // As a directory, should be ignored
    expect(resolver.isIgnored(logsDir, true)).toBe(true);
    // As a file named "logs", the trailing-slash gitignore rule does not match files
    expect(resolver.isIgnored(logsDir, false)).toBe(false);
  });

  it('handles missing .gitignore file gracefully', () => {
    // tmpDir has no .gitignore — should not throw
    const resolver = createGitignoreResolver(tmpDir);
    expect(resolver.isIgnored(path.join(tmpDir, 'src', 'main.ts'))).toBe(false);
    // Default patterns still work
    expect(resolver.isIgnored(path.join(tmpDir, 'node_modules', 'x'))).toBe(true);
  });

  it('reads patterns from .gitignore when it exists', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '*.secret\ncoverage/\n');
    const resolver = createGitignoreResolver(tmpDir);
    expect(resolver.isIgnored(path.join(tmpDir, 'api.secret'))).toBe(true);
    expect(resolver.isIgnored(path.join(tmpDir, 'coverage', 'lcov.info'))).toBe(true);
    expect(resolver.isIgnored(path.join(tmpDir, 'src', 'app.ts'))).toBe(false);
  });

  it('reads patterns from .claudeignore when it exists', () => {
    fs.writeFileSync(path.join(tmpDir, '.claudeignore'), '*.draft\n');
    const resolver = createGitignoreResolver(tmpDir);
    expect(resolver.isIgnored(path.join(tmpDir, 'notes.draft'))).toBe(true);
    expect(resolver.isIgnored(path.join(tmpDir, 'notes.txt'))).toBe(false);
  });
});
