import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore from 'ignore';

export interface GitignoreResolver {
  isIgnored(filePath: string, isDirectory?: boolean): boolean;
}

const DEFAULT_IGNORE_PATTERNS = ['node_modules/', '.git/', 'dist/', 'build/', '.next/'];

export function createGitignoreResolver(
  repoPath: string,
  extraPatterns: string[] = [],
): GitignoreResolver {
  const ig = ignore();
  ig.add([...DEFAULT_IGNORE_PATTERNS, ...extraPatterns]);

  const ignoreFiles = ['.gitignore', '.claudeignore'];

  for (const fileName of ignoreFiles) {
    const filePath = path.join(repoPath, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      ig.add(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      // Ignore malformed ignore files and continue with built-in defaults.
    }
  }

  return {
    isIgnored(filePath: string, isDirectory = false): boolean {
      const relativePath = path.relative(repoPath, filePath).replace(/\\/g, '/');
      if (relativePath === '' || relativePath.startsWith('..')) {
        return false;
      }

      const candidate =
        isDirectory && !relativePath.endsWith('/') ? `${relativePath}/` : relativePath;

      return ig.ignores(candidate);
    },
  };
}
