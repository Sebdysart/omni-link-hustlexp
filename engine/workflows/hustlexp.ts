import * as path from 'node:path';

import type { OmniLinkConfig, RepoConfig } from '../types.js';

const HUSTLEXP_GROUPS = {
  bootstrap: ['hustlexp-ios', 'hustlexp-docs'],
  contracts: ['hustlexp-ios', 'hustlexp-backend', 'hustlexp-docs'],
  payments: ['hustlexp-ios', 'hustlexp-backend'],
  'trust-safety': ['hustlexp-ios', 'hustlexp-backend', 'hustlexp-docs'],
  realtime: ['hustlexp-ios', 'hustlexp-backend'],
};

const HUSTLEXP_REQUIRED_CHECKS = [
  'ios-build',
  'ios-tests',
  'backend-typecheck',
  'backend-tests',
  'docs-authority-check',
  'contract-sync',
];

const HUSTLEXP_OWNERSHIP_RULES = [
  {
    owner: 'product-architecture',
    kind: 'team' as const,
    scope: 'repo' as const,
    repo: 'hustlexp-docs',
  },
  {
    owner: 'ios-team',
    kind: 'team' as const,
    scope: 'repo' as const,
    repo: 'hustlexp-ios',
  },
  {
    owner: 'backend-team',
    kind: 'team' as const,
    scope: 'repo' as const,
    repo: 'hustlexp-backend',
  },
  {
    owner: 'payments',
    kind: 'team' as const,
    scope: 'path' as const,
    repo: 'hustlexp-ios',
    pattern: 'hustleXP final1/Services/StripePaymentManager.swift',
  },
  {
    owner: 'payments',
    kind: 'team' as const,
    scope: 'path' as const,
    repo: 'hustlexp-backend',
    pattern: 'backend/src/routers/escrow.ts',
  },
  {
    owner: 'trust-safety',
    kind: 'team' as const,
    scope: 'path' as const,
    repo: 'hustlexp-backend',
    pattern: 'backend/src/routers/fraud.ts',
  },
  {
    owner: 'realtime-platform',
    kind: 'team' as const,
    scope: 'path' as const,
    repo: 'hustlexp-backend',
    pattern: 'backend/src/realtime/',
  },
];

