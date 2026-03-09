import type {
  OmniLinkConfig,
  OwnerAssignment,
  PolicyDecision,
  RiskLevel,
  RiskReport,
} from '../types.js';

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function highestStatus(decisions: PolicyDecision[]): 'passed' | 'warning' | 'blocked' {
  if (decisions.some((decision) => decision.status === 'blocked')) return 'blocked';
  if (decisions.some((decision) => decision.status === 'warning')) return 'warning';
  return 'passed';
}

export function evaluatePolicies(
  config: OmniLinkConfig,
  targetBranch: string,
  risk: RiskReport,
  owners: OwnerAssignment[],
  options: { destructive?: boolean; authorityDrift?: boolean } = {},
): PolicyDecision[] {
  const policies = config.policies;
  if (!policies?.enabled) {
    return [];
  }

  const decisions: PolicyDecision[] = [];
  if (policies.forbidDirectMainMutation && policies.protectedBranches?.includes(targetBranch)) {
    decisions.push({
      policyId: 'protected-branch',
      status: 'blocked',
      message: `Direct mutation of protected branch '${targetBranch}' is forbidden.`,
    });
  }

  if (
    policies.maxAllowedRisk &&
    RISK_ORDER[risk.overallRisk] > RISK_ORDER[policies.maxAllowedRisk]
  ) {
    decisions.push({
      policyId: 'risk-threshold',
      status: 'blocked',
      message: `Risk '${risk.overallRisk}' exceeds max allowed risk '${policies.maxAllowedRisk}'.`,
    });
  }

  if (policies.requiredOwners && policies.requiredOwners.length > 0) {
    const presentOwners = new Set(owners.map((owner) => owner.owner));
    const missingOwners = policies.requiredOwners.filter(
      (requiredOwner) => !presentOwners.has(requiredOwner),
    );
    if (missingOwners.length > 0) {
      decisions.push({
        policyId: 'required-owners',
        status: 'warning',
        message: `Missing required owners: ${missingOwners.join(', ')}`,
      });
    }
  }

  if (policies.forbidDestructiveChanges && options.destructive) {
    decisions.push({
      policyId: 'destructive-change',
      status: 'blocked',
      message: 'Destructive changes are disabled by policy.',
    });
  }

  if (options.authorityDrift) {
    decisions.push({
      policyId: 'authority-drift',
      status: 'blocked',
      message: 'Authority drift must be reconciled before execution or strict review can proceed.',
    });
  }

  if (decisions.length === 0) {
    decisions.push({
      policyId: 'policy-default',
      status: 'passed',
      message: 'All configured policies passed.',
    });
  }

  return decisions;
}

export function policiesBlock(decisions: PolicyDecision[]): boolean {
  return highestStatus(decisions) === 'blocked';
}
