import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ReviewProviderCapabilities,
  ReviewProviderId,
  ReviewProviderMetadata,
  ReviewPublishMode,
  ReviewPublishTarget,
} from '../types.js';
import type { ReviewSnapshotIdentity } from './types.js';

const FRESH_PROVIDER_METADATA_WINDOW_MS = 60_000;

export interface ProviderMetadataSnapshotKey extends ReviewSnapshotIdentity {
  providerId: ReviewProviderId;
  mode: ReviewPublishMode;
  owner: string;
  repo: string;
  pullRequestNumber: number;
}

export interface StoredProviderMetadataSnapshot {
  fetchedAt: string;
  providerId: ReviewProviderId;
  mode: ReviewPublishMode;
  target: ReviewPublishTarget;
  capabilities: ReviewProviderCapabilities;
  metadata: ReviewProviderMetadata;
  stateFingerprint: string;
}

function snapshotRootFor(artifactPath: string): string {
  return path.join(path.dirname(artifactPath), 'provider-metadata-snapshots');
}

function snapshotPathFor(artifactPath: string, key: ProviderMetadataSnapshotKey): string {
  const snapshotHash = crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        configSha: key.configSha,
        branchSignature: key.branchSignature,
        baseRef: key.baseRef,
        headRef: key.headRef,
        providerId: key.providerId,
        mode: key.mode,
        owner: key.owner,
        repo: key.repo,
        pullRequestNumber: key.pullRequestNumber,
      }),
    )
    .digest('hex')
    .slice(0, 16);

  return path.join(snapshotRootFor(artifactPath), `${key.providerId}-${snapshotHash}.json`);
}

function isProviderMetadata(value: unknown): value is ReviewProviderMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ReviewProviderMetadata>;
  return typeof candidate.provider === 'string' && typeof candidate.state === 'string';
}

function isProviderCapabilities(value: unknown): value is ReviewProviderCapabilities {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ReviewProviderCapabilities>;
  return (
    typeof candidate.supportsComments === 'boolean' &&
    typeof candidate.supportsChecks === 'boolean' &&
    typeof candidate.supportsMetadata === 'boolean' &&
    typeof candidate.maxAnnotationsPerCheck === 'number' &&
    typeof candidate.maxCommentBytes === 'number'
  );
}

function isPublishTarget(value: unknown): value is ReviewPublishTarget {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ReviewPublishTarget>;
  return (
    typeof candidate.owner === 'string' &&
    typeof candidate.repo === 'string' &&
    typeof candidate.pullRequestNumber === 'number' &&
    (candidate.headSha === undefined || typeof candidate.headSha === 'string')
  );
}

function isStoredProviderMetadataSnapshot(value: unknown): value is StoredProviderMetadataSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredProviderMetadataSnapshot>;
  return (
    typeof candidate.fetchedAt === 'string' &&
    typeof candidate.providerId === 'string' &&
    typeof candidate.mode === 'string' &&
    isPublishTarget(candidate.target) &&
    isProviderCapabilities(candidate.capabilities) &&
    isProviderMetadata(candidate.metadata) &&
    typeof candidate.stateFingerprint === 'string'
  );
}

export function providerMetadataStateFingerprint(metadata: ReviewProviderMetadata): string {
  return [
    metadata.provider,
    metadata.state,
    metadata.headSha ?? '',
    metadata.sourceBranch ?? '',
    metadata.targetBranch ?? '',
    metadata.isDraft ? 'draft' : 'ready',
  ].join(':');
}

export function shouldReuseProviderMetadataSnapshot(
  snapshot: StoredProviderMetadataSnapshot,
  now: number = Date.now(),
): boolean {
  switch (snapshot.metadata.state) {
    case 'closed':
    case 'merged':
    case 'locked':
      return true;
    case 'open':
    case 'unknown':
    default: {
      const fetchedAt = Date.parse(snapshot.fetchedAt);
      return Number.isFinite(fetchedAt) && now - fetchedAt <= FRESH_PROVIDER_METADATA_WINDOW_MS;
    }
  }
}

export function saveProviderMetadataSnapshot(
  artifactPath: string,
  key: ProviderMetadataSnapshotKey,
  snapshot: StoredProviderMetadataSnapshot,
): string {
  const filePath = snapshotPathFor(artifactPath, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return filePath;
}

export function loadProviderMetadataSnapshot(
  artifactPath: string,
  key: ProviderMetadataSnapshotKey,
): StoredProviderMetadataSnapshot | null {
  const filePath = snapshotPathFor(artifactPath, key);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!isStoredProviderMetadataSnapshot(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
