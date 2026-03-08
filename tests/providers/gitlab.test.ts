import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildGitLabReviewReplayOutput,
  createGitLabApiReviewTransport,
  createReplayGitLabReviewTransport,
  fetchGitLabMergeRequestMetadata,
  gitlabReviewProvider,
  publishGitLabReviewArtifact,
  summarizeGitLabReviewArtifact,
} from '../../engine/providers/gitlab.js';
import type { OmniLinkConfig, ReviewArtifact } from '../../engine/types.js';

function makeConfig(artifactPath = '.omni-link/review-artifact.gitlab.json'): OmniLinkConfig {
  return {
    repos: [{ name: 'repo', path: '/tmp/repo', language: 'typescript', role: 'backend' }],
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
      directory: '/tmp/cache',
      maxAgeDays: 7,
    },
    gitlab: {
      enabled: true,
      artifactPath,
      namespace: 'acme',
      project: 'platform',
      publishMode: 'dry-run',
      replayDirectory: '.omni-link/provider-replay',
      apiUrl: 'https://gitlab.test/api/v4',
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

describe('GitLab review provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves artifact paths relative to the current workspace', () => {
    const config = makeConfig();

    expect(gitlabReviewProvider.resolveArtifactPath(config, '/tmp/workspace')).toBe(
      path.join('/tmp/workspace', '.omni-link', 'review-artifact.gitlab.json'),
    );
    expect(
      gitlabReviewProvider.resolveArtifactPath(
        makeConfig('/tmp/custom/review.json'),
        '/tmp/workspace',
      ),
    ).toBe('/tmp/custom/review.json');
  });

  it('serializes a GitLab review envelope with a stable summary', () => {
    const artifact = makeArtifact();
    const summary = summarizeGitLabReviewArtifact(artifact);
    const serialized = gitlabReviewProvider.serializeArtifact(artifact);
    const parsed = JSON.parse(serialized) as {
      provider: string;
      formatVersion: number;
      summary: string;
      artifact: ReviewArtifact;
    };

    expect(parsed.provider).toBe('gitlab');
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.summary).toBe(summary);
    expect(parsed.summary).toContain('Risk: high (72)');
    expect(parsed.summary).toContain('Affected repos: backend, client');
    expect(parsed.artifact).toEqual(artifact);
    expect(gitlabReviewProvider.deserializeArtifact(serialized)).toEqual(artifact);
  });

  it('deserializes legacy raw review artifacts for backward compatibility', () => {
    const artifact = makeArtifact();

    expect(gitlabReviewProvider.deserializeArtifact(JSON.stringify(artifact))).toEqual(artifact);
  });

  it('matches the committed GitLab replay fixtures for note and status outputs', () => {
    const artifact = makeArtifact();
    const replayOutput = buildGitLabReviewReplayOutput(artifact);
    const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'providers', 'gitlab');
    const expectedNote = fs
      .readFileSync(path.join(fixtureRoot, 'merge-request-note.txt'), 'utf8')
      .trim();
    const expectedStatus = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'status-check.json'), 'utf8'),
    ) as unknown;

    expect(replayOutput.commentBody).toBe(expectedNote);
    expect(replayOutput.checkRun).toEqual(expectedStatus);
    expect(replayOutput.checkRun.annotations).toHaveLength(0);
    expect(gitlabReviewProvider.buildReplayOutput(artifact)).toEqual(replayOutput);
  });

  it('replays merge-request note and status outputs to deterministic files', async () => {
    const artifact = makeArtifact();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-gitlab-replay-'));
    const config = makeConfig('.omni-link/review-artifact.gitlab.json');
    const target = {
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      headSha: 'abc123',
    };

    try {
      const result = await publishGitLabReviewArtifact(config, artifact, target, {
        cwd: root,
        transport: createReplayGitLabReviewTransport(config, root),
      });

      const replayRoot = path.join(
        root,
        '.omni-link',
        'provider-replay',
        'acme',
        'platform',
        'mr-42',
      );
      const notePath = path.join(replayRoot, 'merge-request-note.txt');
      const statusPath = path.join(replayRoot, 'status-check.json');
      const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'providers', 'gitlab');

      expect(result.mode).toBe('replay');
      expect(result.capabilities.maxAnnotationsPerCheck).toBe(0);
      expect(result.metadata).toBeNull();
      expect(result.comment).toEqual({
        kind: 'comment',
        status: 'replayed',
        path: notePath,
      });
      expect(result.checkRun).toEqual({
        kind: 'check-run',
        status: 'replayed',
        path: statusPath,
      });
      expect(fs.readFileSync(notePath, 'utf8').trim()).toBe(
        fs.readFileSync(path.join(fixtureRoot, 'merge-request-note.txt'), 'utf8').trim(),
      );
      expect(JSON.parse(fs.readFileSync(statusPath, 'utf8'))).toEqual(
        JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'status-check.json'), 'utf8')),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fetches live GitLab merge request metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        state: 'opened',
        title: 'Max-tier publish',
        web_url: 'https://gitlab.test/acme/platform/-/merge_requests/42',
        draft: false,
        sha: 'meta-sha',
        source_branch: 'feature/max-tier',
        target_branch: 'main',
      }),
    });

    const metadata = await fetchGitLabMergeRequestMetadata({
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      apiUrl: 'https://gitlab.test/api/v4',
      token: 'test-token',
      fetchImpl,
    });

    expect(metadata).toEqual({
      provider: 'gitlab',
      state: 'open',
      title: 'Max-tier publish',
      url: 'https://gitlab.test/acme/platform/-/merge_requests/42',
      headSha: 'meta-sha',
      sourceBranch: 'feature/max-tier',
      targetBranch: 'main',
      isDraft: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://gitlab.test/api/v4/projects/acme%2Fplatform/merge_requests/42',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('skips GitLab publish operations when live metadata shows a closed merge request', async () => {
    const artifact = makeArtifact();
    const target = {
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      headSha: 'abc123',
    };

    const result = await publishGitLabReviewArtifact(makeConfig(), artifact, target, {
      transport: createReplayGitLabReviewTransport(makeConfig(), os.tmpdir()),
      metadata: {
        provider: 'gitlab',
        state: 'closed',
        headSha: 'abc123',
      },
    });

    expect(result.comment).toEqual({
      kind: 'comment',
      status: 'skipped',
      reason: 'comment publishing skipped because the gitlab review target is closed',
    });
    expect(result.checkRun).toEqual({
      kind: 'check-run',
      status: 'skipped',
      reason: 'status publishing skipped because the gitlab review target is closed',
    });
  });

  it('publishes GitLab note and status payloads through the API transport', async () => {
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
          web_url: 'https://gitlab.test/acme/platform/-/merge_requests/42#note_101',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({
          id: 202,
          target_url: 'https://gitlab.test/acme/platform/-/pipelines/202',
        }),
      });
    const transport = createGitLabApiReviewTransport({
      apiUrl: 'https://gitlab.test/api/v4',
      token: 'test-token',
      fetchImpl,
    });
    const replayOutput = buildGitLabReviewReplayOutput(makeArtifact());
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
      url: 'https://gitlab.test/acme/platform/-/merge_requests/42#note_101',
    });
    expect(checkRun).toEqual({
      kind: 'check-run',
      status: 'published',
      id: '202',
      url: 'https://gitlab.test/acme/platform/-/pipelines/202',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://gitlab.test/api/v4/projects/acme%2Fplatform/merge_requests/42/notes?per_page=100',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://gitlab.test/api/v4/projects/acme%2Fplatform/merge_requests/42/notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ body: replayOutput.commentBody }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://gitlab.test/api/v4/projects/acme%2Fplatform/statuses/abc123',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const thirdBody = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body));
    expect(thirdBody.state).toBe('failed');
    expect(thirdBody.name).toBe('omni-link status');
  });

  it('updates the existing omni-link GitLab note instead of creating duplicates', async () => {
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
            web_url: 'https://gitlab.test/acme/platform/-/merge_requests/42#note_101',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          id: 101,
          web_url: 'https://gitlab.test/acme/platform/-/merge_requests/42#note_101',
        }),
      });
    const transport = createGitLabApiReviewTransport({
      apiUrl: 'https://gitlab.test/api/v4',
      token: 'test-token',
      fetchImpl,
    });
    const replayOutput = buildGitLabReviewReplayOutput(makeArtifact());

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
      url: 'https://gitlab.test/acme/platform/-/merge_requests/42#note_101',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://gitlab.test/api/v4/projects/acme%2Fplatform/merge_requests/42/notes/101',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ body: replayOutput.commentBody }),
      }),
    );
  });
});
