import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ApiBridge,
  AuthorityState,
  EcosystemGraph,
  Mismatch,
  OmniLinkConfig,
  RepoConfig,
  ReviewFinding,
  TypeDef,
} from '../types.js';
import { createGitignoreResolver } from '../scanner/gitignore-resolver.js';

export interface SwiftTrpcCall {
  repo: string;
  file: string;
  line: number;
  router: string;
  procedure: string;
  inputType?: string;
  outputType?: string;
  inputTypeDef?: TypeDef;
  outputTypeDef?: TypeDef;
}

export interface BackendProcedureRef {
  repo: string;
  router: string;
  procedure: string;
  kind: 'query' | 'mutation' | 'subscription';
  file: string;
  line: number;
  inputType?: string;
  outputType?: string;
}

export interface SwiftTrpcBridgeAnalysis {
  bridges: ApiBridge[];
  mismatches: Mismatch[];
  findings: ReviewFinding[];
  iosCalls: SwiftTrpcCall[];
  backendProcedures: BackendProcedureRef[];
}

const DEFAULT_SWIFT_TRPC_PATTERN =
  'trpc\\.call\\(\\s*router:\\s*"(?<router>[A-Za-z_][A-Za-z0-9_]*)"\\s*,\\s*procedure:\\s*"(?<procedure>[A-Za-z_][A-Za-z0-9_]*)"';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function uniquePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const pattern of patterns) {
    const normalized = pattern.trim();
    if (normalized === '' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function patternCandidates(patternSource: string): string[] {
  return uniquePatterns([
    patternSource,
    patternSource.replace(/\\\\/g, '\\'),
    DEFAULT_SWIFT_TRPC_PATTERN,
  ]);
}

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function emptyType(name: string, repo: string, file = 'unknown', line = 0): TypeDef {
  return {
    name,
    fields: [],
    source: { repo, file, line },
  };
}

function compareFields(
  key: string,
  label: 'input' | 'output',
  authorityType: TypeDef,
  actualType: TypeDef,
  provider: { repo: string; file: string; line: number },
  consumer: { repo: string; file: string; line: number },
): Mismatch[] {
  if (authorityType.fields.length === 0 || actualType.fields.length === 0) {
    return [];
  }

  const mismatches: Mismatch[] = [];
  const authorityFields = new Map(authorityType.fields.map((field) => [field.name, field]));
  const actualFields = new Map(actualType.fields.map((field) => [field.name, field]));

  for (const [fieldName, authorityField] of authorityFields) {
    const actualField = actualFields.get(fieldName);
    if (!actualField) {
      if (authorityField.optional) {
        continue;
      }

      mismatches.push(
        bridgeMismatch(
          'missing-field',
          'warning',
          `Swift ${label} payload for '${key}' is missing '${fieldName}' from the docs authority.`,
          {
            repo: provider.repo,
            file: provider.file,
            line: provider.line,
            field: fieldName,
          },
          {
            repo: consumer.repo,
            file: consumer.file,
            line: consumer.line,
            field: fieldName,
          },
        ),
      );
      continue;
    }

    const normalizedAuthorityType = normalizeComparableType(authorityField.type, fieldName);
    const normalizedActualType = normalizeComparableType(actualField.type, fieldName);

    if (normalizedAuthorityType !== normalizedActualType) {
      mismatches.push(
        bridgeMismatch(
          'type-mismatch',
          'warning',
          `Swift ${label} payload for '${key}.${fieldName}' uses '${actualField.type}', but docs authority expects '${authorityField.type}'.`,
          {
            repo: provider.repo,
            file: provider.file,
            line: provider.line,
            field: fieldName,
          },
          {
            repo: consumer.repo,
            file: consumer.file,
            line: consumer.line,
            field: fieldName,
          },
        ),
      );
    }
  }

  for (const [fieldName] of actualFields) {
    if (!authorityFields.has(fieldName)) {
      mismatches.push(
        bridgeMismatch(
          'extra-field',
          'info',
          `Swift ${label} payload for '${key}' includes '${fieldName}', which is not declared in the docs authority.`,
          {
            repo: provider.repo,
            file: provider.file,
            line: provider.line,
            field: fieldName,
          },
          {
            repo: consumer.repo,
            file: consumer.file,
            line: consumer.line,
            field: fieldName,
          },
        ),
      );
    }
  }

  return mismatches;
}

function normalizeComparableType(rawType: string | undefined, fieldName: string): string {
  if (!rawType) {
    return 'unknown';
  }

  const trimmed = rawType.replace(/\s+/g, ' ').trim();
  const withoutNullish = trimmed
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== 'null' && part !== 'undefined')
    .join(' | ');
  const optionalNormalized = withoutNullish.replace(/[?!]$/, '').trim();

  const swiftArrayMatch = optionalNormalized.match(/^\[([A-Za-z0-9_<>.? ]+)\]$/);
  if (swiftArrayMatch) {
    return `${normalizeComparableType(swiftArrayMatch[1], fieldName)}[]`;
  }

  const genericArrayMatch = optionalNormalized.match(/^Array<(.+)>$/);
  if (genericArrayMatch) {
    return `${normalizeComparableType(genericArrayMatch[1], fieldName)}[]`;
  }

  const compact = optionalNormalized.replace(/\s+/g, '');
  if (compact.endsWith('[]')) {
    return `${normalizeComparableType(compact.slice(0, -2), fieldName)}[]`;
  }

  if (/^'(?:[^']+)'(?:\|'(?:[^']+)')+$/.test(compact)) {
    return 'string-enum';
  }

  if (
    compact === 'string' ||
    compact === 'String' ||
    compact === 'UUID' ||
    compact === 'URL' ||
    compact === 'StringProtocol'
  ) {
    return 'string';
  }

  if (
    compact === 'number' ||
    compact === 'Int' ||
    compact === 'Int8' ||
    compact === 'Int16' ||
    compact === 'Int32' ||
    compact === 'Int64' ||
    compact === 'UInt' ||
    compact === 'UInt8' ||
    compact === 'UInt16' ||
    compact === 'UInt32' ||
    compact === 'UInt64' ||
    compact === 'Double' ||
    compact === 'Float' ||
    compact === 'CGFloat' ||
    compact === 'NSNumber'
  ) {
    return 'number';
  }

  if (compact === 'boolean' || compact === 'Bool') {
    return 'boolean';
  }

  if (compact === 'Date') {
    return 'string';
  }

  if (/^[A-Z][A-Za-z0-9_]*$/.test(compact)) {
    if (/(State|Status|Tier|Mode|Role|Decision|Kind|Level)$/.test(compact)) {
      return 'string-enum';
    }

    if (fieldName.endsWith('At') || fieldName.endsWith('Date') || fieldName.endsWith('Until')) {
      return 'string';
    }
  }

  return compact;
}

