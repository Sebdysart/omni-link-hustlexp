import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  githubReviewProvider,
  buildGitHubReviewReplayOutput,
  createGitHubApiReviewTransport,
  createReplayGitHubReviewTransport,
  fetchGitHubPullRequestMetadata,
  publishGitHubReviewArtifact,
  summarizeGitHubReviewArtifact,
} from '../../engine/providers/github.js';
import type { OmniLinkConfig, ReviewArtifact } from '../../engine/types.js';

function makeConfig(artifactPath = '.omni-link/review-artifact.json'): OmniLinkConfig {
  return {
    repos: [{ name: 'repo', path: '/tmp/repo', language: 'typescript', role: 'backend' }],
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
      directory: '/tmp/cache',
      maxAgeDays: 7,
    },
    github: {
      enabled: true,
      artifactPath,
      owner: 'acme',
      repo: 'platform',
      publishMode: 'dry-run',
      replayDirectory: '.omni-link/provider-replay',
      apiUrl: 'https://api.github.test',
    },
  };
}

function makeArtifact(): ReviewArtifact {
  return {
    generatedAt: '2026-03-07T12:00:00.000Z',
    baseRef: 'main',
    headRef: 'feature/max-tier',
    affectedRepos: ['backend', 'client'],
    impact: [
      {
        trigger: {
          repo: 'backend',
          file: 'src/routes/users.ts',
          change: 'route-change',
        },
        affected: [
          {
            repo: 'client',
            file: 'src/client.ts',
            line: 14,
            reason: 'consumes GET /api/users',
            severity: 'breaking',
          },
        ],
      },
    ],
    contractMismatches: [
      {
        kind: 'missing-field',
        description:
          "Consumer client expects field 'plan' on User which provider backend does not provide",
        provider: {
          repo: 'backend',
          file: 'src/routes/users.ts',
          line: 5,
          field: 'plan',
        },
        consumer: {
          repo: 'client',
          file: 'src/client.ts',
          line: 14,
          field: 'plan',
        },
        severity: 'breaking',
      },
    ],
    owners: [
      {
        owner: 'platform-team',
        kind: 'team',
        scope: 'repo',
        repoId: 'backend',
      },
    ],
    risk: {
      overallRisk: 'high',
      score: 72,
      reasons: [
        'breaking contract mismatches detected',
        'runtime-weighted signals increased priority',
      ],
      affectedRepos: ['backend', 'client'],
      blockedByPolicy: true,
    },
    policyDecisions: [
      {
        policyId: 'required-owner',
        status: 'blocked',
        message: 'backend-team approval required',
      },
    ],
    executionPlan: {
      planId: 'plan-1',
      mode: 'branch-pr',
      branchName: 'codex/omni-link/plan-1',
      baseBranch: 'main',
      changes: [
        {
          id: 'schema-sync-1',
          kind: 'schema-sync',
          title: 'Sync contract for backend',
          description: 'Update client for new user contract',
          repo: 'client',
          files: ['src/client.ts'],
          confidence: 0.91,
          risk: 'high',
          dependsOn: [],
          preconditions: ['confirm provider contract intent'],
          validationSteps: ['run omni-link review-pr'],
          rollbackSteps: ['revert consumer sync'],
        },
      ],
      risk: {
        overallRisk: 'high',
        score: 72,
        reasons: ['breaking contract mismatches detected'],
        affectedRepos: ['backend', 'client'],
        blockedByPolicy: false,
      },
      approvals: ['backend-team'],
      blocked: true,
      policyDecisions: [
        {
          policyId: 'required-owner',
          status: 'blocked',
          message: 'backend-team approval required',
        },
      ],
      rollback: {
        steps: ['delete generated branch'],
        restoreTargets: [],
        branchName: 'codex/omni-link/plan-1',
      },
      pullRequest: {
        title: 'omni-link: high risk execution plan',
        body: '- Sync contract',
      },
    },
  };
}

