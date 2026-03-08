import type {
  OmniLinkConfig,
  ReviewArtifact,
  ReviewProviderCapabilities,
  ReviewProviderMetadata,
  ReviewProviderId,
  ReviewPublishMode,
  ReviewPublishRecord,
  ReviewPublishResult,
  ReviewPublishTarget,
} from '../types.js';

export interface StoredReviewArtifactEnvelope {
  provider: string;
  formatVersion: number;
  summary: string;
  artifact: ReviewArtifact;
}

export interface ReviewAnnotation {
  path: string;
  line?: number;
  level: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}

export interface ReviewReplayOutput {
  summary: string;
  commentBody: string;
  checkRun: {
    name: string;
    title: string;
    summary: string;
    text: string;
    conclusion: 'success' | 'neutral' | 'action_required';
    annotations: ReviewAnnotation[];
  };
}

export interface PublishCommentInput {
  target: ReviewPublishTarget;
  body: string;
}

export interface PublishCheckRunInput {
  target: ReviewPublishTarget;
  checkRun: ReviewReplayOutput['checkRun'];
}

export interface ReviewPublishTransport {
  readonly mode: ReviewPublishMode;
  publishComment(input: PublishCommentInput): Promise<ReviewPublishRecord>;
  publishCheckRun(input: PublishCheckRunInput): Promise<ReviewPublishRecord>;
}

export interface ReviewPublishOptions {
  cwd?: string;
  transport?: ReviewPublishTransport;
  capabilities?: ReviewProviderCapabilities;
  metadata?: ReviewProviderMetadata | null;
  fetchImpl?: typeof fetch;
  snapshotKey?: ReviewSnapshotIdentity;
}

export interface ReviewPublishRequest {
  pullRequestNumber: number;
  headSha?: string;
}

export interface ReviewSnapshotIdentity {
  configSha: string;
  branchSignature: string;
  baseRef: string;
  headRef: string;
}

export interface ReviewProvider {
  readonly id: ReviewProviderId;
  defaultBaseRef(config: OmniLinkConfig): string;
  resolvePublishTarget(config: OmniLinkConfig, request: ReviewPublishRequest): ReviewPublishTarget;
  capabilities(config: OmniLinkConfig): ReviewProviderCapabilities;
  fetchLiveMetadata(
    config: OmniLinkConfig,
    target: ReviewPublishTarget,
    options?: ReviewPublishOptions,
  ): Promise<ReviewProviderMetadata | null>;
  resolveArtifactPath(config: OmniLinkConfig, cwd?: string): string;
  summarizeArtifact(artifact: ReviewArtifact): string;
  serializeArtifact(artifact: ReviewArtifact): string;
  deserializeArtifact(raw: string): ReviewArtifact | null;
  buildReplayOutput(artifact: ReviewArtifact): ReviewReplayOutput;
  publishArtifact(
    config: OmniLinkConfig,
    artifact: ReviewArtifact,
    target: ReviewPublishTarget,
    options?: ReviewPublishOptions,
  ): Promise<ReviewPublishResult>;
}
