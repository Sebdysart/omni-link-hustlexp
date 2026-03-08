import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  OmniLinkConfig,
  ReviewArtifact,
  ReviewProviderCapabilities,
  ReviewProviderMetadata,
  ReviewPublishRecord,
  ReviewPublishResult,
  ReviewPublishTarget,
} from '../types.js';
import type {
  PublishCheckRunInput,
  PublishCommentInput,
  ReviewPublishOptions,
  ReviewPublishTransport,
  ReviewProvider,
  ReviewReplayOutput,
  StoredReviewArtifactEnvelope,
} from './types.js';
import {
  applyReviewProviderCapabilities,
  buildStandardReviewReplayOutput,
  createDryRunReviewTransport,
  publishSkipReasonForMetadata,
  skippedRecord,
  summarizeStandardReviewArtifact,
} from './shared.js';

function isReviewArtifact(value: unknown): value is ReviewArtifact {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ReviewArtifact>;
  return (
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.baseRef === 'string' &&
    typeof candidate.headRef === 'string' &&
    Array.isArray(candidate.affectedRepos) &&
    Array.isArray(candidate.impact) &&
    Array.isArray(candidate.contractMismatches) &&
    Array.isArray(candidate.owners) &&
    typeof candidate.risk === 'object' &&
    candidate.risk !== null &&
    Array.isArray(candidate.policyDecisions)
  );
}

function isEnvelope(value: unknown): value is StoredReviewArtifactEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredReviewArtifactEnvelope>;
  return (
    typeof candidate.provider === 'string' &&
    typeof candidate.formatVersion === 'number' &&
    typeof candidate.summary === 'string' &&
    isReviewArtifact(candidate.artifact)
  );
}

export function summarizeGitLabReviewArtifact(artifact: ReviewArtifact): string {
  return summarizeStandardReviewArtifact(artifact);
}

export function buildGitLabReviewReplayOutput(artifact: ReviewArtifact): ReviewReplayOutput {
  return applyReviewProviderCapabilities(
    buildStandardReviewReplayOutput(artifact, {
      checkName: 'omni-link status',
      checkTitlePrefix: 'omni-link status',
    }),
    GITLAB_REVIEW_CAPABILITIES,
  );
}

const GITLAB_REVIEW_CAPABILITIES: ReviewProviderCapabilities = {
  supportsComments: true,
  supportsChecks: true,
  supportsMetadata: true,
  maxAnnotationsPerCheck: 0,
  maxCommentBytes: 1_000_000,
};

function resolveGitLabApiRoot(apiUrl?: string): string {
  return (apiUrl ?? 'https://gitlab.com/api/v4').replace(/\/+$/, '');
}

function resolveGitLabToken(token?: string): string | undefined {
  return token ?? process.env.GITLAB_TOKEN ?? process.env.CI_JOB_TOKEN;
}

function resolveFetchImpl(fetchImpl?: typeof fetch): typeof fetch | undefined {
  return fetchImpl ?? globalThis.fetch;
}

function resolveReplayDirectory(config: OmniLinkConfig, cwd: string = process.cwd()): string {
  const configured = config.gitlab?.replayDirectory ?? path.join('.omni-link', 'provider-replay');
  return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
}

function replayTargetDirectory(root: string, target: ReviewPublishTarget): string {
  return path.join(root, target.owner, target.repo, `mr-${target.pullRequestNumber}`);
}

export function createDryRunGitLabReviewTransport(): ReviewPublishTransport {
  return createDryRunReviewTransport('dry-run');
}

export function createReplayGitLabReviewTransport(
  config: OmniLinkConfig,
  cwd: string = process.cwd(),
): ReviewPublishTransport {
  const root = resolveReplayDirectory(config, cwd);

  return {
    mode: 'replay',
    async publishComment(input: PublishCommentInput): Promise<ReviewPublishRecord> {
      const targetDir = replayTargetDirectory(root, input.target);
      const filePath = path.join(targetDir, 'merge-request-note.txt');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(filePath, `${input.body.trim()}\n`, 'utf-8');
      return {
        kind: 'comment',
        status: 'replayed',
        path: filePath,
      };
    },
    async publishCheckRun(input: PublishCheckRunInput): Promise<ReviewPublishRecord> {
      const targetDir = replayTargetDirectory(root, input.target);
      const filePath = path.join(targetDir, 'status-check.json');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(input.checkRun, null, 2), 'utf-8');
      return {
        kind: 'check-run',
        status: 'replayed',
        path: filePath,
      };
    },
  };
}

