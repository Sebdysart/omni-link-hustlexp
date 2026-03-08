import type {
  OmniLinkConfig,
  ReviewArtifact,
  ReviewProviderCapabilities,
  ReviewProviderId,
  ReviewProviderMetadata,
  ReviewPublishMode,
  ReviewPublishResult,
  ReviewPublishTarget,
} from '../types.js';
import {
  loadProviderMetadataSnapshot,
  providerMetadataStateFingerprint,
  saveProviderMetadataSnapshot,
  shouldReuseProviderMetadataSnapshot,
  type ProviderMetadataSnapshotKey,
} from './cache.js';
import { githubReviewProvider } from './github.js';
import { gitlabReviewProvider } from './gitlab.js';
import type { ReviewProvider, ReviewPublishOptions, ReviewPublishRequest } from './types.js';

const PROVIDERS: Record<ReviewProviderId, ReviewProvider> = {
  github: githubReviewProvider,
  gitlab: gitlabReviewProvider,
};

export function resolveReviewProviderId(config: OmniLinkConfig): ReviewProviderId {
  if (config.reviewProvider) {
    return config.reviewProvider;
  }
  if (config.gitlab?.enabled) {
    return 'gitlab';
  }
  return 'github';
}

export function resolveReviewProvider(config: OmniLinkConfig): ReviewProvider {
  return PROVIDERS[resolveReviewProviderId(config)] ?? githubReviewProvider;
}

export function defaultBaseRefForProvider(config: OmniLinkConfig): string {
  return resolveReviewProvider(config).defaultBaseRef(config);
}

function publishModeForProvider(
  config: OmniLinkConfig,
  providerId: ReviewProviderId,
): ReviewPublishMode {
  switch (providerId) {
    case 'gitlab':
      return config.gitlab?.publishMode ?? 'dry-run';
    case 'github':
    default:
      return config.github?.publishMode ?? 'dry-run';
  }
}

function providerMetadataSnapshotKeyFor(
  providerId: ReviewProviderId,
  mode: ReviewPublishMode,
  target: ReviewPublishTarget,
  snapshotKey: NonNullable<ReviewPublishOptions['snapshotKey']>,
): ProviderMetadataSnapshotKey {
  return {
    ...snapshotKey,
    providerId,
    mode,
    owner: target.owner,
    repo: target.repo,
    pullRequestNumber: target.pullRequestNumber,
  };
}

export interface NegotiatedReviewPublishContext {
  provider: ReviewProvider;
  target: ReviewPublishTarget;
  capabilities: ReviewProviderCapabilities;
  metadata: ReviewProviderMetadata | null;
}

export async function negotiateReviewPublishContext(
  config: OmniLinkConfig,
  request: ReviewPublishRequest,
  options: ReviewPublishOptions = {},
): Promise<NegotiatedReviewPublishContext> {
  const provider = resolveReviewProvider(config);
  const initialTarget = provider.resolvePublishTarget(config, request);
  const providerMode = options.transport?.mode ?? publishModeForProvider(config, provider.id);
  const artifactPath = provider.resolveArtifactPath(config, options.cwd);
  let capabilities = options.capabilities ?? provider.capabilities(config);
  let metadata: ReviewProviderMetadata | null = options.metadata ?? null;

  if (options.metadata === undefined && providerMode === provider.id && options.snapshotKey) {
    const snapshotKey = providerMetadataSnapshotKeyFor(
      provider.id,
      providerMode,
      initialTarget,
      options.snapshotKey,
    );
    const cachedSnapshot = loadProviderMetadataSnapshot(artifactPath, snapshotKey);

    if (cachedSnapshot && shouldReuseProviderMetadataSnapshot(cachedSnapshot)) {
      capabilities = cachedSnapshot.capabilities;
      metadata = cachedSnapshot.metadata;
    } else {
      metadata = await provider.fetchLiveMetadata(config, initialTarget, options);
      if (metadata) {
        saveProviderMetadataSnapshot(artifactPath, snapshotKey, {
          fetchedAt: new Date().toISOString(),
          providerId: provider.id,
          mode: providerMode,
          target: {
            ...initialTarget,
            headSha: metadata.headSha ?? initialTarget.headSha,
          },
          capabilities,
          metadata,
          stateFingerprint: providerMetadataStateFingerprint(metadata),
        });
      }
    }
  } else if (options.metadata === undefined) {
    metadata = await provider.fetchLiveMetadata(config, initialTarget, options);
  }

  const target =
    initialTarget.headSha || !metadata?.headSha
      ? initialTarget
      : {
          ...initialTarget,
          headSha: metadata.headSha,
        };

  return {
    provider,
    target,
    capabilities,
    metadata,
  };
}

export async function publishReviewArtifact(
  config: OmniLinkConfig,
  artifact: ReviewArtifact,
  request: ReviewPublishRequest,
  options: ReviewPublishOptions = {},
): Promise<ReviewPublishResult> {
  const context = await negotiateReviewPublishContext(config, request, options);
  return context.provider.publishArtifact(config, artifact, context.target, {
    ...options,
    capabilities: context.capabilities,
    metadata: context.metadata,
  });
}

export { githubReviewProvider, gitlabReviewProvider };
