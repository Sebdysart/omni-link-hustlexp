import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { extractExports, extractRoutes } from '../scanner/api-extractor.js';
import { extractSchemas, extractTypes } from '../scanner/type-extractor.js';
import type {
  InternalDep,
  RepoConfig,
  RouteDefinition,
  SchemaDef,
  SourceKind,
  SymbolReference,
  TypeDef,
} from '../types.js';
import type { RepoAnalyzer, RepoSemanticAnalysis, SemanticFileAnalysis } from './types.js';

const SUPPORTED_LANGUAGES = new Set(['python', 'go', 'graphql', 'java', 'swift']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

function createMetadata(
  adapter: string,
  confidence: number,
  detail: string,
): {
  sourceKind: SourceKind;
  confidence: number;
  provenance: Array<{
    sourceKind: SourceKind;
    adapter: string;
    detail: string;
    confidence: number;
  }>;
} {
  return {
    sourceKind: 'semantic',
    confidence,
    provenance: [{ sourceKind: 'semantic', adapter, detail, confidence }],
  };
}

function addMetadata<T extends object>(
  entries: T[],
  adapter: string,
  confidence: number,
  detail: string,
): T[] {
  return entries.map((entry) => ({
    ...entry,
    ...createMetadata(adapter, confidence, detail),
  }));
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function ensureFileAnalysis(
  analysisByFile: Map<string, SemanticFileAnalysis>,
  filePath: string,
): SemanticFileAnalysis {
  const existing = analysisByFile.get(filePath);
  if (existing) {
    return existing;
  }

  const next: SemanticFileAnalysis = {
    exports: [],
    routes: [],
    procedures: [],
    types: [],
    schemas: [],
    imports: [],
    symbolReferences: [],
  };
  analysisByFile.set(filePath, next);
  return next;
}

function buildInternalDeps(
  fromFile: string,
  symbolTargets: Map<string, Set<string>>,
  adapter: string,
  confidence: number,
  detail: string,
): InternalDep[] {
  return [...symbolTargets.entries()]
    .filter(([toFile, names]) => toFile !== fromFile && names.size > 0)
    .map(([toFile, names]) => ({
      from: fromFile,
      to: toFile,
      imports: [...names].sort(),
      ...createMetadata(adapter, confidence, detail),
    }));
}

function pythonModuleIndex(repoPath: string, filePaths: string[]): Map<string, string> {
  const modules = new Map<string, string>();
  for (const filePath of filePaths) {
    const relPath = path.relative(repoPath, filePath).replace(/\\/g, '/');
    if (!relPath.endsWith('.py')) continue;

    const withoutExt = relPath.replace(/\.py$/, '');
    const parts = withoutExt.split('/');
    if (parts[parts.length - 1] === '__init__') {
      parts.pop();
    }
    const moduleName = parts.join('.');
    if (moduleName) {
      modules.set(moduleName, relPath);
    }
  }
  return modules;
}

function resolvePythonModule(
  moduleIndex: Map<string, string>,
  currentRelPath: string,
  rawModule: string,
): string | null {
  const relativeDots = rawModule.match(/^\.+/)?.[0].length ?? 0;
  const moduleName = rawModule.replace(/^\.+/, '');
  if (relativeDots > 0) {
    const currentDirParts = path.dirname(currentRelPath).replace(/\\/g, '/').split('/');
    const parentDepth = Math.max(0, relativeDots - 1);
    const baseParts = currentDirParts.slice(0, Math.max(0, currentDirParts.length - parentDepth));
    const resolved = [...baseParts, ...moduleName.split('.').filter(Boolean)].join('.');
    return moduleIndex.get(resolved) ?? null;
  }

  if (moduleIndex.has(moduleName)) {
    return moduleIndex.get(moduleName) ?? null;
  }

  const parts = moduleName.split('.');
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('.');
    if (moduleIndex.has(candidate)) {
      return moduleIndex.get(candidate) ?? null;
    }
  }

  return null;
}

function pythonImports(
  source: string,
  relPath: string,
  moduleIndex: Map<string, string>,
): Pick<SemanticFileAnalysis, 'imports' | 'symbolReferences'> {
  const imports: InternalDep[] = [];
  const symbolReferences: SymbolReference[] = [];
  const seen = new Set<string>();

  const importPattern = /^\s*import\s+([A-Za-z0-9_.,\s]+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    const importedModules = match[1]
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const importedModule of importedModules) {
      const [moduleName, alias] = importedModule.split(/\s+as\s+/);
      const targetFile = resolvePythonModule(moduleIndex, relPath, moduleName);
      if (!targetFile || targetFile === relPath) continue;
      const importedName = alias?.trim() || moduleName.split('.').pop() || moduleName;
      const dedupeKey = `${targetFile}:${importedName}:${match.index}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      imports.push({
        from: relPath,
        to: targetFile,
        imports: [importedName],
        ...createMetadata('python-import-resolver', 0.88, 'python local import'),
      });
      symbolReferences.push({
        name: importedName,
        kind: 'import',
        fromFile: relPath,
        toFile: targetFile,
        line: lineForIndex(source, match.index),
        ...createMetadata('python-import-resolver', 0.86, 'python import reference'),
      });
    }
  }

  const fromPattern = /^\s*from\s+([.A-Za-z0-9_]+)\s+import\s+([A-Za-z0-9_*,\s]+)$/gm;
  while ((match = fromPattern.exec(source)) !== null) {
    const targetFile = resolvePythonModule(moduleIndex, relPath, match[1]);
    if (!targetFile || targetFile === relPath) continue;
    const importedNames = match[2]
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== '*')
      .map((entry) => entry.split(/\s+as\s+/)[1] ?? entry.split(/\s+as\s+/)[0]);
    if (importedNames.length === 0) continue;
    const line = lineForIndex(source, match.index);

    imports.push({
      from: relPath,
      to: targetFile,
      imports: importedNames,
      ...createMetadata('python-import-resolver', 0.9, 'python from-import'),
    });
    symbolReferences.push(
      ...importedNames.map((name) => ({
        name,
        kind: 'import' as const,
        fromFile: relPath,
        toFile: targetFile,
        line,
        ...createMetadata('python-import-resolver', 0.88, 'python from-import reference'),
      })),
    );
  }

  return { imports, symbolReferences };
}

function pythonRoutes(source: string, relPath: string): RouteDefinition[] {
  const results: RouteDefinition[] = [];
  const decoratorPattern =
    /@(?:[A-Za-z_][A-Za-z0-9_]*\.)?(get|post|put|patch|delete|options|head)\(\s*['"]([^'"]+)['"][^\n]*\)\s*\n(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = decoratorPattern.exec(source)) !== null) {
    results.push({
      method: match[1].toUpperCase(),
      path: match[2],
      handler: match[3],
      file: relPath,
      line: lineForIndex(source, match.index),
      ...createMetadata('python-ast-rules', 0.9, 'python decorated route'),
    });
  }
  return results;
}

function goDirectoryIndex(repoPath: string, filePaths: string[]): Map<string, string[]> {
  const directories = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const relPath = path.relative(repoPath, filePath).replace(/\\/g, '/');
    if (!relPath.endsWith('.go')) continue;
    const dir = path.dirname(relPath).replace(/\\/g, '/');
    const entries = directories.get(dir) ?? [];
    entries.push(relPath);
    directories.set(dir, entries.sort());
  }
  return directories;
}

function resolveGoImport(
  currentRelPath: string,
  importPath: string,
  directoryIndex: Map<string, string[]>,
): string | null {
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    const resolvedDir = path
      .normalize(path.join(path.dirname(currentRelPath), importPath))
      .replace(/\\/g, '/');
    return directoryIndex.get(resolvedDir)?.[0] ?? null;
  }

  const segments = importPath.split('/').filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const suffix = segments.slice(index).join('/');
    const target = directoryIndex.get(suffix)?.[0];
    if (target) {
      return target;
    }
  }

  return null;
}

function goImports(
  source: string,
  relPath: string,
  directoryIndex: Map<string, string[]>,
): Pick<SemanticFileAnalysis, 'imports' | 'symbolReferences'> {
  const imports: InternalDep[] = [];
  const symbolReferences: SymbolReference[] = [];
  const blockPattern = /import\s*\(([\s\S]*?)\)/gm;
  const singleImportPattern = /^\s*import\s+(.+)$/gm;
  const candidateBodies: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(source)) !== null) {
    candidateBodies.push(match[1]);
  }

  while ((match = singleImportPattern.exec(source)) !== null) {
    if (!match[1].startsWith('(')) {
      candidateBodies.push(match[1]);
    }
  }

  const importPattern = /^(?:\s*([A-Za-z_][A-Za-z0-9_]*)\s+)?"([^"]+)"$/gm;
  for (const body of candidateBodies) {
    while ((match = importPattern.exec(body)) !== null) {
      const alias = match[1];
      const importPath = match[2];
      const targetFile = resolveGoImport(relPath, importPath, directoryIndex);
      if (!targetFile || targetFile === relPath) continue;
      const importedName = alias || importPath.split('/').pop() || importPath;
      imports.push({
        from: relPath,
        to: targetFile,
        imports: [importedName],
        ...createMetadata('go-import-resolver', 0.86, 'go local import'),
      });
      symbolReferences.push({
        name: importedName,
        kind: 'import',
        fromFile: relPath,
        toFile: targetFile,
        line: lineForIndex(source, source.indexOf(importPath)),
        ...createMetadata('go-import-resolver', 0.84, 'go import reference'),
      });
    }
    importPattern.lastIndex = 0;
  }

  return { imports, symbolReferences };
}

function goRoutes(source: string, relPath: string): RouteDefinition[] {
  const results: RouteDefinition[] = [];
  const memberPattern =
    /\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\(\s*"([^"]+)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = memberPattern.exec(source)) !== null) {
    results.push({
      method: match[1],
      path: match[2],
      handler: match[3],
      file: relPath,
      line: lineForIndex(source, match.index),
      ...createMetadata('go-router-rules', 0.87, 'go method route'),
    });
  }

  const handleFuncPattern =
    /HandleFunc\(\s*"([^"]+)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\.Methods\(\s*"([A-Z]+)"/g;
  while ((match = handleFuncPattern.exec(source)) !== null) {
    if (!HTTP_METHODS.has(match[3])) continue;
    results.push({
      method: match[3],
      path: match[1],
      handler: match[2],
      file: relPath,
      line: lineForIndex(source, match.index),
      ...createMetadata('go-router-rules', 0.89, 'go HandleFunc route'),
    });
  }

  return results;
}

function joinRoutePath(basePath: string, routePath: string): string {
  const normalizedBase = basePath && basePath !== '/' ? basePath.replace(/\/$/, '') : '';
  const normalizedRoute = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return normalizedBase ? `${normalizedBase}${normalizedRoute}` : normalizedRoute;
}

function javaRoutes(source: string, relPath: string): RouteDefinition[] {
  const results: RouteDefinition[] = [];
  const basePath =
    source.match(
      /@RequestMapping\(\s*(?:value\s*=\s*)?"([^"]+)"[^)]*\)\s*(?:public\s+)?class/m,
    )?.[1] ?? '';
  const verbMappings = new Map<string, string>([
    ['GetMapping', 'GET'],
    ['PostMapping', 'POST'],
    ['PutMapping', 'PUT'],
    ['PatchMapping', 'PATCH'],
    ['DeleteMapping', 'DELETE'],
  ]);
  const annotationPattern =
    /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\(\s*(?:value\s*=\s*)?"([^"]+)"[^)]*\)\s*(?:public|protected|private)\s+[^{;=]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  const requestMappingPattern =
    /@RequestMapping\(\s*(?:value\s*=\s*)?"([^"]+)"[^)]*method\s*=\s*RequestMethod\.([A-Z]+)[^)]*\)\s*(?:public|protected|private)\s+[^{;=]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let match: RegExpExecArray | null;

  while ((match = annotationPattern.exec(source)) !== null) {
    results.push({
      method: verbMappings.get(match[1]) ?? match[1].replace('Mapping', '').toUpperCase(),
      path: joinRoutePath(basePath, match[2]),
      handler: match[3],
      file: relPath,
      line: lineForIndex(source, match.index),
      ...createMetadata('java-spring-rules', 0.89, 'java Spring route'),
    });
  }

  while ((match = requestMappingPattern.exec(source)) !== null) {
    if (!HTTP_METHODS.has(match[2])) continue;
    results.push({
      method: match[2],
      path: joinRoutePath(basePath, match[1]),
      handler: match[3],
      file: relPath,
      line: lineForIndex(source, match.index),
      ...createMetadata('java-spring-rules', 0.87, 'java RequestMapping route'),
    });
  }

  return results;
}

function javaTypeIndex(sourceByFile: Map<string, string>): Map<string, string> {
  const index = new Map<string, string>();
  const typePattern = /\b(?:public\s+)?(?:class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const [relPath, source] of sourceByFile.entries()) {
    const packageName = source.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/m)?.[1];
    let match: RegExpExecArray | null;

    while ((match = typePattern.exec(source)) !== null) {
      const typeName = match[1];
      const fullyQualifiedName = packageName ? `${packageName}.${typeName}` : typeName;
      index.set(fullyQualifiedName, relPath);
      if (!index.has(typeName)) {
        index.set(typeName, relPath);
      }
    }
  }

  return index;
}

function javaImports(
  source: string,
  relPath: string,
  typeIndex: Map<string, string>,
): Pick<SemanticFileAnalysis, 'imports' | 'symbolReferences'> {
  const symbolTargets = new Map<string, Set<string>>();
  const symbolReferences: SymbolReference[] = [];
  const importPattern = /^\s*import\s+([A-Za-z0-9_.*]+)\s*;/gm;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(source)) !== null) {
    const importPath = match[1];
    if (importPath.endsWith('.*')) {
      continue;
    }
    const typeName = importPath.split('.').pop() ?? importPath;
    const targetFile = typeIndex.get(importPath) ?? typeIndex.get(typeName);
    if (!targetFile || targetFile === relPath) continue;

    const targetNames = symbolTargets.get(targetFile) ?? new Set<string>();
    targetNames.add(typeName);
    symbolTargets.set(targetFile, targetNames);
    symbolReferences.push({
      name: typeName,
      kind: 'import',
      fromFile: relPath,
      toFile: targetFile,
      line: lineForIndex(source, match.index),
      ...createMetadata('java-import-resolver', 0.9, 'java local import'),
    });
  }

  return {
    imports: buildInternalDeps(
      relPath,
      symbolTargets,
      'java-import-resolver',
      0.9,
      'java local import',
    ),
    symbolReferences,
  };
}

function swiftSymbolIndex(
  config: RepoConfig,
  sourceByFile: Map<string, string>,
): {
  symbolToFile: Map<string, string>;
  fileToSymbols: Map<string, Set<string>>;
} {
  const symbolToFile = new Map<string, string>();
  const fileToSymbols = new Map<string, Set<string>>();

  for (const [relPath, source] of sourceByFile.entries()) {
    const symbols = new Set<string>();
    for (const exportDef of extractExports(source, relPath, 'swift')) {
      symbols.add(exportDef.name);
      if (!symbolToFile.has(exportDef.name)) {
        symbolToFile.set(exportDef.name, relPath);
      }
    }
    for (const typeDef of extractTypes(source, relPath, 'swift', config.name)) {
      symbols.add(typeDef.name);
      if (!symbolToFile.has(typeDef.name)) {
        symbolToFile.set(typeDef.name, relPath);
      }
    }
    fileToSymbols.set(relPath, symbols);
  }

  return { symbolToFile, fileToSymbols };
}

function swiftReferences(
  source: string,
  relPath: string,
  symbolIndex: Map<string, string>,
  ownSymbols: Set<string>,
): Pick<SemanticFileAnalysis, 'imports' | 'symbolReferences'> {
  const symbolTargets = new Map<string, Set<string>>();
  const symbolReferences: SymbolReference[] = [];
  const seen = new Set<string>();
  const identifierPattern = /\b([A-Z][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null;

  while ((match = identifierPattern.exec(source)) !== null) {
    const symbolName = match[1];
    if (ownSymbols.has(symbolName)) continue;
    const targetFile = symbolIndex.get(symbolName);
    if (!targetFile || targetFile === relPath) continue;
    const line = lineForIndex(source, match.index);
    const dedupeKey = `${targetFile}:${symbolName}:${line}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const targetNames = symbolTargets.get(targetFile) ?? new Set<string>();
    targetNames.add(symbolName);
    symbolTargets.set(targetFile, targetNames);
    symbolReferences.push({
      name: symbolName,
      kind: 'type',
      fromFile: relPath,
      toFile: targetFile,
      line,
      ...createMetadata('swift-symbol-resolver', 0.84, 'swift local type reference'),
    });
  }

  return {
    imports: buildInternalDeps(
      relPath,
      symbolTargets,
      'swift-symbol-resolver',
      0.84,
      'swift local symbol dependency',
    ),
    symbolReferences,
  };
}

function graphQlTypes(source: string, repo: RepoConfig, relPath: string): TypeDef[] {
  const results: TypeDef[] = [];
  const blockPattern = /\b(type|input|interface)\s+([A-Za-z0-9_]+)[^{]*\{([\s\S]*?)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(source)) !== null) {
    const fields = [
      ...match[3].matchAll(/^\s*([A-Za-z0-9_]+)\s*(?:\([^)]*\))?\s*:\s*([^\s#]+)/gm),
    ].map((fieldMatch) => ({
      name: fieldMatch[1],
      type: fieldMatch[2],
      optional: !fieldMatch[2].endsWith('!'),
    }));
    results.push({
      name: match[2],
      fields,
      source: { repo: repo.name, file: relPath, line: lineForIndex(source, match.index) },
      ...createMetadata('graphql-schema', 0.87, `graphql ${match[1]} definition`),
    });
  }
  return results;
}

function graphQlSchemas(source: string, repo: RepoConfig, relPath: string): SchemaDef[] {
  return [...source.matchAll(/\binput\s+([A-Za-z0-9_]+)[^{]*\{([\s\S]*?)\}/gm)].map((match) => ({
    name: match[1],
    kind: 'other' as const,
    fields: [...match[2].matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*([^\s#]+)/gm)].map((fieldMatch) => ({
      name: fieldMatch[1],
      type: fieldMatch[2],
      optional: !fieldMatch[2].endsWith('!'),
    })),
    source: { repo: repo.name, file: relPath, line: lineForIndex(source, match.index) },
    ...createMetadata('graphql-schema', 0.84, 'graphql input schema'),
  }));
}

class SourceSemanticAnalyzer implements RepoAnalyzer {
  readonly id = 'source-structured';

  supports(config: RepoConfig): boolean {
    return SUPPORTED_LANGUAGES.has(config.language);
  }

  async analyzeRepo(config: RepoConfig, filePaths: string[]): Promise<RepoSemanticAnalysis | null> {
    if (!this.supports(config) || filePaths.length === 0) {
      return null;
    }

    const analysisByFile = new Map<string, SemanticFileAnalysis>();
    const sourceByFile = new Map<string, string>();

    for (const filePath of filePaths) {
      const relPath = path.relative(config.path, filePath).replace(/\\/g, '/');
      sourceByFile.set(relPath, await fs.readFile(filePath, 'utf-8'));
    }

    const pythonModules =
      config.language === 'python' ? pythonModuleIndex(config.path, filePaths) : null;
    const goDirectories =
      config.language === 'go' ? goDirectoryIndex(config.path, filePaths) : null;
    const javaTypes = config.language === 'java' ? javaTypeIndex(sourceByFile) : null;
    const swiftSymbols =
      config.language === 'swift' ? swiftSymbolIndex(config, sourceByFile) : null;

    for (const [relPath, source] of sourceByFile.entries()) {
      const fileAnalysis = ensureFileAnalysis(analysisByFile, relPath);

      fileAnalysis.exports.push(
        ...addMetadata(
          extractExports(source, relPath, config.language),
          this.id,
          0.82,
          `${config.language} structured export`,
        ),
      );

      const baseRoutes = addMetadata(
        extractRoutes(source, relPath, config.language),
        this.id,
        0.82,
        `${config.language} structured route`,
      );
      fileAnalysis.routes.push(...baseRoutes);

      fileAnalysis.types.push(
        ...addMetadata(
          config.language === 'graphql'
            ? graphQlTypes(source, config, relPath)
            : extractTypes(source, relPath, config.language, config.name),
          this.id,
          0.84,
          `${config.language} structured type`,
        ),
      );

      fileAnalysis.schemas.push(
        ...addMetadata(
          config.language === 'graphql'
            ? graphQlSchemas(source, config, relPath)
            : extractSchemas(source, relPath, config.language, config.name),
          this.id,
          0.82,
          `${config.language} structured schema`,
        ),
      );

      if (config.language === 'python' && pythonModules) {
        const imports = pythonImports(source, relPath, pythonModules);
        fileAnalysis.imports.push(...imports.imports);
        fileAnalysis.symbolReferences.push(...imports.symbolReferences);
        fileAnalysis.routes.push(...pythonRoutes(source, relPath));
      }

      if (config.language === 'go' && goDirectories) {
        const imports = goImports(source, relPath, goDirectories);
        fileAnalysis.imports.push(...imports.imports);
        fileAnalysis.symbolReferences.push(...imports.symbolReferences);
        fileAnalysis.routes.push(...goRoutes(source, relPath));
      }

      if (config.language === 'java' && javaTypes) {
        const imports = javaImports(source, relPath, javaTypes);
        fileAnalysis.imports.push(...imports.imports);
        fileAnalysis.symbolReferences.push(...imports.symbolReferences);
        fileAnalysis.routes.push(...javaRoutes(source, relPath));
      }

      if (config.language === 'swift' && swiftSymbols) {
        const references = swiftReferences(
          source,
          relPath,
          swiftSymbols.symbolToFile,
          swiftSymbols.fileToSymbols.get(relPath) ?? new Set<string>(),
        );
        fileAnalysis.imports.push(...references.imports);
        fileAnalysis.symbolReferences.push(...references.symbolReferences);
      }
    }

    return {
      adapter: this.id,
      files: analysisByFile,
    };
  }
}

export const sourceSemanticAnalyzer = new SourceSemanticAnalyzer();