export interface GitLabApiTransportOptions {
  apiUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

async function postGitLabJson<TResponse>(
  url: string,
  body: Record<string, string>,
  options: Required<Pick<GitLabApiTransportOptions, 'fetchImpl' | 'token'>>,
): Promise<TResponse> {
  const response = await options.fetchImpl(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': options.token,
      'Content-Type': 'application/json',
      'User-Agent': 'omni-link',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GitLab publish failed (${response.status} ${response.statusText})`);
  }

  return (await response.json()) as TResponse;
}

async function getGitLabJson<TResponse>(
  url: string,
  options: Required<Pick<GitLabApiTransportOptions, 'fetchImpl' | 'token'>>,
): Promise<TResponse> {
  const response = await options.fetchImpl(url, {
    method: 'GET',
    headers: {
      'PRIVATE-TOKEN': options.token,
      'User-Agent': 'omni-link',
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab metadata fetch failed (${response.status} ${response.statusText})`);
  }

  return (await response.json()) as TResponse;
}

function gitLabStatusForConclusion(
  conclusion: ReviewReplayOutput['checkRun']['conclusion'],
): 'success' | 'failed' | 'pending' {
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'neutral':
      return 'pending';
    case 'action_required':
      return 'failed';
  }
}

export function createGitLabApiReviewTransport(
  options: GitLabApiTransportOptions = {},
): ReviewPublishTransport {
  const token = resolveGitLabToken(options.token);
  const fetchImpl = resolveFetchImpl(options.fetchImpl);
  const apiRoot = resolveGitLabApiRoot(options.apiUrl);

  if (!token) {
    throw new Error('GitLab publish mode requires GITLAB_TOKEN or CI_JOB_TOKEN.');
  }
  if (!fetchImpl) {
    throw new Error('Global fetch is not available in this runtime.');
  }

  return {
    mode: 'gitlab',
    async publishComment(input: PublishCommentInput): Promise<ReviewPublishRecord> {
      const projectPath = encodeURIComponent(`${input.target.owner}/${input.target.repo}`);
      const endpoint = `${apiRoot}/projects/${projectPath}/merge_requests/${input.target.pullRequestNumber}/notes`;
      const response = await postGitLabJson<{ id: number; web_url?: string }>(
        endpoint,
        { body: input.body },
        { fetchImpl, token },
      );
      return {
        kind: 'comment',
        status: 'published',
        id: String(response.id),
        url: response.web_url,
      };
    },
    async publishCheckRun(input: PublishCheckRunInput): Promise<ReviewPublishRecord> {
      if (!input.target.headSha) {
        return skippedRecord('check-run', 'head SHA required for GitLab status publishing');
      }

      const projectPath = encodeURIComponent(`${input.target.owner}/${input.target.repo}`);
      const endpoint = `${apiRoot}/projects/${projectPath}/statuses/${input.target.headSha}`;
      const response = await postGitLabJson<{ id: number; target_url?: string }>(
        endpoint,
        {
          state: gitLabStatusForConclusion(input.checkRun.conclusion),
          name: input.checkRun.name,
          description: input.checkRun.title,
          target_url: '',
        },
        { fetchImpl, token },
      );
      return {
        kind: 'check-run',
        status: 'published',
        id: String(response.id),
        url: response.target_url,
      };
    },
  };
}

