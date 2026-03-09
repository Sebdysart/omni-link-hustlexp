# omni-link-hustlexp

**HustleXP-tailored multi-repo engineering control plane for Claude Code** -- docs authority ingestion, Swift↔tRPC bridge analysis, phase-drift gating, bounded automation, and branch-aware review workflows across the HustleXP iOS, backend, and docs repos.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![Verification](https://img.shields.io/badge/verify:stress-passing-brightgreen.svg)](#verification)
[![Tests](https://img.shields.io/badge/tests-488%2B4_live-brightgreen.svg)](#verification)

## What it does

This fork starts from upstream `omni-link` and narrows it around one operating model:

- `HUSTLEXPFINAL1` as the Swift/iOS consumer
- `hustlexp-ai-backend` as the tRPC/API provider
- `HUSTLEXP-DOCS` as the authority/governance repo

It still preserves the upstream command surface, but the `hustlexp` workflow profile adds project-specific truth sources that upstream generic scanning cannot infer reliably.

In max-tier HustleXP mode, the fork behaves like a local-first control plane for this exact topology:

- It keeps warm state in a SQLite-backed daemon instead of rescanning everything on every command.
- It treats the docs repo as an authority source instead of just another Markdown tree.
- It extracts Swift client `trpc.call(router: ..., procedure: ...)` usage and correlates it with backend procedures under `backend/src`.
- It detects phase drift between docs, backend, and iOS code before execution is allowed.
- It combines parser coverage with compiler-backed semantic analysis for TypeScript, Go, Python, Java, and Swift, plus AST-backed GraphQL analysis.
- It generates branch-aware review artifacts with risk, owners, policy decisions, and rollback-aware execution plans.
- It publishes or replays provider-native review output for GitHub with live metadata negotiation and idempotent comment updates.
- It keeps automation bounded: branch and PR oriented, policy gated, and auditable.

## Why it is different

- **Cross-repo truth, not single-repo guesses** -- omni-link reasons over the ecosystem graph, not just one working directory.
- **Semantic where it matters** -- compiler-backed analysis is used where available, with structured fallback where necessary.
- **Operationally safe** -- direct protected-branch mutation is blocked, execution is policy-gated, and rollback plans are always generated.
- **Provider-aware** -- GitHub and GitLab publishing is capability-aware, metadata-aware, and proven against live sandbox PR/MR targets.
- **Proven, not hypothetical** -- the repo ships with contract fixtures, smoke tests, stress tests, packaged-install tests, and live-provider gates.

## Features

- **HustleXP workflow profile** -- one config flag turns on authority ingestion, Swift↔tRPC bridge analysis, path exclusions, ownership defaults, policy defaults, and daemon defaults for the three-repo HustleXP workspace.
- **Docs authority layer** -- parses `CURRENT_PHASE.md`, `FINISHED_STATE.md`, `FEATURE_FREEZE.md`, `AI_GUARDRAILS.md`, `API_CONTRACT.md`, and `schema.sql` into first-class authority state.
- **Swift↔tRPC bridge** -- correlates Swift client calls, backend procedures, and docs authority so stale calls, missing procedures, and undocumented endpoints are surfaced explicitly.
- **Authority drift findings** -- reconciliation mode allows scan/review while blocking `apply`; strict mode turns unresolved authority drift into a hard policy gate.
- **Hybrid truth layer** -- Tree-sitter fallback plus compiler-backed TypeScript, Go, Python, Java, and Swift analyzers, plus GraphQL AST analysis with provenance and confidence.
- **Branch-aware daemon state** -- SQLite-backed warm graph snapshots keyed by config and branch/worktree signature.
- **Cross-repo API and type graphing** -- Routes, procedures, contracts, imports, symbol references, type lineage, dependency edges, and impact paths.
- **Runtime-aware ranking** -- Coverage, test, OpenAPI, GraphQL, telemetry, and trace artifacts can influence health and prioritization.
- **Ownership and policy engine** -- Repo, path, API, and package-level ownership plus protected-branch and risk gating.
- **Review artifact pipeline** -- `review-pr` emits risk, owners, policy decisions, contract mismatches, and execution plans.
- **Provider publishing** -- `publish-review` supports dry-run, replay, GitHub, and GitLab transports with capability negotiation and live metadata hydration.
- **Idempotent provider comments** -- repeated publish runs update the existing omni-link review comment instead of spraying duplicates.
- **Bounded execution** -- `apply` and `rollback` stay branch-oriented, emit rollback plans, and now produce an execution ledger for auditability.
- **Contract-locked CLI surface** -- JSON and markdown outputs are pinned by fixture tests so public command drift is deliberate.
- **Packaged artifact validation** -- the built tarball is installed into a temp project and exercised from `node_modules`.
- **Polyglot stress coverage** -- the comprehensive stress harness exercises TypeScript, Go, Python, GraphQL, Java, and Swift together.

## HustleXP workflow

The tailored fork is opinionated on purpose.

- The docs repo is treated as the authority layer.
- The backend repo is treated as the provider surface rooted at `backend/src`.
- The iOS repo is treated as the consumer surface.
- Default excludes suppress noisy nested copies, screenshots, archives, mocks, and legacy trees.
- Default automation posture is dry-run first, with `apply` blocked while authority drift is unresolved.

The result is a review surface that answers the questions the generic scanner could not answer well enough for HustleXP:

- Does iOS call a backend procedure that no longer exists?
- Does the backend expose a procedure that the docs never declared?
- Do the docs still claim bootstrap while the product is clearly beyond bootstrap?
- Is a proposed change blocked because the authority layer has not been reconciled yet?

## Verification

The current repository state is validated by `npm run verify:stress`, which includes lint, typecheck, unit/integration tests, coverage, build, CLI smoke, max-tier smoke, contract fixtures, package-install smoke, full stress, and live-provider gates when credentials are configured.

The tailored fork also adds `npm run verify:hustlexp`, which explicitly reruns the HustleXP-specific bars:

- docs-authority parsing
- Swift↔tRPC bridge extraction and mismatch detection
- phase-drift enforcement
- HustleXP fixture integration from `scan` through blocked `apply`

Current proof points from the verified state:

- `488` core tests passing, plus live GitHub and GitLab provider tests executed in sandbox PR/MR flows
- `90.6%` statement coverage
- `0` moderate-or-higher audit vulnerabilities
- Live GitHub and GitLab metadata fetch plus publish validated through sandbox review targets
- Cleanup verified: sandbox PRs/MRs are closed and temporary branches are deleted
- Polyglot stress harness validated across `8` repos and `6` languages in one engine run

## Installation

### From the marketplace

```bash
claude plugin install omni-link-hustlexp
```

### Manual installation

```bash
git clone https://github.com/Sebdysart/omni-link-hustlexp.git
cd omni-link-hustlexp
npm install
npm run build
```

## Configuration

For the tailored fork, start from [config/hustlexp.local.example.json](/Users/sebastiandysart/omni-link-hustlexp/config/hustlexp.local.example.json) and keep the absolute paths machine-local. The important part is the `workflowProfile: "hustlexp"` switch, because that activates the authority layer, Swift↔tRPC bridge, default exclusions, ownership defaults, and safer automation posture.

Create a `.omni-link.json` in your project root or `~/.claude/omni-link-hustlexp.json` for global config:

```json
{
  "workflowProfile": "hustlexp",
  "simulateOnly": true,
  "reviewProvider": "github",
  "repos": [
    {
      "name": "hustlexp-ios",
      "path": "/absolute/path/to/HUSTLEXPFINAL1",
      "language": "swift",
      "role": "ios-client"
    },
    {
      "name": "hustlexp-backend",
      "path": "/absolute/path/to/hustlexp-ai-backend",
      "language": "typescript",
      "role": "backend-api"
    },
    {
      "name": "hustlexp-docs",
      "path": "/absolute/path/to/HUSTLEXP-DOCS",
      "language": "javascript",
      "role": "product-governance"
    }
  ],
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
    "directory": "/absolute/path/to/.cache/omni-link-hustlexp",
    "maxAgeDays": 7
  },
  "daemon": {
    "enabled": true,
    "preferDaemon": true,
    "statePath": "/absolute/path/to/.cache/omni-link-hustlexp/state.sqlite"
  },
  "authority": {
    "enabled": true,
    "docsRepo": "/absolute/path/to/HUSTLEXP-DOCS",
    "phaseMode": "reconciliation",
    "authorityFiles": {
      "currentPhase": "CURRENT_PHASE.md",
      "finishedState": "FINISHED_STATE.md",
      "featureFreeze": "FEATURE_FREEZE.md",
      "aiGuardrails": "AI_GUARDRAILS.md",
      "apiContract": "specs/04-backend/API_CONTRACT.md",
      "schema": "specs/02-architecture/schema.sql"
    }
  },
  "bridges": {
    "swiftTrpc": {
      "enabled": true,
      "iosRepo": "/absolute/path/to/HUSTLEXPFINAL1",
      "backendRepo": "/absolute/path/to/hustlexp-ai-backend",
      "clientCallPattern": "trpc\\\\.call\\\\(router:\\\\s*\"(?<router>[A-Za-z_][A-Za-z0-9_]*)\"\\\\s*,\\\\s*procedure:\\\\s*\"(?<procedure>[A-Za-z_][A-Za-z0-9_]*)\"\\\\s*\\\\)",
      "authoritativeBackendRoot": "backend/src"
    }
  },
  "ownership": {
    "enabled": true,
    "defaultOwner": "platform"
  },
  "runtime": {
    "enabled": true,
    "coverageSummaryPath": "/absolute/path/to/hustlexp-ai-backend/coverage/coverage-summary.json",
    "testResultsPath": "/absolute/path/to/hustlexp-ai-backend/artifacts/test-results.json"
  },
  "policies": {
    "enabled": true,
    "protectedBranches": ["main"],
    "requiredChecks": [
      "ios-build",
      "ios-tests",
      "backend-typecheck",
      "backend-tests",
      "docs-authority-check",
      "contract-sync"
    ],
    "maxAllowedRisk": "medium",
    "forbidDirectMainMutation": true,
    "forbidDestructiveChanges": true
  }
}
```

### Config options

| Section     | Key                        | Values                                                                                | Default                        | Description                                                     |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| root        | `workflowProfile`          | `hustlexp`                                                                            | unset                          | Activates the HustleXP preset for authority, bridge, and policy |
| root        | `reviewProvider`           | `github`                                                                              | `github`                       | Active publish target for the tailored fork                     |
| `repos[]`   | `name`                     | string                                                                                | --                             | Unique repo identifier                                          |
| `repos[]`   | `path`                     | string                                                                                | --                             | Absolute path to repo root                                      |
| `repos[]`   | `language`                 | `typescript`, `tsx`, `swift`, `python`, `go`, `rust`, `java`, `javascript`, `graphql` | --                             | Primary language                                                |
| `repos[]`   | `role`                     | `ios-client`, `backend-api`, `product-governance`, or another string                  | --                             | Repo role used by the workflow preset                           |
| `repos[]`   | `exclude`                  | string array                                                                          | preset by role                 | Extra ignore globs for noisy or non-authoritative paths         |
| `authority` | `enabled` / `docsRepo`     | boolean + string                                                                      | enabled in profile             | Turns docs authority parsing on and points it at the docs repo  |
| `authority` | `phaseMode`                | `reconciliation`, `strict`                                                            | `reconciliation`               | Reconciliation reports drift; strict blocks review and execute  |
| `authority` | `authorityFiles`           | path map                                                                              | HustleXP defaults              | Relative locations for phase, freeze, guardrails, API, schema   |
| `bridges`   | `swiftTrpc`                | object                                                                                | enabled in profile             | Swift client call extraction and backend correlation            |
| `quality`   | `blockOnFailure`           | boolean                                                                               | `true`                         | Whether quality violations block output                         |
| `quality`   | `requireTestsForNewCode`   | boolean                                                                               | `true`                         | Require test coverage for new code                              |
| `quality`   | `conventionStrictness`     | `strict`, `moderate`, `relaxed`                                                       | `strict`                       | How strictly to enforce conventions                             |
| `context`   | `tokenBudget`              | number                                                                                | `8000`                         | Max tokens for context digest                                   |
| `context`   | `prioritize`               | `changed-files-first`, `api-surface-first`                                            | `api-surface-first` in profile | What to prioritize in digest                                    |
| `context`   | `includeRecentCommits`     | number                                                                                | `20`                           | How many recent commits to include                              |
| `cache`     | `directory`                | string                                                                                | machine-local                  | Cache directory path                                            |
| `cache`     | `maxAgeDays`               | number                                                                                | `7`                            | Cache TTL in days                                               |
| `daemon`    | `enabled` / `preferDaemon` | booleans                                                                              | `true` in profile              | Enable warm graph state and prefer daemon-backed reads          |
| `daemon`    | `statePath`                | string                                                                                | cache-relative path            | Persistent SQLite daemon state file                             |
| `github`    | `owner` / `repo`           | strings                                                                               | unset                          | Provider target used by `publish-review`                        |
| `github`    | `publishMode`              | `dry-run`, `replay`, `github`                                                         | `replay` in profile            | Choose provider publish behavior                                |
| `ownership` | `defaultOwner` / `rules[]` | owner mappings by repo, path, API, or package                                         | enabled in profile             | Resolve ownership across repos and domains                      |
| `runtime`   | artifact paths             | strings                                                                               | disabled                       | Ingest coverage, test, telemetry, and trace artifacts           |
| `policies`  | branch/risk rules          | arrays + booleans + risk threshold                                                    | strict HustleXP defaults       | Gate execution and protected-branch behavior                    |
| `maxTier`   | semantic / execution flags | booleans + thresholds                                                                 | enabled in profile             | Enable semantic accuracy and max-tier platform modules          |

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

| Command           | Description                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `/scan`           | Force a full ecosystem rescan across all configured repos              |
| `/impact`         | Analyze cross-repo impact of uncommitted changes or branch diffs       |
| `/health`         | Run a full ecosystem health audit with per-repo scores                 |
| `/evolve`         | Generate ranked evolution suggestions with evidence                    |
| `/watch`          | Refresh or maintain daemon-backed ecosystem state                      |
| `/owners`         | Resolve ownership assignments across repos and APIs                    |
| `/review-pr`      | Generate a PR review artifact with risk, owners, and execution plan    |
| `/publish-review` | Publish or replay provider comments/checks for a saved review artifact |
| `/apply`          | Apply the bounded execution plan on generated branches/PRs             |
| `/rollback`       | Roll back the last generated execution plan                            |

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
npm run verify:stress
npm run verify:hustlexp
```

`verify:stress` is the release bar. `verify:hustlexp` is the focused workflow bar for the tailored fork. It reruns upstream verification and then explicitly revalidates the authority layer, Swift↔tRPC bridge, phase-drift rules, and blocked-apply behavior on the HustleXP fixture workspace.

### CLI smoke test

```bash
npm run smoke:cli
npm run smoke:max
npm run stress:full
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
node dist/cli.js publish-review --pr 42 --base main --head HEAD --config .omni-link.json
node dist/cli.js apply --base main --head HEAD --config .omni-link.json
node dist/cli.js rollback --config .omni-link.json
```

In live provider mode, `publish-review` fetches GitHub PR metadata before publishing so the fork can resolve missing head SHAs, detect closed or merged review targets, and trim provider payloads before comments or checks are emitted.

### Releases

Create a git tag like `v1.0.0` and push it to trigger the release workflow. The workflow rebuilds, reruns verification, creates an `npm pack` artifact, and publishes a GitHub release with generated notes.

### Project structure

```
omni-link-hustlexp/
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
  tests/            # Test suite, including HustleXP authority/bridge/profile coverage
    scanner/        # Scanner unit tests
    grapher/        # Grapher unit tests
    context/        # Context engine tests
    quality/        # Quality gate tests
    evolution/      # Evolution engine tests
    providers/      # Provider replay and live integration tests
    integration/    # End-to-end integration tests
  scripts/          # Smoke, contract, package-install, and full stress harnesses
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
