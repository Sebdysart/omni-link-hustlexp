import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadReviewArtifact,
  saveReviewArtifact,
  type ReviewSnapshotKey,
} from '../../engine/review/index.js';
import type { OmniLinkConfig, ReviewArtifact } from '../../engine/types.js';

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
      artifactPath,
    },
  };
}

function makeArtifact(baseRef: string, headRef: string, generatedAt: string): ReviewArtifact {
  return {
    generatedAt,
    baseRef,
    headRef,
    affectedRepos: ['backend'],
    impact: [],
    contractMismatches: [],
    owners: [],
    risk: {
      overallRisk: 'low',
      score: 12,
      reasons: [],
      affectedRepos: ['backend'],
      blockedByPolicy: false,
    },
    policyDecisions: [],
    executionPlan: {
      planId: 'plan-1',
      mode: 'dry-run',
      branchName: 'codex/omni-link/plan-1',
      baseBranch: 'main',
      changes: [],
      risk: {
        overallRisk: 'low',
        score: 12,
        reasons: [],
        affectedRepos: ['backend'],
        blockedByPolicy: false,
      },
      approvals: [],
      blocked: false,
      policyDecisions: [],
      rollback: {
        steps: ['discard changes'],
        restoreTargets: [],
      },
    },
  };
}

describe('review snapshot persistence', () => {
  let tmpDir: string;
  let config: OmniLinkConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-review-artifacts-'));
    config = makeConfig(path.join(tmpDir, '.omni-link', 'review-artifact.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores latest and keyed snapshot artifacts independently', () => {
    const mainKey: ReviewSnapshotKey = {
      configSha: 'cfg-1',
      branchSignature: 'repo:main:head-a:000000000000',
      baseRef: 'main',
      headRef: 'HEAD',
    };
    const featureKey: ReviewSnapshotKey = {
      configSha: 'cfg-1',
      branchSignature: 'repo:feature:head-b:000000000000',
      baseRef: 'main',
      headRef: 'feature/max-tier',
    };
    const mainArtifact = makeArtifact('main', 'HEAD', '2026-03-07T12:00:00.000Z');
    const featureArtifact = makeArtifact('main', 'feature/max-tier', '2026-03-07T12:05:00.000Z');

    saveReviewArtifact(config, mainArtifact, mainKey);
    saveReviewArtifact(config, featureArtifact, featureKey);

    expect(loadReviewArtifact(config)).toEqual(featureArtifact);
    expect(loadReviewArtifact(config, mainKey)).toEqual(mainArtifact);
    expect(loadReviewArtifact(config, featureKey)).toEqual(featureArtifact);
    expect(
      loadReviewArtifact(config, {
        ...featureKey,
        headRef: 'feature/other',
      }),
    ).toBeNull();
  });
});