export interface GitLabMergeRequestMetadataOptions {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  apiUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchGitLabMergeRequestMetadata(
  options: GitLabMergeRequestMetadataOptions,
): Promise<ReviewProviderMetadata> {
  const token = resolveGitLabToken(options.token);
  const fetchImpl = resolveFetchImpl(options.fetchImpl);
  const apiRoot = resolveGitLabApiRoot(options.apiUrl);

  if (!token) {
    throw new Error('GitLab metadata fetch requires GITLAB_TOKEN or CI_JOB_TOKEN.');
  }
  if (!fetchImpl) {
    throw new Error('Global fetch is not available in this runtime.');
  }

  const projectPath = encodeURIComponent(`${options.owner}/${options.repo}`);
  const response = await getGitLabJson<{
    state?: string;
    title?: string;
    web_url?: string;
    draft?: boolean;
    work_in_progress?: boolean;
    sha?: string;
    source_branch?: string;
    target_branch?: string;
  }>(`${apiRoot}/projects/${projectPath}/merge_requests/${options.pullRequestNumber}`, {
    fetchImpl,
    token,
  });

  const state: ReviewProviderMetadata['state'] =
    response.state === 'opened'
      ? 'open'
      : response.state === 'merged'
        ? 'merged'
        : response.state === 'closed'
          ? 'closed'
          : response.state === 'locked'
            ? 'locked'
            : 'unknown';

  return {
    provider: 'gitlab',
    state,
    title: response.title,
    url: response.web_url,
    headSha: response.sha,
    sourceBranch: response.source_branch,
    targetBranch: response.target_branch,
    isDraft: response.draft ?? response.work_in_progress,
  };
}

function transportForConfig(
  config: OmniLinkConfig,
  cwd: string = process.cwd(),
): ReviewPublishTransport {
  switch (config.gitlab?.publishMode ?? 'dry-run') {
    case 'replay':
      return createReplayGitLabReviewTransport(config, cwd);
    case 'gitlab':
      return createGitLabApiReviewTransport({ apiUrl: config.gitlab?.apiUrl });
    case 'dry-run':
    default:
      return createDryRunGitLabReviewTransport();
  }
}

export async function publishGitLabReviewArtifact(
  config: OmniLinkConfig,
  artifact: ReviewArtifact,
  target: ReviewPublishTarget,
  options: ReviewPublishOptions = {},
): Promise<ReviewPublishResult> {
  const transport = options.transport ?? transportForConfig(config, options.cwd);
  const capabilities = options.capabilities ?? gitlabReviewProvider.capabilities(config);
  const metadata = options.metadata ?? null;
  const replayOutput = applyReviewProviderCapabilities(
    buildGitLabReviewReplayOutput(artifact),
    capabilities,
  );
  const metadataCommentReason = publishSkipReasonForMetadata(metadata, 'comment');
  const metadataCheckReason = publishSkipReasonForMetadata(metadata, 'check-run');

  const comment = !capabilities.supportsComments
    ? skippedRecord('comment', 'provider does not support comment publishing')
    : config.gitlab?.commentOnMergeRequest === false
      ? skippedRecord('comment', 'merge request note publishing disabled in config')
      : metadataCommentReason
        ? skippedRecord('comment', metadataCommentReason)
        : await transport.publishComment({
            target,
            body: replayOutput.commentBody,
          });
  const checkRun = !capabilities.supportsChecks
    ? skippedRecord('check-run', 'provider does not support check publishing')
    : config.gitlab?.publishChecks === false
      ? skippedRecord('check-run', 'status publishing disabled in config')
      : metadataCheckReason
        ? skippedRecord('check-run', metadataCheckReason)
        : await transport.publishCheckRun({
            target,
            checkRun: replayOutput.checkRun,
          });

  return {
    provider: 'gitlab',
    mode: transport.mode,
    target,
    summary: replayOutput.summary,
    capabilities,
    metadata,
    comment,
    checkRun,
  };
}

export const gitlabReviewProvider: ReviewProvider = {
  id: 'gitlab',
  defaultBaseRef(config: OmniLinkConfig): string {
    return config.gitlab?.defaultBaseBranch ?? 'main';
  },
  resolvePublishTarget(config: OmniLinkConfig, request) {
    const owner = config.gitlab?.namespace;
    const repo = config.gitlab?.project;
    if (!owner || !repo) {
      throw new Error('GitLab namespace/project must be configured before publish-review can run.');
    }
    return {
      owner,
      repo,
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
    };
  },
  capabilities(_config: OmniLinkConfig): ReviewProviderCapabilities {
    return { ...GITLAB_REVIEW_CAPABILITIES };
  },
  async fetchLiveMetadata(
    config: OmniLinkConfig,
    target: ReviewPublishTarget,
    options: ReviewPublishOptions = {},
  ): Promise<ReviewProviderMetadata | null> {
    if ((config.gitlab?.publishMode ?? 'dry-run') !== 'gitlab') {
      return null;
    }

    try {
      return await fetchGitLabMergeRequestMetadata({
        owner: target.owner,
        repo: target.repo,
        pullRequestNumber: target.pullRequestNumber,
        apiUrl: config.gitlab?.apiUrl,
        fetchImpl: options.fetchImpl,
      });
    } catch {
      return null;
    }
  },
  resolveArtifactPath(config: OmniLinkConfig, cwd: string = process.cwd()): string {
    const configured =
      config.gitlab?.artifactPath ?? path.join('.omni-link', 'review-artifact.gitlab.json');
    return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
  },
  summarizeArtifact(artifact: ReviewArtifact): string {
    return summarizeGitLabReviewArtifact(artifact);
  },
  serializeArtifact(artifact: ReviewArtifact): string {
    return JSON.stringify(
      {
        provider: 'gitlab',
        formatVersion: 1,
        summary: summarizeGitLabReviewArtifact(artifact),
        artifact,
      } satisfies StoredReviewArtifactEnvelope,
      null,
      2,
    );
  },
  deserializeArtifact(raw: string): ReviewArtifact | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isEnvelope(parsed)) {
        return parsed.artifact;
      }

      return isReviewArtifact(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  buildReplayOutput(artifact: ReviewArtifact): ReviewReplayOutput {
    return buildGitLabReviewReplayOutput(artifact);
  },
  async publishArtifact(
    config: OmniLinkConfig,
    artifact: ReviewArtifact,
    target: ReviewPublishTarget,
    options: ReviewPublishOptions = {},
  ): Promise<ReviewPublishResult> {
    return publishGitLabReviewArtifact(config, artifact, target, options);
  },
};
