import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { GraphStateStore, type StoredScanState } from '../../engine/daemon/store.js';

const SQLITE_HEADER = 'SQLite format 3\u0000';

function createState(tag: string): StoredScanState {
  return {
    updatedAt: '2026-03-07T00:00:00.000Z',
    configSha: `sha-${tag}`,
    branchSignature: `repo-${tag}:main:head-${tag}:000000000000`,
    manifests: [
      {
        repoId: `repo-${tag}`,
        path: `/tmp/repo-${tag}`,
        language: 'typescript',
        gitState: {
          branch: 'main',
          headSha: `head-${tag}`,
          uncommittedChanges: [],
          recentCommits: [],
        },
        apiSurface: {
          routes: [],
          procedures: [],
          exports: [],
        },
        typeRegistry: {
          types: [],
          schemas: [],
          models: [],
        },
        conventions: {
          naming: 'camelCase',
          fileOrganization: 'feature-first',
          errorHandling: 'throw',
          patterns: [],
          testingPatterns: 'vitest',
        },
        dependencies: {
          internal: [],
          external: [],
        },
        health: {
          testCoverage: 92,
          lintErrors: 0,
          typeErrors: 0,
          todoCount: 0,
          deadCode: [],
        },
      },
    ],
    graph: {
      repos: [],
      bridges: [],
      sharedTypes: [],
      contractMismatches: [],
      impactPaths: [],
    },
    context: {
      digest: {
        generatedAt: '2026-03-07T00:00:00.000Z',
        configSha: `sha-${tag}`,
        repos: [],
        contractStatus: {
          total: 0,
          exact: 0,
          compatible: 0,
          mismatches: [],
        },
        evolutionOpportunities: [],
        conventionSummary: {},
        apiSurfaceSummary: '',
        recentChangesSummary: '',
        tokenCount: 0,
      },
      markdown: `# ${tag}`,
    },
    dirtyRepos: [`repo-${tag}`],
  };
}

describe('GraphStateStore', () => {
  const tmpDir = path.join(os.tmpdir(), 'omni-link-daemon-store-tests');

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists daemon state as sqlite and loads it back', async () => {
    const filePath = path.join(tmpDir, 'daemon-state.sqlite');
    const state = createState('sqlite');
    const store = new GraphStateStore(filePath);

    await store.save(state);

    const loaded = await store.load();
    const status = await store.status();
    const header = fs.readFileSync(filePath).subarray(0, SQLITE_HEADER.length).toString('utf8');

    expect(loaded).toEqual(state);
    expect(header).toBe(SQLITE_HEADER);
    expect(status).toMatchObject({
      running: true,
      repoCount: 1,
      dirtyRepos: ['repo-sqlite'],
      statePath: filePath,
    });
  });

  it('migrates a legacy json state file in place and preserves a backup', async () => {
    const filePath = path.join(tmpDir, 'daemon-state.json');
    const state = createState('inline-json');
    const backupPath = `${filePath}.legacy.json`;
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');

    const store = new GraphStateStore(filePath);
    const loaded = await store.load();
    const header = fs.readFileSync(filePath).subarray(0, SQLITE_HEADER.length).toString('utf8');

    expect(loaded).toEqual(state);
    expect(header).toBe(SQLITE_HEADER);
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(backupPath, 'utf8'))).toEqual(state);
  });

  it('migrates a legacy json file into a sqlite target path', async () => {
    const sqlitePath = path.join(tmpDir, 'daemon-state.sqlite');
    const legacyPath = path.join(tmpDir, 'daemon-state.json');
    const state = createState('sidecar-json');
    fs.writeFileSync(legacyPath, JSON.stringify(state, null, 2), 'utf8');

    const store = new GraphStateStore(sqlitePath, { legacyFilePath: legacyPath });
    const loaded = await store.load();
    const header = fs.readFileSync(sqlitePath).subarray(0, SQLITE_HEADER.length).toString('utf8');

    expect(loaded).toEqual(state);
    expect(header).toBe(SQLITE_HEADER);
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it('stores and retrieves branch-specific snapshots independently', async () => {
    const filePath = path.join(tmpDir, 'daemon-state.sqlite');
    const mainState = createState('main');
    const featureState = {
      ...createState('feature'),
      configSha: mainState.configSha,
      branchSignature: 'repo-main:feature:head-feature:111111111111',
    };
    const store = new GraphStateStore(filePath);

    await store.save(mainState);
    await store.save(featureState);

    expect(await store.loadSnapshot(mainState.configSha, mainState.branchSignature)).toEqual(
      mainState,
    );
    expect(await store.loadSnapshot(featureState.configSha, featureState.branchSignature)).toEqual(
      featureState,
    );
    expect(await store.load()).toEqual(featureState);
  });
});
