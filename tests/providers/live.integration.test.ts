import { describe, expect, it } from 'vitest';

import {
  createGitHubApiReviewTransport,
  fetchGitHubPullRequestMetadata,
  publishGitHubReviewArtifact,
  type GitHubPullRequestMetadataOptions,
} from '../../engine/providers/github.js';
import {
  createGitLabApiReviewTransport,
  fetchGitLabMergeRequestMetadata,
  publishGitLabReviewArtifact,
  type GitLabMergeRequestMetadataOptions,
} from '../../engine/providers/gitlab.js';
import type { OmniLinkConfig, ReviewArtifact } from '../../engine/types.js';

const githubOptions: GitHubPullRequestMetadataOptions | null =
  (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) &&
  process.env.OMNI_LINK_GITHUB_OWNER &&
  process.env.OMNI_LINK_GITHUB_REPO &&
  process.env.OMNI_LINK_GITHUB_PR
    ? {
        token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
        owner: process.env.OMNI_LINK_GITHUB_OWNER,
        repo: process.env.OMNI_LINK_GITHUB_REPO,
        pullRequestNumber: Number(process.env.OMNI_LINK_GITHUB_PR),
        apiUrl: process.env.OMNI_LINK_GITHUB_API_URL,
      }
    : null;

const gitlabOptions: GitLabMergeRequestMetadataOptions | null =
  (process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN) &&
  process.env.OMNI_LINK_GITLAB_NAMESPACE &&
  process.env.OMNI_LINK_GITLAB_PROJECT &&
  process.env.OMNI_LINK_GITLAB_MR
    ? {
        token: process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN,
        owner: process.env.OMNI_LINK_GITLAB_NAMESPACE,
        repo: process.env.OMNI_LINK_GITLAB_PROJECT,
        pullRequestNumber: Number(process.env.OMNI_LINK_GITLAB_MR),
        apiUrl: process.env.OMNI_LINK_GITLAB_API_URL,
      }
    : null;

const livePublishEnabled =
  process.env.OMNI_LINK_LIVE_PUBLISH === '1' || process.env.OMNI_LINK_LIVE_PUBLISH === 'true';

function makeArtifact(): ReviewArtifact {
  return {
    generatedAt: new Date().toISOString(),
    baseRef: 'main',
    headRef: 'live-integration',
    affectedRepos: ['backend'],
    impact: [],
    contractMismatches: [],
    owners: [],
    risk: {
      overallRisk: 'low',
      score: 10,
      reasons: ['live integration validation'],
      affectedRepos: ['backend'],
      blockedByPolicy: false,
    },
    policyDecisions: [],
  };
}

function makeGitHubConfig(): OmniLinkConfig {
  return {
    repos: [{ name: 'repo', path: process.cwd(), language: 'typescript', role: 'backend' }],
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 4000,
      prioritize: 'api-surface-first',
      includeRecentCommits: 10,
    },
    cache: {
      directory: '.omni-link/cache',
      maxAgeDays: 7,
    },
    github: {
      enabled: true,
      owner: githubOptions?.owner,
      repo: githubOptions?.repo,
      publishMode: 'github',
      commentOnPr: true,
      publishChecks: true,
      apiUrl: githubOptions?.apiUrl,
    },
  };
}

function makeGitLabConfig(): OmniLinkConfig {
  return {
    repos: [{ name: 'repo', path: process.cwd(), language: 'typescript', role: 'backend' }],
    reviewProvider: 'gitlab',
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 5,
      categories: ['feature'],
    },
    quality: {
      blockOnFailure: true,
      requireTestsForNewCode: true,
      conventionStrictness: 'strict',
    },
    context: {
      tokenBudget: 4000,
      prioritize: 'api-surface-first',
      includeRecentCommits: 10,
    },
    cache: {
      directory: '.omni-link/cache',
      maxAgeDays: 7,
    },
    gitlab: {
      enabled: true,
      namespace: gitlabOptions?.owner,
      project: gitlabOptions?.repo,
      publishMode: 'gitlab',
      commentOnMergeRequest: true,
      publishChecks: true,
      apiUrl: gitlabOptions?.apiUrl,
    },
  };
}

