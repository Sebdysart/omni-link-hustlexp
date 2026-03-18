# CLAUDE.md — Persistent AI Coding Rules for omni-link-hustlexp

## Project Identity

- **Name:** omni-link-hustlexp
- **Type:** Multi-repo engineering control plane for Claude Code
- **Language:** TypeScript (ESM, `"type": "module"`)
- **Engine:** `engine/` directory, compiles to `dist/`
- **Tests:** `tests/` directory, Vitest

## Build & Validate

```bash
npm run build          # TypeScript compilation
npm run lint           # ESLint + tsc --noEmit
npm run format:check   # Prettier
npm test               # Vitest (all tests)
npm run verify         # Full pre-merge gate
npm run verify:max     # verify + smoke:max + smoke:contracts + smoke:package
```

## Commit Convention

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
Every commit message must start with one of these prefixes.

## Coding Rules — NEVER Do

- **Never use `var`** — always `const` or `let`
- **Never use `any`** — use proper types or `unknown` with type guards
- **Never leave `console.log` in production code** — use structured logging or remove
- **Never hardcode absolute paths** — use `import.meta.dirname` or `path.resolve(__dirname, ...)`
- **Never commit with failing lint** — run `npm run lint` first
- **Never use `fetch()` without error handling** — wrap in try/catch or attach `.catch()`
- **Never add comments that narrate obvious code** — comments explain _why_, not _what_

## Coding Rules — ALWAYS Do

- **Always handle errors explicitly** — try/catch for async, `.catch()` for promises
- **Always add tests for new behavior** — co-locate in `tests/` mirroring `engine/` structure
- **Always use `path.join()` or `path.resolve()`** for file paths — never string concatenation
- **Always run `npm run lint && npm test`** before considering work complete
- **Always clean up temp directories** in test `afterAll`/`afterEach` hooks
- **Always use `import.meta.dirname`** for portable fixture paths in tests

## Naming Conventions

- **Functions and variables:** camelCase (`fetchUsers`, `tokenBudget`)
- **Types and interfaces:** PascalCase (`RepoManifest`, `ScanResult`)
- **Files:** kebab-case (`slop-detector.ts`, `health-scorer.ts`)
- **Test files:** `*.test.ts` in `tests/` mirroring engine structure
- **Constants:** SCREAMING_SNAKE_CASE for sentinels (`UNKNOWN_FILE`, `UNKNOWN_LINE`)

## Architecture

```
engine/
  scanner/     → Tree-sitter parsing, API/type extraction
  grapher/     → Cross-repo graph, impact analysis
  context/     → Token pruning, digest formatting, caching
  quality/     → Reference checker, convention validator, slop detector
  evolution/   → Gap analysis, bottleneck finder, benchmarker
  authority/   → Docs authority parsing
  bridges/     → Swift↔tRPC bridge analysis
  daemon/      → SQLite-backed warm state
  providers/   → GitHub/GitLab publishing
  review/      → PR review artifacts
  execution/   → Apply/rollback execution plans
  policy/      → Policy evaluation
  runtime/     → Runtime signal ingestion
```

## Pipeline Order

`scan()` → `health()` → `evolve()` → `impact()` → `qualityCheck()`

Each function is self-contained and can be called independently. `scan()` results
are cached per config SHA — use `invalidateScanCache(config)` or
`scan(config, { bypassCache: true })` to force a fresh scan.

## Test Fixture Strategy

- For tests that only read files (authority, bridges): use `import.meta.dirname`-relative paths
- For tests that call `scan()` (needs git repos): copy fixtures to temp dir + `git init` + `git commit`
- Always clean temp dirs in `afterAll`/`afterEach`
- Use `vi.setConfig({ hookTimeout: 30_000 })` for tests with git operations

## Evidence-Based Development

Every evolution suggestion MUST have at least one evidence citation pointing to
a real file, line, and finding. This is the "Iron Law" — no hallucinated advice.