function simplifyTypeExpression(expression: string | undefined): string | undefined {
  if (!expression) {
    return undefined;
  }

  const normalized = expression.replace(/\s+/g, ' ').trim();
  if (normalized === '') {
    return undefined;
  }

  if (normalized.startsWith('Schemas.')) {
    return normalized.slice('Schemas.'.length);
  }

  const explicitType = normalized.match(/^([A-Za-z_][A-Za-z0-9_<>.?]*(?:\[\])*)/);
  if (explicitType) {
    return explicitType[1];
  }

  if (normalized.startsWith('z.object(')) {
    return 'inline-object';
  }

  if (normalized.startsWith('z.array(')) {
    return 'array';
  }

  return normalized.slice(0, 40);
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractSwiftTypeDefinitions(
  source: string,
  repo: string,
  file: string,
): Map<string, TypeDef> {
  const results = new Map<string, TypeDef>();
  const typePattern =
    /(?:^|\n)\s*(?:private\s+|fileprivate\s+|internal\s+|public\s+)?(?:struct|class)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^\n{]*Codable[^{]*\{/g;

  let match: RegExpExecArray | null;
  while ((match = typePattern.exec(source)) !== null) {
    const name = match[1];
    const openIndex = source.indexOf('{', match.index);
    if (openIndex === -1) {
      continue;
    }

    const closeIndex = findMatchingBrace(source, openIndex);
    if (closeIndex === -1) {
      continue;
    }

    const body = source.slice(openIndex + 1, closeIndex);
    const fields = body
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .flatMap((line) => {
        if (line === '' || /{\s*$/.test(line)) {
          return [];
        }

        const fieldMatch =
          /^(?:@[\w().]+(?:\s+)?)*(?:private\s+|fileprivate\s+|internal\s+|public\s+)?(?:let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+?)(?:\s*=.*)?$/.exec(
            line,
          );
        if (!fieldMatch) {
          return [];
        }

        return [
          {
            name: fieldMatch[1],
            type: fieldMatch[2].trim(),
            optional: /\?$/.test(fieldMatch[2].trim()),
          },
        ];
      });

    results.set(name, {
      name,
      fields,
      source: {
        repo,
        file,
        line: lineNumberForIndex(source, match.index),
      },
      sourceKind: 'semantic',
      confidence: fields.length > 0 ? 0.83 : 0.69,
      provenance: [
        {
          sourceKind: 'semantic',
          adapter: 'hustlexp-swift-trpc-bridge',
          detail: 'Swift Codable type definition',
          confidence: fields.length > 0 ? 0.83 : 0.69,
        },
      ],
    });
  }

  return results;
}

function parseSwiftCallOutputType(source: string, matchIndex: number): string | undefined {
  const prefix = source.slice(Math.max(0, matchIndex - 220), matchIndex);
  const outputMatch =
    /(?:let|var)\s+[^:=]+\s*:\s*([A-Za-z_][A-Za-z0-9_<>.? ,]*(?:\[\])*)\s*=\s*try\s+await\s*$/.exec(
      prefix,
    );
  return outputMatch?.[1]?.trim();
}

function parseSwiftCallInputType(callSnippet: string): string | undefined {
  const constructorMatch = /input:\s*([A-Za-z_][A-Za-z0-9_<>.?]*(?:\[\])*)\s*\(/.exec(callSnippet);
  if (constructorMatch) {
    return constructorMatch[1];
  }

  const typedNilMatch = /input:\s*([A-Za-z_][A-Za-z0-9_<>.?]*(?:\[\])*)\s*\?/.exec(callSnippet);
  if (typedNilMatch) {
    return typedNilMatch[1];
  }

  return undefined;
}

function walkSwiftFiles(repo: RepoConfig): string[] {
  const results: string[] = [];
  const stack = [repo.path];
  const ignoreResolver = createGitignoreResolver(repo.path, repo.exclude ?? []);

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreResolver.isIgnored(fullPath, true)) {
          stack.push(fullPath);
        }
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith('.swift') &&
        !ignoreResolver.isIgnored(fullPath) &&
        !entry.name.endsWith('Tests.swift')
      ) {
        const relativePath = normalizePath(path.relative(repo.path, fullPath));
        if (relativePath.includes('/Services/') || relativePath.endsWith('/TRPCClient.swift')) {
          results.push(fullPath);
        }
      }
    }
  }

  return results.sort();
}

export function extractSwiftTrpcCalls(repo: RepoConfig, patternSource: string): SwiftTrpcCall[] {
  const swiftFiles = walkSwiftFiles(repo);
  const fileSources = swiftFiles.flatMap((filePath) => {
    try {
      const relPath = normalizePath(path.relative(repo.path, filePath));
      const source = fs.readFileSync(filePath, 'utf-8');
      return [
        {
          filePath,
          relPath,
          source,
          typeDefs: extractSwiftTypeDefinitions(source, repo.name, relPath),
        },
      ];
    } catch {
      return [];
    }
  });

  for (const candidate of patternCandidates(patternSource)) {
    let callPattern: RegExp;
    try {
      callPattern = new RegExp(candidate, 'g');
    } catch {
      continue;
    }

    if (callPattern.test('') || callPattern.source === '(?:)') {
      continue;
    }

    const calls: SwiftTrpcCall[] = [];

    for (const fileSource of fileSources) {
      callPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(fileSource.source)) !== null) {
        const router = match.groups?.router ?? match[1];
        const procedure = match.groups?.procedure ?? match[2];
        if (!router || !procedure) {
          if (match[0] === '') {
            break;
          }
          continue;
        }

        const matchIndex = match.index ?? 0;
        const outputType = parseSwiftCallOutputType(fileSource.source, matchIndex);
        const inputType = parseSwiftCallInputType(
          fileSource.source.slice(matchIndex, Math.min(fileSource.source.length, matchIndex + 400)),
        );
        calls.push({
          repo: repo.name,
          file: fileSource.relPath,
          line: lineNumberForIndex(fileSource.source, matchIndex),
          router,
          procedure,
          inputType,
          outputType,
          inputTypeDef: inputType ? fileSource.typeDefs.get(inputType) : undefined,
          outputTypeDef: outputType ? fileSource.typeDefs.get(outputType) : undefined,
        });

        if (match[0] === '') {
          break;
        }
      }
    }

    if (calls.length > 0) {
      return calls;
    }
  }

  return [];
}

