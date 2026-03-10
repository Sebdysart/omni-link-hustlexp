import { describe, it, expect, vi } from 'vitest';

import { USAGE, parseArgs, resolveCliConfig, runCli } from '../engine/cli-app.js';
import type { CliDeps, CliIo } from '../engine/cli-app.js';
import type { OmniLinkConfig } from '../engine/types.js';

function makeConfig(): OmniLinkConfig {
  return {
    repos: [{ name: 'repo', path: '/tmp/repo', language: 'typescript', role: 'backend' }],
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature', 'performance'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 8000,
      prioritize: 'changed-files-first',
      includeRecentCommits: 20,
    },
    cache: {
      directory: '/tmp/omni-link-cache',
      maxAgeDays: 7,
    },
  };
}

function createIo(): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  };
}

function createDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  const config = makeConfig();

  return {
    apply: vi.fn(async () => ({
      executed: false,
      branches: [],
      pullRequestCreated: false,
      warnings: [],
    })),
    reviewPr: vi.fn(async () => ({
      generatedAt: new Date(0).toISOString(),
      baseRef: 'main',
      headRef: 'HEAD',
      affectedRepos: [],
      impact: [],
      contractMismatches: [],
      owners: [],
      risk: {
        overallRisk: 'low',
        score: 0,
        reasons: [],
        affectedRepos: [],
        blockedByPolicy: false,
      },
      policyDecisions: [],
    })),
    publishReview: vi.fn(async () => ({
      provider: 'github',
      mode: 'replay',
      target: {
        owner: 'acme',
        repo: 'platform',
        pullRequestNumber: 42,
        headSha: 'abc123',
      },
      summary: '# omni-link review',
      capabilities: {
        supportsComments: true,
        supportsChecks: true,
        supportsMetadata: true,
        maxAnnotationsPerCheck: 50,
        maxCommentBytes: 65000,
      },
      metadata: null,
      comment: {
        kind: 'comment',
        status: 'replayed',
        path: '/tmp/comment.txt',
      },
      checkRun: {
        kind: 'check-run',
        status: 'replayed',
        path: '/tmp/check-run.json',
      },
    })),
    rollback: vi.fn(async () => ({
      executed: false,
      branches: [],
      pullRequestCreated: false,
      warnings: [],
    })),
    scan: vi.fn(async () => ({
      manifests: [],
      graph: {
        repos: [],
        bridges: [],
        sharedTypes: [],
        contractMismatches: [],
        impactPaths: [],
      },
      context: {
        digest: {
          repos: [{ name: 'repo' }],
          tokenCount: 42,
        },
        markdown: '# OMNI-LINK ECOSYSTEM STATE',
      },
    })),
    watch: vi.fn(async () => ({
      running: true,
      updatedAt: new Date(0).toISOString(),
      repoCount: 1,
      dirtyRepos: [],
      statePath: '/tmp/daemon-state.json',
    })),
    owners: vi.fn(async () => ({ owners: [], perRepo: {} })),
    authorityStatus: vi.fn(async () => ({
      authority: {
        docsRepo: '/tmp/docs',
        phaseMode: 'reconciliation',
        currentPhase: 'BOOTSTRAP',
        blockedWorkClasses: ['Backend calls'],
        frozenFeatures: [],
        authoritativeApiSurface: {
          sourceFile: '/tmp/docs/API_CONTRACT.md',
          procedures: ['task.create'],
          procedureContracts: [],
          errorCodes: [],
          baseUrls: [],
        },
        authoritativeSchemaSurface: {
          sourceFile: '/tmp/docs/schema.sql',
          tables: ['tasks'],
          views: [],
        },
      },
      findings: [],
      blockedApply: true,
      procedureCoverage: {
        docs: 1,
        backend: 2,
        iosCalls: 1,
        bridges: 1,
        docsOnly: [],
        backendOnly: ['task.accept'],
        obsoleteCalls: [],
        payloadDrift: [],
      },
      recommendations: [
        'update API_CONTRACT.md to declare backend procedures that are already live',
      ],
    })),
    impact: vi.fn(async () => [{ repo: 'repo', file: 'src/simulated.ts' }]),
    impactFromRefs: vi.fn(async () => [{ repo: 'repo', file: 'src/ref.ts' }]),
    impactFromUncommitted: vi.fn(async () => [{ repo: 'repo', file: 'src/index.ts' }]),
    health: vi.fn(async () => ({ overall: 82, perRepo: { repo: { overall: 82 } } })),
    evolve: vi.fn(async () => [{ id: 'upgrade-1', title: 'Add pagination' }]),
    loadConfig: vi.fn(() => config),
    resolveConfigPath: vi.fn(() => '/tmp/.omni-link.json'),
    cwd: vi.fn(() => '/tmp'),
    ...overrides,
  } as unknown as CliDeps;
}

