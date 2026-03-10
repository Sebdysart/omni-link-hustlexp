import { describe, it, expect } from 'vitest';
import {
  REVIEW_COMMENT_MARKER,
  ensureReviewCommentMarker,
  summarizeStandardReviewArtifact,
  buildStandardReviewReplayOutput,
  skippedRecord,
  createDryRunReviewTransport,
  applyReviewProviderCapabilities,
  publishSkipReasonForMetadata,
} from '../../engine/providers/shared.js';
import type {
  ReviewArtifact,
  ReviewProviderCapabilities,
  ReviewProviderMetadata,
  Mismatch,
  ImpactPath,
} from '../../engine/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeArtifact(overrides: Partial<ReviewArtifact> = {}): ReviewArtifact {
  return {
    generatedAt: '2026-03-10T00:00:00Z',
    baseRef: 'main',
    headRef: 'feature/test',
    affectedRepos: overrides.affectedRepos ?? [],
    impact: overrides.impact ?? [],
    contractMismatches: overrides.contractMismatches ?? [],
    findings: overrides.findings ?? [],
    owners: overrides.owners ?? [],
    risk: overrides.risk ?? {
      overallRisk: 'low',
      score: 10,
      reasons: [],
      affectedRepos: [],
      blockedByPolicy: false,
    },
    policyDecisions: overrides.policyDecisions ?? [],
    executionPlan: overrides.executionPlan ?? undefined,
  };
}

function makeMismatch(overrides: Partial<Mismatch> = {}): Mismatch {
  return {
    kind: overrides.kind ?? 'missing-field',
    severity: overrides.severity ?? 'warning',
    description: overrides.description ?? 'Field "email" missing from consumer type',
    provider: {
      repo: 'backend',
      file: 'src/routers/user.ts',
      line: 42,
      field: 'email',
      ...overrides.provider,
    },
    consumer: {
      repo: 'ios-app',
      file: 'Services/UserService.swift',
      line: 15,
      field: 'email',
      ...overrides.consumer,
    },
  };
}

