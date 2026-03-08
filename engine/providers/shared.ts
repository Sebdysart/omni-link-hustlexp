import type {
  ImpactPath,
  Mismatch,
  ReviewArtifact,
  ReviewProviderCapabilities,
  ReviewProviderMetadata,
  ReviewPublishRecord,
} from '../types.js';
import type { ReviewAnnotation, ReviewPublishTransport, ReviewReplayOutput } from './types.js';

export const REVIEW_COMMENT_MARKER = '<!-- omni-link review -->';

export function ensureReviewCommentMarker(body: string): string {
  if (body.includes(REVIEW_COMMENT_MARKER)) {
    return body;
  }

  return `${REVIEW_COMMENT_MARKER}\n${body}`;
}

export function summarizeStandardReviewArtifact(artifact: ReviewArtifact): string {
  const plannedChanges = artifact.executionPlan?.changes.length ?? 0;
  const approvals = artifact.executionPlan?.approvals.length ?? 0;
  const policyFailures = artifact.policyDecisions.filter(
    (decision) => decision.status === 'blocked',
  );
  const riskReasons =
    artifact.risk.reasons.length > 0
      ? artifact.risk.reasons.join('; ')
      : 'no amplified risk reasons';

  return [
    '# omni-link review',
    `- Risk: ${artifact.risk.overallRisk} (${artifact.risk.score})`,
    `- Refs: ${artifact.baseRef} -> ${artifact.headRef}`,
    `- Affected repos: ${artifact.affectedRepos.join(', ') || 'none'}`,
    `- Contract mismatches: ${artifact.contractMismatches.length}`,
    `- Impact paths: ${artifact.impact.length}`,
    `- Planned changes: ${plannedChanges}`,
    `- Required approvals: ${approvals}`,
    `- Policy blocks: ${policyFailures.length}`,
    `- Risk reasons: ${riskReasons}`,
  ].join('\n');
}

function annotationLevel(severity: 'breaking' | 'warning' | 'info'): ReviewAnnotation['level'] {
  switch (severity) {
    case 'breaking':
      return 'failure';
    case 'warning':
      return 'warning';
    case 'info':
      return 'notice';
  }
}

function mismatchAnnotation(mismatch: Mismatch): ReviewAnnotation {
  return {
    path: mismatch.consumer.file,
    line: mismatch.consumer.line,
    level: annotationLevel(mismatch.severity),
    title: `${mismatch.kind} in ${mismatch.consumer.repo}`,
    message: mismatch.description,
  };
}

function impactAnnotations(impactPath: ImpactPath): ReviewAnnotation[] {
  return impactPath.affected.map((affected) => ({
    path: affected.file,
    line: affected.line,
    level: annotationLevel(affected.severity),
    title: `${affected.repo} impacted by ${impactPath.trigger.repo}`,
    message: `${affected.reason} (trigger: ${impactPath.trigger.file})`,
  }));
}

function plannedChangeLines(artifact: ReviewArtifact): string[] {
  return (artifact.executionPlan?.changes ?? []).map(
    (change) => `- ${change.repo}: ${change.title} [${change.risk}]`,
  );
}

function mismatchLines(artifact: ReviewArtifact): string[] {
  if (artifact.contractMismatches.length === 0) {
    return ['- none'];
  }

  return artifact.contractMismatches.map(
    (mismatch) =>
      `- ${mismatch.consumer.repo}:${mismatch.consumer.file}:${mismatch.consumer.line} <- ${mismatch.provider.repo}:${mismatch.provider.file}:${mismatch.provider.line} (${mismatch.severity}) ${mismatch.description}`,
  );
}

function impactLines(artifact: ReviewArtifact): string[] {
  if (artifact.impact.length === 0) {
    return ['- none'];
  }

  return artifact.impact.flatMap((impactPath) =>
    impactPath.affected.map(
      (affected) =>
        `- ${impactPath.trigger.repo}:${impactPath.trigger.file} -> ${affected.repo}:${affected.file}:${affected.line} (${affected.severity}) ${affected.reason}`,
    ),
  );
}

