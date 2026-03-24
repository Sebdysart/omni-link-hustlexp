# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

omni-link-hustlexp is a TypeScript ESM CLI tool and Claude Code plugin for multi-repo static analysis, cross-repo impact analysis, and PR review. It integrates the ruflo orchestration engine (swarm coordination, workflow execution, hybrid vector memory, plugin system) as `engine/ruflo/`. The omni-link analysis pipeline is wired as a ruflo plugin (`HustleXPEngineeringPlugin`). See `README.md` for full details.

### Service summary

This is a single Node.js service with no external databases or containers. All state (SQLite via `sql.js` WASM, tree-sitter native bindings, ruflo in-memory backends) runs in-process. No Docker, Redis, or external services are required.

### Development commands

All standard commands are in `package.json` scripts and documented in `README.md` § Development. Key ones:

- **Build:** `npm run build` (runs `tsc`)
- **Lint:** `npm run lint` (ESLint + `tsc --noEmit`)
- **Format check:** `npm run format:check` (Prettier)
- **Tests:** `npm test` (Vitest, 847 tests, ~2.5 min)
- **CLI:** `node dist/cli.js --help`
- **Full verify gate:** `npm run verify`

### Non-obvious caveats

- **Native bindings:** `tree-sitter` and 7 language grammar packages compile C/C++ native addons during `npm install`. The system must have `g++`, `make`, and `python3` available (pre-installed in the Cloud Agent environment).
- **Test duration:** The full test suite takes ~2.5 minutes due to git-fixture-based integration tests (`tests/scanner/index.test.ts`, `tests/integration/plugin-e2e-lifecycle.test.ts`). Individual unit test files run in under 1 second.
- **Live provider tests are skipped:** 4 tests in `tests/providers/live.integration.test.ts` require `GITHUB_TOKEN`/`GITLAB_TOKEN` and are skipped by default. This is expected.
- **CLI requires config:** Running `node dist/cli.js scan` without a `.omni-link.json` config exits with code 1. Use `node scripts/cli-smoke.mjs` to exercise the full pipeline with built-in fixtures.
- **Build before CLI:** The CLI runs from `dist/cli.js`, so `npm run build` must complete before invoking CLI commands.
- **Husky pre-commit hook:** Runs `npm run lint`, `npm run format:check`, and `npm test` on every commit. Expect ~3 minutes per commit if all tests run.