function parseRouterImports(indexSource: string, indexPath: string): Map<string, string> {
  const imports = new Map<string, string>();
  const importPattern = /import\s+\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\s+from\s+'(\.\/[^']+)';/g;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(indexSource)) !== null) {
    const variableName = match[1];
    const specifier = match[2];
    imports.set(
      variableName,
      normalizePath(
        path.relative(
          path.dirname(indexPath),
          path.resolve(path.dirname(indexPath), `${specifier}.ts`),
        ),
      ),
    );
  }

  return imports;
}

function extractRouteFiles(
  indexSource: string,
  indexPath: string,
): Array<{ route: string; file: string }> {
  const imports = parseRouterImports(indexSource, indexPath);
  const routerBodyMatch = /export const appRouter = router\(\{([\s\S]*?)\}\);/m.exec(indexSource);
  if (!routerBodyMatch) {
    return [];
  }

  const results: Array<{ route: string; file: string }> = [];
  const routePattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,?$/gm;
  let match: RegExpExecArray | null;

  while ((match = routePattern.exec(routerBodyMatch[1])) !== null) {
    const route = match[1];
    const routerVariable = match[2];
    const file = imports.get(routerVariable);
    if (file) {
      results.push({ route, file });
    }
  }

  return results;
}

function enrichWithManifestTypes(
  manifest: EcosystemGraph['repos'][number],
  file: string,
  procedure: string,
  line: number,
): Pick<BackendProcedureRef, 'inputType' | 'outputType'> {
  const normalizedFile = normalizePath(file);
  const matches = manifest.apiSurface.procedures
    .filter((entry) => normalizePath(entry.file) === normalizedFile && entry.name === procedure)
    .sort((left, right) => Math.abs(left.line - line) - Math.abs(right.line - line));
  const closest = matches[0];

  return {
    inputType: closest?.inputType,
    outputType: closest?.outputType,
  };
}