describe('live provider metadata integrations', () => {
  const githubIt = githubOptions ? it : it.skip;
  const gitlabIt = gitlabOptions ? it : it.skip;
  const githubPublishIt = githubOptions && livePublishEnabled ? it : it.skip;
  const gitlabPublishIt = gitlabOptions && livePublishEnabled ? it : it.skip;

  githubIt(
    'fetches GitHub pull request metadata from the live API when credentials are configured',
    async () => {
      const metadata = await fetchGitHubPullRequestMetadata(githubOptions!);

      expect(metadata.provider).toBe('github');
      expect(['open', 'closed', 'merged', 'locked', 'unknown']).toContain(metadata.state);
      expect(metadata.url).toMatch(/^https?:\/\//);
      expect(metadata.headSha).toBeTruthy();
    },
    30000,
  );

  githubPublishIt(
    'publishes GitHub review outputs against the live API when explicit publish mode is enabled',
    async () => {
      const metadata = await fetchGitHubPullRequestMetadata(githubOptions!);
      const artifact = makeArtifact();
      const firstResult = await publishGitHubReviewArtifact(
        makeGitHubConfig(),
        artifact,
        {
          owner: githubOptions!.owner,
          repo: githubOptions!.repo,
          pullRequestNumber: githubOptions!.pullRequestNumber,
          headSha: metadata.headSha,
        },
        {
          metadata,
          transport: createGitHubApiReviewTransport({
            apiUrl: githubOptions!.apiUrl,
            token: githubOptions!.token,
          }),
        },
      );
      const secondResult = await publishGitHubReviewArtifact(
        makeGitHubConfig(),
        artifact,
        {
          owner: githubOptions!.owner,
          repo: githubOptions!.repo,
          pullRequestNumber: githubOptions!.pullRequestNumber,
          headSha: metadata.headSha,
        },
        {
          metadata,
          transport: createGitHubApiReviewTransport({
            apiUrl: githubOptions!.apiUrl,
            token: githubOptions!.token,
          }),
        },
      );

      expect(firstResult.mode).toBe('github');
      expect(secondResult.mode).toBe('github');
      if (metadata.state === 'open') {
        expect(firstResult.comment.status).toBe('published');
        expect(firstResult.checkRun.status).toBe('published');
        expect(secondResult.comment.status).toBe('published');
        expect(secondResult.checkRun.status).toBe('published');
        expect(secondResult.comment.id).toBe(firstResult.comment.id);
      } else {
        expect(firstResult.comment.status).toBe('skipped');
        expect(firstResult.checkRun.status).toBe('skipped');
        expect(secondResult.comment.status).toBe('skipped');
        expect(secondResult.checkRun.status).toBe('skipped');
      }
    },
    60000,
  );

  gitlabIt(
    'fetches GitLab merge request metadata from the live API when credentials are configured',
    async () => {
      const metadata = await fetchGitLabMergeRequestMetadata(gitlabOptions!);

      expect(metadata.provider).toBe('gitlab');
      expect(['open', 'closed', 'merged', 'locked', 'unknown']).toContain(metadata.state);
      expect(metadata.url).toMatch(/^https?:\/\//);
      expect(metadata.headSha).toBeTruthy();
    },
    30000,
  );

  gitlabPublishIt(
    'publishes GitLab review outputs against the live API when explicit publish mode is enabled',
    async () => {
      const metadata = await fetchGitLabMergeRequestMetadata(gitlabOptions!);
      const artifact = makeArtifact();
      const firstResult = await publishGitLabReviewArtifact(
        makeGitLabConfig(),
        artifact,
        {
          owner: gitlabOptions!.owner,
          repo: gitlabOptions!.repo,
          pullRequestNumber: gitlabOptions!.pullRequestNumber,
          headSha: metadata.headSha,
        },
        {
          metadata,
          transport: createGitLabApiReviewTransport({
            apiUrl: gitlabOptions!.apiUrl,
            token: gitlabOptions!.token,
          }),
        },
      );
      const secondResult = await publishGitLabReviewArtifact(
        makeGitLabConfig(),
        artifact,
        {
          owner: gitlabOptions!.owner,
          repo: gitlabOptions!.repo,
          pullRequestNumber: gitlabOptions!.pullRequestNumber,
          headSha: metadata.headSha,
        },
        {
          metadata,
          transport: createGitLabApiReviewTransport({
            apiUrl: gitlabOptions!.apiUrl,
            token: gitlabOptions!.token,
          }),
        },
      );

      expect(firstResult.mode).toBe('gitlab');
      expect(secondResult.mode).toBe('gitlab');
      if (metadata.state === 'open') {
        expect(firstResult.comment.status).toBe('published');
        expect(firstResult.checkRun.status).toBe('published');
        expect(secondResult.comment.status).toBe('published');
        expect(secondResult.checkRun.status).toBe('published');
        expect(secondResult.comment.id).toBe(firstResult.comment.id);
      } else {
        expect(firstResult.comment.status).toBe('skipped');
        expect(firstResult.checkRun.status).toBe('skipped');
        expect(secondResult.comment.status).toBe('skipped');
        expect(secondResult.checkRun.status).toBe('skipped');
      }
    },
    60000,
  );
});