function makeImpactPath(overrides: Partial<ImpactPath> = {}): ImpactPath {
  return {
    trigger: overrides.trigger ?? {
      repo: 'backend',
      file: 'src/routers/user.ts',
      change: 'Modified user response type',
    },
    affected: overrides.affected ?? [
      {
        repo: 'ios-app',
        file: 'Services/UserService.swift',
        line: 10,
        severity: 'warning',
        reason: 'Consumes user response type',
      },
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ensureReviewCommentMarker', () => {
  it('adds marker to body without it', () => {
    const result = ensureReviewCommentMarker('Hello world');
    expect(result).toContain(REVIEW_COMMENT_MARKER);
    expect(result).toBe(`${REVIEW_COMMENT_MARKER}\nHello world`);
  });

  it('does not duplicate marker if already present', () => {
    const body = `${REVIEW_COMMENT_MARKER}\nExisting content`;
    const result = ensureReviewCommentMarker(body);
    expect(result).toBe(body);
  });

  it('handles empty body', () => {
    const result = ensureReviewCommentMarker('');
    expect(result).toBe(`${REVIEW_COMMENT_MARKER}\n`);
  });
});

describe('summarizeStandardReviewArtifact', () => {
  it('includes all required fields in summary', () => {
    const artifact = makeArtifact({
      affectedRepos: ['backend', 'ios-app'],
      contractMismatches: [makeMismatch()],
      impact: [makeImpactPath()],
    });

    const summary = summarizeStandardReviewArtifact(artifact);
    expect(summary).toContain('# omni-link review');
    expect(summary).toContain('Risk: low (10)');
    expect(summary).toContain('Refs: main -> feature/test');
    expect(summary).toContain('Affected repos: backend, ios-app');
    expect(summary).toContain('Contract mismatches: 1');
    expect(summary).toContain('Impact paths: 1');
  });

  it('shows "none" for empty affected repos', () => {
    const artifact = makeArtifact({ affectedRepos: [] });
    const summary = summarizeStandardReviewArtifact(artifact);
    expect(summary).toContain('Affected repos: none');
  });

  it('shows "no amplified risk reasons" when no reasons', () => {
    const artifact = makeArtifact();
    const summary = summarizeStandardReviewArtifact(artifact);
    expect(summary).toContain('Risk reasons: no amplified risk reasons');
  });

  it('joins multiple risk reasons with semicolons', () => {
    const artifact = makeArtifact({
      risk: {
        overallRisk: 'high',
        score: 80,
        reasons: ['breaking API change', 'missing tests'],
        affectedRepos: ['backend'],
        blockedByPolicy: false,
      },
    });

    const summary = summarizeStandardReviewArtifact(artifact);
    expect(summary).toContain('Risk reasons: breaking API change; missing tests');
  });

  it('counts policy blocks correctly', () => {
    const artifact = makeArtifact({
      policyDecisions: [
        { policyId: 'lint', status: 'passed', message: 'OK' },
        { policyId: 'tests', status: 'blocked', message: 'Tests failing' },
        { policyId: 'owners', status: 'blocked', message: 'Missing owner approval' },
      ],
    });

    const summary = summarizeStandardReviewArtifact(artifact);
    expect(summary).toContain('Policy blocks: 2');
  });

  it('counts planned changes from execution plan', () => {
    const artifact = makeArtifact({
      executionPlan: {
        changes: [
          {
            id: 'c1',
            kind: 'code',
            repo: 'backend',
            title: 'Fix type',
            risk: 'low',
            file: 'src/types.ts',
            diff: '',
          },
        ],
        approvals: [{ owner: 'admin', status: 'pending', reason: 'High risk' }],
      },
    });

    const summary = summarizeStandardReviewArtifact(artifact);
    expect(summary).toContain('Planned changes: 1');
    expect(summary).toContain('Required approvals: 1');
  });
});

describe('buildStandardReviewReplayOutput', () => {
  it('generates full review output with sections', () => {
    const artifact = makeArtifact({
      contractMismatches: [makeMismatch()],
      impact: [makeImpactPath()],
    });

    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.commentBody).toContain(REVIEW_COMMENT_MARKER);
    expect(output.commentBody).toContain('## Contract Mismatches');
    expect(output.commentBody).toContain('## Impact Paths');
    expect(output.commentBody).toContain('## Planned Changes');
    expect(output.summary).toContain('# omni-link review');
  });

  it('shows "- none" for empty sections', () => {
    const artifact = makeArtifact();
    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.commentBody).toContain('## Contract Mismatches\n- none');
    expect(output.commentBody).toContain('## Impact Paths\n- none');
    expect(output.commentBody).toContain('## Planned Changes\n- none');
  });

  it('uses default check name and title', () => {
    const artifact = makeArtifact();
    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.checkRun.name).toBe('omni-link review');
    expect(output.checkRun.title).toBe('omni-link review: low risk');
  });

  it('uses custom check name and title prefix', () => {
    const artifact = makeArtifact();
    const output = buildStandardReviewReplayOutput(artifact, {
      checkName: 'custom-check',
      checkTitlePrefix: 'Custom Prefix',
    });
    expect(output.checkRun.name).toBe('custom-check');
    expect(output.checkRun.title).toBe('Custom Prefix: low risk');
  });

  it('conclusion is "success" for low risk', () => {
    const artifact = makeArtifact({
      risk: {
        overallRisk: 'low',
        score: 10,
        reasons: [],
        affectedRepos: [],
        blockedByPolicy: false,
      },
    });

    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.checkRun.conclusion).toBe('success');
  });

  it('conclusion is "neutral" for medium risk', () => {
    const artifact = makeArtifact({
      risk: {
        overallRisk: 'medium',
        score: 50,
        reasons: ['some concern'],
        affectedRepos: [],
        blockedByPolicy: false,
      },
    });

    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.checkRun.conclusion).toBe('neutral');
  });

  it('conclusion is "action_required" for high risk', () => {
    const artifact = makeArtifact({
      risk: {
        overallRisk: 'high',
        score: 80,
        reasons: ['breaking change'],
        affectedRepos: [],
        blockedByPolicy: false,
      },
    });

    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.checkRun.conclusion).toBe('action_required');
  });

  it('conclusion is "action_required" for critical risk', () => {
    const artifact = makeArtifact({
      risk: {
        overallRisk: 'critical',
        score: 95,
        reasons: ['security vulnerability'],
        affectedRepos: [],
        blockedByPolicy: false,
      },
    });

    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.checkRun.conclusion).toBe('action_required');
  });

  it('conclusion is "action_required" when blocked by policy even at low risk', () => {
    const artifact = makeArtifact({
      risk: {
        overallRisk: 'low',
        score: 5,
        reasons: [],
        affectedRepos: [],
        blockedByPolicy: true,
      },
    });

    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.checkRun.conclusion).toBe('action_required');
  });

  it('generates annotations from mismatches and impacts', () => {
    const artifact = makeArtifact({
      contractMismatches: [
        makeMismatch({ severity: 'breaking' }),
        makeMismatch({
          severity: 'info',
          consumer: {
            repo: 'web-app',
            file: 'src/api.ts',
            line: 5,
            field: 'name',
          },
        }),
      ],
      impact: [makeImpactPath()],
    });

    const output = buildStandardReviewReplayOutput(artifact);
    expect(output.checkRun.annotations.length).toBeGreaterThanOrEqual(3);

    const levels = output.checkRun.annotations.map((a) => a.level);
    expect(levels).toContain('failure');
    expect(levels).toContain('notice');
    expect(levels).toContain('warning');
  });
});

describe('skippedRecord', () => {
  it('creates a skipped record for comment', () => {
    const record = skippedRecord('comment', 'target is closed');
    expect(record).toEqual({
      kind: 'comment',
      status: 'skipped',
      reason: 'target is closed',
    });
  });

  it('creates a skipped record for check-run', () => {
    const record = skippedRecord('check-run', 'not supported');
    expect(record).toEqual({
      kind: 'check-run',
      status: 'skipped',
      reason: 'not supported',
    });
  });
});

