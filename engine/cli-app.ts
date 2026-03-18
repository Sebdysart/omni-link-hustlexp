import {
  apply,
  authorityStatus,
  evolve,
  health,
  impact,
  impactFromRefs,
  impactFromUncommitted,
  owners,
  publishReview,
  reviewPr,
  rollback,
  scan,
  watch,
} from './index.js';
import { loadConfig, resolveConfigPath } from './config.js';
import { defaultBaseRefForProvider } from './providers/index.js';
import type { OmniLinkConfig } from './types.js';

export const USAGE = `
omni-link — Multi-repo AI ecosystem plugin for Claude Code

Usage:
  omni-link <command> [options]

Commands:
  scan      Full scan: repos -> graph -> context digest
  impact    Analyze cross-repo impact of uncommitted changes
  health    Compute per-repo and ecosystem health scores
  evolve    Generate evolution suggestions (gaps, bottlenecks, upgrades)
  watch     Build or refresh daemon-backed ecosystem state
  owners    Resolve repo ownership assignments
  authority-status Report docs authority drift, contract coverage, and reconciliation guidance
  review-pr Generate a PR review artifact with risk and execution planning
  publish-review Publish the saved PR review artifact through the configured provider transport
  apply     Execute the generated automation plan (bounded by policy)
  rollback  Roll back the last generated automation plan

Options:
  --config <path>         Path to .omni-link.json config file
                          (auto-detects from cwd or ~/.claude/ if omitted)
  --format <json|markdown>  Output format for supported commands
  --markdown              Shortcut for --format markdown
  --base <ref>            Base git ref for PR / branch-aware analysis
  --head <ref>            Head git ref for PR / branch-aware analysis
  --pr <number>           Pull request number for publish-review
  --head-sha <sha>        Explicit commit SHA for provider check publishing
  --simulate <repo:file>  Simulate impact of changing a file (can be repeated)
  --once                  Run a single watch refresh and exit
  --help                  Show this help message

Examples:
  omni-link scan
  omni-link scan --markdown
  omni-link scan --config ./my-config.json
  omni-link health --config /path/to/.omni-link.json
  omni-link evolve
  omni-link impact --base main --head HEAD
  omni-link impact --simulate hustlexp-ai-backend:src/routers/task.ts
  omni-link watch --once
  omni-link review-pr --base main --head HEAD
  omni-link publish-review --pr 42 --base main --head HEAD
`.trim();

export interface CliArgs {
  command: string | undefined;
  configPath: string | undefined;
  outputFormat: 'json' | 'markdown';
  baseRef: string | undefined;
  headRef: string | undefined;
  prNumber: number | undefined;
  headSha: string | undefined;
  simulate: string[];
  once: boolean;
  help: boolean;
}

export interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliDeps {
  apply: typeof apply;
  reviewPr: typeof reviewPr;
  rollback: typeof rollback;
  scan: typeof scan;
  watch: typeof watch;
  owners: typeof owners;
  authorityStatus: typeof authorityStatus;
  publishReview: typeof publishReview;
  impact: typeof impact;
  impactFromRefs: typeof impactFromRefs;
  impactFromUncommitted: typeof impactFromUncommitted;
  health: typeof health;
  evolve: typeof evolve;
  loadConfig: typeof loadConfig;
  resolveConfigPath: typeof resolveConfigPath;
  cwd: () => string;
}

const DEFAULT_IO: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const DEFAULT_DEPS: CliDeps = {
  apply,
  reviewPr,
  rollback,
  scan,
  watch,
  owners,
  authorityStatus,
  publishReview,
  impact,
  impactFromRefs,
  impactFromUncommitted,
  health,
  evolve,
  loadConfig,
  resolveConfigPath,
  cwd: () => process.cwd(),
};

