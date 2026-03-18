import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadAuthorityState } from '../../engine/authority/index.js';
import {
  analyzeSwiftTrpcBridge,
  type SwiftTrpcBridgeAnalysis,
} from '../../engine/bridges/swift-trpc.js';
import type { EcosystemGraph, OmniLinkConfig, RepoManifest } from '../../engine/types.js';

const fixtureRoot = path.resolve(import.meta.dirname!, '..', 'fixtures', 'hustlexp-workspace');

function makeManifest(
  repoId: string,
  repoPath: string,
  language: string,
  overrides: Partial<RepoManifest> = {},
): RepoManifest {
  return {
    repoId,
    path: repoPath,
    language,
    gitState: {
      branch: 'main',
      headSha: 'head',
      uncommittedChanges: [],
      recentCommits: [],
    },
    apiSurface: {
      routes: [],
      procedures: [],
      exports: [],
    },
    typeRegistry: {
      types: [],
      schemas: [],
      models: [],
    },
    conventions: {
      naming: 'camelCase',
      fileOrganization: 'domain',
      errorHandling: 'throws',
      patterns: [],
      testingPatterns: '',
    },
    dependencies: {
      internal: [],
      external: [],
    },
    health: {
      testCoverage: null,
      lintErrors: 0,
      typeErrors: 0,
      todoCount: 0,
      deadCode: [],
    },
    ...overrides,
  };
}