describe('createDryRunReviewTransport', () => {
  it('publishComment returns dry-run record', async () => {
    const transport = createDryRunReviewTransport('dry-run');
    const result = await transport.publishComment({
      target: { owner: 'org', repo: 'repo', pullRequestNumber: 1 },
      body: 'test',
    });
    expect(result.status).toBe('dry-run');
    expect(result.kind).toBe('comment');
  });

  it('publishCheckRun returns dry-run record', async () => {
    const transport = createDryRunReviewTransport('dry-run');
    const result = await transport.publishCheckRun({
      target: { owner: 'org', repo: 'repo', pullRequestNumber: 1 },
      checkRun: {
        name: 'test',
        title: 'test',
        summary: '',
        text: '',
        conclusion: 'success',
        annotations: [],
      },
    });
    expect(result.status).toBe('dry-run');
    expect(result.kind).toBe('check-run');
  });

  it('stores the mode', () => {
    const transport = createDryRunReviewTransport('replay');
    expect(transport.mode).toBe('replay');
  });
});

describe('applyReviewProviderCapabilities', () => {
  const baseOutput = buildStandardReviewReplayOutput(
    makeArtifact({
      contractMismatches: [makeMismatch(), makeMismatch(), makeMismatch()],
      impact: [makeImpactPath()],
    }),
  );

  it('truncates annotations to maxAnnotationsPerCheck', () => {
    const capabilities: ReviewProviderCapabilities = {
      supportsComments: true,
      supportsChecks: true,
      supportsMetadata: true,
      maxAnnotationsPerCheck: 1,
      maxCommentBytes: 100_000,
    };

    const result = applyReviewProviderCapabilities(baseOutput, capabilities);
    expect(result.checkRun.annotations).toHaveLength(1);
  });

  it('truncates comment body to maxCommentBytes', () => {
    const capabilities: ReviewProviderCapabilities = {
      supportsComments: true,
      supportsChecks: true,
      supportsMetadata: true,
      maxAnnotationsPerCheck: 100,
      maxCommentBytes: 50, // very small
    };

    const result = applyReviewProviderCapabilities(baseOutput, capabilities);
    expect(Buffer.byteLength(result.commentBody, 'utf8')).toBeLessThanOrEqual(50);
    expect(result.commentBody).toContain('[truncated by omni-link');
  });

  it('does not truncate when within limits', () => {
    const capabilities: ReviewProviderCapabilities = {
      supportsComments: true,
      supportsChecks: true,
      supportsMetadata: true,
      maxAnnotationsPerCheck: 1000,
      maxCommentBytes: 100_000,
    };

    const result = applyReviewProviderCapabilities(baseOutput, capabilities);
    expect(result.commentBody).toBe(baseOutput.commentBody);
  });

  it('handles maxAnnotationsPerCheck of 0', () => {
    const capabilities: ReviewProviderCapabilities = {
      supportsComments: true,
      supportsChecks: true,
      supportsMetadata: true,
      maxAnnotationsPerCheck: 0,
      maxCommentBytes: 100_000,
    };

    const result = applyReviewProviderCapabilities(baseOutput, capabilities);
    expect(result.checkRun.annotations).toHaveLength(0);
  });
});

describe('publishSkipReasonForMetadata', () => {
  it('returns null for null metadata', () => {
    expect(publishSkipReasonForMetadata(null, 'comment')).toBeNull();
  });

  it('returns null for open state', () => {
    const metadata: ReviewProviderMetadata = { provider: 'github', state: 'open' };
    expect(publishSkipReasonForMetadata(metadata, 'comment')).toBeNull();
  });

  it('returns null for unknown state', () => {
    const metadata: ReviewProviderMetadata = { provider: 'github', state: 'unknown' };
    expect(publishSkipReasonForMetadata(metadata, 'comment')).toBeNull();
  });

  it('returns skip reason for closed state', () => {
    const metadata: ReviewProviderMetadata = { provider: 'github', state: 'closed' };
    const result = publishSkipReasonForMetadata(metadata, 'comment');
    expect(result).toContain('comment publishing skipped');
    expect(result).toContain('closed');
  });

  it('returns skip reason for merged state', () => {
    const metadata: ReviewProviderMetadata = { provider: 'gitlab', state: 'merged' };
    const result = publishSkipReasonForMetadata(metadata, 'check-run');
    expect(result).toContain('status publishing skipped');
    expect(result).toContain('merged');
    expect(result).toContain('gitlab');
  });

  it('returns skip reason for locked state', () => {
    const metadata: ReviewProviderMetadata = { provider: 'github', state: 'locked' };
    const result = publishSkipReasonForMetadata(metadata, 'comment');
    expect(result).toContain('comment publishing skipped');
    expect(result).toContain('locked');
  });

  it('uses correct subject for check-run kind', () => {
    const metadata: ReviewProviderMetadata = { provider: 'github', state: 'closed' };
    const result = publishSkipReasonForMetadata(metadata, 'check-run');
    expect(result).toContain('status publishing');
  });
});
