import {
  apply,
  evolve,
  health,
  impactFromRefs,
  impactFromUncommitted,
  owners,
  reviewPr,
  rollback,
  scan,
  watch,
} from './index.js';
import { loadConfig, resolveConfigPath } from './config.js';
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
  review-pr Generate a PR review artifact with risk and execution planning
  apply     Execute the generated automation plan (bounded by policy)
  rollback  Roll back the last generated automation plan

Options:
  --config <path>         Path to .omni-link.json config file
                          (auto-detects from cwd or ~/.claude/ if omitted)
  --format <json|markdown>  Output format for supported commands
  --markdown              Shortcut for --format markdown
  --base <ref>            Base git ref for PR / branch-aware analysis
  --head <ref>            Head git ref for PR / branch-aware analysis
  --once                  Run a single watch refresh and exit
  --help                  Show this help message

Examples:
  omni-link scan
  omni-link scan --markdown
  omni-link scan --config ./my-config.json
  omni-link health --config /path/to/.omni-link.json
  omni-link evolve
  omni-link impact --base main --head HEAD
  omni-link watch --once
  omni-link review-pr --base main --head HEAD
`.trim();

export interface CliArgs {
  command: string | undefined;
  configPath: string | undefined;
  outputFormat: 'json' | 'markdown';
  baseRef: string | undefined;
  headRef: string | undefined;
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

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!command) {
      command = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return { command, configPath, outputFormat, baseRef, headRef, once, help };
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
        const result =
          args.baseRef && args.headRef
            ? await deps.impactFromRefs(config, args.baseRef, args.headRef)
            : await deps.impactFromUncommitted(config);
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

      case 'review-pr': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.reviewPr(
          config,
          args.baseRef ?? config.github?.defaultBaseBranch ?? 'main',
          args.headRef ?? 'HEAD',
        );
        io.stdout(JSON.stringify(result, null, 2));
        return 0;
      }

      case 'apply': {
        const config = resolveCliConfig(args.configPath, deps);
        const result = await deps.apply(
          config,
          args.baseRef ?? config.github?.defaultBaseBranch ?? 'main',
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
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
