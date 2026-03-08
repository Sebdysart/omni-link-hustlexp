import { execFileSync } from 'node:child_process';

import type {
  ChangePlan,
  EcosystemGraph,
  ExecutionPlan,
  OmniLinkConfig,
  PolicyDecision,
  RiskLevel,
  ReviewArtifact,
  RiskReport,
  RollbackPlan,
} from '../types.js';
import { evaluatePolicies, policiesBlock } from '../policy/index.js';

export interface ExecutionResult {
  executed: boolean;
  branches: Array<{ repo: string; branch: string; created: boolean; error?: string }>;
  pullRequestCreated: boolean;
  warnings: string[];
  ledger: ExecutionLedgerEntry[];
}

export interface ExecutionLedgerEntry {
  kind: 'preflight' | 'branch' | 'push' | 'pull-request' | 'rollback';
  repo?: string;
  status: 'passed' | 'skipped' | 'failed';
  message: string;
}

function ledgerEntry(
  kind: ExecutionLedgerEntry['kind'],
  status: ExecutionLedgerEntry['status'],
  message: string,
  repo?: string,
): ExecutionLedgerEntry {
  return { kind, repo, status, message };
}

function baseBranchFor(config: OmniLinkConfig): string {
  return config.github?.defaultBaseBranch ?? 'main';
}

function branchNameFor(config: OmniLinkConfig, planId: string): string {
  const prefix = config.automation?.branchPrefix ?? 'codex/omni-link';
  return `${prefix}/${planId}`;
}

