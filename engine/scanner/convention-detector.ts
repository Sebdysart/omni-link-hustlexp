// engine/scanner/convention-detector.ts — Detects naming, file org, error handling, and testing conventions
import type { NamingConvention } from '../types.js';

export interface FileInfo {
  path: string;
  exports: string[];
}

export interface ConventionResult {
  naming: NamingConvention;
  fileOrganization: string;
  errorHandling: string;
  patterns: string[];
  testingPatterns: string;
}

/**
 * Detect code conventions from file paths, export names, and optional source snippets.
 */
export function detectConventions(
  files: FileInfo[],
  language: string,
  sourceSnippets?: string[],
): ConventionResult {
  const naming = detectNaming(files, language);
  const fileOrganization = detectFileOrganization(files);
  const errorHandling = detectErrorHandling(sourceSnippets ?? [], language);
  const patterns = detectPatterns(files, language);
  const testingPatterns = detectTestingPatterns(files);

  return { naming, fileOrganization, errorHandling, patterns, testingPatterns };
}

// ─── Naming Convention ──────────────────────────────────────────────────────

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

function detectNaming(files: FileInfo[], _language: string): NamingConvention {
  const allExports = files.flatMap((f) => f.exports);

  if (allExports.length === 0) {
    // Fall back to file name analysis
    const fileNames = files
      .map((f) => {
        const base = f.path.split('/').pop() ?? '';
        return base.replace(/\.[^.]+$/, ''); // strip extension
      })
      .filter((n) => n.length > 0);

    return classifyNames(fileNames);
  }

  return classifyNames(allExports);
}

function classifyNames(names: string[]): NamingConvention {
  if (names.length === 0) return 'mixed';

  let camel = 0;
  let snake = 0;
  let pascal = 0;
  let kebab = 0;

  for (const name of names) {
    if (PASCAL_CASE.test(name)) {
      pascal++;
    } else if (CAMEL_CASE.test(name)) {
      camel++;
    } else if (SNAKE_CASE.test(name) && name.includes('_')) {
      // Only count as snake_case if it actually has underscores
      snake++;
    } else if (KEBAB_CASE.test(name) && name.includes('-')) {
      kebab++;
    }
  }

  const total = names.length;
  const threshold = 0.5; // majority wins

  if (camel / total >= threshold) return 'camelCase';
  if (snake / total >= threshold) return 'snake_case';
  if (pascal / total >= threshold) return 'PascalCase';
  if (kebab / total >= threshold) return 'kebab-case';
  return 'mixed';
}

// ─── File Organization ──────────────────────────────────────────────────────

/** Directories whose names indicate layer-based (responsibility-split) architecture */
const LAYER_DIRS = new Set([
  'services',
  'routes',
  'routers',
  'controllers',
  'models',
  'middleware',
  'utils',
  'helpers',
  'handlers',
  'repositories',
  'schemas',
  'validators',
  // iOS / SwiftUI conventions
  'screens',
  'views',
  'components',
  'viewmodels',
  'managers',
  'networking',
  'extensions',
]);

/** Directories specific to documentation / governance repos */
const DOC_DIRS = new Set(['specs', 'guides', 'reference', 'policies', 'adr', 'private-beta']);

function detectFileOrganization(files: FileInfo[]): string {
  if (files.length === 0) return 'unknown';

  // Extract all directory segments
  const dirMap = new Map<string, Set<string>>(); // dir -> set of file basenames (without extension)
  const allDirSegments = new Set<string>(); // every directory segment, lowercased

  for (const file of files) {
    // Skip test files for organization analysis
    if (isTestFile(file.path)) continue;

    const parts = file.path.split('/');
    if (parts.length < 2) continue;

    // Collect every directory segment for broad layer detection
    for (let i = 0; i < parts.length - 1; i++) {
      allDirSegments.add(parts[i].toLowerCase());
    }

    // Get parent directory
    const dir = parts.slice(0, -1).join('/');
    const basename = (parts.pop() ?? '').replace(/\.[^.]+$/, '');

    if (!dirMap.has(dir)) dirMap.set(dir, new Set());
    dirMap.get(dir)!.add(basename);
  }

  // Check for layer-based: directories named after architectural layers
  // Use allDirSegments (every segment at any depth) so nested patterns like
  // src/services/ or Screens/Auth/ still match.
  const allDirs = [...dirMap.keys()];
  const dirBasenames = allDirs.map((d) => d.split('/').pop()?.toLowerCase() ?? '');
  const layerDirCount = dirBasenames.filter((d) => LAYER_DIRS.has(d)).length;
  // Also count any segment match at any depth for repos with deep nesting
  const segmentLayerCount = [...allDirSegments].filter((s) => LAYER_DIRS.has(s)).length;
  const effectiveLayerCount = Math.max(layerDirCount, segmentLayerCount);

  // Check for feature-based: directories contain mixed file types (service + router + model)
  const ROLE_NAMES = new Set([
    'service',
    'router',
    'controller',
    'model',
    'handler',
    'schema',
    'index',
  ]);
  let featureDirs = 0;
  for (const [_dir, basenames] of dirMap) {
    const roles = [...basenames].filter((b) => ROLE_NAMES.has(b.toLowerCase()));
    if (roles.length >= 2) {
      featureDirs++;
    }
  }

  // Check for document/spec-based organization (common in docs repos)
  const docDirCount = [...allDirSegments].filter((s) => DOC_DIRS.has(s)).length;

  if (featureDirs > 0 && featureDirs >= effectiveLayerCount) {
    return 'feature-based';
  }
  if (effectiveLayerCount >= 2) {
    return 'layer-based';
  }
  if (docDirCount >= 2) {
    return 'doc-based';
  }

  return 'flat';
}

