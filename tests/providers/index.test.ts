import { describe, expect, it } from 'vitest';

import {
  defaultBaseRefForProvider,
  negotiateReviewPublishContext,
  resolveReviewProvider,
  resolveReviewProviderId,
} from '../../engine/providers/index.js';
import type { OmniLinkConfig } from '../../engine/types.js';

function makeConfig(overrides: Partial<OmniLinkConfig> = {}): OmniLinkConfig {
  return {
    repos: [{ name: 'repo', path: '/tmp/repo', language: 'typescript', role: 'backend' }],
    reviewProvider: 'github',
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
      defaultBaseBranch: 'main',
    },
    ...overrides,
  };
}

describe('provider registry', () => {
  it('defaults to the GitHub provider', () => {
    const config = makeConfig();

    expect(resolveReviewProviderId(config)).toBe('github');
    expect(resolveReviewProvider(config).id).toBe('github');
    expect(defaultBaseRefForProvider(config)).toBe('main');
  });

  it('selects the GitLab provider when configured', () => {
    const config = makeConfig({
      reviewProvider: 'gitlab',
      gitlab: {
        enabled: true,
        namespace: 'acme',
        project: 'platform',
        defaultBaseBranch: 'trunk',
      },
    });

    expect(resolveReviewProviderId(config)).toBe('gitlab');
    expect(resolveReviewProvider(config).id).toBe('gitlab');
    expect(defaultBaseRefForProvider(config)).toBe('trunk');
  });

  it('hydrates the publish target head SHA from provider metadata when available', async () => {
    const config = makeConfig();

    const context = await negotiateReviewPublishContext(
      config,
      {
        pullRequestNumber: 42,
      },
      {
        metadata: {
          provider: 'github',
          state: 'open',
          headSha: 'meta-sha',
        },
      },
    );

    expect(context.provider.id).toBe('github');
    expect(context.target).toEqual({
      owner: 'acme',
      repo: 'platform',
      pullRequestNumber: 42,
      headSha: 'meta-sha',
    });
    expect(context.capabilities.maxAnnotationsPerCheck).toBe(50);
    expect(context.metadata?.headSha).toBe('meta-sha');
  });
});
