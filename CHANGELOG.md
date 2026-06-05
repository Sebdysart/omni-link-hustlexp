# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [2.0.0] - 2026-06-05

### Added

- communication-pro-max multi-agent orchestration layer: structured handoff protocol,
  Agent Teams bridge, and a file-based MCP message bus (`communication-bus`).
- Orchestration agents: `coordinator`, `error-coordinator`, `memory-keeper`, and
  `team-visualizer`, plus the `structured-handoff`, `agent-teams-bridge`, and
  `error-recovery` skills.
- `SubagentStart` (inject-context) and `SubagentStop` (subagent-stop) hooks and a shared
  bulletin board for inter-agent state.
- Coverage thresholds enforced in Vitest so `test:coverage` fails on regressions.
- CI now runs `format:check`, and `npm run verify` includes the Prettier gate.

### Changed

- Aligned plugin version across `package.json`, `.claude-plugin/plugin.json`, and
  `.claude-plugin/marketplace.json` to 2.0.0.

### Fixed

- Test and stress-harness git fixtures now disable commit/tag signing, so the full suite
  and `verify:max`/`stress:full` run on hosts that enforce global commit signing.
- Declared the previously implicit `@eslint/js` dev dependency required by the flat
  ESLint config, preventing lint failures on clean installs.
- Removed a hardcoded macOS Java path from the toolchain semantic analyzer; Java is now
  resolved via `JAVA_HOME` or `PATH`.

## [1.0.0] - 2026-03-07

### Added

- Semantic TypeScript analysis with provenance and confidence scoring.
- Daemon-backed warm graph refresh and watch mode.
- Ownership resolution, runtime signal ingestion, policy evaluation, and risk scoring.
- PR review artifacts plus bounded `apply` and `rollback` execution planning.
- Branch-aware impact analysis, new CLI commands, and max-tier smoke verification.

- Async scan pipeline with bounded parallel repo processing.
- `.gitignore` and `.claudeignore` aware source walking.
- Zod-backed config validation with default merging.
- Mermaid architecture diagrams in context output.
- Real tokenizer-backed digest counting.
- ESLint, Prettier, Husky, coverage, and release automation scaffolding.

## [0.3.0] - 2026-02-28

### Added

- Multi-repo scanning with Tree-sitter.
- API contract mapping and type lineage tracking.
- Quality gates for reference, convention, and slop detection.
- Evolution analysis and benchmark smoke coverage.