// ─── Error Handling ─────────────────────────────────────────────────────────

function detectErrorHandling(sourceSnippets: string[], language: string = ''): string {
  if (sourceSnippets.length === 0) return 'unknown';

  let tryCatch = 0;
  let promiseCatch = 0;
  let resultType = 0;
  let doCatch = 0; // Swift do-catch
  let throwsAnnotation = 0; // Swift throws keyword in function signatures

  for (const snippet of sourceSnippets) {
    // JS/TS try-catch (must not match Swift `try` keyword which is an expression)
    if (/try\s*\{[\s\S]*?\}\s*catch/.test(snippet)) tryCatch++;
    // Promise .catch()
    if (/\.catch\s*\(/.test(snippet)) promiseCatch++;
    // Result / Either monadic error handling
    if (/Result</.test(snippet) || /Either</.test(snippet)) resultType++;
    // Swift: do { ... } catch
    if (/do\s*\{[\s\S]*?\}\s*catch/.test(snippet)) doCatch++;
    // Swift: func ... throws (function signature annotation)
    if (/func\s+\w+[^{]*\bthrows\b/.test(snippet)) throwsAnnotation++;
  }

  // Combine Swift do-catch and throws into a unified "swift-errors" signal
  const swiftErrors = doCatch + throwsAnnotation;

  // Determine the dominant error handling strategy
  const candidates: Array<[string, number]> = [
    ['try-catch', tryCatch],
    ['promise-catch', promiseCatch],
    ['result-type', resultType],
  ];

  // Swift-specific: merge do-catch + throws into the appropriate bucket
  if (language === 'swift') {
    candidates.push(['do-catch', swiftErrors]);
  } else {
    // For non-Swift, treat do-catch as a variant of try-catch
    candidates[0] = ['try-catch', tryCatch + doCatch];
  }

  // Sort by count descending
  candidates.sort((a, b) => b[1] - a[1]);

  const [topLabel, topCount] = candidates[0];
  if (topCount > 0) return topLabel;

  return 'unknown';
}

// ─── Testing Patterns ───────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [/\.test\.[^.]+$/, /\.spec\.[^.]+$/, /_test\.[^.]+$/, /_spec\.[^.]+$/];

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((p) => p.test(path));
}

function detectTestingPatterns(files: FileInfo[]): string {
  const testFiles = files.filter((f) => isTestFile(f.path));
  const sourceFiles = files.filter((f) => !isTestFile(f.path));

  if (testFiles.length === 0) return 'none';

  // Check if test files are co-located (same directory as source)
  let coLocated = 0;
  let separated = 0;

  for (const testFile of testFiles) {
    const testDir = testFile.path.split('/').slice(0, -1).join('/');
    const testBasename = testFile.path
      .split('/')
      .pop()!
      .replace(/\.(test|spec)\.[^.]+$/, '')
      .replace(/_(test|spec)\.[^.]+$/, '');

    // Check if there's a matching source file in the same directory
    const hasCoLocatedSource = sourceFiles.some((sf) => {
      const sourceDir = sf.path.split('/').slice(0, -1).join('/');
      const sourceBasename = sf.path
        .split('/')
        .pop()!
        .replace(/\.[^.]+$/, '');
      return sourceDir === testDir && sourceBasename === testBasename;
    });

    if (hasCoLocatedSource) {
      coLocated++;
    } else {
      separated++;
    }
  }

  // Check if tests are in a dedicated test directory
  const testDirFiles = testFiles.filter(
    (f) =>
      f.path.includes('/tests/') || f.path.includes('/__tests__/') || f.path.startsWith('tests/'),
  );

  if (coLocated > separated) return 'co-located';
  if (testDirFiles.length > coLocated) return 'separate-directory';
  if (separated > coLocated) return 'separate-directory';

  return 'co-located';
}

// ─── Patterns ───────────────────────────────────────────────────────────────

function detectPatterns(files: FileInfo[], language: string): string[] {
  const patterns: string[] = [];

  // Check for barrel exports (index.ts files)
  const hasIndexFiles = files.some(
    (f) =>
      f.path.endsWith('/index.ts') ||
      f.path.endsWith('/index.js') ||
      f.path === 'index.ts' ||
      f.path === 'index.js',
  );
  if (hasIndexFiles) patterns.push('barrel-exports');

  // Check for service pattern
  const hasServices = files.some((f) => f.path.includes('service') || f.path.includes('Service'));
  if (hasServices) patterns.push('service-pattern');

  // Check for repository pattern
  const hasRepositories = files.some(
    (f) => f.path.includes('repository') || f.path.includes('Repository'),
  );
  if (hasRepositories) patterns.push('repository-pattern');

  // Check for middleware pattern
  const hasMiddleware = files.some(
    (f) => f.path.includes('middleware') || f.path.includes('Middleware'),
  );
  if (hasMiddleware) patterns.push('middleware-pattern');

  // Language-specific patterns
  if (language === 'typescript' || language === 'javascript') {
    const hasTrpc = files.some(
      (f) => f.path.includes('router') || f.path.includes('trpc') || /\/routers?\//.test(f.path),
    );
    if (hasTrpc) patterns.push('trpc');
  }

  if (language === 'swift') {
    const hasSwiftUI = files.some((f) =>
      f.exports.some((e) => e.includes('View') || e.includes('body')),
    );
    if (hasSwiftUI) patterns.push('swiftui');

    const hasMVVM = files.some((f) => f.path.includes('ViewModel') || f.path.includes('viewModel'));
    if (hasMVVM) patterns.push('mvvm');
  }

  return patterns;
}
