# omni-link

**Multi-repo AI ecosystem plugin for Claude Code** -- cross-repo grounding, anti-slop enforcement, and proactive business evolution.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-277%2B-brightgreen.svg)](#development)

## What it does

omni-link scans up to 10 repositories, builds an ecosystem graph of API contracts, shared types, and cross-repo dependencies, then injects a compact context digest into every Claude Code session. It enforces quality gates that **block** hallucinated imports, wrong conventions, and placeholder code -- and proactively surfaces business evolution opportunities backed by codebase evidence.

## Features

- **Multi-repo scanning** -- Tree-sitter-powered parsing of TypeScript, TSX, Swift, Python, Go, Rust, Java, JavaScript, and GraphQL-aware file detection
- **API contract mapping** -- Detects routes, tRPC procedures, and consumer references across repos
- **Type lineage tracking** -- Finds shared concepts (e.g., `User` in backend, `UserDTO` in iOS) via name matching and field similarity
- **Semantic accuracy layer** -- Optional TypeScript compiler-backed analysis overlays parser results with provenance and confidence
- **Contract mismatch detection** -- Identifies breaking, warning, and info-level type divergences
- **Context digest** -- Token-budgeted markdown summary injected at session start with Mermaid architecture diagrams
- **Ignore-aware scanning** -- Honors `.gitignore` and `.claudeignore` during repo walks
- **Anti-slop gate** -- Blocks hallucinated imports, unknown packages, wrong conventions, and placeholder code
- **Convention enforcement** -- Detects and enforces naming, file organization, error handling, and testing patterns
- **Evolution engine** -- Gap analysis, bottleneck detection, competitive benchmarking, and ranked upgrade proposals
- **Impact analysis** -- Traces ripple effects of changes across the entire ecosystem
- **Health scoring** -- Per-repo and overall ecosystem health metrics
- **Ownership and policy engine** -- Resolves owners, evaluates branch/risk policies, and gates bounded execution
- **Daemon-backed watch mode** -- Maintains warm ecosystem state for faster repeated analysis
- **PR review artifacts** -- Generates branch-aware review output with risk, impact, owners, and execution planning
- **Bounded automation** -- Produces branch/PR-oriented execution plans with rollback instructions and dry-run defaults

## Installation

### From the marketplace

```bash
claude plugin install omni-link
```

### Manual installation

```bash
git clone https://github.com/Sebdysart/omni-link.git
cd omni-link
npm install
npm run build
```

## Configuration

Create a `.omni-link.json` in your project root or `~/.claude/omni-link.json` for global config:

```json
{
  "repos": [
    {
      "name": "my-backend",
      "path": "/path/to/backend",
      "language": "typescript",
      "role": "backend"
    },
    {
      "name": "my-ios-app",
      "path": "/path/to/ios",
      "language": "swift",
      "role": "ios"
    }
  ],
  "evolution": {
    "aggressiveness": "aggressive",
    "maxSuggestionsPerSession": 5,
    "categories": ["feature", "performance", "monetization", "scale", "security"]
  },
  "quality": {
    "blockOnFailure": true,
    "requireTestsForNewCode": true,
    "conventionStrictness": "strict"
  },
  "context": {
    "tokenBudget": 8000,
    "prioritize": "changed-files-first",
    "includeRecentCommits": 20
  },
  "cache": {
    "directory": "~/.claude/omni-link-cache",
    "maxAgeDays": 7
  },
  "daemon": {
    "enabled": true,
    "preferDaemon": true,
    "statePath": "~/.claude/omni-link-daemon-state.sqlite"
  },
  "ownership": {
    "enabled": true,
    "defaultOwner": "platform-team",
    "rules": [{ "owner": "backend-team", "kind": "team", "scope": "repo", "repo": "my-backend" }]
  },
  "runtime": {
    "enabled": true,
    "coverageSummaryPath": "coverage/coverage-summary.json",
    "testResultsPath": "test-results.json"
  },
  "policies": {
    "enabled": true,
    "protectedBranches": ["main"],
    "maxAllowedRisk": "high",
    "forbidDirectMainMutation": true
  },
  "maxTier": {
    "enabled": true,
    "semanticAnalysis": {
      "enabled": true,
      "preferSemantic": true
    }
  }
}
```

### Config options

| Section     | Key                        | Values                                                                                | Default                     | Description                                                  |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| `repos[]`   | `name`                     | string                                                                                | --                          | Unique repo identifier                                       |
| `repos[]`   | `path`                     | string                                                                                | --                          | Absolute path to repo root                                   |
| `repos[]`   | `language`                 | `typescript`, `tsx`, `swift`, `python`, `go`, `rust`, `java`, `javascript`, `graphql` | --                          | Primary language                                             |
| `repos[]`   | `role`                     | string                                                                                | --                          | Repo's role in the ecosystem (e.g., `backend`, `ios`, `web`) |
| `evolution` | `aggressiveness`           | `aggressive`, `moderate`, `on-demand`                                                 | `aggressive`                | How proactively to surface suggestions                       |
| `evolution` | `maxSuggestionsPerSession` | number                                                                                | `5`                         | Cap on evolution suggestions per session                     |
| `evolution` | `categories`               | array of strings                                                                      | all 5                       | Which categories to include                                  |
| `quality`   | `blockOnFailure`           | boolean                                                                               | `true`                      | Whether quality violations block output                      |
| `quality`   | `requireTestsForNewCode`   | boolean                                                                               | `true`                      | Require test coverage for new code                           |
| `quality`   | `conventionStrictness`     | `strict`, `moderate`, `relaxed`                                                       | `strict`                    | How strictly to enforce conventions                          |
| `context`   | `tokenBudget`              | number                                                                                | `8000`                      | Max tokens for context digest                                |
| `context`   | `prioritize`               | `changed-files-first`, `api-surface-first`                                            | `changed-files-first`       | What to prioritize in digest                                 |
| `context`   | `includeRecentCommits`     | number                                                                                | `20`                        | How many recent commits to include                           |
| `cache`     | `directory`                | string                                                                                | `~/.claude/omni-link-cache` | Cache directory path                                         |
| `cache`     | `maxAgeDays`               | number                                                                                | `7`                         | Cache TTL in days                                            |
| `daemon`    | `enabled` / `preferDaemon` | booleans                                                                              | `false`                     | Enable warm graph state and prefer daemon-backed reads       |
| `daemon`    | `statePath`                | string                                                                                | cache-relative path         | Persistent SQLite daemon state file                          |
| `ownership` | `defaultOwner` / `rules[]` | owner mappings by repo, path, API, or package                                         | disabled                    | Resolve ownership across repos and API surfaces              |
| `runtime`   | artifact paths             | strings                                                                               | disabled                    | Ingest coverage, test, OpenAPI, GraphQL, telemetry artifacts |
| `policies`  | branch/risk rules          | arrays + booleans + risk threshold                                                    | disabled                    | Gate execution and protected-branch behavior                 |
| `maxTier`   | semantic / execution flags | booleans + thresholds                                                                 | disabled                    | Enable semantic accuracy and max-tier platform modules       |

## Skills

Skills are contextual instructions that guide Claude Code's behavior within the omni-link ecosystem.

| Skill                  | Trigger                     | Purpose                                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| `using-omni-link`      | Session start               | Meta skill defining iron laws, skill registry, and aggressive evolution posture   |
| `ecosystem-grounding`  | Session start, after rescan | Ground Claude in current ecosystem state: repos, contracts, mismatches            |
| `anti-slop-gate`       | Code generation             | Block hallucinated imports, unknown packages, wrong conventions, placeholder code |
| `convention-enforcer`  | Code generation             | Enforce naming, file organization, error handling, and testing conventions        |
| `cross-repo-impact`    | Before API/schema changes   | Analyze ripple effects of changes across all configured repositories              |
| `dependency-navigator` | On demand                   | Trace dependency chains, answer "Where is X used?" across repos                   |
| `ecosystem-planner`    | Multi-repo feature planning | Plan task ordering, coordination points, and contract validation checkpoints      |
| `health-audit`         | On demand                   | Produce per-repo and overall health scores with actionable recommendations        |
| `business-evolution`   | Session start, `/evolve`    | Surface business improvement opportunities backed by codebase evidence            |
| `upgrade-executor`     | Multi-repo changes          | Orchestrate provider-first ordering, contract validation, and rollback planning   |

## Commands

Commands are slash commands available in Claude Code.

| Command      | Description                                                         |
| ------------ | ------------------------------------------------------------------- |
| `/scan`      | Force a full ecosystem rescan across all configured repos           |
| `/impact`    | Analyze cross-repo impact of uncommitted changes or branch diffs    |
| `/health`    | Run a full ecosystem health audit with per-repo scores              |
| `/evolve`    | Generate ranked evolution suggestions with evidence                 |
| `/watch`     | Refresh or maintain daemon-backed ecosystem state                   |
| `/owners`    | Resolve ownership assignments across repos and APIs                 |
| `/review-pr` | Generate a PR review artifact with risk, owners, and execution plan |
| `/apply`     | Apply the bounded execution plan on generated branches/PRs          |
| `/rollback`  | Roll back the last generated execution plan                         |

## Agents

Specialized agents for focused analysis tasks.

| Agent                  | Description                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `repo-analyst`         | Deep-dive single-repo analysis: structure, dependencies, dead code, test coverage, health             |
| `cross-repo-reviewer`  | Reviews changes for cross-repo safety: API contracts, type lineage, dependency compatibility          |
| `evolution-strategist` | CTO/product strategist perspective: industry best practices, competitive analysis, strategic roadmaps |

## Architecture

omni-link is built as a layered pipeline:

```
.omni-link.json
     |
     v
+-----------+     +----------+     +---------+     +-----------+     +----------+
|  Scanner  | --> | Grapher  | --> | Context | --> |  Quality  | --> | Evolution|
+-----------+     +----------+     +---------+     +-----------+     +----------+
```

### Engine layers

1. **Scanner** (`engine/scanner/`) -- Tree-sitter-powered parsing that walks each repo and extracts exports, routes, tRPC procedures, types, schemas, conventions, dependencies, and git state into a `RepoManifest`.

2. **Grapher** (`engine/grapher/`) -- Cross-repo analysis that builds an `EcosystemGraph` from all manifests: API bridges (provider/consumer connections), type lineage (shared concepts across repos), contract mismatches, dependency graphs, and impact paths.

3. **Context** (`engine/context/`) -- Token-budgeted context generation: prunes the ecosystem graph to fit within the configured token budget, formats a human-readable digest, and manages scan caching.

4. **Quality** (`engine/quality/`) -- Enforcement layer with four gates: reference checker (validates imports and symbols), convention validator (naming, organization, patterns), slop detector (placeholder code, hallucinations), and health scorer (per-repo and overall scores).

5. **Evolution** (`engine/evolution/`) -- Business intelligence: gap analyzer (incomplete CRUD, dead exports, orphaned schemas), bottleneck finder (pagination, caching, rate-limiting), competitive benchmarker (best practices comparison), and upgrade proposer (ranked suggestions with evidence).

### Key types

- `RepoManifest` -- Complete snapshot of a single repo's code structure
- `EcosystemGraph` -- Cross-repo relationship graph with bridges, types, and mismatches
- `EcosystemDigest` -- Token-budgeted summary for session injection
- `EvolutionSuggestion` -- Ranked improvement proposal with evidence and effort estimates

## Compatibility

omni-link works alongside Claude Code Superpowers and other plugins without conflicts. It operates through standard plugin extension points (skills, commands, agents, hooks) and does not modify Claude Code's core behavior.

## Development

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

### Run coverage

```bash
npm run test:coverage
```

### Run tests in watch mode

```bash
npm run test:watch
```

### Type check

```bash
npm run lint
npm run format:check
```

### Full verification

```bash
npm run verify
npm run verify:max
```

### CLI smoke test

```bash
npm run smoke:cli
npm run smoke:max
```

### CLI

```bash
node dist/cli.js --help
node dist/cli.js scan --config .omni-link.json
node dist/cli.js scan --markdown --config .omni-link.json
node dist/cli.js health --config .omni-link.json
node dist/cli.js evolve --config .omni-link.json
node dist/cli.js impact --config .omni-link.json
node dist/cli.js watch --once --config .omni-link.json
node dist/cli.js owners --config .omni-link.json
node dist/cli.js review-pr --base main --head HEAD --config .omni-link.json
node dist/cli.js apply --base main --head HEAD --config .omni-link.json
node dist/cli.js rollback --config .omni-link.json
```

### Releases

Create a git tag like `v1.0.0` and push it to trigger the release workflow. The workflow rebuilds, reruns verification, creates an `npm pack` artifact, and publishes a GitHub release with generated notes.

### Project structure

```
omni-link/
  engine/           # Core TypeScript engine
    scanner/        # Tree-sitter parsing, extraction
    grapher/        # Cross-repo graph building
    context/        # Token pruning, digest formatting, caching
    quality/        # Reference checking, convention validation, slop detection
    evolution/      # Gap analysis, bottlenecks, benchmarking, upgrades
    types.ts        # Core type definitions
    config.ts       # Configuration loader
    index.ts        # Pipeline orchestrator
    cli.ts          # CLI entry point
  skills/           # 10 Claude Code skills
  commands/         # Slash command docs
  agents/           # 3 specialized agents
  hooks/            # Session-start hook
  tests/            # Test suite (277+ tests)
    scanner/        # Scanner unit tests
    grapher/        # Grapher unit tests
    context/        # Context engine tests
    quality/        # Quality gate tests
    evolution/      # Evolution engine tests
    integration/    # End-to-end integration tests
  .claude-plugin/   # Plugin manifest
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure `npm test` passes
5. Submit a pull request

## License

MIT
