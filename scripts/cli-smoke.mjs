import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-03-07T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-07T12:00:00Z',
    },
  })
    .toString()
    .trim();
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function initRepo(root) {
  run('git', ['init', '-q'], root);
  run('git', ['config', 'user.email', 'cli-smoke@example.com'], root);
  run('git', ['config', 'user.name', 'CLI Smoke'], root);
  // Fixtures are throwaway repos; never inherit the host's commit/tag signing config.
  run('git', ['config', 'commit.gpgsign', 'false'], root);
  run('git', ['config', 'tag.gpgsign', 'false'], root);
}

function commitAll(root, message) {
  run('git', ['add', '.'], root);
  run('git', ['commit', '-qm', message], root);
}

function createCliRunner(cliPath, cwd) {
  return (args) => run(process.execPath, [cliPath, ...args], cwd);
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} did not emit JSON: ${String(error)}`);
  }
}

export async function runCliSmoke(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scratchRoot = options.scratchRoot ?? path.join(cwd, '.tmp');
  const cliPath = options.cliPath ?? path.join(cwd, 'dist', 'cli.js');
  const executeCli = options.executeCli ?? createCliRunner(cliPath, cwd);
  const logger = options.logger ?? console.log;

  if (!options.executeCli) {
    assert(
      fs.existsSync(cliPath),
      'dist/cli.js not found. Run `npm run build` before `npm run smoke:cli`.',
    );
  }

  fs.mkdirSync(scratchRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchRoot, 'omni-link-cli-'));

  try {
    const backendDir = path.join(root, 'backend');
    const clientDir = path.join(root, 'client');
    const cacheDir = path.join(root, '.cache');
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    initRepo(backendDir);
    initRepo(clientDir);

    writeFile(
      backendDir,
      'src/routes/users.ts',
      `export interface User {
  id: string;
  email: string;
}

const app = { get: (..._args) => undefined };
app.get('/api/users', (_req, res) => res.json({ users: [] }));
`,
    );
    writeFile(
      backendDir,
      'package.json',
      JSON.stringify(
        {
          name: 'cli-backend',
          version: '1.0.0',
          dependencies: { hono: '^4.0.0' },
        },
        null,
        2,
      ),
    );
    commitAll(backendDir, 'backend init');

    writeFile(
      clientDir,
      'src/client.ts',
      `export async function fetchUsers() {
  const response = await fetch('/api/users').catch(() => ({ json: async () => [] }));
  return response.json();
}
`,
    );
    writeFile(
      clientDir,
      'package.json',
      JSON.stringify(
        {
          name: 'cli-client',
          version: '1.0.0',
        },
        null,
        2,
      ),
    );
    commitAll(clientDir, 'client init');

    const configPath = path.join(root, '.omni-link.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          repos: [
            { name: 'backend', path: backendDir, language: 'typescript', role: 'backend' },
            { name: 'client', path: clientDir, language: 'typescript', role: 'frontend' },
          ],
          evolution: {
            aggressiveness: 'moderate',
            maxSuggestionsPerSession: 5,
            categories: ['feature', 'performance', 'security'],
          },
          quality: {
            blockOnFailure: true,
            requireTestsForNewCode: true,
            conventionStrictness: 'strict',
          },
          context: {
            tokenBudget: 600,
            prioritize: 'api-surface-first',
            includeRecentCommits: 10,
          },
          cache: {
            directory: cacheDir,
            maxAgeDays: 7,
          },
        },
        null,
        2,
      ),
    );

    const scan = parseJson(await executeCli(['scan', '--config', configPath]), 'scan');
    assert(
      Array.isArray(scan.repos) && scan.repos.length === 2,
      'scan should emit a digest with 2 repos',
    );
    assert(
      typeof scan.tokenCount === 'number' && scan.tokenCount > 0,
      'scan should emit a positive token count',
    );

    const scanMarkdown = await executeCli(['scan', '--markdown', '--config', configPath]);
    assert(
      scanMarkdown.includes('# OMNI-LINK ECOSYSTEM STATE'),
      'scan --markdown should emit the markdown digest header',
    );
    assert(
      scanMarkdown.includes('## API Contracts'),
      'scan --markdown should include the API contract summary',
    );

    const health = parseJson(await executeCli(['health', '--config', configPath]), 'health');
    assert(typeof health.overall === 'number', 'health should emit an overall numeric score');

    const evolve = parseJson(await executeCli(['evolve', '--config', configPath]), 'evolve');
    assert(Array.isArray(evolve), 'evolve should emit an array');

    writeFile(clientDir, 'src/uncommitted.ts', "export const changed = '/api/users';\n");
    const impact = parseJson(await executeCli(['impact', '--config', configPath]), 'impact');
    assert(Array.isArray(impact), 'impact should emit an array');

    const metrics = {
      repos: scan.repos.length,
      tokenCount: scan.tokenCount,
      markdownLength: scanMarkdown.length,
      overallHealth: health.overall,
      evolutionSuggestions: evolve.length,
      impactPaths: impact.length,
    };

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
  await runCliSmoke();
}
