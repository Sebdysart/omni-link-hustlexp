import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DaemonStatus, OmniLinkConfig, RepoManifest } from '../types.js';
import { CacheManager } from '../context/cache-manager.js';
import { buildContext } from '../context/index.js';
import { buildEcosystemGraph } from '../grapher/index.js';
import { attachOwnersToGraph } from '../ownership/index.js';
import { attachRuntimeSignals } from '../runtime/index.js';
import { scanRepo } from '../scanner/index.js';
import type { FileCache } from '../scanner/index.js';
import { GraphStateStore, type StoredScanState } from './store.js';

function configSha(config: OmniLinkConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
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
  const manifests: RepoManifest[] = [];

  for (const repo of config.repos) {
    manifests.push(await scanRepo(repo, fileCache, manifestCache, { config }));
  }

  const graph = attachRuntimeSignals(
    attachOwnersToGraph(buildEcosystemGraph(manifests), config),
    config,
  );
  const context = buildContext(graph, config);
  return {
    updatedAt: new Date().toISOString(),
    configSha: configSha(config),
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
  await store.save(state);
}

export async function loadDaemonState(config: OmniLinkConfig): Promise<StoredScanState | null> {
  if (!config.daemon?.enabled) {
    return null;
  }

  const store = new GraphStateStore(statePathFor(config), {
    legacyFilePath: legacyStatePathFor(config),
  });
  const state = await store.load();
  if (!state) {
    return null;
  }

  return state.configSha === configSha(config) ? state : null;
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
