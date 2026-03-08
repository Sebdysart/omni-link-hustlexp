import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadProviderMetadataSnapshot,
  providerMetadataStateFingerprint,
  saveProviderMetadataSnapshot,
  shouldReuseProviderMetadataSnapshot,
} from '../../engine/providers/cache.js';
import { negotiateReviewPublishContext } from '../../engine/providers/index.js';
import type { OmniLinkConfig } from '../../engine/types.js';

function makeConfig(artifactPath: string): OmniLinkConfig {
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
      owner: 'acme',
      repo: 'platform',
      artifactPath,
      publishMode: 'github',
      apiUrl: 'https://api.github.test',
    },
  };
}

describe('provider metadata snapshot cache', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-provider-cache-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores provider metadata snapshots under a branch-aware key', () => {
    const artifactPath = path.join(tmpDir, '.omni-link', 'review-artifact.json');
    const snapshotKey = {
      configSha: 'cfg-1',
      branchSignature: 'repo:main:head-1:000000000000',
      baseRef: 'main',
      headRef: 'HEAD',
      providerId: 'github' as const,
      mode: 'github' as const,
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
    };
    const snapshot = {
      fetchedAt: '2026-03-07T12:00:00.000Z',
      providerId: 'github' as const,
      mode: 'github' as const,
      target: {
        owner: 'acme',
        repo: 'platform',
        pullRequestNumber: 42,
        headSha: 'abc123',
      },
      capabilities: {
        supportsComments: true,
        supportsChecks: true,
        supportsMetadata: true,
        maxAnnotationsPerCheck: 50,
        maxCommentBytes: 65000,
      },
      metadata: {
        provider: 'github' as const,
        state: 'open' as const,
        headSha: 'abc123',
        sourceBranch: 'feature/provider-cache',
        targetBranch: 'main',
      },
      stateFingerprint: 'github:open:abc123:feature/provider-cache:main:ready',
    };

    saveProviderMetadataSnapshot(artifactPath, snapshotKey, snapshot);

    expect(loadProviderMetadataSnapshot(artifactPath, snapshotKey)).toEqual(snapshot);
    expect(
      loadProviderMetadataSnapshot(artifactPath, {
        ...snapshotKey,
        headRef: 'feature/other',
      }),
    ).toBeNull();
  });

  it('reuses fresh live GitHub metadata snapshots without refetching', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    const artifactPath = path.join(tmpDir, '.omni-link', 'review-artifact.json');
    const config = makeConfig(artifactPath);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        state: 'open',
        locked: false,
        title: 'Provider cache reuse',
        html_url: 'https://github.test/acme/platform/pull/42',
        draft: false,
        head: {
          sha: 'meta-sha',
          ref: 'feature/provider-cache',
        },
        base: {
          ref: 'main',
        },
      }),
    });
    const snapshotKey = {
      configSha: 'cfg-1',
      branchSignature: 'repo:main:head-1:000000000000',
      baseRef: 'main',
      headRef: 'HEAD',
    };

    const first = await negotiateReviewPublishContext(
      config,
      {
        pullRequestNumber: 42,
      },
      {
        snapshotKey,
        fetchImpl,
      },
    );
    const second = await negotiateReviewPublishContext(
      config,
      {
        pullRequestNumber: 42,
      },
      {
        snapshotKey,
        fetchImpl,
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.metadata).toEqual(second.metadata);
    expect(second.target.headSha).toBe('meta-sha');
  });

  it('treats terminal provider states as reusable and fingerprints metadata deterministically', () => {
    const mergedSnapshot = {
      fetchedAt: '2026-03-07T10:00:00.000Z',
      providerId: 'github' as const,
      mode: 'github' as const,
      target: {
        owner: 'acme',
        repo: 'platform',
        pullRequestNumber: 42,
        headSha: 'meta-sha',
      },
      capabilities: {
        supportsComments: true,
        supportsChecks: true,
        supportsMetadata: true,
        maxAnnotationsPerCheck: 50,
        maxCommentBytes: 65000,
      },
      metadata: {
        provider: 'github' as const,
        state: 'merged' as const,
        headSha: 'meta-sha',
        sourceBranch: 'feature/provider-cache',
        targetBranch: 'main',
        isDraft: false,
      },
      stateFingerprint: providerMetadataStateFingerprint({
        provider: 'github',
        state: 'merged',
        headSha: 'meta-sha',
        sourceBranch: 'feature/provider-cache',
        targetBranch: 'main',
        isDraft: false,
      }),
    };
    const staleOpenSnapshot = {
      ...mergedSnapshot,
      metadata: {
        ...mergedSnapshot.metadata,
        state: 'open' as const,
      },
      stateFingerprint: providerMetadataStateFingerprint({
        provider: 'github',
        state: 'open',
        headSha: 'meta-sha',
        sourceBranch: 'feature/provider-cache',
        targetBranch: 'main',
        isDraft: false,
      }),
    };

    expect(mergedSnapshot.stateFingerprint).toBe(
      'github:merged:meta-sha:feature/provider-cache:main:ready',
    );
    expect(
      shouldReuseProviderMetadataSnapshot(mergedSnapshot, Date.parse('2026-03-07T12:00:00.000Z')),
    ).toBe(true);
    expect(
      shouldReuseProviderMetadataSnapshot(
        staleOpenSnapshot,
        Date.parse('2026-03-07T12:00:00.000Z'),
      ),
    ).toBe(false);
  });
});
