import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

import type { DaemonStatus, EcosystemGraph, EcosystemDigest, RepoManifest } from '../types.js';

const require = createRequire(import.meta.url);
const SQLITE_HEADER = 'SQLite format 3\u0000';
const STATE_ROW_ID = 1;
const STATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS daemon_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at TEXT NOT NULL,
    config_sha TEXT NOT NULL,
    manifests_json TEXT NOT NULL,
    graph_json TEXT NOT NULL,
    context_json TEXT NOT NULL,
    dirty_repos_json TEXT NOT NULL
  );
`;

export interface StoredScanState {
  updatedAt: string;
  configSha: string;
  manifests: RepoManifest[];
  graph: EcosystemGraph;
  context: { digest: EcosystemDigest; markdown: string };
  dirtyRepos: string[];
}

type SqlValue = string | number | null;

interface SqlJsExecResult {
  values: SqlValue[][];
}

interface SqlJsDatabase {
  run(sql: string, params?: Record<string, SqlValue>): void;
  exec(sql: string): SqlJsExecResult[];
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

type InitSqlJs = (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function isStoredScanState(value: unknown): value is StoredScanState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredScanState>;
  return (
    typeof candidate.updatedAt === 'string' &&
    typeof candidate.configSha === 'string' &&
    Array.isArray(candidate.manifests) &&
    typeof candidate.graph === 'object' &&
    candidate.graph !== null &&
    typeof candidate.context === 'object' &&
    candidate.context !== null &&
    Array.isArray(candidate.dirtyRepos)
  );
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async (): Promise<SqlJsStatic> => {
      const module = (await import('sql.js')) as unknown as { default?: InitSqlJs };
      const initSqlJs = module.default;
      if (!initSqlJs) {
        throw new Error('sql.js did not expose a default initializer');
      }

      return initSqlJs({
        locateFile(file): string {
          return require.resolve(`sql.js/dist/${file}`);
        },
      });
    })();
  }

  return sqlJsPromise;
}

async function fileLooksLikeSqlite(filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString('utf8') === SQLITE_HEADER;
  } finally {
    await handle.close();
  }
}

async function readLegacyJsonState(filePath: string): Promise<StoredScanState | null> {
  if (!fs.existsSync(filePath) || (await fileLooksLikeSqlite(filePath))) {
    return null;
  }

  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return isStoredScanState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rowToState(row: SqlValue[]): StoredScanState {
  return {
    updatedAt: String(row[0] ?? ''),
    configSha: String(row[1] ?? ''),
    manifests: JSON.parse(String(row[2] ?? '[]')) as RepoManifest[],
    graph: JSON.parse(String(row[3] ?? '{}')) as EcosystemGraph,
    context: JSON.parse(String(row[4] ?? '{}')) as { digest: EcosystemDigest; markdown: string },
    dirtyRepos: JSON.parse(String(row[5] ?? '[]')) as string[],
  };
}

export class GraphStateStore {
  constructor(
    private readonly filePath: string,
    private readonly options: { legacyFilePath?: string } = {},
  ) {}

  async load(): Promise<StoredScanState | null> {
    try {
      await this.ensureMigrated();
      const db = await this.openDatabase(false);
      if (!db) {
        return null;
      }

      try {
        const results = db.exec(
          'SELECT updated_at, config_sha, manifests_json, graph_json, context_json, dirty_repos_json FROM daemon_state WHERE id = 1;',
        );
        if (results.length === 0 || results[0].values.length === 0) {
          return null;
        }

        return rowToState(results[0].values[0]);
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  async save(state: StoredScanState): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.ensureMigrated();

    const db = await this.openDatabase(true, true);
    try {
      db.run(
        `
          INSERT INTO daemon_state (
            id,
            updated_at,
            config_sha,
            manifests_json,
            graph_json,
            context_json,
            dirty_repos_json
          ) VALUES (
            $id,
            $updatedAt,
            $configSha,
            $manifests,
            $graph,
            $context,
            $dirtyRepos
          )
          ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at,
            config_sha = excluded.config_sha,
            manifests_json = excluded.manifests_json,
            graph_json = excluded.graph_json,
            context_json = excluded.context_json,
            dirty_repos_json = excluded.dirty_repos_json;
        `,
        {
          $id: STATE_ROW_ID,
          $updatedAt: state.updatedAt,
          $configSha: state.configSha,
          $manifests: JSON.stringify(state.manifests),
          $graph: JSON.stringify(state.graph),
          $context: JSON.stringify(state.context),
          $dirtyRepos: JSON.stringify(state.dirtyRepos),
        },
      );

      await this.persistDatabase(db);
    } finally {
      db.close();
    }
  }

  async status(): Promise<DaemonStatus> {
    const state = await this.load();
    return {
      running: state !== null,
      updatedAt: state?.updatedAt ?? new Date(0).toISOString(),
      repoCount: state?.manifests.length ?? 0,
      dirtyRepos: state?.dirtyRepos ?? [],
      statePath: this.filePath,
    };
  }

  private async ensureMigrated(): Promise<void> {
    const inlineLegacyState = await readLegacyJsonState(this.filePath);
    if (inlineLegacyState) {
      const backupPath = `${this.filePath}.legacy.json`;
      if (!fs.existsSync(backupPath)) {
        await fs.promises.copyFile(this.filePath, backupPath);
      }
      await this.writeFreshDatabase(inlineLegacyState);
      return;
    }

    if (fs.existsSync(this.filePath) || !this.options.legacyFilePath) {
      return;
    }

    const legacyState = await readLegacyJsonState(this.options.legacyFilePath);
    if (legacyState) {
      await this.writeFreshDatabase(legacyState);
    }
  }

  private async writeFreshDatabase(state: StoredScanState): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const SQL = await getSqlJs();
    const db = new SQL.Database();

    try {
      this.ensureSchema(db);
      db.run(
        `
          INSERT INTO daemon_state (
            id,
            updated_at,
            config_sha,
            manifests_json,
            graph_json,
            context_json,
            dirty_repos_json
          ) VALUES (
            $id,
            $updatedAt,
            $configSha,
            $manifests,
            $graph,
            $context,
            $dirtyRepos
          );
        `,
        {
          $id: STATE_ROW_ID,
          $updatedAt: state.updatedAt,
          $configSha: state.configSha,
          $manifests: JSON.stringify(state.manifests),
          $graph: JSON.stringify(state.graph),
          $context: JSON.stringify(state.context),
          $dirtyRepos: JSON.stringify(state.dirtyRepos),
        },
      );
      await this.persistDatabase(db);
    } finally {
      db.close();
    }
  }

  private async openDatabase(
    createIfMissing: true,
    overwriteCorrupt?: boolean,
  ): Promise<SqlJsDatabase>;
  private async openDatabase(
    createIfMissing: false,
    overwriteCorrupt?: boolean,
  ): Promise<SqlJsDatabase | null>;
  private async openDatabase(
    createIfMissing: boolean,
    overwriteCorrupt: boolean = false,
  ): Promise<SqlJsDatabase | null> {
    if (!fs.existsSync(this.filePath)) {
      if (!createIfMissing) {
        return null;
      }

      const SQL = await getSqlJs();
      const db = new SQL.Database();
      this.ensureSchema(db);
      return db;
    }

    const raw = await fs.promises.readFile(this.filePath);
    const SQL = await getSqlJs();

    try {
      const db = new SQL.Database(raw);
      this.ensureSchema(db);
      return db;
    } catch (error) {
      if (!overwriteCorrupt) {
        throw error;
      }

      const db = new SQL.Database();
      this.ensureSchema(db);
      return db;
    }
  }

  private ensureSchema(db: SqlJsDatabase): void {
    db.run(STATE_TABLE_SQL);
  }

  private async persistDatabase(db: SqlJsDatabase): Promise<void> {
    await fs.promises.writeFile(this.filePath, Buffer.from(db.export()));
  }
}