function extractProcedureInputType(snippet: string): string | undefined {
  const inputMatch = /\.input\(([\s\S]{0,240}?)\)\s*\.(?:query|mutation|subscription)\s*\(/.exec(
    snippet,
  );
  return simplifyTypeExpression(inputMatch?.[1]);
}

function extractTopLevelRouterEntries(
  source: string,
): Array<{ name: string; kind: BackendProcedureRef['kind']; snippet: string; line: number }> {
  const routerOpenMatch = /router\(\{/.exec(source);
  if (!routerOpenMatch) {
    return [];
  }

  const openBraceIndex = source.indexOf('{', routerOpenMatch.index);
  if (openBraceIndex === -1) {
    return [];
  }

  const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
  if (closeBraceIndex === -1) {
    return [];
  }

  const body = source.slice(openBraceIndex + 1, closeBraceIndex);
  const lines = body.split('\n');
  const entries: Array<{
    name: string;
    kind: BackendProcedureRef['kind'];
    snippet: string;
    line: number;
  }> = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let currentEntry:
    | {
        name: string;
        startLine: number;
        snippetLines: string[];
      }
    | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    const propertyMatch =
      braceDepth === 0 && parenDepth === 0 && bracketDepth === 0
        ? /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(trimmed)
        : null;

    if (propertyMatch) {
      if (currentEntry) {
        const snippet = currentEntry.snippetLines.join('\n');
        const kindMatch = /\.(query|mutation|subscription)\s*\(/.exec(snippet);
        if (kindMatch) {
          entries.push({
            name: currentEntry.name,
            kind: kindMatch[1] as BackendProcedureRef['kind'],
            snippet,
            line: currentEntry.startLine,
          });
        }
      }

      currentEntry = {
        name: propertyMatch[1],
        startLine: lineIndex + lineNumberForIndex(source, openBraceIndex),
        snippetLines: [line],
      };
    } else if (currentEntry) {
      currentEntry.snippetLines.push(line);
    }

    for (const char of line) {
      if (char === '{') {
        braceDepth += 1;
      } else if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === '(') {
        parenDepth += 1;
      } else if (char === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === '[') {
        bracketDepth += 1;
      } else if (char === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
    }
  }

  if (currentEntry) {
    const snippet = currentEntry.snippetLines.join('\n');
    const kindMatch = /\.(query|mutation|subscription)\s*\(/.exec(snippet);
    if (kindMatch) {
      entries.push({
        name: currentEntry.name,
        kind: kindMatch[1] as BackendProcedureRef['kind'],
        snippet,
        line: currentEntry.startLine,
      });
    }
  }

  return entries;
}

function extractRouterProcedures(
  source: string,
  repoId: string,
  router: string,
  relFile: string,
  manifest: EcosystemGraph['repos'][number],
): BackendProcedureRef[] {
  return extractTopLevelRouterEntries(source).map((entry) => {
    const semanticTypes = enrichWithManifestTypes(manifest, relFile, entry.name, entry.line);
    return {
      repo: repoId,
      router,
      procedure: entry.name,
      kind: entry.kind,
      file: relFile,
      line: entry.line,
      inputType: extractProcedureInputType(entry.snippet) ?? semanticTypes.inputType,
      outputType: semanticTypes.outputType,
    };
  });
}

export function extractBackendProcedureRefs(
  manifest: EcosystemGraph['repos'][number],
  backendRepoPath: string,
  authoritativeBackendRoot = path.join('backend', 'src'),
): BackendProcedureRef[] {
  const normalizedRoot = normalizePath(authoritativeBackendRoot);
  const indexPath = path.join(backendRepoPath, normalizedRoot, 'routers', 'index.ts');

  try {
    const indexSource = fs.readFileSync(indexPath, 'utf-8');
    const routeFiles = extractRouteFiles(indexSource, indexPath);
    const procedures = routeFiles.flatMap(({ route, file }) => {
      const absolutePath = path.resolve(path.dirname(indexPath), file);
      try {
        const source = fs.readFileSync(absolutePath, 'utf-8');
        const relFile = normalizePath(path.relative(backendRepoPath, absolutePath));
        return extractRouterProcedures(source, manifest.repoId, route, relFile, manifest);
      } catch {
        return [];
      }
    });

    if (procedures.length > 0) {
      return procedures;
    }
  } catch {
    // Fall back to the baseline manifest if source extraction is unavailable.
  }

  return manifest.apiSurface.procedures
    .filter((procedure) => normalizePath(procedure.file).startsWith(normalizedRoot))
    .map((procedure) => ({
      repo: manifest.repoId,
      router: path.basename(procedure.file, path.extname(procedure.file)),
      procedure: procedure.name,
      kind: procedure.kind,
      file: normalizePath(procedure.file),
      line: procedure.line,
      inputType: procedure.inputType,
      outputType: procedure.outputType,
    }))
    .filter((procedure) => procedure.router !== 'index' && procedure.router !== 'trpc');
}

/**
 * Compute variable confidence for bridge mismatches based on match quality.
 * Factors:
 * - Mismatch kind: procedure name match vs field-level vs type-level
 * - Severity: breaking issues get higher confidence (we're more sure they matter)
 * - Whether docs authority confirms the procedure exists
 */
function computeBridgeConfidence(
  kind: string,
  severity: 'breaking' | 'warning' | 'info',
  description: string,
): number {
  // Base confidence by severity
  let base: number;
  switch (severity) {
    case 'breaking':
      base = 0.94;
      break;
    case 'warning':
      base = 0.82;
      break;
    case 'info':
      base = 0.7;
      break;
  }

  // Adjust by mismatch kind
  switch (kind) {
    case 'obsolete-call':
      // Very confident: procedure simply doesn't exist on backend
      base = Math.max(base, 0.92);
      break;
    case 'missing-procedure':
      // Procedure exists in code but not in docs — medium-high confidence
      if (description.includes('docs authority does not declare')) {
        base = Math.min(base + 0.03, 0.9);
      }
      break;
    case 'missing-field':
      // A required field is missing — high signal
      if (description.includes('missing') && !description.includes('optional')) {
        base = Math.min(base + 0.05, 0.93);
      }
      break;
    case 'type-mismatch':
      // Type differs — confidence depends on how different
      if (description.includes('string-enum') || description.includes('named struct')) {
        // Known type-representation artifacts — lower confidence
        base = Math.max(base - 0.1, 0.6);
      }
      break;
    case 'extra-field':
      // Extra field in Swift not in docs — low severity, low confidence
      base = Math.max(base - 0.05, 0.65);
      break;
  }

  // Clamp to [0.50, 0.98]
  return Math.round(Math.max(0.5, Math.min(0.98, base)) * 100) / 100;
}

function bridgeFinding(
  kind: ReviewFinding['kind'],
  severity: ReviewFinding['severity'],
  title: string,
  description: string,
  repo: string,
  file: string,
  line: number,
): ReviewFinding {
  return {
    kind,
    severity,
    title,
    description,
    repo,
    file,
    line,
    sourceKind: 'mixed',
    confidence: computeBridgeConfidence(kind, severity, description),
    riskScore: severity === 'breaking' ? 92 : severity === 'warning' ? 61 : 24,
    provenance: [
      {
        sourceKind: 'mixed',
        adapter: 'hustlexp-swift-trpc-bridge',
        detail: 'Swift tRPC contract correlation',
        confidence: computeBridgeConfidence(kind, severity, description),
      },
    ],
  };
}

function bridgeMismatch(
  kind: Mismatch['kind'],
  severity: Mismatch['severity'],
  description: string,
  provider: { repo: string; file: string; line: number; field: string },
  consumer: { repo: string; file: string; line: number; field?: string },
): Mismatch {
  return {
    kind,
    description,
    provider,
    consumer,
    severity,
    sourceKind: 'mixed',
    confidence: computeBridgeConfidence(kind, severity, description),
    riskScore: severity === 'breaking' ? 92 : severity === 'warning' ? 61 : 24,
    provenance: [
      {
        sourceKind: 'mixed',
        adapter: 'hustlexp-swift-trpc-bridge',
        detail: 'Swift tRPC contract mismatch',
        confidence: computeBridgeConfidence(kind, severity, description),
      },
    ],
  };
}

function preferredType(
  primary: TypeDef | undefined,
  fallback: TypeDef | undefined,
  empty: TypeDef,
): TypeDef {
  if (primary && (primary.fields.length > 0 || primary.name !== 'unknown')) {
    return primary;
  }
  if (fallback && (fallback.fields.length > 0 || fallback.name !== 'unknown')) {
    return fallback;
  }
  return empty;
}

export function analyzeSwiftTrpcBridge(
  config: OmniLinkConfig,
  graph: EcosystemGraph,
  authority: AuthorityState | null,
): SwiftTrpcBridgeAnalysis {
  const bridgeConfig = config.bridges?.swiftTrpc;
  if (!bridgeConfig?.enabled || !bridgeConfig.iosRepo || !bridgeConfig.backendRepo) {
    return { bridges: [], mismatches: [], findings: [], iosCalls: [], backendProcedures: [] };
  }

  const iosRepo = config.repos.find((repo) => repo.path === bridgeConfig.iosRepo);
  const backendManifest = graph.repos.find((repo) => repo.path === bridgeConfig.backendRepo);
  if (!iosRepo || !backendManifest) {
    return { bridges: [], mismatches: [], findings: [], iosCalls: [], backendProcedures: [] };
  }

  const iosCalls = extractSwiftTrpcCalls(iosRepo, bridgeConfig.clientCallPattern ?? '');
  const backendProcedures = extractBackendProcedureRefs(
    backendManifest,
    bridgeConfig.backendRepo,
    bridgeConfig.authoritativeBackendRoot,
  );
  const backendProcedureMap = new Map(
    backendProcedures.map((procedure) => [`${procedure.router}.${procedure.procedure}`, procedure]),
  );
  const docsProcedures = new Set(authority?.authoritativeApiSurface.procedures ?? []);
  const docsProcedureContracts = new Map(
    (authority?.authoritativeApiSurface.procedureContracts ?? []).map((contract) => [
      contract.procedure,
      contract,
    ]),
  );

  const bridges: ApiBridge[] = [];
  const mismatches: Mismatch[] = [];
  const findings: ReviewFinding[] = [];

  for (const call of iosCalls) {
    const key = `${call.router}.${call.procedure}`;
    const provider = backendProcedureMap.get(key);
    const docsContract = docsProcedureContracts.get(key);
    if (!provider) {
      mismatches.push(
        bridgeMismatch(
          'obsolete-call',
          'breaking',
          `Swift client calls '${key}', but the authoritative backend does not expose it.`,
          {
            repo: backendManifest.repoId,
            file: bridgeConfig.authoritativeBackendRoot ?? 'backend/src',
            line: 1,
            field: key,
          },
          {
            repo: iosRepo.name,
            file: call.file,
            line: call.line,
            field: key,
          },
        ),
      );
      findings.push(
        bridgeFinding(
          'bridge_obsolete_call',
          'breaking',
          'Obsolete Swift tRPC call',
          `Swift client calls '${key}', but the authoritative backend does not expose it.`,
          iosRepo.name,
          call.file,
          call.line,
        ),
      );
      continue;
    }

    const defaultInputType = emptyType(
      provider.inputType ?? call.inputType ?? 'unknown',
      backendManifest.repoId,
      provider.file,
      provider.line,
    );
    const defaultOutputType = emptyType(
      provider.outputType ?? call.outputType ?? 'unknown',
      backendManifest.repoId,
      provider.file,
      provider.line,
    );
    const contractInputType = preferredType(
      docsContract?.inputType,
      call.inputTypeDef,
      defaultInputType,
    );
    const contractOutputType = preferredType(
      docsContract?.outputType,
      call.outputTypeDef,
      defaultOutputType,
    );
    const payloadMismatches = docsContract
      ? [
          ...compareFields(
            key,
            'input',
            docsContract.inputType,
            call.inputTypeDef ?? defaultInputType,
            {
              repo: authority?.docsRepo ? 'hustlexp-docs' : backendManifest.repoId,
              file: authority?.authoritativeApiSurface.sourceFile ?? provider.file,
              line: docsContract.inputType.source.line,
            },
            {
              repo: iosRepo.name,
              file: call.file,
              line: call.line,
            },
          ),
          ...compareFields(
            key,
            'output',
            docsContract.outputType,
            call.outputTypeDef ?? defaultOutputType,
            {
              repo: authority?.docsRepo ? 'hustlexp-docs' : backendManifest.repoId,
              file: authority?.authoritativeApiSurface.sourceFile ?? provider.file,
              line: docsContract.outputType.source.line,
            },
            {
              repo: iosRepo.name,
              file: call.file,
              line: call.line,
            },
          ),
        ]
      : [];

    mismatches.push(...payloadMismatches);
    if (payloadMismatches.length > 0) {
      findings.push(
        bridgeFinding(
          'bridge_mismatch',
          'warning',
          'Swift payload drifts from docs authority',
          `The Swift client payload for '${key}' does not match the authority contract shape.`,
          iosRepo.name,
          call.file,
          call.line,
        ),
      );
    }

    bridges.push({
      consumer: {
        repo: iosRepo.name,
        file: call.file,
        line: call.line,
      },
      provider: {
        repo: backendManifest.repoId,
        route: key,
        handler: `${provider.router}.${provider.procedure}`,
      },
      contract: {
        inputType: contractInputType,
        outputType: contractOutputType,
        matchStatus:
          payloadMismatches.some((mismatch) => mismatch.kind === 'type-mismatch') ||
          payloadMismatches.some((mismatch) => mismatch.kind === 'missing-field')
            ? 'mismatch'
            : docsProcedures.has(key)
              ? 'exact'
              : 'compatible',
      },
      sourceKind: 'mixed',
      confidence: docsProcedures.has(key) ? 0.95 : 0.82,
      provenance: [
        {
          sourceKind: 'mixed',
          adapter: 'hustlexp-swift-trpc-bridge',
          detail: 'Swift client call mapped to backend procedure',
          confidence: docsProcedures.has(key) ? 0.95 : 0.82,
        },
      ],
    });

    if (!docsProcedures.has(key)) {
      mismatches.push(
        bridgeMismatch(
          'missing-procedure',
          'warning',
          `Swift client and backend both use '${key}', but the docs authority does not declare it.`,
          {
            repo: authority?.docsRepo ? 'hustlexp-docs' : backendManifest.repoId,
            file: authority?.authoritativeApiSurface.sourceFile ?? provider.file,
            line: 1,
            field: key,
          },
          {
            repo: iosRepo.name,
            file: call.file,
            line: call.line,
            field: key,
          },
        ),
      );
      findings.push(
        bridgeFinding(
          'bridge_mismatch',
          'warning',
          'Swift↔backend bridge missing from docs authority',
          `The procedure '${key}' is active in code but missing from the docs authority.`,
          iosRepo.name,
          call.file,
          call.line,
        ),
      );
    }
  }

  for (const procedure of backendProcedures) {
    const key = `${procedure.router}.${procedure.procedure}`;
    if (!docsProcedures.has(key)) {
      mismatches.push(
        bridgeMismatch(
          'missing-procedure',
          'warning',
          `Backend exposes '${key}', but the docs authority does not declare it.`,
          {
            repo: backendManifest.repoId,
            file: procedure.file,
            line: procedure.line,
            field: key,
          },
          {
            repo: authority?.docsRepo ? 'hustlexp-docs' : backendManifest.repoId,
            file: authority?.authoritativeApiSurface.sourceFile ?? procedure.file,
            line: 1,
            field: key,
          },
        ),
      );
    }
  }

  for (const docsProcedure of docsProcedures) {
    if (backendProcedureMap.has(docsProcedure)) {
      continue;
    }

    mismatches.push(
      bridgeMismatch(
        'missing-procedure',
        'breaking',
        `Docs authority declares '${docsProcedure}', but the backend manifest does not expose it.`,
        {
          repo: authority?.docsRepo ? 'hustlexp-docs' : backendManifest.repoId,
          file:
            authority?.authoritativeApiSurface.sourceFile ??
            bridgeConfig.authoritativeBackendRoot ??
            'backend/src',
          line: 1,
          field: docsProcedure,
        },
        {
          repo: backendManifest.repoId,
          file: bridgeConfig.authoritativeBackendRoot ?? 'backend/src',
          line: 1,
          field: docsProcedure,
        },
      ),
    );
  }

  return { bridges, mismatches, findings, iosCalls, backendProcedures };
}
