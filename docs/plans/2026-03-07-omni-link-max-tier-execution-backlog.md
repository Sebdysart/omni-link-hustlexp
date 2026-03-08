# omni-link Max-Tier Execution Backlog

This is the execution program for taking omni-link from the current `1.0.0` baseline into a true max-tier ecosystem control plane without losing release health.

## Non-Negotiable Rules

1. `npm run verify:max` must stay green on every merge.
2. `npm audit --audit-level=moderate` must stay at zero vulnerabilities.
3. New capability ships behind config flags until it reaches parity with the current stable path.
4. Parser fallback remains available until each semantic adapter is proven.
5. No automated path may mutate a protected branch directly.
6. Every persistence change must have migration and corruption-recovery tests.
7. Every public command surface must be covered by contract fixtures.

## Current Baseline

- Verification:
  - `verify:max`
  - `smoke:cli`
  - `smoke:max`
  - `smoke:contracts`
  - `smoke:package`
- Persistence:
  - SQLite daemon state with legacy JSON migration
- CI:
  - Node 20 / 22 matrix
  - audit, benchmark smoke, max-tier smoke, contract smoke, package smoke

## v1.1: Contract Freeze + Semantic Hardening

### Goal

Lock the public command surface and strengthen the semantic truth layer without changing default behavior.

### Tasks

1. Expand command contract fixtures.
   - Files:
     - `scripts/contract-fixture-smoke.mjs`
     - `tests/fixtures/contracts/*`
     - `tests/scripts/contract-fixture-smoke.test.ts`
   - Acceptance:
     - `scan`, `health`, `impact`, `owners`, `review-pr`, `apply`, `rollback`, and markdown output all have fixture coverage.

2. Strengthen TypeScript semantic parity.
   - Files:
     - `engine/analyzers/typescript-semantic.ts`
     - `tests/analyzers/typescript-semantic.test.ts`
     - `tests/fixtures/semantic/typescript/*`
   - Acceptance:
     - semantic output is compared against parser output on edge-case fixtures.
     - confidence/provenance are present on every semantic artifact.

3. Add GraphQL/OpenAPI artifact analyzers.
   - Files:
     - `engine/analyzers/graphql-semantic.ts`
     - `engine/analyzers/openapi-semantic.ts`
     - `engine/analyzers/index.ts`
   - Acceptance:
     - artifact analyzers augment route/schema intelligence without weakening fallback scanning.

4. Add semantic regression budgets.
   - Files:
     - `package.json`
     - `.github/workflows/ci.yml`
   - Acceptance:
     - CI fails if semantic fixtures drift without explicit fixture updates.

### Merge Order

1. contract fixture expansion
2. TypeScript parity fixtures
3. GraphQL/OpenAPI analyzers
4. semantic CI gates

## v1.2: Branch-Aware Persistence + Review Platform

### Goal

Upgrade the daemon from latest-state caching into branch-aware graph reuse and deterministic review generation.

### Tasks

1. Add daemon schema versioning and branch snapshots.
   - Files:
     - `engine/daemon/store.ts`
     - `engine/daemon/index.ts`
     - `tests/daemon/*`
   - Acceptance:
     - per-branch snapshots can be loaded independently.
     - schema migrations are tested across at least two historical layouts.

2. Persist review artifacts and execution journals by branch/head pair.
   - Files:
     - `engine/review/index.ts`
     - `engine/execution/index.ts`
   - Acceptance:
     - repeated `review-pr` runs reuse snapshot state and emit deterministic artifacts.

3. Introduce provider abstraction for PR outputs.
   - Files:
     - `engine/providers/github.ts`
     - `engine/providers/types.ts`
     - `engine/review/index.ts`
   - Acceptance:
     - GitHub formatting logic is separated from core review logic.
     - provider logic is fully mock-tested.

4. Add replay fixtures for PR annotations.
   - Files:
     - `tests/providers/github.test.ts`
     - `tests/fixtures/providers/github/*`
   - Acceptance:
     - generated PR annotations are stable under replay tests.

### Merge Order

1. daemon schema versioning
2. branch snapshot reuse
3. provider abstraction
4. PR replay fixtures

## v1.3: Runtime Evidence + Controlled Execution

### Goal

Make runtime evidence materially affect prioritization and execution, but only through explainable, reversible rules.

### Tasks

1. Split runtime ingestion into typed ingestors.
   - Files:
     - `engine/runtime/index.ts`
     - `engine/runtime/coverage.ts`
     - `engine/runtime/tests.ts`
     - `engine/runtime/openapi.ts`
     - `engine/runtime/graphql.ts`
     - `engine/runtime/telemetry.ts`
     - `engine/runtime/traces.ts`
   - Acceptance:
     - each ingestor can be enabled independently.
     - each ingestor has offline artifact fixtures.

2. Add explainable risk and ranking reasons.
   - Files:
     - `engine/runtime/index.ts`
     - `engine/review/index.ts`
   - Acceptance:
     - review artifacts show what runtime signals affected the risk result.

3. Add execution ledger and partial-failure handling.
   - Files:
     - `engine/execution/index.ts`
     - `engine/types.ts`
   - Acceptance:
     - apply/rollback are deterministic under branch creation failure and validation failure.
     - rollback is replay-safe.

4. Add failure-injection tests.
   - Files:
     - `tests/execution/*`
     - `tests/runtime/*`
   - Acceptance:
     - dry-run, partial failure, and rollback paths are all covered.

### Merge Order

1. typed runtime ingestors
2. explainable risk reasons
3. execution ledger
4. failure injection tests

## v1.4: Scale + Multi-Provider Control Plane

### Goal

Scale beyond small ecosystems and make the plugin portable across provider environments.

### Tasks

1. Add workspace grouping and graph sharding.
   - Files:
     - `engine/config-validator.ts`
     - `engine/config.ts`
     - `engine/index.ts`
     - `engine/daemon/store.ts`
   - Acceptance:
     - focused scans can target a workspace group.
     - large synthetic graphs do not require full reload.

2. Add large-fixture performance benchmarks.
   - Files:
     - `scripts/benchmark-large.mjs`
     - `tests/fixtures/benchmarks/*`
   - Acceptance:
     - scan/review/evolve budgets are enforced for larger repo sets.

3. Add provider adapters beyond GitHub.
   - Files:
     - `engine/providers/*`
   - Acceptance:
     - provider selection is configuration-driven.
     - unsupported providers degrade cleanly.

4. Add packaged install matrix smoke.
   - Files:
     - `scripts/package-install-smoke.mjs`
     - `.github/workflows/ci.yml`
   - Acceptance:
     - tarball install verification remains green across supported runtimes.

### Merge Order

1. workspace groups
2. large benchmark fixtures
3. provider expansion
4. package/install matrix hardening

## Release Gates

- `verify:max` is mandatory for every release candidate.
- `smoke:package` must pass before tag creation.
- Every feature flag needs:
  - unit coverage
  - fixture coverage
  - source CLI smoke
  - built CLI smoke
  - rollback or fallback behavior

## Definition of Max Tier

omni-link reaches max tier when all of the following are true:

1. Major supported languages have semantic or artifact-grade truth, not just parser fallback.
2. Branch-aware daemon snapshots can be reused safely in CI and local workflows.
3. Review artifacts are provider-aware and stable.
4. Runtime evidence changes prioritization and risk in an explainable way.
5. Execution remains bounded, reversible, and policy-gated.
6. Large ecosystem workloads stay within benchmark budgets.
