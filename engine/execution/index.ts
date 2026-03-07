import { execFileSync } from 'node:child_process';

import type {
  ChangePlan,
  EcosystemGraph,
  ExecutionPlan,
  OmniLinkConfig,
  PolicyDecision,
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
}

function baseBranchFor(config: OmniLinkConfig): string {
  return config.github?.defaultBaseBranch ?? 'main';
}

function branchNameFor(config: OmniLinkConfig, planId: string): string {
  const prefix = config.automation?.branchPrefix ?? 'codex/omni-link';
  return `${prefix}/${planId}`;
}

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

function canCreatePullRequest(config: OmniLinkConfig): boolean {
  if (!config.github?.enabled || !config.automation?.createPullRequest) return false;

  try {
    execFileSync('gh', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

export function applyExecutionPlan(config: OmniLinkConfig, plan: ExecutionPlan): ExecutionResult {
  if (config.simulateOnly || config.automation?.dryRunByDefault !== false || plan.blocked) {
    return {
      executed: false,
      branches: [],
      pullRequestCreated: false,
      warnings: plan.blocked ? ['execution blocked by policy'] : ['dry-run mode is enabled'],
    };
  }

  const branches: ExecutionResult['branches'] = [];
  for (const repo of config.repos) {
    const repoChanges = plan.changes.filter((change) => change.repo === repo.name);
    if (repoChanges.length === 0) continue;

    try {
      if (!branchExists(repo.path, plan.branchName)) {
        execFileSync('git', ['-C', repo.path, 'checkout', '-b', plan.branchName], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }
      branches.push({ repo: repo.name, branch: plan.branchName, created: true });
    } catch (error) {
      branches.push({
        repo: repo.name,
        branch: plan.branchName,
        created: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let pullRequestCreated = false;
  const warnings: string[] = [];
  if (canCreatePullRequest(config) && plan.pullRequest) {
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
      pullRequestCreated = true;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    executed: branches.some((branch) => branch.created),
    branches,
    pullRequestCreated,
    warnings,
  };
}

export function rollbackExecutionPlan(
  config: OmniLinkConfig,
  plan: ExecutionPlan,
): ExecutionResult {
  const branches: ExecutionResult['branches'] = [];

  for (const repo of config.repos) {
    try {
      if (branchExists(repo.path, plan.branchName)) {
        execFileSync('git', ['-C', repo.path, 'branch', '-D', plan.branchName], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        branches.push({ repo: repo.name, branch: plan.branchName, created: false });
      }
    } catch (error) {
      branches.push({
        repo: repo.name,
        branch: plan.branchName,
        created: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    executed: branches.length > 0,
    branches,
    pullRequestCreated: false,
    warnings: [],
  };
}
