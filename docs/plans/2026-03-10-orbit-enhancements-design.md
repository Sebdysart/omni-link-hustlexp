# omni-link-hustlexp Orbit Enhancement Design

**Date**: 2026-03-10
**Goal**: Fix 3 quality issues + add E2E tests, push health to fully tested

## Enhancement 1: Rich Evidence in `evolve`

**Problem**: `benchmarkToBottleneckFindings()` in `engine/evolution/bottleneck-finder.ts` produces `file: "", line: 0` for best-practice suggestions (pagination, validation, rate-limiting, versioning).

**Fix**: After generating each benchmark finding, scan the manifest's `apiSurface.procedures` and `apiSurface.routes` to find every procedure/route missing the feature. Replace single empty-evidence entry with array of all concrete file:line locations.

**Files**:

- `engine/evolution/bottleneck-finder.ts` — `benchmarkToBottleneckFindings()` + `detectMissingPagination()` / `detectMissingRateLimiting()`
- `engine/evolution/upgrade-proposer.ts` — evidence array construction (may need multi-evidence support)
- `tests/evolution/bottleneck-finder.test.ts` — update tests

**Acceptance**: `evolve` output has zero `file: ""` entries. Every suggestion cites real file:line.

## Enhancement 2: `--simulate` Flag for `impact`

**Problem**: `impact` only shows real uncommitted/ref changes. No way to ask "what if I changed this file?"

**Fix**: Add `--simulate <repo>:<filepath>` flag to `cli-app.ts`. When provided, inject synthetic `changedFiles` entries instead of running git diff, then use existing `analyzeImpact()`.

**Files**:

- `engine/cli-app.ts` — parse `--simulate` arg, route to new `impactFromSimulated()`
- `engine/index.ts` — add `impactFromSimulated()` export
- `engine/grapher/impact-analyzer.ts` — no changes needed (reuses existing graph traversal)
- `tests/grapher/impact-analyzer.test.ts` — add simulated input tests

**Acceptance**: `impact --simulate hustlexp-ai-backend:backend/src/routers/task.ts` returns non-empty affected arrays.

## Enhancement 3: Variable Confidence in Swift-tRPC Bridge

**Problem**: `bridgeMismatch()` in `engine/bridges/swift-trpc.ts` uses binary `0.94`/`0.84` confidence.

**Fix**: Replace with scoring function considering:

- Procedure name match type: exact (0.95) vs fuzzy (0.75)
- Field coverage: % of expected fields present
- Type compatibility: exact match (+0.05) vs compatible (+0) vs incompatible (-0.1)
- Optional vs required: missing optional = -0.05, missing required = -0.15

Formula: `clamp(baseConfidence * fieldCoverage + typeBonus, 0.5, 0.98)`

**Files**:

- `engine/bridges/swift-trpc.ts` — new `computeConfidence()` function, replace hardcoded values
- `tests/bridges/swift-trpc.test.ts` — test confidence varies across mismatch types

**Acceptance**: `scan` output confidence values vary across mismatches (not uniform 0.84).

## E2E Tests

Add integration tests that run the CLI binary against the real HustleXP repos:

- `evolve` output has no `file: ""` entries
- `impact --simulate` returns non-empty affected
- `scan` confidence values vary
- All commands exit 0 and return valid JSON
- `health` returns scores in [0, 100] range

**File**: `tests/e2e/cli-commands.test.ts`
