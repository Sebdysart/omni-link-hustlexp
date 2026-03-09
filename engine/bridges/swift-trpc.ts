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
  'trpc\\.call\\(router:\\s*"(?<router>[A-Za-z_][A-Za-z0-9_]*)"\\s*,\\s*procedure:\\s*"(?<procedure>[A-Za-z_][A-Za-z0-9_]*)"\\s*\\)';

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

function emptyType(name: string, repo: string, file = 'unknown', line = 0): TypeDef {
  return {
    name,
    fields: [],
    source: { repo, file, line },
  };
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
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

export function extractSwiftTrpcCalls(repo: RepoConfig, patternSource: string): SwiftTrpcCall[] {
  const swiftFiles = walkSwiftFiles(repo);

  const fileSources = swiftFiles.flatMap((filePath) => {
    try {
      return [
        {
          filePath,
          relPath: path.relative(repo.path, filePath).replace(/\\/g, '/'),
          source: fs.readFileSync(filePath, 'utf-8'),
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
      const lines = fileSource.source.split('\n');
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber];
        callPattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = callPattern.exec(line)) !== null) {
          const router = match.groups?.router ?? match[1];
          const procedure = match.groups?.procedure ?? match[2];
          if (!router || !procedure) {
            if (match[0] === '') break;
            continue;
          }
          calls.push({
            repo: repo.name,
            file: fileSource.relPath,
            line: lineNumber + 1,
            router,
            procedure,
          });
          if (match[0] === '') break;
        }
      }
    }

    if (calls.length > 0) {
      return calls;
    }
  }

  return [];
}

export function extractBackendProcedureRefs(
  manifest: EcosystemGraph['repos'][number],
  authoritativeBackendRoot = path.join('backend', 'src'),
): BackendProcedureRef[] {
  return manifest.apiSurface.procedures
    .filter((procedure) => {
      const normalized = procedure.file.replace(/\\/g, '/');
      return normalized.startsWith(authoritativeBackendRoot.replace(/\\/g, '/'));
    })
    .map((procedure) => ({
      repo: manifest.repoId,
      router: path.basename(procedure.file, path.extname(procedure.file)),
      procedure: procedure.name,
      kind: procedure.kind,
      file: procedure.file,
      line: procedure.line,
      inputType: procedure.inputType,
      outputType: procedure.outputType,
    }))
    .filter((procedure) => procedure.router !== 'index' && procedure.router !== 'trpc');
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
    confidence: severity === 'breaking' ? 0.94 : 0.84,
    riskScore: severity === 'breaking' ? 92 : severity === 'warning' ? 61 : 24,
    provenance: [
      {
        sourceKind: 'mixed',
        adapter: 'hustlexp-swift-trpc-bridge',
        detail: 'Swift tRPC contract correlation',
        confidence: severity === 'breaking' ? 0.94 : 0.84,
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
    confidence: severity === 'breaking' ? 0.94 : 0.84,
    riskScore: severity === 'breaking' ? 92 : severity === 'warning' ? 61 : 24,
    provenance: [
      {
        sourceKind: 'mixed',
        adapter: 'hustlexp-swift-trpc-bridge',
        detail: 'Swift tRPC contract mismatch',
        confidence: severity === 'breaking' ? 0.94 : 0.84,
      },
    ],
  };
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
    bridgeConfig.authoritativeBackendRoot,
  );
  const backendProcedureMap = new Map(
    backendProcedures.map((procedure) => [`${procedure.router}.${procedure.procedure}`, procedure]),
  );
  const docsProcedures = new Set(authority?.authoritativeApiSurface.procedures ?? []);

  const bridges: ApiBridge[] = [];
  const mismatches: Mismatch[] = [];
  const findings: ReviewFinding[] = [];

  for (const call of iosCalls) {
    const key = `${call.router}.${call.procedure}`;
    const provider = backendProcedureMap.get(key);
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
        inputType: emptyType(
          provider.inputType ?? 'unknown',
          backendManifest.repoId,
          provider.file,
          provider.line,
        ),
        outputType: emptyType(
          provider.outputType ?? 'unknown',
          backendManifest.repoId,
          provider.file,
          provider.line,
        ),
        matchStatus: docsProcedures.has(key) ? 'exact' : 'compatible',
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
    if (backendProcedureMap.has(docsProcedure)) continue;
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
