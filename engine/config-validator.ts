import { z } from 'zod';

const repoLanguageSchema = z.enum([
  'typescript',
  'tsx',
  'javascript',
  'swift',
  'python',
  'go',
  'rust',
  'java',
  'graphql',
]);

const evolutionCategorySchema = z.enum([
  'feature',
  'performance',
  'monetization',
  'scale',
  'security',
]);

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

function normalizeCategory(category: string): string {
  return category === 'features' ? 'feature' : category;
}

const categoryArraySchema = z
  .array(z.string().min(1))
  .transform((categories, ctx) =>
    categories.map((category, index) => {
      const normalized = normalizeCategory(category);
      const parsed = evolutionCategorySchema.safeParse(normalized);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid evolution category at index ${index}: ${category}`,
        });
      }
      return normalized;
    }),
  )
  .pipe(z.array(evolutionCategorySchema));

export const repoConfigSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  language: repoLanguageSchema,
  role: z.string().min(1),
});

const ownershipRuleSchema = z.object({
  owner: z.string().min(1),
  kind: z.enum(['team', 'person', 'service']),
  scope: z.enum(['repo', 'path', 'api', 'package']),
  repo: z.string().min(1).optional(),
  pattern: z.string().min(1).optional(),
});

const DEFAULT_EVOLUTION = {
  aggressiveness: 'aggressive' as const,
  maxSuggestionsPerSession: 5,
  categories: ['feature', 'performance', 'monetization', 'scale', 'security'] as Array<
    z.infer<typeof evolutionCategorySchema>
  >,
};

const DEFAULT_QUALITY = {
  blockOnFailure: true,
  requireTestsForNewCode: true,
  conventionStrictness: 'strict' as const,
};

const DEFAULT_CONTEXT = {
  tokenBudget: 8000,
  prioritize: 'changed-files-first' as const,
  includeRecentCommits: 20,
};

const DEFAULT_CACHE = {
  directory: '.omni-link-cache',
  maxAgeDays: 7,
};

const DEFAULT_DAEMON = {
  enabled: false,
  statePath: '.omni-link-daemon-state.sqlite',
  pollIntervalMs: 1000,
  cacheRetentionDays: 7,
  workspaceGroups: {},
  preferDaemon: false,
};

const DEFAULT_GITHUB = {
  enabled: false,
  defaultBaseBranch: 'main',
  commentOnPr: true,
  publishChecks: true,
  artifactPath: '.omni-link/review-artifact.json',
  publishMode: 'dry-run' as const,
  replayDirectory: '.omni-link/provider-replay',
  apiUrl: 'https://api.github.com',
};

const DEFAULT_GITLAB = {
  enabled: false,
  defaultBaseBranch: 'main',
  commentOnMergeRequest: true,
  publishChecks: true,
  artifactPath: '.omni-link/review-artifact.gitlab.json',
  publishMode: 'dry-run' as const,
  replayDirectory: '.omni-link/provider-replay',
  apiUrl: 'https://gitlab.com/api/v4',
};

const DEFAULT_AUTOMATION = {
  enabled: false,
  branchPrefix: 'codex/omni-link',
  createPullRequest: true,
  retryLimit: 2,
  allowedRiskTiers: ['low', 'medium'] as Array<z.infer<typeof riskLevelSchema>>,
  autoApplyRiskTiers: ['low'] as Array<z.infer<typeof riskLevelSchema>>,
  dryRunByDefault: true,
};

const DEFAULT_OWNERSHIP = {
  enabled: false,
  defaultOwner: 'unassigned',
  rules: [] as Array<z.infer<typeof ownershipRuleSchema>>,
};

const DEFAULT_RUNTIME = {
  enabled: false,
};

const DEFAULT_POLICIES = {
  enabled: false,
  protectedBranches: ['main'],
  requiredChecks: ['lint', 'test', 'build'],
  requiredOwners: [] as string[],
  maxAllowedRisk: 'medium' as const,
  forbidDirectMainMutation: true,
  forbidDestructiveChanges: true,
};

const DEFAULT_MAX_TIER = {
  enabled: false,
  semanticAnalysis: {
    enabled: false,
    preferSemantic: false,
    confidenceThreshold: 0.6,
    languages: [
      'typescript',
      'tsx',
      'javascript',
      'python',
      'go',
      'graphql',
      'java',
      'swift',
    ] as Array<
      'typescript' | 'tsx' | 'javascript' | 'python' | 'go' | 'graphql' | 'java' | 'swift'
    >,
  },
  runtimeIngestion: {
    enabled: false,
  },
  execution: {
    enabled: false,
  },
};

export const omniLinkConfigSchema = z.object({
  repos: z.array(repoConfigSchema).min(1).max(10),
  reviewProvider: z.enum(['github', 'gitlab']).default('github'),
  evolution: z
    .object({
      aggressiveness: z.enum(['aggressive', 'moderate', 'on-demand']).default('aggressive'),
      maxSuggestionsPerSession: z.number().int().min(1).max(20).default(5),
      categories: categoryArraySchema.default(DEFAULT_EVOLUTION.categories),
    })
    .default(DEFAULT_EVOLUTION),
  quality: z
    .object({
      blockOnFailure: z.boolean().default(true),
      requireTestsForNewCode: z.boolean().default(true),
      conventionStrictness: z.enum(['strict', 'moderate', 'relaxed']).default('strict'),
    })
    .default(DEFAULT_QUALITY),
  context: z
    .object({
      tokenBudget: z.number().int().min(100).max(50000).default(8000),
      prioritize: z
        .enum(['changed-files-first', 'api-surface-first'])
        .default('changed-files-first'),
      includeRecentCommits: z.number().int().min(0).max(100).default(20),
      focus: z.enum(['commits', 'types', 'api-surface', 'mismatches', 'auto']).optional(),
    })
    .default(DEFAULT_CONTEXT),
  cache: z
    .object({
      directory: z.string().min(1).default(DEFAULT_CACHE.directory),
      maxAgeDays: z.number().int().min(1).max(30).default(7),
    })
    .default(DEFAULT_CACHE),
  daemon: z
    .object({
      enabled: z.boolean().default(DEFAULT_DAEMON.enabled),
      statePath: z.string().min(1).default(DEFAULT_DAEMON.statePath),
      pollIntervalMs: z.number().int().min(100).max(60_000).default(DEFAULT_DAEMON.pollIntervalMs),
      cacheRetentionDays: z
        .number()
        .int()
        .min(1)
        .max(90)
        .default(DEFAULT_DAEMON.cacheRetentionDays),
      workspaceGroups: z.record(z.string(), z.array(z.string().min(1))).default({}),
      preferDaemon: z.boolean().default(DEFAULT_DAEMON.preferDaemon),
    })
    .optional(),
  github: z
    .object({
      enabled: z.boolean().default(DEFAULT_GITHUB.enabled),
      owner: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      defaultBaseBranch: z.string().min(1).default(DEFAULT_GITHUB.defaultBaseBranch),
      commentOnPr: z.boolean().default(DEFAULT_GITHUB.commentOnPr),
      publishChecks: z.boolean().default(DEFAULT_GITHUB.publishChecks),
      artifactPath: z.string().min(1).default(DEFAULT_GITHUB.artifactPath),
      publishMode: z.enum(['dry-run', 'replay', 'github']).default(DEFAULT_GITHUB.publishMode),
      replayDirectory: z.string().min(1).default(DEFAULT_GITHUB.replayDirectory),
      apiUrl: z.string().url().default(DEFAULT_GITHUB.apiUrl),
    })
    .optional(),
  gitlab: z
    .object({
      enabled: z.boolean().default(DEFAULT_GITLAB.enabled),
      namespace: z.string().min(1).optional(),
      project: z.string().min(1).optional(),
      defaultBaseBranch: z.string().min(1).default(DEFAULT_GITLAB.defaultBaseBranch),
      commentOnMergeRequest: z.boolean().default(DEFAULT_GITLAB.commentOnMergeRequest),
      publishChecks: z.boolean().default(DEFAULT_GITLAB.publishChecks),
      artifactPath: z.string().min(1).default(DEFAULT_GITLAB.artifactPath),
      publishMode: z.enum(['dry-run', 'replay', 'gitlab']).default(DEFAULT_GITLAB.publishMode),
      replayDirectory: z.string().min(1).default(DEFAULT_GITLAB.replayDirectory),
      apiUrl: z.string().url().default(DEFAULT_GITLAB.apiUrl),
    })
    .optional(),
  automation: z
    .object({
      enabled: z.boolean().default(DEFAULT_AUTOMATION.enabled),
      branchPrefix: z.string().min(1).default(DEFAULT_AUTOMATION.branchPrefix),
      createPullRequest: z.boolean().default(DEFAULT_AUTOMATION.createPullRequest),
      retryLimit: z.number().int().min(0).max(10).default(DEFAULT_AUTOMATION.retryLimit),
      allowedRiskTiers: z
        .array(riskLevelSchema)
        .min(1)
        .default(DEFAULT_AUTOMATION.allowedRiskTiers),
      autoApplyRiskTiers: z
        .array(riskLevelSchema)
        .min(1)
        .default(DEFAULT_AUTOMATION.autoApplyRiskTiers),
      dryRunByDefault: z.boolean().default(DEFAULT_AUTOMATION.dryRunByDefault),
    })
    .optional(),
  ownership: z
    .object({
      enabled: z.boolean().default(DEFAULT_OWNERSHIP.enabled),
      defaultOwner: z.string().min(1).default(DEFAULT_OWNERSHIP.defaultOwner),
      rules: z.array(ownershipRuleSchema).default(DEFAULT_OWNERSHIP.rules),
    })
    .optional(),
  runtime: z
    .object({
      enabled: z.boolean().default(DEFAULT_RUNTIME.enabled),
      coverageSummaryPath: z.string().min(1).optional(),
      testResultsPath: z.string().min(1).optional(),
      openApiPath: z.string().min(1).optional(),
      graphQlSchemaPath: z.string().min(1).optional(),
      telemetrySummaryPath: z.string().min(1).optional(),
      traceSummaryPath: z.string().min(1).optional(),
    })
    .optional(),
  policies: z
    .object({
      enabled: z.boolean().default(DEFAULT_POLICIES.enabled),
      protectedBranches: z.array(z.string().min(1)).default(DEFAULT_POLICIES.protectedBranches),
      requiredChecks: z.array(z.string().min(1)).default(DEFAULT_POLICIES.requiredChecks),
      requiredOwners: z.array(z.string().min(1)).default(DEFAULT_POLICIES.requiredOwners),
      maxAllowedRisk: riskLevelSchema.default(DEFAULT_POLICIES.maxAllowedRisk),
      forbidDirectMainMutation: z.boolean().default(DEFAULT_POLICIES.forbidDirectMainMutation),
      forbidDestructiveChanges: z.boolean().default(DEFAULT_POLICIES.forbidDestructiveChanges),
    })
    .optional(),
  maxTier: z
    .object({
      enabled: z.boolean().default(DEFAULT_MAX_TIER.enabled),
      semanticAnalysis: z
        .object({
          enabled: z.boolean().default(DEFAULT_MAX_TIER.semanticAnalysis.enabled),
          preferSemantic: z.boolean().default(DEFAULT_MAX_TIER.semanticAnalysis.preferSemantic),
          confidenceThreshold: z
            .number()
            .min(0)
            .max(1)
            .default(DEFAULT_MAX_TIER.semanticAnalysis.confidenceThreshold),
          languages: z
            .array(
              z.enum([
                'typescript',
                'tsx',
                'javascript',
                'python',
                'go',
                'graphql',
                'java',
                'swift',
              ]),
            )
            .min(1)
            .default(DEFAULT_MAX_TIER.semanticAnalysis.languages),
        })
        .default(DEFAULT_MAX_TIER.semanticAnalysis),
      runtimeIngestion: z
        .object({
          enabled: z.boolean().default(DEFAULT_MAX_TIER.runtimeIngestion.enabled),
        })
        .default(DEFAULT_MAX_TIER.runtimeIngestion),
      execution: z
        .object({
          enabled: z.boolean().default(DEFAULT_MAX_TIER.execution.enabled),
        })
        .default(DEFAULT_MAX_TIER.execution),
    })
    .optional(),
  simulateOnly: z.boolean().optional(),
});

export type ParsedOmniLinkConfig = z.infer<typeof omniLinkConfigSchema>;

export function parseConfig(raw: unknown): ParsedOmniLinkConfig {
  return omniLinkConfigSchema.parse(raw);
}

export function safeParseConfig(raw: unknown): ReturnType<typeof omniLinkConfigSchema.safeParse> {
  return omniLinkConfigSchema.safeParse(raw);
}
