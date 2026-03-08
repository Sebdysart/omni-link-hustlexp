import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { OmniLinkConfig } from './types.js';
import { parseConfig, safeParseConfig } from './config-validator.js';

export const DEFAULT_CONFIG: Omit<OmniLinkConfig, 'repos'> = {
  reviewProvider: 'github',
  evolution: {
    aggressiveness: 'aggressive',
    maxSuggestionsPerSession: 5,
    categories: ['feature', 'performance', 'monetization', 'scale', 'security'],
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
    directory: path.join(os.homedir(), '.claude', 'omni-link-cache'),
    maxAgeDays: 7,
  },
  daemon: {
    enabled: false,
    statePath: path.join(os.homedir(), '.claude', 'omni-link-daemon-state.sqlite'),
    pollIntervalMs: 1000,
    cacheRetentionDays: 7,
    workspaceGroups: {},
    preferDaemon: false,
  },
  github: {
    enabled: false,
    defaultBaseBranch: 'main',
    commentOnPr: true,
    publishChecks: true,
    artifactPath: path.join('.omni-link', 'review-artifact.json'),
    publishMode: 'dry-run',
    replayDirectory: path.join('.omni-link', 'provider-replay'),
    apiUrl: 'https://api.github.com',
  },
  gitlab: {
    enabled: false,
    defaultBaseBranch: 'main',
    commentOnMergeRequest: true,
    publishChecks: true,
    artifactPath: path.join('.omni-link', 'review-artifact.gitlab.json'),
    publishMode: 'dry-run',
    replayDirectory: path.join('.omni-link', 'provider-replay'),
    apiUrl: 'https://gitlab.com/api/v4',
  },
  automation: {
    enabled: false,
    branchPrefix: 'codex/omni-link',
    createPullRequest: true,
    retryLimit: 2,
    allowedRiskTiers: ['low', 'medium'],
    autoApplyRiskTiers: ['low'],
    dryRunByDefault: true,
  },
  ownership: {
    enabled: false,
    defaultOwner: 'unassigned',
    rules: [],
  },
  runtime: {
    enabled: false,
  },
  policies: {
    enabled: false,
    protectedBranches: ['main'],
    requiredChecks: ['lint', 'test', 'build'],
    requiredOwners: [],
    maxAllowedRisk: 'medium',
    forbidDirectMainMutation: true,
    forbidDestructiveChanges: true,
  },
  maxTier: {
    enabled: false,
    semanticAnalysis: {
      enabled: false,
      preferSemantic: false,
      confidenceThreshold: 0.6,
      languages: ['typescript', 'tsx', 'javascript'],
    },
    runtimeIngestion: {
      enabled: false,
    },
    execution: {
      enabled: false,
    },
  },
};

export function resolveConfigPath(cwd: string, homeDir: string = os.homedir()): string | null {
  const localPath = path.join(cwd, '.omni-link.json');
  if (fs.existsSync(localPath)) return localPath;

  const globalPath = path.join(homeDir, '.claude', 'omni-link.json');
  if (fs.existsSync(globalPath)) return globalPath;

  return null;
}

export function validateConfig(raw: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const result = safeParseConfig(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => {
    if (issue.path.length === 1 && issue.path[0] === 'repos') {
      if (issue.code === 'too_small') {
        return 'repos: must have at least 1 repo';
      }
      if (issue.code === 'too_big') {
        return 'repos: maximum 10 repos allowed';
      }
    }

    const pathLabel = issue.path.length > 0 ? issue.path.join('.') : 'config';
    return `${pathLabel}: ${issue.message}`;
  });

  return { valid: false, errors };
}

export function loadConfig(configPath: string): OmniLinkConfig {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const merged = {
    ...raw,
    reviewProvider: raw.reviewProvider ?? DEFAULT_CONFIG.reviewProvider,
    evolution: { ...DEFAULT_CONFIG.evolution, ...raw.evolution },
    quality: { ...DEFAULT_CONFIG.quality, ...raw.quality },
    context: { ...DEFAULT_CONFIG.context, ...raw.context },
    cache: { ...DEFAULT_CONFIG.cache, ...raw.cache },
    daemon: raw.daemon ? { ...DEFAULT_CONFIG.daemon, ...raw.daemon } : raw.daemon,
    github: raw.github ? { ...DEFAULT_CONFIG.github, ...raw.github } : raw.github,
    gitlab: raw.gitlab ? { ...DEFAULT_CONFIG.gitlab, ...raw.gitlab } : raw.gitlab,
    automation: raw.automation
      ? { ...DEFAULT_CONFIG.automation, ...raw.automation }
      : raw.automation,
    ownership: raw.ownership ? { ...DEFAULT_CONFIG.ownership, ...raw.ownership } : raw.ownership,
    runtime: raw.runtime ? { ...DEFAULT_CONFIG.runtime, ...raw.runtime } : raw.runtime,
    policies: raw.policies ? { ...DEFAULT_CONFIG.policies, ...raw.policies } : raw.policies,
    maxTier: raw.maxTier
      ? {
          ...DEFAULT_CONFIG.maxTier,
          ...raw.maxTier,
          semanticAnalysis: {
            ...DEFAULT_CONFIG.maxTier?.semanticAnalysis,
            ...raw.maxTier.semanticAnalysis,
          },
          runtimeIngestion: {
            ...DEFAULT_CONFIG.maxTier?.runtimeIngestion,
            ...raw.maxTier.runtimeIngestion,
          },
          execution: {
            ...DEFAULT_CONFIG.maxTier?.execution,
            ...raw.maxTier.execution,
          },
        }
      : raw.maxTier,
  };

  return parseConfig(merged);
}