export function buildStandardReviewReplayOutput(
  artifact: ReviewArtifact,
  options: {
    checkName?: string;
    checkTitlePrefix?: string;
  } = {},
): ReviewReplayOutput {
  const summary = summarizeStandardReviewArtifact(artifact);
  const annotations = [
    ...artifact.contractMismatches.map((mismatch) => mismatchAnnotation(mismatch)),
    ...artifact.impact.flatMap((impactPath) => impactAnnotations(impactPath)),
  ].sort((left, right) =>
    [left.path, left.line ?? 0, left.level, left.title]
      .join(':')
      .localeCompare([right.path, right.line ?? 0, right.level, right.title].join(':')),
  );
  const commentBody = ensureReviewCommentMarker(
    [
      summary,
      '',
      '## Contract Mismatches',
      ...mismatchLines(artifact),
      '',
      '## Impact Paths',
      ...impactLines(artifact),
      '',
      '## Planned Changes',
      ...(plannedChangeLines(artifact).length > 0 ? plannedChangeLines(artifact) : ['- none']),
    ].join('\n'),
  );

  return {
    summary,
    commentBody,
    checkRun: {
      name: options.checkName ?? 'omni-link review',
      title: `${options.checkTitlePrefix ?? 'omni-link review'}: ${artifact.risk.overallRisk} risk`,
      summary,
      text: commentBody,
      conclusion:
        artifact.risk.blockedByPolicy ||
        artifact.risk.overallRisk === 'high' ||
        artifact.risk.overallRisk === 'critical'
          ? 'action_required'
          : artifact.risk.overallRisk === 'medium'
            ? 'neutral'
            : 'success',
      annotations,
    },
  };
}

export function skippedRecord(
  kind: ReviewPublishRecord['kind'],
  reason: string,
): ReviewPublishRecord {
  return {
    kind,
    status: 'skipped',
    reason,
  };
}

export function createDryRunReviewTransport(
  mode: ReviewPublishTransport['mode'],
): ReviewPublishTransport {
  return {
    mode,
    async publishComment(): Promise<ReviewPublishRecord> {
      return {
        kind: 'comment',
        status: 'dry-run',
        reason: 'dry-run publish mode configured',
      };
    },
    async publishCheckRun(): Promise<ReviewPublishRecord> {
      return {
        kind: 'check-run',
        status: 'dry-run',
        reason: 'dry-run publish mode configured',
      };
    },
  };
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }

  const suffix = '\n\n[truncated by omni-link for provider byte limit]';
  let truncated = text;

  while (truncated.length > 0 && Buffer.byteLength(`${truncated}${suffix}`, 'utf8') > maxBytes) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}${suffix}`;
}

export function applyReviewProviderCapabilities(
  output: ReviewReplayOutput,
  capabilities: ReviewProviderCapabilities,
): ReviewReplayOutput {
  return {
    ...output,
    commentBody: truncateUtf8(output.commentBody, capabilities.maxCommentBytes),
    checkRun: {
      ...output.checkRun,
      annotations: output.checkRun.annotations.slice(
        0,
        Math.max(0, capabilities.maxAnnotationsPerCheck),
      ),
    },
  };
}

export function publishSkipReasonForMetadata(
  metadata: ReviewProviderMetadata | null,
  kind: ReviewPublishRecord['kind'],
): string | null {
  if (!metadata) {
    return null;
  }

  const subject = kind === 'comment' ? 'comment publishing' : 'status publishing';

  switch (metadata.state) {
    case 'closed':
      return `${subject} skipped because the ${metadata.provider} review target is closed`;
    case 'merged':
      return `${subject} skipped because the ${metadata.provider} review target is merged`;
    case 'locked':
      return `${subject} skipped because the ${metadata.provider} review target is locked`;
    case 'open':
    case 'unknown':
    default:
      return null;
  }
}
