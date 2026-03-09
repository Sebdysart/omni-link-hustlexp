import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import pLimit from 'p-limit';

import type { DaemonStatus, OmniLinkConfig, RepoManifest } from '../types.js';
import { CacheManager } from '../context/cache-manager.js';
import { buildContext } from '../context/index.js';
import { buildEcosystemGraph } from '../grapher/index.js';
import { enrichGraphForConfig } from '../graph/enrichment.js';
import { scanRepo } from '../scanner/index.js';
import type { FileCache } from '../scanner/index.js';
import { GraphStateStore, type StoredScanState } from './store.js';

export function configSha(config: OmniLinkConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
}

function normalizeDirtyFiles(files: string[]): string {
  return crypto
    .createHash('sha1')
    .update([...files].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

export function branchSignatureFromManifests(manifests: RepoManifest[]): string {
  return manifests
    .map((manifest) =>
      [
        manifest.repoId,
        manifest.gitState.branch,
        manifest.gitState.headSha,
        normalizeDirtyFiles(manifest.gitState.uncommittedChanges),
      ].join(':'),
    )
    .sort()
    .join('|');
}

function normalizeStatusPath(entry: string): string {
  return entry.replace(/\\/g, '/').trim();
}

export function currentBranchSignature(config: OmniLinkConfig): string {
  return config.repos
    .map((repo) => {
      try {
        const branch = execFileSync('git', ['-C', repo.path, 'rev-parse', '--abbrev-ref', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        const headSha = execFileSync('git', ['-C', repo.path, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        const diffOutput = execFileSync('git', ['-C', repo.path, 'diff', '--name-only'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stagedOutput = execFileSync(
          'git',
          ['-C', repo.path, 'diff', '--cached', '--name-only'],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const untrackedOutput = execFileSync(
          'git',
          ['-C', repo.path, 'ls-files', '--others', '--exclude-standard'],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const dirtyFiles = [
          ...diffOutput.split('\n'),
          ...stagedOutput.split('\n'),
          ...untrackedOutput.split('\n'),
        ]
          .map((line) => normalizeStatusPath(line.trim()))
          .filter(Boolean);

        return [repo.name, branch, headSha, normalizeDirtyFiles(dirtyFiles)].join(':');
      } catch {
        return [repo.name, 'unknown', 'unknown', 'missing'].join(':');
      }
    })
    .sort()
    .join('|');
}

function normalizeState(state: StoredScanState): StoredScanState {
  return {
    ...state,
    branchSignature:
      state.branchSignature && state.branchSignature.length > 0
        ? state.branchSignature
        : branchSignatureFromManifests(state.manifests),
  };
}

export function statePathFor(config: OmniLinkConfig): string {
  const configured =
    config.daemon?.statePath ?? path.join(config.cache.directory, 'daemon-state.sqlite');
  return path.isAbsolute(configured) ? configured : path.join(config.cache.directory, configured);
}

function legacyStatePathFor(config: OmniLinkConfig): string | undefined {
  const statePath = statePathFor(config);
  if (statePath.endsWith('.sqlite')) {
    return statePath.replace(/\.sqlite$/, '.json');
  }

  return undefined;
}

async function scanAllRepos(config: OmniLinkConfig): Promise<StoredScanState> {
  const fileCache: FileCache = new Map();
  const manifestCache = config.cache?.directory
    ? new CacheManager(config.cache.directory)
    : undefined;
  const limit = pLimit(4);
  const manifests: RepoManifest[] = await Promise.all(
    config.repos.map((repo) => limit(() => scanRepo(repo, fileCache, manifestCache, { config }))),
  );

  const graph = enrichGraphForConfig(buildEcosystemGraph(manifests), config);
  const context = buildContext(graph, config);
  return {
    updatedAt: new Date().toISOString(),
    configSha: configSha(config),
    branchSignature: branchSignatureFromManifests(manifests),
    manifests,
    graph,
    context,
    dirtyRepos: [],
  };
}

export async function saveDaemonState(
  config: OmniLinkConfig,
  state: StoredScanState,
): Promise<void> {
  const store = new GraphStateStore(statePathFor(config), {
    legacyFilePath: legacyStatePathFor(config),
  });
  await store.save(normalizeState(state));
}

export async function loadDaemonState(config: OmniLinkConfig): Promise<StoredScanState | null> {
  if (!config.daemon?.enabled) {
    return null;
  }

  const store = new GraphStateStore(statePathFor(config), {
    legacyFilePath: legacyStatePathFor(config),
  });
  const expectedConfigSha = configSha(config);
  const branchSignature = currentBranchSignature(config);
  const snapshot = await store.loadSnapshot(expectedConfigSha, branchSignature);
  if (snapshot) {
    return normalizeState(snapshot);
  }

  const state = await store.load();
  if (!state) {
    return null;
  }

  const normalizedState = normalizeState(state);
  return normalizedState.configSha === expectedConfigSha &&
    normalizedState.branchSignature === branchSignature
    ? normalizedState
    : null;
}

export async function updateDaemonState(config: OmniLinkConfig): Promise<StoredScanState> {
  const store = new GraphStateStore(statePathFor(config), {
    legacyFilePath: legacyStatePathFor(config),
  });
  const nextState = await scanAllRepos(config);
  await store.save(nextState);
  return nextState;
}

export async function watchEcosystem(
  config: OmniLinkConfig,
  options: { once?: boolean; onStatus?: (status: DaemonStatus) => void } = {},
): Promise<DaemonStatus> {
  const once = options.once ?? false;
  const store = new GraphStateStore(statePathFor(config), {
    legacyFilePath: legacyStatePathFor(config),
  });

  if (once) {
    const cachedState = await loadDaemonState(config);
    if (cachedState) {
      const cachedStatus: DaemonStatus = {
        running: true,
        updatedAt: cachedState.updatedAt,
        repoCount: cachedState.manifests.length,
        dirtyRepos: cachedState.dirtyRepos,
        statePath: statePathFor(config),
      };
      options.onStatus?.(cachedStatus);
      return cachedStatus;
    }
  }

  await updateDaemonState(config);
  const initialStatus = await store.status();
  options.onStatus?.(initialStatus);

  if (once) {
    return initialStatus;
  }

  let pending = false;
  let dirtyRepos = new Set<string>();

  const flush = async (): Promise<void> => {
    if (!pending) return;
    pending = false;
    const nextState = await updateDaemonState(config);
    nextState.dirtyRepos = [...dirtyRepos];
    dirtyRepos = new Set<string>();
    await store.save(nextState);
    options.onStatus?.(await store.status());
  };

  for (const repo of config.repos) {
    if (!fs.existsSync(repo.path)) continue;
    fs.watch(repo.path, { recursive: true }, () => {
      dirtyRepos.add(repo.name);
      pending = true;
      setTimeout(() => {
        void flush();
      }, config.daemon?.pollIntervalMs ?? 1000);
    });
  }

  return initialStatus;
}