const RISK_ORDER: Record<RiskReport['overallRisk'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function changePlansFromGraph(graph: EcosystemGraph): ChangePlan[] {
  const plans: ChangePlan[] = [];

  for (const mismatch of graph.contractMismatches) {
    plans.push({
      id: `schema-sync-${plans.length + 1}`,
      kind: 'schema-sync',
      title: `Sync contract for ${mismatch.provider.repo}`,
      description: mismatch.description,
      repo: mismatch.provider.repo,
      files: [mismatch.provider.file, mismatch.consumer.file],
      confidence: mismatch.confidence ?? 0.7,
      risk:
        mismatch.severity === 'breaking'
          ? 'high'
          : mismatch.severity === 'warning'
            ? 'medium'
            : 'low',
      dependsOn: [],
      preconditions: ['confirm provider contract intent'],
      validationSteps: ['run omni-link review-pr', 'run repo test suite'],
      rollbackSteps: ['restore provider contract', 'revert consumer sync'],
    });
  }

  for (const impactPath of graph.impactPaths) {
    const crossRepoImpact = impactPath.affected.find(
      (affected) => affected.repo !== impactPath.trigger.repo,
    );
    if (!crossRepoImpact) continue;

    plans.push({
      id: `consumer-update-${plans.length + 1}`,
      kind: 'consumer-update',
      title: `Update consumer ${crossRepoImpact.repo}`,
      description: `${crossRepoImpact.repo} consumes ${impactPath.trigger.file}`,
      repo: crossRepoImpact.repo,
      files: [crossRepoImpact.file],
      confidence: impactPath.confidence ?? 0.65,
      risk: crossRepoImpact.severity === 'breaking' ? 'high' : 'medium',
      dependsOn: [],
      preconditions: ['provider change merged or branch available'],
      validationSteps: ['run omni-link impact', 'run repo test suite'],
      rollbackSteps: ['revert consumer branch changes'],
    });
  }

  if (plans.length === 0) {
    plans.push({
      id: 'docs-update-1',
      kind: 'docs-update',
      title: 'Document ecosystem review outcome',
      description: 'No direct migration plan was required; generate docs/update evidence.',
      repo: graph.repos[0]?.repoId ?? 'workspace',
      files: [],
      confidence: 0.5,
      risk: 'low',
      dependsOn: [],
      preconditions: ['review artifact generated'],
      validationSteps: ['attach artifact to PR or release notes'],
      rollbackSteps: ['discard generated documentation update'],
    });
  }

  return plans;
}

function rollbackPlanFor(branchName: string, changes: ChangePlan[]): RollbackPlan {
  return {
    branchName,
    restoreTargets: [...new Set(changes.flatMap((change) => change.files))],
    steps: [
      `Delete generated branch ${branchName} in each affected repo`,
      'Revert or discard any staged automation patches',
      'Re-run omni-link review-pr before retrying',
    ],
  };
}

export function createExecutionPlan(
  config: OmniLinkConfig,
  graph: EcosystemGraph,
  risk: RiskReport,
  owners = graph.owners ?? [],
): ExecutionPlan {
  const changes = changePlansFromGraph(graph);
  const branchName = branchNameFor(config, `plan-${Date.now()}`);
  const policyDecisions: PolicyDecision[] = evaluatePolicies(
    config,
    baseBranchFor(config),
    risk,
    owners,
    {
      destructive: changes.some(
        (change) => change.kind === 'provider-migration' && change.risk === 'high',
      ),
    },
  );
  const blocked = policiesBlock(policyDecisions);

  return {
    planId: branchName.split('/').pop() ?? 'plan',
    mode: config.automation?.dryRunByDefault === false ? 'branch-pr' : 'dry-run',
    branchName,
    baseBranch: baseBranchFor(config),
    changes,
    risk: {
      ...risk,
      blockedByPolicy: blocked,
    },
    approvals: [...new Set(owners.map((owner) => owner.owner))],
    blocked,
    policyDecisions,
    rollback: rollbackPlanFor(branchName, changes),
    pullRequest: {
      title: `omni-link: ${risk.overallRisk} risk execution plan`,
      body: changes.map((change) => `- ${change.title}: ${change.description}`).join('\n'),
    },
  };
}

export function attachExecutionPlan(
  artifact: ReviewArtifact,
  executionPlan: ExecutionPlan,
): ReviewArtifact {
  return {
    ...artifact,
    executionPlan,
    policyDecisions: executionPlan.policyDecisions,
    risk: executionPlan.risk,
  };
}

function branchExists(repoPath: string, branchName: string): boolean {
  try {
    execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', branchName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function currentBranch(repoPath: string): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function worktreeDirty(repoPath: string): boolean {
  try {
    return (
      execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim().length > 0
    );
  } catch {
    return true;
  }
}

function baseBranchExists(repoPath: string, branchName: string): boolean {
  try {
    execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', branchName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function remoteExists(repoPath: string, remote = 'origin'): boolean {
  try {
    execFileSync('git', ['-C', repoPath, 'remote', 'get-url', remote], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function resolveGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
}

function resolveGitHubApiRoot(config: OmniLinkConfig): string {
  return (config.github?.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
}

function riskTierAllowed(
  allowedRiskTiers: RiskLevel[] | undefined,
  risk: RiskReport['overallRisk'],
): boolean {
  if (!allowedRiskTiers || allowedRiskTiers.length === 0) {
    return true;
  }

  const threshold = Math.max(...allowedRiskTiers.map((tier) => RISK_ORDER[tier]));
  return RISK_ORDER[risk] <= threshold;
}

function affectedRepos(config: OmniLinkConfig, plan: ExecutionPlan): OmniLinkConfig['repos'] {
  const repoIds = new Set(plan.changes.map((change) => change.repo));
  return config.repos.filter((repo) => repoIds.has(repo.name));
}

function pushBranch(repoPath: string, branchName: string): string | null {
  if (!remoteExists(repoPath)) {
    return 'origin remote is not configured';
  }

  try {
    execFileSync('git', ['-C', repoPath, 'push', '-u', 'origin', branchName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function canCreatePullRequest(config: OmniLinkConfig): boolean {
  if (!config.github?.enabled || !config.automation?.createPullRequest) return false;

  try {
    execFileSync('gh', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return Boolean(resolveGitHubToken() && config.github?.owner && config.github?.repo);
  }
}

function createPullRequestWithGh(plan: ExecutionPlan): string | null {
  if (!plan.pullRequest) {
    return 'pull request details are missing';
  }

  try {
    execFileSync(
      'gh',
      [
        'pr',
        'create',
        '--base',
        plan.baseBranch,
        '--head',
        plan.branchName,
        '--title',
        plan.pullRequest.title,
        '--body',
        plan.pullRequest.body,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function createPullRequestWithGitHubApi(
  config: OmniLinkConfig,
  plan: ExecutionPlan,
): string | null {
  if (!plan.pullRequest) {
    return 'pull request details are missing';
  }

  const token = resolveGitHubToken();
  const owner = config.github?.owner;
  const repo = config.github?.repo;
  if (!token || !owner || !repo) {
    return 'GitHub owner/repo and token are required for API-based PR creation';
  }

  try {
    execFileSync(
      'curl',
      [
        '-sSf',
        '-X',
        'POST',
        `${resolveGitHubApiRoot(config)}/repos/${owner}/${repo}/pulls`,
        '-H',
        `Authorization: Bearer ${token}`,
        '-H',
        'Accept: application/vnd.github+json',
        '-H',
        'X-GitHub-Api-Version: 2022-11-28',
        '-H',
        'Content-Type: application/json',
        '--data-binary',
        JSON.stringify({
          title: plan.pullRequest.title,
          body: plan.pullRequest.body,
          head: plan.branchName,
          base: plan.baseBranch,
          draft: false,
        }),
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function applyExecutionPlan(config: OmniLinkConfig, plan: ExecutionPlan): ExecutionResult {
  if (config.simulateOnly || config.automation?.dryRunByDefault !== false || plan.blocked) {
    return {
      executed: false,
      branches: [],
      pullRequestCreated: false,
      warnings: plan.blocked ? ['execution blocked by policy'] : ['dry-run mode is enabled'],
      ledger: [
        ledgerEntry(
          'preflight',
          'skipped',
          plan.blocked ? 'execution blocked by policy' : 'dry-run mode is enabled',
        ),
      ],
    };
  }

  if (!config.automation?.enabled) {
    return {
      executed: false,
      branches: [],
      pullRequestCreated: false,
      warnings: ['automation is disabled'],
      ledger: [ledgerEntry('preflight', 'failed', 'automation is disabled')],
    };
  }

  if (!riskTierAllowed(config.automation.allowedRiskTiers, plan.risk.overallRisk)) {
    return {
      executed: false,
      branches: [],
      pullRequestCreated: false,
      warnings: [`risk tier '${plan.risk.overallRisk}' is not allowed for execution`],
      ledger: [
        ledgerEntry(
          'preflight',
          'failed',
          `risk tier '${plan.risk.overallRisk}' is not allowed for execution`,
        ),
      ],
    };
  }

  const branches: ExecutionResult['branches'] = [];
  const warnings: string[] = [];
  const ledger: ExecutionResult['ledger'] = [
    ledgerEntry('preflight', 'passed', `execution permitted for ${plan.risk.overallRisk} risk`),
  ];
  const repos = affectedRepos(config, plan);

  for (const repo of repos) {
    try {
      if (worktreeDirty(repo.path)) {
        branches.push({
          repo: repo.name,
          branch: plan.branchName,
          created: false,
          error: 'working tree has uncommitted changes',
        });
        ledger.push(
          ledgerEntry('branch', 'failed', 'working tree has uncommitted changes', repo.name),
        );
        continue;
      }

      if (!baseBranchExists(repo.path, plan.baseBranch)) {
        branches.push({
          repo: repo.name,
          branch: plan.branchName,
          created: false,
          error: `base branch '${plan.baseBranch}' does not exist`,
        });
        ledger.push(
          ledgerEntry(
            'branch',
            'failed',
            `base branch '${plan.baseBranch}' does not exist`,
            repo.name,
          ),
        );
        continue;
      }

      if (!branchExists(repo.path, plan.branchName)) {
        execFileSync('git', ['-C', repo.path, 'branch', plan.branchName, plan.baseBranch], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        ledger.push(
          ledgerEntry(
            'branch',
            'passed',
            `created branch '${plan.branchName}' from '${plan.baseBranch}'`,
            repo.name,
          ),
        );
      } else {
        ledger.push(
          ledgerEntry('branch', 'skipped', `branch '${plan.branchName}' already exists`, repo.name),
        );
      }

      const pushError = config.automation.createPullRequest
        ? pushBranch(repo.path, plan.branchName)
        : null;
      if (pushError) {
        warnings.push(`${repo.name}: ${pushError}`);
        ledger.push(ledgerEntry('push', 'failed', pushError, repo.name));
      } else if (config.automation.createPullRequest) {
        ledger.push(
          ledgerEntry('push', 'passed', `pushed '${plan.branchName}' to origin`, repo.name),
        );
      } else {
        ledger.push(
          ledgerEntry('push', 'skipped', 'push skipped because PR creation is disabled', repo.name),
        );
      }
      branches.push({ repo: repo.name, branch: plan.branchName, created: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      branches.push({
        repo: repo.name,
        branch: plan.branchName,
        created: false,
        error: message,
      });
      ledger.push(ledgerEntry('branch', 'failed', message, repo.name));
    }
  }

  let pullRequestCreated = false;
  if (
    canCreatePullRequest(config) &&
    plan.pullRequest &&
    branches.some((branch) => branch.created) &&
    repos.length === 1
  ) {
    let createError: string | null = null;

    try {
      execFileSync('gh', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      createError = createPullRequestWithGh(plan);
    } catch {
      createError = createPullRequestWithGitHubApi(config, plan);
    }

    if (!createError) {
      pullRequestCreated = true;
      ledger.push(
        ledgerEntry('pull-request', 'passed', 'created pull request for execution branch'),
      );
    } else {
      warnings.push(createError);
      ledger.push(ledgerEntry('pull-request', 'failed', createError));
    }
  } else if (plan.pullRequest && repos.length > 1 && config.automation?.createPullRequest) {
    warnings.push('automatic PR creation is only supported for single-repo execution plans');
    ledger.push(
      ledgerEntry(
        'pull-request',
        'skipped',
        'automatic PR creation is only supported for single-repo execution plans',
      ),
    );
  } else {
    ledger.push(
      ledgerEntry(
        'pull-request',
        'skipped',
        'pull request creation not requested or not applicable',
      ),
    );
  }

  return {
    executed: branches.some((branch) => branch.created),
    branches,
    pullRequestCreated,
    warnings,
    ledger,
  };
}

export function rollbackExecutionPlan(
  config: OmniLinkConfig,
  plan: ExecutionPlan,
): ExecutionResult {
  const branches: ExecutionResult['branches'] = [];
  const warnings: string[] = [];
  const ledger: ExecutionResult['ledger'] = [];

  for (const repo of affectedRepos(config, plan)) {
    try {
      if (branchExists(repo.path, plan.branchName)) {
        if (currentBranch(repo.path) === plan.branchName) {
          execFileSync('git', ['-C', repo.path, 'checkout', plan.baseBranch], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          ledger.push(
            ledgerEntry(
              'rollback',
              'passed',
              `checked out '${plan.baseBranch}' before deleting '${plan.branchName}'`,
              repo.name,
            ),
          );
        }
        execFileSync('git', ['-C', repo.path, 'branch', '-D', plan.branchName], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        ledger.push(
          ledgerEntry('rollback', 'passed', `deleted local branch '${plan.branchName}'`, repo.name),
        );
        if (remoteExists(repo.path)) {
          try {
            execFileSync('git', ['-C', repo.path, 'push', 'origin', '--delete', plan.branchName], {
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            ledger.push(
              ledgerEntry(
                'rollback',
                'passed',
                `deleted remote branch '${plan.branchName}'`,
                repo.name,
              ),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`${repo.name}: ${message}`);
            ledger.push(ledgerEntry('rollback', 'failed', message, repo.name));
          }
        }
        branches.push({ repo: repo.name, branch: plan.branchName, created: false });
      } else {
        ledger.push(
          ledgerEntry(
            'rollback',
            'skipped',
            `branch '${plan.branchName}' does not exist`,
            repo.name,
          ),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      branches.push({
        repo: repo.name,
        branch: plan.branchName,
        created: false,
        error: message,
      });
      ledger.push(ledgerEntry('rollback', 'failed', message, repo.name));
    }
  }

  return {
    executed: branches.length > 0,
    branches,
    pullRequestCreated: false,
    warnings,
    ledger,
  };
}