const DEFAULT_EXCLUDES: Record<string, string[]> = {
  'ios-client': [
    'HUSTLEXP-DOCS/',
    'HustleXP/',
    'node_modules/',
    'docs/',
    'screens/',
    '*.png',
    '*_small.png',
    'temp_screenshot*',
  ],
  'backend-api': [
    'node_modules/',
    'dist/',
    'artifacts/',
    'admin-dashboard/',
    'ops/load-test/',
    'public/',
    '/src/',
  ],
  'product-governance': [
    '__mocks__/',
    '_archive/',
    'archive/',
    'staging/',
    'mock-data/',
    'reference/components/',
  ],
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function findRepo(
  config: OmniLinkConfig,
  predicate: (repo: RepoConfig) => boolean,
): RepoConfig | undefined {
  return config.repos.find(predicate);
}

function inferDocsRepo(config: OmniLinkConfig): RepoConfig | undefined {
  return findRepo(
    config,
    (repo) => repo.role === 'product-governance' || repo.name.includes('docs'),
  );
}

function inferIosRepo(config: OmniLinkConfig): RepoConfig | undefined {
  return findRepo(config, (repo) => repo.role === 'ios-client' || repo.language === 'swift');
}

function inferBackendRepo(config: OmniLinkConfig): RepoConfig | undefined {
  return findRepo(config, (repo) => repo.role === 'backend-api' || repo.name.includes('backend'));
}

function mergeRepoExcludes(repo: RepoConfig): RepoConfig {
  const defaults = DEFAULT_EXCLUDES[repo.role] ?? [];
  if (defaults.length === 0 && !repo.exclude) {
    return repo;
  }

  return {
    ...repo,
    exclude: unique([...(defaults ?? []), ...(repo.exclude ?? [])]),
  };
}

export function applyHustleXpWorkflowProfile(config: OmniLinkConfig): OmniLinkConfig {
  if (config.workflowProfile !== 'hustlexp') {
    return config;
  }

  const docsRepo = inferDocsRepo(config);
  const iosRepo = inferIosRepo(config);
  const backendRepo = inferBackendRepo(config);
  const authorityFiles = {
    currentPhase: 'CURRENT_PHASE.md',
    finishedState: 'FINISHED_STATE.md',
    featureFreeze: 'FEATURE_FREEZE.md',
    aiGuardrails: 'AI_GUARDRAILS.md',
    apiContract: path.join('specs', '04-backend', 'API_CONTRACT.md'),
    schema: path.join('specs', '02-architecture', 'schema.sql'),
    ...(config.authority?.authorityFiles ?? {}),
  };
  const workspaceGroups = {
    ...HUSTLEXP_GROUPS,
    ...(config.daemon?.workspaceGroups ?? {}),
  };
  const requiredChecks = unique([
    ...HUSTLEXP_REQUIRED_CHECKS,
    ...(config.policies?.requiredChecks ?? []),
  ]);
  const requiredOwners = unique([
    'product-architecture',
    ...(config.policies?.requiredOwners ?? []),
  ]);

  return {
    ...config,
    repos: config.repos.map(mergeRepoExcludes),
    context: {
      ...config.context,
      prioritize:
        config.context.prioritize === 'changed-files-first'
          ? 'api-surface-first'
          : config.context.prioritize,
      focus: config.context.focus ?? 'mismatches',
    },
    daemon: {
      ...config.daemon,
      enabled: config.daemon?.enabled ?? true,
      preferDaemon: config.daemon?.preferDaemon ?? true,
      pollIntervalMs: config.daemon?.pollIntervalMs ?? 1000,
      cacheRetentionDays: config.daemon?.cacheRetentionDays ?? 7,
      workspaceGroups,
    },
    github: {
      enabled: true,
      defaultBaseBranch: 'main',
      publishMode: 'replay',
      artifactPath: path.join('.omni-link', 'review-artifact.json'),
      replayDirectory: path.join('.omni-link', 'provider-replay'),
      ...config.github,
    },
    authority: {
      ...config.authority,
      enabled: config.authority?.enabled ?? true,
      docsRepo: config.authority?.docsRepo ?? docsRepo?.path,
      phaseMode: config.authority?.phaseMode ?? 'reconciliation',
      authorityFiles,
    },
    bridges: {
      swiftTrpc: {
        enabled: true,
        iosRepo: iosRepo?.path,
        backendRepo: backendRepo?.path,
        clientCallPattern:
          'trpc\\\\.call\\\\(router:\\\\s*"(?<router>[A-Za-z_][A-Za-z0-9_]*)"\\\\s*,\\\\s*procedure:\\\\s*"(?<procedure>[A-Za-z_][A-Za-z0-9_]*)"\\\\s*\\\\)',
        authoritativeBackendRoot: path.join('backend', 'src'),
        ...(config.bridges?.swiftTrpc ?? {}),
      },
    },
    automation: {
      enabled: true,
      branchPrefix: 'codex/omni-link-hustlexp',
      createPullRequest: true,
      retryLimit: 2,
      allowedRiskTiers: ['low', 'medium'],
      autoApplyRiskTiers: ['low'],
      dryRunByDefault: true,
      ...config.automation,
    },
    ownership: {
      ...config.ownership,
      enabled: true,
      defaultOwner: 'platform',
      rules: unique([...(config.ownership?.rules ?? []), ...HUSTLEXP_OWNERSHIP_RULES]),
    },
    runtime: {
      enabled: config.runtime?.enabled ?? false,
      ...config.runtime,
    },
    policies: {
      ...config.policies,
      enabled: config.policies?.enabled ?? true,
      protectedBranches: config.policies?.protectedBranches ?? ['main'],
      requiredChecks,
      requiredOwners,
      maxAllowedRisk: config.policies?.maxAllowedRisk ?? 'medium',
      forbidDirectMainMutation: config.policies?.forbidDirectMainMutation ?? true,
      forbidDestructiveChanges: config.policies?.forbidDestructiveChanges ?? true,
    },
    maxTier: {
      enabled: true,
      semanticAnalysis: {
        enabled: true,
        preferSemantic: true,
        confidenceThreshold: 0.7,
        languages: ['typescript', 'swift', 'javascript'],
        ...config.maxTier?.semanticAnalysis,
      },
      runtimeIngestion: {
        enabled: true,
        ...config.maxTier?.runtimeIngestion,
      },
      execution: {
        enabled: true,
        ...config.maxTier?.execution,
      },
    },
    simulateOnly: config.simulateOnly ?? true,
  };
}
