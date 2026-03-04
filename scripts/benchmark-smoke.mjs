import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { scan, health, evolve, qualityCheck } from '../dist/index.js';

const scratchRoot = path.join(process.cwd(), '.tmp');
fs.mkdirSync(scratchRoot, { recursive: true });
const root = fs.mkdtempSync(path.join(scratchRoot, 'omni-link-bench-'));
const cacheDir = path.join(root, '.cache');
fs.mkdirSync(cacheDir, { recursive: true });

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-03-03T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-03T12:00:00Z',
    },
  }).toString().trim();
}

function makeRepo(name) {
  const repoPath = path.join(root, name);
  fs.mkdirSync(repoPath, { recursive: true });
  run('git', ['init', '-q'], repoPath);
  run('git', ['config', 'user.email', 'codex@example.com'], repoPath);
  run('git', ['config', 'user.name', 'Codex'], repoPath);
  return repoPath;
}

function writeFile(repoPath, relativePath, contents) {
  const filePath = path.join(repoPath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function commitAll(repoPath, message) {
  run('git', ['add', '.'], repoPath);
  run('git', ['commit', '-qm', message], repoPath);
}

function measure(fn) {
  const start = performance.now();
  const value = fn();
  return {
    value,
    ms: Number((performance.now() - start).toFixed(1)),
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createBackendRepo() {
  const repoPath = makeRepo('backend');
  for (let index = 0; index < 80; index++) {
    writeFile(repoPath, `src/routes/user-${index}.ts`, `
export interface User${index} {
  id: string;
  email: string;
}

const app = { get: (..._args) => undefined };
app.get('/api/users/${index}', (_req, res) => res.json({ id: '${index}' }));

export function loadUser${index}(): User${index} {
  return { id: '${index}', email: 'user${index}@example.com' };
}
`);
  }
  commitAll(repoPath, 'backend init');
  return repoPath;
}

function createClientRepo(name, routeCount) {
  const repoPath = makeRepo(name);
  for (let index = 0; index < routeCount; index++) {
    writeFile(repoPath, `src/client-${index}.ts`, `
import { helper } from './shared/helper';

export async function fetchUser${index}() {
  helper();
  const response = await fetch('/api/users/${index}');
  return response.json();
}
`);
  }
  writeFile(repoPath, 'src/shared/helper.ts', `export function helper() { return 'ok'; }\n`);
  commitAll(repoPath, `${name} init`);
  return {
    repoPath,
    sampleFile: path.join(repoPath, 'src/client-0.ts'),
  };
}

function createGoRepo() {
  const repoPath = makeRepo('go-service');
  for (let index = 0; index < 40; index++) {
    writeFile(repoPath, `pkg/user_${index}.go`, `
package pkg

type User${index} struct {
  ID string
  Email string
}

func GetUser${index}() User${index} {
  return User${index}{}
}
`);
  }
  commitAll(repoPath, 'go init');
  return repoPath;
}

function configFor(repos) {
  return {
    repos,
    evolution: {
      aggressiveness: 'moderate',
      maxSuggestionsPerSession: 10,
      categories: ['feature', 'performance', 'security', 'scale', 'monetization'],
    },
    quality: {
      blockOnFailure: false,
      requireTestsForNewCode: false,
      conventionStrictness: 'moderate',
    },
    context: {
      tokenBudget: 600,
      prioritize: 'api-surface-first',
      includeRecentCommits: 5,
      focus: 'auto',
    },
    cache: {
      directory: cacheDir,
      maxAgeDays: 7,
    },
  };
}

try {
  const backend = createBackendRepo();
  const clientA = createClientRepo('web-client-a', 80);
  const clientB = createClientRepo('web-client-b', 80);
  const goRepo = createGoRepo();

  const config = configFor([
    { name: 'backend', path: backend, language: 'typescript', role: 'backend' },
    { name: 'web-client-a', path: clientA.repoPath, language: 'typescript', role: 'frontend' },
    { name: 'web-client-b', path: clientB.repoPath, language: 'typescript', role: 'frontend' },
    { name: 'go-service', path: goRepo, language: 'go', role: 'backend' },
  ]);

  const scanRun = measure(() => scan(config));
  const healthRun = measure(() => health(config));
  const evolveRun = measure(() => evolve(config));
  const quality = qualityCheck(fs.readFileSync(clientA.sampleFile, 'utf8'), clientA.sampleFile, config);

  const goManifest = scanRun.value.manifests.find((manifest) => manifest.repoId === 'go-service');
  const metrics = {
    scanMs: scanRun.ms,
    healthMs: healthRun.ms,
    evolveMs: evolveRun.ms,
    bridges: scanRun.value.graph.bridges.length,
    tokenCount: scanRun.value.context.digest.tokenCount,
    goExports: goManifest?.apiSurface.exports.length ?? 0,
    goTypes: goManifest?.typeRegistry.types.length ?? 0,
    rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };

  assert(metrics.bridges >= 120, `Expected benchmark ecosystem to produce many bridges, got ${metrics.bridges}`);
  assert(metrics.tokenCount <= 600, `Expected digest to honor token budget, got ${metrics.tokenCount}`);
  assert(metrics.goExports > 0 && metrics.goTypes > 0, 'Expected Go repo to produce exports and types');
  assert(quality.references.valid, 'Expected sample quality check to remain valid');
  assert(scanRun.ms < 20000, `Scan smoke benchmark regressed: ${scanRun.ms}ms`);
  assert(healthRun.ms < 20000, `Health smoke benchmark regressed: ${healthRun.ms}ms`);
  assert(evolveRun.ms < 20000, `Evolution smoke benchmark regressed: ${evolveRun.ms}ms`);

  console.log(JSON.stringify(metrics, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