export function parseArgs(argv: string[]): CliArgs {
  let command: string | undefined;
  let configPath: string | undefined;
  let outputFormat: 'json' | 'markdown' = 'json';
  let baseRef: string | undefined;
  let headRef: string | undefined;
  let prNumber: number | undefined;
  let headSha: string | undefined;
  const simulate: string[] = [];
  let once = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--markdown') {
      outputFormat = 'markdown';
      continue;
    }

    if (arg === '--once') {
      once = true;
      continue;
    }

    if (arg === '--format') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --format');
      }
      if (next !== 'json' && next !== 'markdown') {
        throw new Error(`Unsupported format: ${next}`);
      }
      outputFormat = next;
      i++;
      continue;
    }

    if (arg === '--config') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --config');
      }
      configPath = next;
      i++;
      continue;
    }

    if (arg === '--base') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --base');
      }
      baseRef = next;
      i++;
      continue;
    }

    if (arg === '--head') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --head');
      }
      headRef = next;
      i++;
      continue;
    }

    if (arg === '--pr') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --pr');
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid pull request number: ${next}`);
      }
      prNumber = parsed;
      i++;
      continue;
    }

    if (arg === '--head-sha') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --head-sha');
      }
      headSha = next;
      i++;
      continue;
    }

    if (arg === '--simulate') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --simulate');
      }
      if (!next.includes(':')) {
        throw new Error(
          '--simulate value must be in format repo:filepath (e.g., hustlexp-ai-backend:src/routers/task.ts)',
        );
      }
      simulate.push(next);
      i++;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!command) {
      command = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return {
    command,
    configPath,
    outputFormat,
    baseRef,
    headRef,
    prNumber,
    headSha,
    simulate,
    once,
    help,
  };
}

export function resolveCliConfig(
  configPath: string | undefined,
  deps: Pick<CliDeps, 'loadConfig' | 'resolveConfigPath' | 'cwd'> = DEFAULT_DEPS,
): OmniLinkConfig {
  const resolved = configPath ?? deps.resolveConfigPath(deps.cwd());

  if (!resolved) {
    throw new Error(
      'No config file found.\nPlace .omni-link.json in the current directory or ~/.claude/omni-link.json\nOr pass --config <path>',
    );
  }

  return deps.loadConfig(resolved);
}

export async function runCli(
  argv: string[],
  io: CliIo = DEFAULT_IO,
  deps: CliDeps = DEFAULT_DEPS,
): Promise<number> {
  let args: CliArgs;

  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    io.stderr('');
    io.stdout(USAGE);
    return 1;
  }

  if (args.help || argv.length === 0 || !args.command) {
    io.stdout(USAGE);
    return 0;
  }

  try {
    switch (args.command) {
      case 'scan': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.scan(config);
        io.stdout(
          args.outputFormat === 'markdown'
            ? result.context.markdown
            : JSON.stringify(result.context.digest, null, 2),
        );
        return 0;
      }

      case 'impact': {
        const config = resolveCliConfig(args.configPath, deps);
        let result;
        if (args.simulate.length > 0) {
          const changedFiles = args.simulate.map((entry) => {
            const colonIdx = entry.indexOf(':');
            return {
              repo: entry.slice(0, colonIdx),
              file: entry.slice(colonIdx + 1),
              change: 'simulated',
            };
          });
          result = await deps.impact(config, changedFiles);
        } else if (args.baseRef && args.headRef) {
          result = await deps.impactFromRefs(config, args.baseRef, args.headRef);
        } else {
          result = await deps.impactFromUncommitted(config);
        }
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'health': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.health(config);
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'evolve': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.evolve(config);
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'watch': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.watch(config, { once: args.once });
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'owners': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.owners(config);
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'authority-status': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.authorityStatus(config);
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'review-pr': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.reviewPr(
          config,
          args.baseRef ?? defaultBaseRefForProvider(config),
          args.headRef ?? 'HEAD',
        );
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'publish-review': {
        if (!args.prNumber) {
          throw new Error('publish-review requires --pr <number>');
        }
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.publishReview(
          config,
          args.prNumber,
          args.baseRef ?? defaultBaseRefForProvider(config),
          args.headRef ?? 'HEAD',
          args.headSha,
        );
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'apply': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.apply(
          config,
          args.baseRef ?? defaultBaseRefForProvider(config),
          args.headRef ?? 'HEAD',
        );
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'rollback': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.rollback(config);
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      default:
        io.stderr(`Unknown command: ${args.command}`);
        io.stderr('');
        io.stdout(USAGE);
        return 1;
    }
  } catch (error) {
    if (error instanceof Error) {
      io.stderr(`Error: ${error.message}`);
      if ('repoId' in error && typeof (error as Record<string, unknown>).repoId === 'string') {
        io.stderr(`  Repo: ${(error as Record<string, unknown>).repoId}`);
      }
      if ('phase' in error && typeof (error as Record<string, unknown>).phase === 'string') {
        io.stderr(`  Phase: ${(error as Record<string, unknown>).phase}`);
      }
      if ('field' in error && typeof (error as Record<string, unknown>).field === 'string') {
        io.stderr(`  Field: ${(error as Record<string, unknown>).field}`);
      }
      if (
        'suggestion' in error &&
        typeof (error as Record<string, unknown>).suggestion === 'string'
      ) {
        io.stderr(`  Suggestion: ${(error as Record<string, unknown>).suggestion}`);
      }
      if (error.message.includes('ENOENT')) {
        io.stderr('  Hint: check that the repo path in your config exists on disk');
      }
      if (error.message.includes('config')) {
        io.stderr('  Hint: validate your config with the Zod schema or check .omni-link.json');
      }
    } else {
      io.stderr(String(error));
    }
    if (error instanceof Error && error.name === 'ConfigError') return 2;
    if (error instanceof Error && error.name === 'PathTraversalError') return 2;
    if (error instanceof Error && error.name === 'ScanError') return 3;
    return 1;
  }
}
