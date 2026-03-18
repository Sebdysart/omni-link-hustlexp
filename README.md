# omni-link-hustlexp

**HustleXP-tailored multi-repo engineering control plane for Claude Code** — docs authority ingestion, Swift↔tRPC bridge analysis, phase-drift gating, bounded automation, branch-aware review workflows, and multi-agent orchestration across the HustleXP iOS, backend, and docs repos.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![CI](https://github.com/Sebdysart/omni-link-hustlexp/actions/workflows/ci.yml/badge.svg)](https://github.com/Sebdysart/omni-link-hustlexp/actions)
[![Tests](https://img.shields.io/badge/tests-773_pass_0_fail-brightgreen.svg)](#verification)

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
- It provides structured multi-agent orchestration with handoff protocols, MCP message bus, and Agent Teams bridge.

## Why it is different

- **Cross-repo truth, not single-repo guesses** — omni-link reasons over the ecosystem graph, not just one working directory.
- **Semantic where it matters** — compiler-backed analysis is used where available, with structured fallback where necessary.
- **Operationally safe** — direct protected-branch mutation is blocked, execution is policy-gated, and rollback plans are always generated.
- **Provider-aware** — GitHub and GitLab publishing is capability-aware, metadata-aware, and proven against live sandbox PR/MR targets.
- **Production-hardened** — structured error types, partial failure resilience, git operation timeouts, path traversal prevention, and explicit cache invalidation API.
- **Multi-agent ready** — structured handoff protocol, MCP communication bus, Agent Teams bridge, error recovery triage, and shared memory bulletin board.
- **Proven, not hypothetical** — 773 tests passing across unit, integration, E2E lifecycle, smoke, stress, and contract fixture suites.

## Features

- **HustleXP workflow profile** — one config flag turns on authority ingestion, Swift↔tRPC bridge analysis, path exclusions, ownership defaults, policy defaults, and daemon defaults for the three-repo HustleXP workspace.
- **Docs authority layer** — parses `CURRENT_PHASE.md`, `FINISHED_STATE.md`, `FEATURE_FREEZE.md`, `AI_GUARDRAILS.md`, `API_CONTRACT.md`, and `schema.sql` into first-class authority state.
- **Swift↔tRPC bridge** — correlates Swift client calls, backend procedures, and docs authority so stale calls, missing procedures, and undocumented endpoints are surfaced explicitly.
- **Type-level bridge checks** — compares Swift request/response models against docs contract shapes so payload drift is surfaced instead of only endpoint drift.
- **Authority drift findings** — reconciliation mode allows scan/review while blocking `apply`; strict mode turns unresolved authority drift into a hard policy gate.
- **Authority reconciliation command** — `authority-status` reports phase drift, docs/backend/Swift coverage gaps, payload drift, and the next reconciliation actions.
- **Hybrid truth layer** — Tree-sitter fallback plus compiler-backed TypeScript, Go, Python, Java, and Swift analyzers, plus GraphQL AST analysis with provenance and confidence.
- **Branch-aware daemon state** — SQLite-backed warm graph snapshots keyed by config and branch/worktree signature, with corruption recovery.
- **Cross-repo API and type graphing** — Routes, procedures, contracts, imports, symbol references, type lineage, dependency edges, and impact paths.
- **Runtime-aware ranking** — Coverage, test, OpenAPI, GraphQL, telemetry, and trace artifacts can influence health and prioritization.
- **Ownership and policy engine** — Repo, path, API, and package-level ownership plus protected-branch and risk gating.
- **Review artifact pipeline** — `review-pr` emits risk, owners, policy decisions, contract mismatches, and execution plans.
- **Provider publishing** — `publish-review` supports dry-run, replay, GitHub, and GitLab transports with capability negotiation and live metadata hydration.
- **Bounded execution** — `apply` and `rollback` stay branch-oriented, emit rollback plans, and produce an execution ledger for auditability.
- **Structured error handling** — `ScanError`, `ConfigError`, and `PathTraversalError` with repo/phase/field context for actionable diagnostics.
- **Partial failure resilience** — `Promise.allSettled` scanning so one broken repo doesn't crash the entire pipeline.
- **Cache invalidation API** — `invalidateScanCache()`, `clearScanCache()`, and `scan(config, { bypassCache: true })` for explicit cache control.
- **Multi-agent orchestration** — Structured handoff protocol, Agent Teams bridge, MCP communication bus, error recovery triage, and shared bulletin board.
- **Contract-locked CLI surface** — JSON and markdown outputs are pinned by fixture tests so public command drift is deliberate.
- **Packaged artifact validation** — the built tarball is installed into a temp project and exercised from `node_modules`.
- **Polyglot stress coverage** — the comprehensive stress harness exercises TypeScript, Go, Python, GraphQL, Java, and Swift together.

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

## Claude Operating Playbook

If Claude Code is using this fork correctly, it should behave in this order:

1. Start the daemon-backed view of the workspace.
2. Read authority state before attempting code mutation.
3. Treat docs drift, backend drift, and consumer drift as separate queues.
4. Keep `simulateOnly` enabled until the affected slice is reconciled.
5. Use `review-pr` before `apply`, not after.

Recommended command order:

```bash
omni-link-hustlexp watch --once
omni-link-hustlexp authority-status
omni-link-hustlexp scan --markdown
omni-link-hustlexp impact
omni-link-hustlexp health
omni-link-hustlexp review-pr
omni-link-hustlexp publish-review
```

Only after authority drift is reduced for the touched area should Claude consider:

```bash
omni-link-hustlexp apply --plan .omni-link/execution-plan.json
```

### How Claude should interpret the outputs

- `docsOnly`: procedures still declared in docs authority but not found in the live backend. Claude should either remove them from docs or prove the backend implementation exists elsewhere before editing code.
- `backendOnly`: procedures live in `backend/src/routers` but still undocumented. Claude should document these before claiming the contract is reconciled.
- `obsoleteCalls`: Swift consumer calls that target procedures no longer present in the authoritative backend. Claude should remove or remap these before enabling execution.
- `payloadDrift`: endpoint exists, but request/response shape drift remains between docs authority, backend, and Swift models. Claude should normalize schemas before merging adjacent feature work.
- `authority_drift`: top-level finding that means docs intent and implementation reality still diverge. In reconciliation mode this blocks `apply`; in strict mode it should also block review approval.

### What `simulateOnly` means here

`simulateOnly` is the correct default for HustleXP reconciliation. It does **not** disable `watch`, `scan`, `impact`, `health`, `evolve`, or `review-pr`. It disables mutation. Claude should keep it enabled until:

- the touched authority slice is reconciled
- the relevant obsolete calls are removed or remapped
- the policy surface for the change is green

### What success looks like

For the live HustleXP workflow, Claude should treat this as the success condition:

- docs authority matches the backend/provider surface for the slice being changed
- Swift consumer calls match the backend/provider surface for the slice being changed
- payload drift is either zero or explicitly understood and documented
- `review-pr` reports low or medium risk without unresolved `authority_drift`
- `apply` remains branch-oriented and never mutates `main` directly

## Reconciliation Loop

This fork is designed around a specific three-way loop:

1. `HUSTLEXP-DOCS` defines intended product and contract authority.
2. `hustlexp-ai-backend` defines implemented provider truth.
3. `HUSTLEXPFINAL1` defines actual consumer truth.
4. `omni-link-hustlexp` measures the gap between all three and blocks unsafe automation until the gap is worked down.

The correct operator behavior is not "generate code first." It is:

1. Check authority.
2. Fix drift.
3. Review impact.
4. Publish evidence.
5. Apply only when the slice is reconciled.

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
| `structured-handoff`   | Inter-agent delegation      | JSON handoff protocol with ecosystem context for sub-agent communication          |
| `agent-teams-bridge`   | Multi-agent workflows       | Auto-detect Agent Teams for peer-to-peer messaging, fallback to sub-agents        |
| `error-recovery`       | Sub-agent failures          | Three-strike triage, exponential backoff, and escalation protocol                 |

Plus 10 HustleXP-specific project skills (`hustlexp-tdd`, `ios-tRPC-wirer`, `hustlexp-revenue-fixer`, `ios-screen-builder`, `pagination-implementer`, `stripe-webhook-auditor`, `zod-audit`, `legal-document-manager`, etc.).

## Commands

Commands are slash commands available in Claude Code.

| Command             | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `/scan`             | Force a full ecosystem rescan across all configured repos                   |
| `/impact`           | Analyze cross-repo impact of uncommitted changes or branch diffs            |
| `/health`           | Run a full ecosystem health audit with per-repo scores                      |
| `/evolve`           | Generate ranked evolution suggestions with evidence                         |
| `/watch`            | Refresh or maintain daemon-backed ecosystem state                           |
| `/owners`           | Resolve ownership assignments across repos and APIs                         |
| `/review-pr`        | Generate a PR review artifact with risk, owners, and execution plan         |
| `/publish-review`   | Publish or replay provider comments/checks for a saved review artifact      |
| `/apply`            | Apply the bounded execution plan on generated branches/PRs                  |
| `/rollback`         | Roll back the last generated execution plan                                 |
| `/authority-status` | Report docs authority drift, contract coverage, and reconciliation guidance |
| `/verify`           | Run the full verification chain (lint + test + build + smoke)               |

## Agents

Specialized agents for focused analysis and orchestration tasks.

| Agent                  | Description                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `repo-analyst`         | Deep-dive single-repo analysis: structure, dependencies, dead code, test coverage, health             |
| `cross-repo-reviewer`  | Reviews changes for cross-repo safety: API contracts, type lineage, dependency compatibility          |
| `evolution-strategist` | CTO/product strategist perspective: industry best practices, competitive analysis, strategic roadmaps |
| `validator`            | Validates code changes against ecosystem constraints and iron laws                                    |
| `coordinator`          | Team lead: orchestrates specialists with structured handoff, shared memory, and Agent Teams fallback  |
| `error-coordinator`    | Auto-triage for sub-agent failures: diagnoses blockers, retries, or escalates                         |
| `memory-keeper`        | Manages the shared bulletin board, project memory, and inter-agent state                              |
| `team-visualizer`      | Generates ASCII/Mermaid progress dashboards from task status and ecosystem health                     |

## Multi-Agent Orchestration (communication-pro-max)

The plugin includes a full multi-agent orchestration layer:

### Structured Handoff Protocol

Every inter-agent message uses a JSON schema:

```json
{
  "context": "Brief project state",
  "task": "Explicit instruction",
  "dependencies": ["prior outputs or memory keys"],
  "expected_format": "Markdown | JSON | Code",
  "ecosystem_state": "omni-link digest excerpt",
  "summary": "Human-readable one-liner"
}
```

### MCP Communication Bus

A file-based JSONL message queue (`mcp/communication-bus/`) providing:

- `send_message(to, msg, sender)` — Send to a specific agent or broadcast
- `read_messages(recipient)` — Read pending messages
- `clear_messages(recipient?)` — Clear queue

Zero external dependencies. MCP 2024-11-05 protocol compliant.

### Agent Teams Bridge

When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set, the coordinator switches from linear sub-agent delegation to native peer-to-peer messaging with task self-claiming.

### Hooks

| Hook             | Event         | Purpose                                           |
| ---------------- | ------------- | ------------------------------------------------- |
| `session-start`  | SessionStart  | Runs `/scan` and injects ecosystem context        |
| `inject-context` | SubagentStart | Injects shared bulletin board into new sub-agents |
| `subagent-stop`  | SubagentStop  | Formats completion as structured handoff          |

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

1. **Scanner** (`engine/scanner/`) — Tree-sitter-powered parsing that walks each repo and extracts exports, routes, tRPC procedures, types, schemas, conventions, dependencies, and git state into a `RepoManifest`. All git operations have a 15-second timeout.

2. **Grapher** (`engine/grapher/`) — Cross-repo analysis that builds an `EcosystemGraph` from all manifests: API bridges, type lineage, contract mismatches, dependency graphs, and impact paths.

3. **Context** (`engine/context/`) — Token-budgeted context generation: prunes the ecosystem graph to fit within the configured token budget, formats a human-readable digest, and manages scan caching with explicit invalidation API.

4. **Quality** (`engine/quality/`) — Enforcement layer with four gates: reference checker, convention validator, slop detector, and health scorer.

5. **Evolution** (`engine/evolution/`) — Business intelligence: gap analyzer, bottleneck finder, competitive benchmarker, and upgrade proposer. Every suggestion requires evidence citations (the Iron Law).

6. **Error Handling** (`engine/errors.ts`) — Structured error types: `ScanError` (carries `repoId` and `phase`), `ConfigError` (carries `field` and `suggestion`), `PathTraversalError`. Partial failure resilience via `Promise.allSettled`.

### Key types

- `RepoManifest` — Complete snapshot of a single repo's code structure
- `EcosystemGraph` — Cross-repo relationship graph with bridges, types, and mismatches
- `EcosystemDigest` — Token-budgeted summary for session injection
- `ScanResult` — Manifests + graph + context + `failures[]` for partial failure reporting
- `EvolutionSuggestion` — Ranked improvement proposal with evidence and effort estimates

## Verification

Current proof points from the verified state:

- `773` tests passing, `5` skipped (live-provider tests require external credentials)
- `0` moderate-or-higher audit vulnerabilities
- `129` E2E lifecycle tests covering 20 sections (happy path, edge cases, conflict resolution, resilience, determinism, quality, evolution, GraphQL, bottlenecks, token pruning, cache invalidation, bridge analysis, error recovery, multi-language, structured errors, partial failure, CLI, config validation, git timeout, daemon resilience)
- CI green on Node 20 and Node 22
- Polyglot stress harness validated across `8` repos and `6` languages in one engine run

### Verification commands

```bash
npm run verify          # lint + test + coverage + build + cli smoke + benchmark smoke + pack check
npm run verify:max      # verify + max-tier smoke + contract smoke + package smoke
npm run verify:stress   # verify:max + full stress + live provider gates
npm run verify:hustlexp # verify:max + authority + bridge + profile + benchmark
```

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

Start from [config/hustlexp.local.example.json](config/hustlexp.local.example.json) and adjust paths for your machine. The important part is `workflowProfile: "hustlexp"`, which activates the authority layer, Swift↔tRPC bridge, default exclusions, ownership defaults, and safer automation posture.

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
  ]
}
```

Config is validated at load time using a comprehensive Zod schema that rejects invalid values (bad aggressiveness, unsupported languages, negative suggestion counts) and applies sensible defaults for all optional fields.

### Config options

| Section     | Key                        | Values                                                                                            | Default                  | Description                                                     |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| root        | `workflowProfile`          | `hustlexp`                                                                                        | unset                    | Activates the HustleXP preset for authority, bridge, and policy |
| root        | `reviewProvider`           | `github`, `gitlab`                                                                                | `github`                 | Active publish target                                           |
| `repos[]`   | `name`                     | string                                                                                            | —                        | Unique repo identifier                                          |
| `repos[]`   | `path`                     | string                                                                                            | —                        | Absolute path to repo root                                      |
| `repos[]`   | `language`                 | `typescript`, `tsx`, `swift`, `python`, `go`, `rust`, `java`, `javascript`, `graphql`, `markdown` | —                        | Primary language                                                |
| `repos[]`   | `role`                     | `ios-client`, `backend-api`, `product-governance`, or another string                              | —                        | Repo role used by the workflow preset                           |
| `authority` | `enabled` / `docsRepo`     | boolean + string                                                                                  | enabled in profile       | Docs authority parsing                                          |
| `authority` | `phaseMode`                | `reconciliation`, `strict`                                                                        | `reconciliation`         | Reconciliation reports drift; strict blocks review and execute  |
| `bridges`   | `swiftTrpc`                | object                                                                                            | enabled in profile       | Swift client call extraction and backend correlation            |
| `quality`   | `conventionStrictness`     | `strict`, `moderate`, `relaxed`                                                                   | `strict`                 | How strictly to enforce conventions                             |
| `context`   | `tokenBudget`              | 100–50000                                                                                         | `8000`                   | Max tokens for context digest                                   |
| `evolution` | `aggressiveness`           | `aggressive`, `moderate`, `on-demand`                                                             | `aggressive`             | How aggressively to generate suggestions                        |
| `evolution` | `maxSuggestionsPerSession` | 1–20                                                                                              | `5`                      | Max suggestions per session                                     |
| `cache`     | `directory`                | string                                                                                            | `.omni-link-cache`       | Cache directory path                                            |
| `daemon`    | `enabled` / `preferDaemon` | booleans                                                                                          | `true` in profile        | Enable warm graph state                                         |
| `policies`  | branch/risk rules          | arrays + booleans + risk threshold                                                                | strict HustleXP defaults | Gate execution and protected-branch behavior                    |

## Development

### Prerequisites

- Node.js >= 18
- npm
- Python 3 (for MCP communication bus server)

### Setup

```bash
npm install
npm run build
```

### Run tests

```bash
npm test                # Full suite (773 tests)
npm run test:coverage   # With coverage report
npm run test:watch      # Watch mode
```

### Lint and format

```bash
npm run lint            # eslint + tsc --noEmit
npm run format:check    # prettier
npm run format          # prettier --write
```

### CLI

```bash
node dist/cli.js --help
node dist/cli.js scan --config .omni-link.json
node dist/cli.js authority-status --config .omni-link.json
node dist/cli.js health --config .omni-link.json
node dist/cli.js evolve --config .omni-link.json
node dist/cli.js impact --config .omni-link.json
node dist/cli.js review-pr --base main --head HEAD --config .omni-link.json
```

### CLI exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 0    | Success                                            |
| 1    | General error                                      |
| 2    | Configuration or path error                        |
| 3    | Scan error (specific repo/phase context in stderr) |

### Project structure

```
omni-link-hustlexp/
  engine/               # Core TypeScript engine
    scanner/            # Tree-sitter parsing, extraction (15s git timeout)
    grapher/            # Cross-repo graph building
    context/            # Token pruning, digest formatting, caching
    quality/            # Reference checking, convention validation, slop detection
    evolution/          # Gap analysis, bottlenecks, benchmarking, upgrades
    authority/          # Docs authority parsing
    bridges/            # Swift↔tRPC bridge analysis
    daemon/             # SQLite-backed warm state (corruption recovery)
    providers/          # GitHub/GitLab publishing
    review/             # PR review artifacts
    execution/          # Apply/rollback execution plans
    policy/             # Policy evaluation
    runtime/            # Runtime signal ingestion
    errors.ts           # Structured error types (ScanError, ConfigError, PathTraversalError)
    types.ts            # Core type definitions
    config.ts           # Configuration loader
    config-validator.ts # Zod schema validation
    index.ts            # Pipeline orchestrator (partial failure, cache API)
    cli-app.ts          # CLI with structured error output
  skills/               # 13 Claude Code skills + 10 HustleXP project skills
  commands/             # 12 slash command docs
  agents/               # 8 specialized agents (analysis + orchestration)
  hooks/                # SessionStart, SubagentStart, SubagentStop hooks
  mcp/                  # MCP communication bus server (Python, JSONL queue)
  tests/                # 773 tests (unit, integration, E2E lifecycle, smoke, stress)
    integration/        # E2E tests including 129-test lifecycle suite
    scanner/            # Scanner unit tests
    grapher/            # Grapher unit tests
    quality/            # Quality gate tests
    evolution/          # Evolution engine tests
    scripts/            # Smoke and stress test wrappers
  scripts/              # CLI smoke, benchmark, contract, stress harnesses
  .claude-plugin/       # Plugin manifest (v2.0.0)
  CLAUDE.md             # Persistent AI coding rules and shared bulletin board
  CLAUDE_TEST_REPORT.md # Full E2E test report with 10/10 bulletproof rating
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure `npm run lint && npm test` passes
5. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) for coding conventions and rules.

## License

MIT