describe('GitHub review provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves artifact paths relative to the current workspace', () => {
    const config = makeConfig();

    expect(githubReviewProvider.resolveArtifactPath(config, '/tmp/workspace')).toBe(
      path.join('/tmp/workspace', '.omni-link', 'review-artifact.json'),
    );
    expect(
      githubReviewProvider.resolveArtifactPath(
        makeConfig('/tmp/custom/review.json'),
        '/tmp/workspace',
      ),
    ).toBe('/tmp/custom/review.json');
  });

  it('serializes a GitHub review envelope with a stable summary', () => {
    const artifact = makeArtifact();
    const summary = summarizeGitHubReviewArtifact(artifact);
    const serialized = githubReviewProvider.serializeArtifact(artifact);
    const parsed = JSON.parse(serialized) as {
      provider: string;
      formatVersion: number;
      summary: string;
      artifact: ReviewArtifact;
    };

    expect(parsed.provider).toBe('github');
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.summary).toBe(summary);
    expect(parsed.summary).toContain('Risk: high (72)');
    expect(parsed.summary).toContain('Affected repos: backend, client');
    expect(parsed.artifact).toEqual(artifact);
    expect(githubReviewProvider.deserializeArtifact(serialized)).toEqual(artifact);
  });

  it('deserializes legacy raw review artifacts for backward compatibility', () => {
    const artifact = makeArtifact();

    expect(githubReviewProvider.deserializeArtifact(JSON.stringify(artifact))).toEqual(artifact);
  });

  it('matches the committed GitHub replay fixtures for comment and check outputs', () => {
    const artifact = makeArtifact();
    const replayOutput = buildGitHubReviewReplayOutput(artifact);
    const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'providers', 'github');
    const expectedComment = fs.readFileSync(path.join(fixtureRoot, 'comment.txt'), 'utf8').trim();
    const expectedCheckRun = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'check-run.json'), 'utf8'),
    ) as unknown;

    expect(replayOutput.commentBody).toBe(expectedComment);
    expect(replayOutput.checkRun).toEqual(expectedCheckRun);
    expect(replayOutput.checkRun.annotations).toHaveLength(2);
    expect(githubReviewProvider.buildReplayOutput(artifact)).toEqual(replayOutput);
  });

  it('replays comment and check-run outputs to deterministic files', async () => {
    const artifact = makeArtifact();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-github-replay-'));
    const config = makeConfig('.omni-link/review-artifact.json');
    const target = {
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      headSha: 'abc123',
    };

    try {
      const result = await publishGitHubReviewArtifact(config, artifact, target, {
        cwd: root,
        transport: createReplayGitHubReviewTransport(config, root),
      });

      const replayRoot = path.join(
        root,
        '.omni-link',
        'provider-replay',
        'acme',
        'platform',
        'pr-42',
      );
      const commentPath = path.join(replayRoot, 'comment.txt');
      const checkRunPath = path.join(replayRoot, 'check-run.json');
      const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'providers', 'github');

      expect(result.mode).toBe('replay');
      expect(result.capabilities.maxAnnotationsPerCheck).toBe(50);
      expect(result.metadata).toBeNull();
      expect(result.comment).toEqual({
        kind: 'comment',
        status: 'replayed',
        path: commentPath,
      });
      expect(result.checkRun).toEqual({
        kind: 'check-run',
        status: 'replayed',
        path: checkRunPath,
      });
      expect(fs.readFileSync(commentPath, 'utf8').trim()).toBe(
        fs.readFileSync(path.join(fixtureRoot, 'comment.txt'), 'utf8').trim(),
      );
      expect(JSON.parse(fs.readFileSync(checkRunPath, 'utf8'))).toEqual(
        JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'check-run.json'), 'utf8')),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fetches live GitHub pull request metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        state: 'open',
        locked: false,
        title: 'Max-tier publish',
        html_url: 'https://github.test/acme/platform/pull/42',
        draft: true,
        head: {
          sha: 'meta-sha',
          ref: 'feature/max-tier',
        },
        base: {
          ref: 'main',
        },
      }),
    });

    const metadata = await fetchGitHubPullRequestMetadata({
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      apiUrl: 'https://api.github.test',
      token: 'test-token',
      fetchImpl,
    });

    expect(metadata).toEqual({
      provider: 'github',
      state: 'open',
      title: 'Max-tier publish',
      url: 'https://github.test/acme/platform/pull/42',
      headSha: 'meta-sha',
      sourceBranch: 'feature/max-tier',
      targetBranch: 'main',
      isDraft: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.test/repos/acme/platform/pulls/42',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('skips GitHub publish operations when live metadata shows a merged pull request', async () => {
    const artifact = makeArtifact();
    const target = {
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      headSha: 'abc123',
    };

    const result = await publishGitHubReviewArtifact(makeConfig(), artifact, target, {
      transport: createReplayGitHubReviewTransport(makeConfig(), os.tmpdir()),
      metadata: {
        provider: 'github',
        state: 'merged',
        headSha: 'abc123',
      },
    });

    expect(result.comment).toEqual({
      kind: 'comment',
      status: 'skipped',
      reason: 'comment publishing skipped because the github review target is merged',
    });
    expect(result.checkRun).toEqual({
      kind: 'check-run',
      status: 'skipped',
      reason: 'status publishing skipped because the github review target is merged',
    });
  });

  it('publishes GitHub comment and check payloads through the API transport', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({
          id: 101,
          html_url: 'https://github.test/acme/platform/pull/42#issuecomment-101',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({
          id: 202,
          html_url: 'https://github.test/acme/platform/runs/202',
        }),
      });
    const transport = createGitHubApiReviewTransport({
      apiUrl: 'https://api.github.test',
      token: 'test-token',
      fetchImpl,
    });
    const replayOutput = buildGitHubReviewReplayOutput(makeArtifact());
    const target = {
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      headSha: 'abc123',
    };

    const comment = await transport.publishComment({
      target,
      body: replayOutput.commentBody,
    });
    const checkRun = await transport.publishCheckRun({
      target,
      checkRun: replayOutput.checkRun,
    });

    expect(comment).toEqual({
      kind: 'comment',
      status: 'published',
      id: '101',
      url: 'https://github.test/acme/platform/pull/42#issuecomment-101',
    });
    expect(checkRun).toEqual({
      kind: 'check-run',
      status: 'published',
      id: '202',
      url: 'https://github.test/acme/platform/runs/202',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.github.test/repos/acme/platform/issues/42/comments?per_page=100',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.github.test/repos/acme/platform/issues/42/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ body: replayOutput.commentBody }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://api.github.test/repos/acme/platform/check-runs',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const thirdBody = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body));
    expect(thirdBody.head_sha).toBe('abc123');
    expect(thirdBody.output.annotations[0]).toEqual({
      path: 'src/client.ts',
      start_line: 14,
      end_line: 14,
      annotation_level: 'failure',
      title: 'client impacted by backend',
      message: 'consumes GET /api/users (trigger: src/routes/users.ts)',
    });
  });

  it('falls back to commit status publishing when GitHub check-runs are forbidden', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({
          id: 101,
          html_url: 'https://github.test/acme/platform/pull/42#issuecomment-101',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ message: 'Resource not accessible by personal access token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({
          id: 303,
          target_url: 'https://github.com/acme/platform/commit/abc123',
        }),
      });
    const transport = createGitHubApiReviewTransport({
      apiUrl: 'https://api.github.test',
      token: 'test-token',
      fetchImpl,
    });
    const replayOutput = buildGitHubReviewReplayOutput(makeArtifact());
    const target = {
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      headSha: 'abc123',
    };

    const comment = await transport.publishComment({
      target,
      body: replayOutput.commentBody,
    });
    const checkRun = await transport.publishCheckRun({
      target,
      checkRun: replayOutput.checkRun,
    });

    expect(comment.status).toBe('published');
    expect(checkRun).toEqual({
      kind: 'check-run',
      status: 'published',
      id: '303',
      url: 'https://github.com/acme/platform/commit/abc123',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://api.github.test/repos/acme/platform/statuses/abc123',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('updates the existing omni-link GitHub comment instead of creating duplicates', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [
          {
            id: 101,
            body: '<!-- omni-link review -->\nold review body',
            html_url: 'https://github.test/acme/platform/pull/42#issuecomment-101',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          id: 101,
          html_url: 'https://github.test/acme/platform/pull/42#issuecomment-101',
        }),
      });
    const transport = createGitHubApiReviewTransport({
      apiUrl: 'https://api.github.test',
      token: 'test-token',
      fetchImpl,
    });
    const replayOutput = buildGitHubReviewReplayOutput(makeArtifact());

    const comment = await transport.publishComment({
      target: {
        owner: 'acme',
        repo: 'platform',
        pullRequestNumber: 42,
        headSha: 'abc123',
      },
      body: replayOutput.commentBody,
    });

    expect(comment).toEqual({
      kind: 'comment',
      status: 'published',
      id: '101',
      url: 'https://github.test/acme/platform/pull/42#issuecomment-101',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.github.test/repos/acme/platform/issues/comments/101',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ body: replayOutput.commentBody }),
      }),
    );
  });
});
