import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-03-03T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-03T12:00:00Z',
    },
  })
    .toString()
    .trim();
}

function makeRepo(root, name) {
  const repoPath = path.join(root, name);
  fs.mkdirSync(repoPath, { recursive: true });
  run('git', ['init', '-q'], repoPath);
  run('git', ['config', 'user.email', 'codex@example.com'], repoPath);
  run('git', ['config', 'user.name', 'Codex'], repoPath);
  // Fixtures are throwaway repos; never inherit the host's commit/tag signing config.
  run('git', ['config', 'commit.gpgsign', 'false'], repoPath);
  run('git', ['config', 'tag.gpgsign', 'false'], repoPath);
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

async function measure(fn) {
  const start = performance.now();
  const value = await fn();
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

async function loadEngine(engine) {
  if (engine) {
    return engine;
  }

  const moduleUrl = new URL('../dist/index.js', import.meta.url);
  assert(
    fs.existsSync(fileURLToPath(moduleUrl)),
    'dist/index.js not found. Run `npm run build` before `npm run benchmark:smoke`.',
  );

  return import(moduleUrl.href);
}

function createBackendRepo(root, routeCount) {
  const repoPath = makeRepo(root, 'backend');
  for (let index = 0; index < routeCount; index++) {
    writeFile(
      repoPath,
      `src/routes/user-${index}.ts`,
      `
export interface User${index} {
  id: string;
  email: string;
}

const app = { get: (..._args) => undefined };
app.get('/api/users/${index}', (_req, res) => res.json({ id: '${index}' }));

export function loadUser${index}(): User${index} {
  return { id: '${index}', email: 'user${index}@example.com' };
}
`,
    );
  }
  commitAll(repoPath, 'backend init');
  return repoPath;
}

function createClientRepo(root, name, routeCount) {
  const repoPath = makeRepo(root, name);
  for (let index = 0; index < routeCount; index++) {
    writeFile(
      repoPath,
      `src/client-${index}.ts`,
      `
import { helper } from './shared/helper';

export async function fetchUser${index}() {
  helper();
  const response = await fetch('/api/users/${index}');
  return response.json();
}
`,
    );
  }
  writeFile(repoPath, 'src/shared/helper.ts', `export function helper() { return 'ok'; }\n`);
  commitAll(repoPath, `${name} init`);
  return {
    repoPath,
    sampleFile: path.join(repoPath, 'src/client-0.ts'),
  };
}

function createGoRepo(root, fileCount) {
  const repoPath = makeRepo(root, 'go-service');
  for (let index = 0; index < fileCount; index++) {
    writeFile(
      repoPath,
      `pkg/user_${index}.go`,
      `
package pkg

type User${index} struct {
  ID string
  Email string
}

func GetUser${index}() User${index} {
  return User${index}{}
}
`,
    );
  }
  commitAll(repoPath, 'go init');
  return repoPath;
}

function configFor(repos, cacheDir) {
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

export async function runBenchmarkSmoke(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scratchRoot = options.scratchRoot ?? path.join(cwd, '.tmp');
  const logger = options.logger ?? console.log;
  const backendRouteCount = options.backendRouteCount ?? 80;
  const clientRouteCount = options.clientRouteCount ?? 80;
  const goFileCount = options.goFileCount ?? 40;
  const minimumBridges = options.minimumBridges ?? 120;
  const maxRuntimeMs = options.maxRuntimeMs ?? 20000;
  const { scan, health, evolve, qualityCheck } = await loadEngine(options.engine);
  fs.mkdirSync(scratchRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchRoot, 'omni-link-bench-'));
  const cacheDir = path.join(root, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  try {
    const backend = createBackendRepo(root, backendRouteCount);
    const clientA = createClientRepo(root, 'web-client-a', clientRouteCount);
    const clientB = createClientRepo(root, 'web-client-b', clientRouteCount);
    const goRepo = createGoRepo(root, goFileCount);

    const config = configFor(
      [
        { name: 'backend', path: backend, language: 'typescript', role: 'backend' },
        { name: 'web-client-a', path: clientA.repoPath, language: 'typescript', role: 'frontend' },
        { name: 'web-client-b', path: clientB.repoPath, language: 'typescript', role: 'frontend' },
        { name: 'go-service', path: goRepo, language: 'go', role: 'backend' },
      ],
      cacheDir,
    );

    const scanRun = await measure(() => scan(config));
    const healthRun = await measure(() => health(config));
    const evolveRun = await measure(() => evolve(config));
    const quality = await qualityCheck(
      fs.readFileSync(clientA.sampleFile, 'utf8'),
      clientA.sampleFile,
      config,
    );

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

    assert(
      metrics.bridges >= minimumBridges,
      `Expected benchmark ecosystem to produce many bridges, got ${metrics.bridges}`,
    );
    assert(
      metrics.tokenCount <= 600,
      `Expected digest to honor token budget, got ${metrics.tokenCount}`,
    );
    assert(
      metrics.goExports > 0 && metrics.goTypes > 0,
      'Expected Go repo to produce exports and types',
    );
    assert(quality.references.valid, 'Expected sample quality check to remain valid');
    assert(scanRun.ms < maxRuntimeMs, `Scan smoke benchmark regressed: ${scanRun.ms}ms`);
    assert(healthRun.ms < maxRuntimeMs, `Health smoke benchmark regressed: ${healthRun.ms}ms`);
    assert(evolveRun.ms < maxRuntimeMs, `Evolution smoke benchmark regressed: ${evolveRun.ms}ms`);

    logger(JSON.stringify(metrics, null, 2));
    return metrics;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  await runBenchmarkSmoke();
}
