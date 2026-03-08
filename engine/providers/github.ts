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

export function summarizeGitHubReviewArtifact(artifact: ReviewArtifact): string {
  return summarizeStandardReviewArtifact(artifact);
}

export function buildGitHubReviewReplayOutput(artifact: ReviewArtifact): ReviewReplayOutput {
  return applyReviewProviderCapabilities(
    buildStandardReviewReplayOutput(artifact),
    GITHUB_REVIEW_CAPABILITIES,
  );
}

const GITHUB_REVIEW_CAPABILITIES: ReviewProviderCapabilities = {
  supportsComments: true,
  supportsChecks: true,
  supportsMetadata: true,
  maxAnnotationsPerCheck: 50,
  maxCommentBytes: 65_000,
};

function resolveGitHubApiRoot(apiUrl?: string): string {
  return (apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
}

function resolveGitHubToken(token?: string): string | undefined {
  return token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

function resolveFetchImpl(fetchImpl?: typeof fetch): typeof fetch | undefined {
  return fetchImpl ?? globalThis.fetch;
}

function resolveReplayDirectory(config: OmniLinkConfig, cwd: string = process.cwd()): string {
  const configured = config.github?.replayDirectory ?? path.join('.omni-link', 'provider-replay');
  return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
}

function replayTargetDirectory(root: string, target: ReviewPublishTarget): string {
  return path.join(root, target.owner, target.repo, `pr-${target.pullRequestNumber}`);
}

export function createDryRunGitHubReviewTransport(): ReviewPublishTransport {
  return createDryRunReviewTransport('dry-run');
}

export function createReplayGitHubReviewTransport(
  config: OmniLinkConfig,
  cwd: string = process.cwd(),
): ReviewPublishTransport {
  const root = resolveReplayDirectory(config, cwd);

  return {
    mode: 'replay',
    async publishComment(input: PublishCommentInput): Promise<ReviewPublishRecord> {
      const targetDir = replayTargetDirectory(root, input.target);
      const filePath = path.join(targetDir, 'comment.txt');
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
      const filePath = path.join(targetDir, 'check-run.json');
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

export interface GitHubApiTransportOptions {
  apiUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

async function postGitHubJson<TResponse>(
  url: string,
  body: unknown,
  options: Required<Pick<GitHubApiTransportOptions, 'fetchImpl' | 'token'>>,
): Promise<TResponse> {
  const response = await options.fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'omni-link',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GitHub publish failed (${response.status} ${response.statusText})`);
  }

  return (await response.json()) as TResponse;
}

async function getGitHubJson<TResponse>(
  url: string,
  options: Required<Pick<GitHubApiTransportOptions, 'fetchImpl' | 'token'>>,
): Promise<TResponse> {
  const response = await options.fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'omni-link',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub metadata fetch failed (${response.status} ${response.statusText})`);
  }

  return (await response.json()) as TResponse;
}

export function createGitHubApiReviewTransport(
  options: GitHubApiTransportOptions = {},
): ReviewPublishTransport {
  const token = resolveGitHubToken(options.token);
  const fetchImpl = resolveFetchImpl(options.fetchImpl);
  const apiRoot = resolveGitHubApiRoot(options.apiUrl);

  if (!token) {
    throw new Error('GitHub publish mode requires GITHUB_TOKEN or GH_TOKEN.');
  }
  if (!fetchImpl) {
    throw new Error('Global fetch is not available in this runtime.');
  }

  return {
    mode: 'github',
    async publishComment(input: PublishCommentInput): Promise<ReviewPublishRecord> {
      const endpoint = `${apiRoot}/repos/${input.target.owner}/${input.target.repo}/issues/${input.target.pullRequestNumber}/comments`;
      const response = await postGitHubJson<{ id: number; html_url?: string }>(
        endpoint,
        { body: input.body },
        { fetchImpl, token },
      );
      return {
        kind: 'comment',
        status: 'published',
        id: String(response.id),
        url: response.html_url,
      };
    },
    async publishCheckRun(input: PublishCheckRunInput): Promise<ReviewPublishRecord> {
      if (!input.target.headSha) {
        return skippedRecord('check-run', 'head SHA required for GitHub check publishing');
      }

      const endpoint = `${apiRoot}/repos/${input.target.owner}/${input.target.repo}/check-runs`;
      const response = await postGitHubJson<{ id: number; html_url?: string }>(
        endpoint,
        {
          name: input.checkRun.name,
          head_sha: input.target.headSha,
          status: 'completed',
          conclusion: input.checkRun.conclusion,
          output: {
            title: input.checkRun.title,
            summary: input.checkRun.summary,
            text: input.checkRun.text,
            annotations: input.checkRun.annotations.slice(0, 50).map((annotation) => ({
              path: annotation.path,
              start_line: annotation.line ?? 1,
              end_line: annotation.line ?? 1,
              annotation_level: annotation.level,
              title: annotation.title,
              message: annotation.message,
            })),
          },
        },
        { fetchImpl, token },
      );
      return {
        kind: 'check-run',
        status: 'published',
        id: String(response.id),
        url: response.html_url,
      };
    },
  };
}

export interface GitHubPullRequestMetadataOptions {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  apiUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchGitHubPullRequestMetadata(
  options: GitHubPullRequestMetadataOptions,
): Promise<ReviewProviderMetadata> {
  const token = resolveGitHubToken(options.token);
  const fetchImpl = resolveFetchImpl(options.fetchImpl);
  const apiRoot = resolveGitHubApiRoot(options.apiUrl);

  if (!token) {
    throw new Error('GitHub metadata fetch requires GITHUB_TOKEN or GH_TOKEN.');
  }
  if (!fetchImpl) {
    throw new Error('Global fetch is not available in this runtime.');
  }

  const response = await getGitHubJson<{
    state?: string;
    locked?: boolean;
    title?: string;
    html_url?: string;
    draft?: boolean;
    merged_at?: string | null;
    head?: { sha?: string; ref?: string };
    base?: { ref?: string };
  }>(`${apiRoot}/repos/${options.owner}/${options.repo}/pulls/${options.pullRequestNumber}`, {
    fetchImpl,
    token,
  });

  const state: ReviewProviderMetadata['state'] = response.locked
    ? 'locked'
    : response.merged_at
      ? 'merged'
      : response.state === 'open'
        ? 'open'
        : response.state === 'closed'
          ? 'closed'
          : 'unknown';

  return {
    provider: 'github',
    state,
    title: response.title,
    url: response.html_url,
    headSha: response.head?.sha,
    sourceBranch: response.head?.ref,
    targetBranch: response.base?.ref,
    isDraft: response.draft,
  };
}

function transportForConfig(
  config: OmniLinkConfig,
  cwd: string = process.cwd(),
): ReviewPublishTransport {
  switch (config.github?.publishMode ?? 'dry-run') {
    case 'replay':
      return createReplayGitHubReviewTransport(config, cwd);
    case 'github':
      return createGitHubApiReviewTransport({ apiUrl: config.github?.apiUrl });
    case 'dry-run':
    default:
      return createDryRunGitHubReviewTransport();
  }
}

export async function publishGitHubReviewArtifact(
  config: OmniLinkConfig,
  artifact: ReviewArtifact,
  target: ReviewPublishTarget,
  options: ReviewPublishOptions = {},
): Promise<ReviewPublishResult> {
  const transport = options.transport ?? transportForConfig(config, options.cwd);
  const capabilities = options.capabilities ?? githubReviewProvider.capabilities(config);
  const metadata = options.metadata ?? null;
  const replayOutput = applyReviewProviderCapabilities(
    buildGitHubReviewReplayOutput(artifact),
    capabilities,
  );
  const metadataCommentReason = publishSkipReasonForMetadata(metadata, 'comment');
  const metadataCheckReason = publishSkipReasonForMetadata(metadata, 'check-run');

  const comment = !capabilities.supportsComments
    ? skippedRecord('comment', 'provider does not support comment publishing')
    : config.github?.commentOnPr === false
      ? skippedRecord('comment', 'comment publishing disabled in config')
      : metadataCommentReason
        ? skippedRecord('comment', metadataCommentReason)
        : await transport.publishComment({
            target,
            body: replayOutput.commentBody,
          });
  const checkRun = !capabilities.supportsChecks
    ? skippedRecord('check-run', 'provider does not support check publishing')
    : config.github?.publishChecks === false
      ? skippedRecord('check-run', 'check publishing disabled in config')
      : metadataCheckReason
        ? skippedRecord('check-run', metadataCheckReason)
        : await transport.publishCheckRun({
            target,
            checkRun: replayOutput.checkRun,
          });

  return {
    provider: 'github',
    mode: transport.mode,
    target,
    summary: replayOutput.summary,
    capabilities,
    metadata,
    comment,
    checkRun,
  };
}

export const githubReviewProvider: ReviewProvider = {
  id: 'github',
  defaultBaseRef(config: OmniLinkConfig): string {
    return config.github?.defaultBaseBranch ?? 'main';
  },
  resolvePublishTarget(config: OmniLinkConfig, request) {
    const owner = config.github?.owner;
    const repo = config.github?.repo;
    if (!owner || !repo) {
      throw new Error('GitHub owner/repo must be configured before publish-review can run.');
    }
    return {
      owner,
      repo,
      pullRequestNumber: request.pullRequestNumber,
      headSha: request.headSha,
    };
  },
  capabilities(_config: OmniLinkConfig): ReviewProviderCapabilities {
    return { ...GITHUB_REVIEW_CAPABILITIES };
  },
  async fetchLiveMetadata(
    config: OmniLinkConfig,
    target: ReviewPublishTarget,
    options: ReviewPublishOptions = {},
  ): Promise<ReviewProviderMetadata | null> {
    if ((config.github?.publishMode ?? 'dry-run') !== 'github') {
      return null;
    }

    try {
      return await fetchGitHubPullRequestMetadata({
        owner: target.owner,
        repo: target.repo,
        pullRequestNumber: target.pullRequestNumber,
        apiUrl: config.github?.apiUrl,
        fetchImpl: options.fetchImpl,
      });
    } catch {
      return null;
    }
  },
  resolveArtifactPath(config: OmniLinkConfig, cwd: string = process.cwd()): string {
    const configured =
      config.github?.artifactPath ?? path.join('.omni-link', 'review-artifact.json');
    return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
  },
  summarizeArtifact(artifact: ReviewArtifact): string {
    return summarizeGitHubReviewArtifact(artifact);
  },
  serializeArtifact(artifact: ReviewArtifact): string {
    return JSON.stringify(
      {
        provider: 'github',
        formatVersion: 1,
        summary: summarizeGitHubReviewArtifact(artifact),
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
    return buildGitHubReviewReplayOutput(artifact);
  },
  async publishArtifact(
    config: OmniLinkConfig,
    artifact: ReviewArtifact,
    target: ReviewPublishTarget,
    options: ReviewPublishOptions = {},
  ): Promise<ReviewPublishResult> {
    return publishGitHubReviewArtifact(config, artifact, target, options);
  },
};