describe('engine/cli-app parseArgs', () => {
  it('parses config and markdown flags', () => {
    expect(parseArgs(['scan', '--markdown', '--config', './test.json'])).toEqual({
      command: 'scan',
      configPath: './test.json',
      outputFormat: 'markdown',
      baseRef: undefined,
      headRef: undefined,
      prNumber: undefined,
      headSha: undefined,
      simulate: [],
      once: false,
      help: false,
    });
  });

  it('rejects unexpected positional arguments', () => {
    expect(() => parseArgs(['scan', 'extra'])).toThrow('Unexpected argument: extra');
  });

  it('rejects unsupported formats', () => {
    expect(() => parseArgs(['scan', '--format', 'yaml'])).toThrow('Unsupported format: yaml');
  });
});

describe('engine/cli-app resolveCliConfig', () => {
  it('loads an explicit config path', () => {
    const loadConfig = vi.fn(() => makeConfig());
    const resolveConfigPathMock = vi.fn(() => null);
    const config = resolveCliConfig('/tmp/custom.json', {
      loadConfig,
      resolveConfigPath: resolveConfigPathMock,
      cwd: () => '/tmp',
    });

    expect(loadConfig).toHaveBeenCalledWith('/tmp/custom.json');
    expect(resolveConfigPathMock).not.toHaveBeenCalled();
    expect(config.repos).toHaveLength(1);
  });

  it('throws when no config file is found', () => {
    expect(() =>
      resolveCliConfig(undefined, {
        loadConfig: vi.fn(),
        resolveConfigPath: vi.fn(() => null),
        cwd: () => '/tmp',
      }),
    ).toThrow('No config file found.');
  });
});

describe('engine/cli-app runCli', () => {
  it('prints usage when no args are provided', async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli([], io, createDeps());

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([USAGE]);
    expect(stderr).toEqual([]);
  });

  it('prints usage for help output', async () => {
    const { io, stdout } = createIo();
    const exitCode = await runCli(['--help'], io, createDeps());

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([USAGE]);
  });

  it('emits JSON for scan by default', async () => {
    const { io, stdout } = createIo();
    const deps = createDeps();
    const exitCode = await runCli(['scan', '--config', '/tmp/config.json'], io, deps);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([
      JSON.stringify({ repos: [{ name: 'repo' }], tokenCount: 42 }, null, 2),
    ]);
    expect(deps.loadConfig).toHaveBeenCalledWith('/tmp/config.json');
    expect(deps.scan).toHaveBeenCalledTimes(1);
  });

  it('emits markdown for scan when requested', async () => {
    const { io, stdout } = createIo();
    const exitCode = await runCli(
      ['scan', '--markdown', '--config', '/tmp/config.json'],
      io,
      createDeps(),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['# OMNI-LINK ECOSYSTEM STATE']);
  });

  it('emits JSON for health, evolve, and impact', async () => {
    const healthIo = createIo();
    const evolveIo = createIo();
    const impactIo = createIo();
    const deps = createDeps();

    expect(await runCli(['health', '--config', '/tmp/config.json'], healthIo.io, deps)).toBe(0);
    expect(await runCli(['evolve', '--config', '/tmp/config.json'], evolveIo.io, deps)).toBe(0);
    expect(await runCli(['impact', '--config', '/tmp/config.json'], impactIo.io, deps)).toBe(0);

    expect(healthIo.stdout).toEqual([
      JSON.stringify({ overall: 82, perRepo: { repo: { overall: 82 } } }, null, 2),
    ]);
    expect(evolveIo.stdout).toEqual([
      JSON.stringify([{ id: 'upgrade-1', title: 'Add pagination' }], null, 2),
    ]);
    expect(impactIo.stdout).toEqual([
      JSON.stringify([{ repo: 'repo', file: 'src/index.ts' }], null, 2),
    ]);
  });

  it('emits JSON for authority-status', async () => {
    const { io, stdout } = createIo();
    const deps = createDeps();

    expect(await runCli(['authority-status', '--config', '/tmp/config.json'], io, deps)).toBe(0);
    expect(stdout).toEqual([
      JSON.stringify(
        {
          authority: {
            docsRepo: '/tmp/docs',
            phaseMode: 'reconciliation',
            currentPhase: 'BOOTSTRAP',
            blockedWorkClasses: ['Backend calls'],
            frozenFeatures: [],
            authoritativeApiSurface: {
              sourceFile: '/tmp/docs/API_CONTRACT.md',
              procedures: ['task.create'],
              procedureContracts: [],
              errorCodes: [],
              baseUrls: [],
            },
            authoritativeSchemaSurface: {
              sourceFile: '/tmp/docs/schema.sql',
              tables: ['tasks'],
              views: [],
            },
          },
          findings: [],
          blockedApply: true,
          procedureCoverage: {
            docs: 1,
            backend: 2,
            iosCalls: 1,
            bridges: 1,
            docsOnly: [],
            backendOnly: ['task.accept'],
            obsoleteCalls: [],
            payloadDrift: [],
          },
          recommendations: [
            'update API_CONTRACT.md to declare backend procedures that are already live',
          ],
        },
        null,
        2,
      ),
    ]);
    expect(deps.authorityStatus).toHaveBeenCalledTimes(1);
  });

  it('emits JSON for publish-review and passes through PR metadata', async () => {
    const { io, stdout } = createIo();
    const deps = createDeps();

    const exitCode = await runCli(
      [
        'publish-review',
        '--pr',
        '42',
        '--head-sha',
        'abc123',
        '--base',
        'main',
        '--head',
        'feature/max-tier',
        '--config',
        '/tmp/config.json',
      ],
      io,
      deps,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([
      JSON.stringify(
        {
          provider: 'github',
          mode: 'replay',
          target: {
            owner: 'acme',
            repo: 'platform',
            pullRequestNumber: 42,
            headSha: 'abc123',
          },
          summary: '# omni-link review',
          capabilities: {
            supportsComments: true,
            supportsChecks: true,
            supportsMetadata: true,
            maxAnnotationsPerCheck: 50,
            maxCommentBytes: 65000,
          },
          metadata: null,
          comment: {
            kind: 'comment',
            status: 'replayed',
            path: '/tmp/comment.txt',
          },
          checkRun: {
            kind: 'check-run',
            status: 'replayed',
            path: '/tmp/check-run.json',
          },
        },
        null,
        2,
      ),
    ]);
    expect(deps.publishReview).toHaveBeenCalledWith(
      expect.any(Object),
      42,
      'main',
      'feature/max-tier',
      'abc123',
    );
  });

  it('prints usage on parse errors', async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(['scan', '--config'], io, createDeps());

    expect(exitCode).toBe(1);
    expect(stderr[0]).toBe('Missing value for --config');
    expect(stdout).toEqual([USAGE]);
  });

  it('fails publish-review when --pr is missing', async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(
      ['publish-review', '--config', '/tmp/config.json'],
      io,
      createDeps(),
    );

    expect(exitCode).toBe(1);
    expect(stderr[0]).toBe('publish-review requires --pr <number>');
  });

  it('prints usage on unknown commands', async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(['deploy'], io, createDeps());

    expect(exitCode).toBe(1);
    expect(stderr[0]).toBe('Unknown command: deploy');
    expect(stdout).toEqual([USAGE]);
  });

  it('returns a non-zero exit code when config resolution fails', async () => {
    const { io, stderr } = createIo();
    const deps = createDeps({
      resolveConfigPath: vi.fn(() => null),
    });
    const exitCode = await runCli(['scan'], io, deps);

    expect(exitCode).toBe(1);
    expect(stderr[0]).toContain('No config file found.');
  });
});