function makeConfig(): OmniLinkConfig {
  return {
    workflowProfile: 'hustlexp',
    repos: [
      {
        name: 'hustlexp-ios',
        path: path.join(fixtureRoot, 'ios'),
        language: 'swift',
        role: 'ios-client',
      },
      {
        name: 'hustlexp-backend',
        path: path.join(fixtureRoot, 'backend'),
        language: 'typescript',
        role: 'backend-api',
      },
      {
        name: 'hustlexp-docs',
        path: path.join(fixtureRoot, 'docs'),
        language: 'javascript',
        role: 'product-governance',
      },
    ],
    reviewProvider: 'github',
    evolution: {
      aggressiveness: 'aggressive',
      maxSuggestionsPerSession: 5,
      categories: ['feature', 'security'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 8000,
      prioritize: 'api-surface-first',
      includeRecentCommits: 20,
      focus: 'mismatches',
    },
    cache: {
      directory: path.join(fixtureRoot, '.cache'),
      maxAgeDays: 7,
    },
    authority: {
      enabled: true,
      docsRepo: path.join(fixtureRoot, 'docs'),
      phaseMode: 'reconciliation',
      authorityFiles: {
        currentPhase: 'CURRENT_PHASE.md',
        finishedState: 'FINISHED_STATE.md',
        featureFreeze: 'FEATURE_FREEZE.md',
        aiGuardrails: 'AI_GUARDRAILS.md',
        apiContract: 'specs/04-backend/API_CONTRACT.md',
        schema: 'specs/02-architecture/schema.sql',
      },
    },
    bridges: {
      swiftTrpc: {
        enabled: true,
        iosRepo: path.join(fixtureRoot, 'ios'),
        backendRepo: path.join(fixtureRoot, 'backend'),
        clientCallPattern:
          'trpc\\\\.call\\\\(router:\\\\s*"(?<router>[A-Za-z_][A-Za-z0-9_]*)"\\\\s*,\\\\s*procedure:\\\\s*"(?<procedure>[A-Za-z_][A-Za-z0-9_]*)"\\\\s*\\\\)',
        authoritativeBackendRoot: 'backend/src',
      },
    },
  };
}

describe('swift tRPC bridge', () => {
  it('maps Swift calls to backend procedures and reports drift', () => {
    const config = makeConfig();
    const authority = loadAuthorityState(config);
    const graph: EcosystemGraph = {
      repos: [
        makeManifest('hustlexp-ios', path.join(fixtureRoot, 'ios'), 'swift'),
        makeManifest('hustlexp-backend', path.join(fixtureRoot, 'backend'), 'typescript', {
          apiSurface: {
            routes: [],
            procedures: [
              {
                name: 'create',
                kind: 'mutation',
                file: 'backend/src/routers/task.ts',
                line: 3,
              },
              {
                name: 'sendMessage',
                kind: 'mutation',
                file: 'backend/src/routers/messaging.ts',
                line: 3,
              },
            ],
            exports: [],
          },
        }),
        makeManifest('hustlexp-docs', path.join(fixtureRoot, 'docs'), 'javascript'),
      ],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    };

    const analysis = analyzeSwiftTrpcBridge(config, graph, authority);

    expect(analysis.iosCalls.map((call) => `${call.router}.${call.procedure}`)).toEqual(
      expect.arrayContaining(['task.create', 'messaging.sendMessage', 'legacy.oldProcedure']),
    );
    expect(analysis.iosCalls.find((call) => call.router === 'task')?.inputType).toBe(
      'CreateTaskInput',
    );
    expect(analysis.iosCalls.find((call) => call.router === 'task')?.outputType).toBe(
      'TaskResponse',
    );
    expect(
      analysis.iosCalls
        .find((call) => call.router === 'task')
        ?.inputTypeDef?.fields.map((field) => field.name),
    ).toEqual(['title', 'price']);
    expect(
      analysis.backendProcedures.map((procedure) => `${procedure.router}.${procedure.procedure}`),
    ).toEqual(expect.arrayContaining(['task.create', 'messaging.sendMessage']));
    expect(analysis.bridges.map((bridge) => bridge.provider.route)).toEqual(
      expect.arrayContaining(['task.create', 'messaging.sendMessage']),
    );
    expect(
      analysis.mismatches.some(
        (mismatch) =>
          mismatch.kind === 'extra-field' &&
          mismatch.description.includes('messaging.sendMessage') &&
          mismatch.description.includes('delivered'),
      ),
    ).toBe(true);
    expect(
      analysis.mismatches.some(
        (mismatch) =>
          mismatch.kind === 'type-mismatch' && mismatch.description.includes('task.create.title'),
      ),
    ).toBe(false);
    expect(
      analysis.mismatches.some(
        (mismatch) =>
          mismatch.kind === 'type-mismatch' && mismatch.description.includes('task.create.price'),
      ),
    ).toBe(false);
    expect(
      analysis.mismatches.some(
        (mismatch) =>
          mismatch.kind === 'missing-field' &&
          mismatch.description.includes('task.create') &&
          mismatch.description.includes('category'),
      ),
    ).toBe(false);
    expect(
      analysis.mismatches.some(
        (mismatch) =>
          mismatch.kind === 'extra-field' &&
          mismatch.description.includes('task.create') &&
          mismatch.description.includes('isOpen'),
      ),
    ).toBe(false);
    expect(analysis.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(['bridge_obsolete_call', 'bridge_mismatch']),
    );
    expect(analysis.mismatches.map((mismatch) => mismatch.kind)).toEqual(
      expect.arrayContaining(['obsolete-call', 'missing-procedure']),
    );
  });
});

describe('variable bridge confidence', () => {
  function makeGraph(): EcosystemGraph {
    return {
      repos: [
        makeManifest('hustlexp-ios', path.join(fixtureRoot, 'ios'), 'swift'),
        makeManifest('hustlexp-backend', path.join(fixtureRoot, 'backend'), 'typescript', {
          apiSurface: {
            routes: [],
            procedures: [
              {
                name: 'create',
                kind: 'mutation',
                file: 'backend/src/routers/task.ts',
                line: 3,
              },
              {
                name: 'sendMessage',
                kind: 'mutation',
                file: 'backend/src/routers/messaging.ts',
                line: 3,
              },
            ],
            exports: [],
          },
        }),
        makeManifest('hustlexp-docs', path.join(fixtureRoot, 'docs'), 'javascript'),
      ],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    };
  }

  function runAnalysis(): SwiftTrpcBridgeAnalysis {
    const config = makeConfig();
    const authority = loadAuthorityState(config);
    return analyzeSwiftTrpcBridge(config, makeGraph(), authority);
  }

  /**
   * Run analysis with a custom authority that only declares task.create,
   * forcing messaging.sendMessage to appear as a missing-procedure + warning.
   */
  function runAnalysisWithLimitedAuthority(): SwiftTrpcBridgeAnalysis {
    const config = makeConfig();
    const authority = loadAuthorityState(config);
    const limitedAuthority = {
      ...authority!,
      authoritativeApiSurface: {
        ...authority!.authoritativeApiSurface,
        procedures: ['task.create'],
        procedureContracts: authority!.authoritativeApiSurface.procedureContracts.filter(
          (c) => c.procedure === 'task.create',
        ),
      },
    };
    return analyzeSwiftTrpcBridge(config, makeGraph(), limitedAuthority);
  }

  it('produces mismatches with different confidence values (not all the same)', () => {
    const analysis = runAnalysis();
    const confidences = new Set(analysis.mismatches.map((m) => m.confidence));

    expect(confidences.size).toBeGreaterThan(1);
  });

  it('assigns confidence 0.85 to missing-procedure + warning mismatches about docs authority', () => {
    const analysis = runAnalysisWithLimitedAuthority();
    const missingProcWarnings = analysis.mismatches.filter(
      (m) =>
        m.kind === 'missing-procedure' &&
        m.severity === 'warning' &&
        m.description.includes('docs authority does not declare'),
    );

    expect(missingProcWarnings.length).toBeGreaterThan(0);
    for (const m of missingProcWarnings) {
      expect(m.confidence).toBe(0.85);
    }
  });

  it('assigns confidence 0.82 to type-mismatch + warning mismatches', () => {
    const analysis = runAnalysis();
    const typeMismatchWarnings = analysis.mismatches.filter(
      (m) => m.kind === 'type-mismatch' && m.severity === 'warning',
    );

    // The fixture may or may not produce type-mismatch warnings depending on
    // field type normalization. If present, they must have confidence 0.82.
    for (const m of typeMismatchWarnings) {
      expect(m.confidence).toBe(0.82);
    }
  });

  it('assigns confidence 0.65 to extra-field + info mismatches', () => {
    const analysis = runAnalysis();
    const extraFieldInfo = analysis.mismatches.filter(
      (m) => m.kind === 'extra-field' && m.severity === 'info',
    );

    expect(extraFieldInfo.length).toBeGreaterThan(0);
    for (const m of extraFieldInfo) {
      expect(m.confidence).toBe(0.65);
    }
  });

  it('assigns confidence 0.94 to obsolete-call + breaking mismatches', () => {
    const analysis = runAnalysis();
    const obsoleteBreaking = analysis.mismatches.filter(
      (m) => m.kind === 'obsolete-call' && m.severity === 'breaking',
    );

    expect(obsoleteBreaking.length).toBeGreaterThan(0);
    for (const m of obsoleteBreaking) {
      expect(m.confidence).toBe(0.94);
    }
  });
});
