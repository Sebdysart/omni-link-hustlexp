import { describe, it, expect } from 'vitest';
import { repoConfigSchema, parseConfig, safeParseConfig } from '../engine/config-validator.js';

const MINIMAL_REPO = {
  name: 'test-repo',
  path: '/tmp/test-repo',
  language: 'typescript',
  role: 'backend-api',
};

function minimalConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { repos: [MINIMAL_REPO], ...overrides };
}

describe('config-validator', () => {
  describe('parseConfig', () => {
    it('accepts valid minimal config (1 repo with name, path, language, role)', () => {
      const result = parseConfig(minimalConfig());
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].name).toBe('test-repo');
      expect(result.repos[0].path).toBe('/tmp/test-repo');
      expect(result.repos[0].language).toBe('typescript');
      expect(result.repos[0].role).toBe('backend-api');
    });

    it('accepts valid full config with all optional sections', () => {
      const full = {
        repos: [MINIMAL_REPO],
        workflowProfile: 'hustlexp',
        reviewProvider: 'github',
        evolution: {
          aggressiveness: 'moderate',
          maxSuggestionsPerSession: 10,
          categories: ['feature', 'security'],
        },
        quality: {
          blockOnFailure: false,
          requireTestsForNewCode: false,
          conventionStrictness: 'relaxed',
        },
        context: {
          tokenBudget: 12000,
          prioritize: 'api-surface-first',
          includeRecentCommits: 50,
          focus: 'commits',
        },
        cache: {
          directory: '.my-cache',
          maxAgeDays: 14,
        },
        daemon: {
          enabled: true,
          statePath: '.my-state.sqlite',
          pollIntervalMs: 5000,
          cacheRetentionDays: 30,
          workspaceGroups: { main: ['repo-a'] },
          preferDaemon: true,
        },
        github: {
          enabled: true,
          owner: 'acme',
          repo: 'platform',
          defaultBaseBranch: 'develop',
          commentOnPr: false,
          publishChecks: false,
          artifactPath: '.my/artifact.json',
          publishMode: 'github',
          replayDirectory: '.my/replay',
          apiUrl: 'https://github.example.com/api',
        },
        authority: {
          enabled: true,
          docsRepo: '/tmp/docs',
          phaseMode: 'strict',
          authorityFiles: {
            currentPhase: 'PHASE.md',
            finishedState: 'FINISHED.md',
            featureFreeze: 'FREEZE.md',
            aiGuardrails: 'GUARDRAILS.md',
            apiContract: 'API.md',
            schema: 'schema.sql',
          },
        },
        bridges: {
          swiftTrpc: {
            enabled: true,
            iosRepo: '/tmp/ios',
            backendRepo: '/tmp/backend',
            clientCallPattern: 'trpc',
            authoritativeBackendRoot: 'src',
          },
        },
        automation: {
          enabled: true,
          branchPrefix: 'auto/',
          createPullRequest: false,
          retryLimit: 5,
          allowedRiskTiers: ['low', 'medium', 'high'],
          autoApplyRiskTiers: ['low'],
          dryRunByDefault: false,
        },
        ownership: {
          enabled: true,
          defaultOwner: 'team-a',
          rules: [{ owner: 'team-a', kind: 'team', scope: 'repo', repo: 'test-repo' }],
        },
        runtime: {
          enabled: true,
          coverageSummaryPath: 'coverage.json',
        },
        policies: {
          enabled: true,
          protectedBranches: ['main', 'release'],
          requiredChecks: ['lint', 'test'],
          requiredOwners: ['admin'],
          maxAllowedRisk: 'high',
          forbidDirectMainMutation: false,
          forbidDestructiveChanges: false,
        },
        maxTier: {
          enabled: true,
          semanticAnalysis: {
            enabled: true,
            preferSemantic: true,
            confidenceThreshold: 0.8,
            languages: ['typescript', 'swift'],
          },
          runtimeIngestion: { enabled: true },
          execution: { enabled: true },
        },
        simulateOnly: true,
      };

      const result = parseConfig(full);
      expect(result.repos).toHaveLength(1);
      expect(result.evolution.aggressiveness).toBe('moderate');
      expect(result.quality.conventionStrictness).toBe('relaxed');
      expect(result.context.tokenBudget).toBe(12000);
      expect(result.authority?.phaseMode).toBe('strict');
      expect(result.bridges?.swiftTrpc?.enabled).toBe(true);
      expect(result.automation?.retryLimit).toBe(5);
      expect(result.ownership?.defaultOwner).toBe('team-a');
      expect(result.runtime?.enabled).toBe(true);
      expect(result.policies?.maxAllowedRisk).toBe('high');
      expect(result.maxTier?.semanticAnalysis?.confidenceThreshold).toBe(0.8);
      expect(result.simulateOnly).toBe(true);
    });

    it('rejects empty repos array (min 1)', () => {
      expect(() => parseConfig({ repos: [] })).toThrow();
    });

    it('rejects repos with 11 repos (max 10)', () => {
      const repos = Array.from({ length: 11 }, (_, i) => ({
        name: `repo-${i}`,
        path: `/tmp/repo-${i}`,
        language: 'typescript',
        role: 'backend',
      }));
      expect(() => parseConfig({ repos })).toThrow();
    });

    it('rejects unknown language (e.g., ruby)', () => {
      expect(() =>
        parseConfig({
          repos: [{ name: 'test', path: '/tmp/test', language: 'ruby', role: 'backend' }],
        }),
      ).toThrow();
    });

    it('accepts markdown as language', () => {
      const result = parseConfig({
        repos: [{ name: 'docs', path: '/tmp/docs', language: 'markdown', role: 'governance' }],
      });
      expect(result.repos[0].language).toBe('markdown');
    });

    it('normalizes features category to feature', () => {
      const result = parseConfig({
        repos: [MINIMAL_REPO],
        evolution: { categories: ['features', 'performance'] },
      });
      expect(result.evolution.categories).toEqual(['feature', 'performance']);
    });
  });

  describe('safeParseConfig', () => {
    it('returns error for invalid input without throwing', () => {
      const result = safeParseConfig({ repos: [] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it('returns success for valid input', () => {
      const result = safeParseConfig(minimalConfig());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repos).toHaveLength(1);
      }
    });
  });

  describe('defaults', () => {
    it('applies evolution defaults when evolution is omitted', () => {
      const result = parseConfig(minimalConfig());
      expect(result.evolution.aggressiveness).toBe('aggressive');
      expect(result.evolution.maxSuggestionsPerSession).toBe(5);
      expect(result.evolution.categories).toEqual([
        'feature',
        'performance',
        'monetization',
        'scale',
        'security',
      ]);
    });

    it('applies quality defaults when quality is omitted', () => {
      const result = parseConfig(minimalConfig());
      expect(result.quality.blockOnFailure).toBe(true);
      expect(result.quality.requireTestsForNewCode).toBe(true);
      expect(result.quality.conventionStrictness).toBe('strict');
    });

    it('applies context defaults when context is omitted', () => {
      const result = parseConfig(minimalConfig());
      expect(result.context.tokenBudget).toBe(8000);
      expect(result.context.prioritize).toBe('changed-files-first');
      expect(result.context.includeRecentCommits).toBe(20);
    });

    it('applies cache defaults when cache is omitted', () => {
      const result = parseConfig(minimalConfig());
      expect(result.cache.directory).toBe('.omni-link-cache');
      expect(result.cache.maxAgeDays).toBe(7);
    });

    it('defaults reviewProvider to github', () => {
      const result = parseConfig(minimalConfig());
      expect(result.reviewProvider).toBe('github');
    });
  });

  describe('repoConfigSchema', () => {
    it('validates exclude array', () => {
      const result = repoConfigSchema.safeParse({
        name: 'test',
        path: '/tmp/test',
        language: 'typescript',
        role: 'backend',
        exclude: ['*.png', 'node_modules/', 'coverage/'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude).toEqual(['*.png', 'node_modules/', 'coverage/']);
      }
    });

    it('rejects exclude array with empty strings', () => {
      const result = repoConfigSchema.safeParse({
        name: 'test',
        path: '/tmp/test',
        language: 'typescript',
        role: 'backend',
        exclude: [''],
      });
      expect(result.success).toBe(false);
    });

    it('accepts repo without exclude (optional)', () => {
      const result = repoConfigSchema.safeParse({
        name: 'test',
        path: '/tmp/test',
        language: 'typescript',
        role: 'backend',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude).toBeUndefined();
      }
    });
  });
});