describe('engine/cli-app --simulate flag', () => {
  it('parses --simulate repo:filepath into simulate array', () => {
    const args = parseArgs([
      'impact',
      '--simulate',
      'hustlexp-ai-backend:backend/src/routers/task.ts',
    ]);

    expect(args.simulate).toEqual(['hustlexp-ai-backend:backend/src/routers/task.ts']);
  });

  it('accumulates multiple --simulate flags', () => {
    const args = parseArgs([
      'impact',
      '--simulate',
      'hustlexp-ai-backend:src/routers/task.ts',
      '--simulate',
      'hustlexp-ios:Services/TaskService.swift',
    ]);

    expect(args.simulate).toEqual([
      'hustlexp-ai-backend:src/routers/task.ts',
      'hustlexp-ios:Services/TaskService.swift',
    ]);
  });

  it('throws when --simulate value has no colon separator', () => {
    expect(() =>
      parseArgs(['impact', '--simulate', 'hustlexp-ai-backend-src-routers-task.ts']),
    ).toThrow('--simulate value must be in format repo:filepath');
  });

  it('calls deps.impact() with simulated changed files when --simulate is used', async () => {
    const { io } = createIo();
    const deps = createDeps();
    const exitCode = await runCli(
      [
        'impact',
        '--simulate',
        'hustlexp-ai-backend:src/routers/task.ts',
        '--config',
        '/tmp/config.json',
      ],
      io,
      deps,
    );

    expect(exitCode).toBe(0);
    expect(deps.impact).toHaveBeenCalledWith(expect.any(Object), [
      { repo: 'hustlexp-ai-backend', file: 'src/routers/task.ts', change: 'simulated' },
    ]);
    expect(deps.impactFromRefs).not.toHaveBeenCalled();
    expect(deps.impactFromUncommitted).not.toHaveBeenCalled();
  });
});
