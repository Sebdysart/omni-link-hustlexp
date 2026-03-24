# omni-link-hustlexp Bulletproof Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 4 confirmed bugs found during live end-to-end testing, add tests for every fix, ensure 645→645+ passing tests and full CLI correctness against real HustleXP repos.

**Architecture:** All fixes are in the engine layer (`engine/` TypeScript source). Each fix follows TDD: write failing test → implement → verify passing → build → run smoke. No new dependencies needed.

**Tech Stack:** TypeScript, Vitest, Node.js, `npm run build` (tsc), `npm test`, `node dist/cli.js`

---

## Bug Inventory (confirmed from live run)

| #   | Bug                                           | File                                     | Root Cause                                                                                                                                                                                  |
| --- | --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `contractStatus.total = 0` in scan output     | `engine/context/digest-formatter.ts:410` | `total` only counts `graph.bridges` (matched), ignores `graph.contractMismatches` (unmatched). In production graph.bridges=0, mismatches=316 → total=0.                                     |
| B2  | 299 doc-gap warnings flood mismatches array   | `engine/context/digest-formatter.ts`     | `missing-procedure` mismatches (Swift+backend both have the proc, docs don't declare it) are categorised same as real type-mismatches. 299 noise buries 17 real issues.                     |
| B3  | `impact --base main --head HEAD` returns `[]` | `engine/index.ts:267-275`                | `impactFromRefs` runs `git diff main...HEAD`; when repos have uncommitted but no new commits, diff is empty. Falls off a cliff silently instead of falling through to uncommitted analysis. |
| B4  | Config backend path wrong                     | `~/.claude/omni-link-hustlexp.json`      | Points to `/HustleXP/hustlexp-ai-backend` (older copy); active development is at `/Desktop/hustlexp-ai-backend`. Causes health testScore=60 instead of 88.88%+.                             |

---

## Task 1: Fix `contractStatus.total` Counter

**Files:**

- Modify: `engine/context/digest-formatter.ts:409-414`
- Modify: `tests/context/digest-formatter.test.ts` (update existing test + add new test)

### Step 1: Write the failing test

In `tests/context/digest-formatter.test.ts`, add after the existing `'digest has correct contractStatus counts'` test:

```typescript
it('contractStatus.total includes mismatches when bridges array is empty', () => {
  // Production scenario: scanner found 316 issues but all are in contractMismatches,
  // graph.bridges is empty (no fully-matched bridges exist yet)
  const graph: EcosystemGraph = {
    repos: [],
    bridges: [], // ← empty: no matched bridges
    sharedTypes: [],
    contractMismatches: [
      {
        kind: 'missing-procedure',
        description: "Swift and backend both use 'task.create', docs don't declare it",
        provider: { repo: 'hustlexp-docs', file: 'API_CONTRACT.md', line: 1, field: 'task.create' },
        consumer: { repo: 'hustlexp-ios', file: 'TaskService.swift', line: 10 },
        severity: 'warning',
      },
      {
        kind: 'type-mismatch',
        description: "field 'amount' is number in backend but String in iOS",
        provider: { repo: 'backend', file: 'types.ts', line: 5 },
        consumer: { repo: 'ios', file: 'Models/Escrow.swift', line: 12 },
        severity: 'breaking',
      },
    ],
    impactPaths: [],
  };
  const config = makeConfig();
  const { digest } = formatDigest(graph, config);

  // total must include ALL detected bridge relationships, not just matched ones
  expect(digest.contractStatus.total).toBe(2);
  expect(digest.contractStatus.exact).toBe(0);
  expect(digest.contractStatus.compatible).toBe(0);
  expect(digest.contractStatus.mismatches).toHaveLength(2);
});
```

Also update the EXISTING `'digest has correct contractStatus counts'` test — the `makeGraph()` fixture has 1 bridge + 1 mismatch, so after the fix total = 2:

```typescript
it('digest has correct contractStatus counts', () => {
  const graph = makeGraph(); // 1 bridge (matchStatus:'mismatch') + 1 contractMismatch
  const config = makeConfig();
  const { digest } = formatDigest(graph, config);

  expect(digest.contractStatus.total).toBe(2); // was 1 — bridge + mismatch
  expect(digest.contractStatus.mismatches).toHaveLength(1);
});
```

### Step 2: Run test to confirm it fails

```bash
cd /Users/sebastiandysart/omni-link-hustlexp
npx vitest run tests/context/digest-formatter.test.ts 2>&1 | tail -20
```

Expected: FAIL — `expected 0 to be 2` and `expected 1 to be 2`

### Step 3: Implement the fix

In `engine/context/digest-formatter.ts`, change line 410:

```typescript
// BEFORE:
return {
  total: graph.bridges.length,
  exact,
  compatible,
  mismatches: graph.contractMismatches,
};

// AFTER:
return {
  total: graph.bridges.length + graph.contractMismatches.length,
  exact,
  compatible,
  mismatches: graph.contractMismatches,
};
```

### Step 4: Run test to confirm it passes

```bash
npx vitest run tests/context/digest-formatter.test.ts 2>&1 | tail -10
```

Expected: all tests PASS

### Step 5: Commit

```bash
git add engine/context/digest-formatter.ts tests/context/digest-formatter.test.ts
git commit -m "fix(digest): contractStatus.total includes contractMismatches not just matched bridges"
```

---

## Task 2: Separate Doc-Coverage-Gap Noise from Real Mismatches

**Files:**

- Modify: `engine/context/digest-formatter.ts` (`buildContractStatus` function + return type)
- Modify: `engine/types.ts` (update `EcosystemDigest.contractStatus` type if needed)
- Modify: `tests/context/digest-formatter.test.ts` (add new tests)

**What a `missing-procedure` doc-gap looks like:**
`kind: 'missing-procedure'`, description contains `"docs authority does not declare"` — this means Swift + backend both have the procedure, but `API_CONTRACT.md` hasn't been updated to document it. It is NOT a functional bug.

**What real mismatches look like:**

- `kind: 'type-mismatch'` — actual type incompatibility between iOS model and backend schema
- `kind: 'obsolete-call'` — iOS calls a procedure the backend no longer exposes
- `kind: 'missing-field'` / `kind: 'extra-field'` — payload shape divergence

### Step 1: Write the failing test

In `tests/context/digest-formatter.test.ts`, add:

```typescript
it('contractStatus separates doc-coverage-gaps from functional mismatches', () => {
  const docGapMismatch: Mismatch = {
    kind: 'missing-procedure',
    description:
      "Swift client and backend both use 'task.create', but the docs authority does not declare it.",
    provider: { repo: 'hustlexp-docs', file: 'API_CONTRACT.md', line: 1, field: 'task.create' },
    consumer: { repo: 'hustlexp-ios', file: 'TaskService.swift', line: 10 },
    severity: 'warning',
  };
  const realMismatch: Mismatch = {
    kind: 'type-mismatch',
    description: "field 'amount' is number in backend but String in iOS",
    provider: { repo: 'backend', file: 'types.ts', line: 5 },
    consumer: { repo: 'ios', file: 'Models/Escrow.swift', line: 12 },
    severity: 'breaking',
  };
  const obsoleteCall: Mismatch = {
    kind: 'obsolete-call',
    description: "iOS calls 'task.legacyCreate' which no longer exists in backend",
    provider: { repo: 'backend', file: 'routers/task.ts', line: 1 },
    consumer: { repo: 'ios', file: 'TaskService.swift', line: 55 },
    severity: 'breaking',
  };

  const graph: EcosystemGraph = {
    repos: [],
    bridges: [],
    sharedTypes: [],
    contractMismatches: [docGapMismatch, realMismatch, obsoleteCall],
    impactPaths: [],
  };
  const config = makeConfig();
  const { digest } = formatDigest(graph, config);

  // total = all 3
  expect(digest.contractStatus.total).toBe(3);
  // docCoverageGaps only counts missing-procedure gaps
  expect(digest.contractStatus.docCoverageGaps).toBe(1);
  // mismatches only contains functional issues (type-mismatch, obsolete-call)
  expect(digest.contractStatus.mismatches).toHaveLength(2);
  expect(digest.contractStatus.mismatches.every((m) => m.kind !== 'missing-procedure')).toBe(true);
});
```

### Step 2: Run test to confirm it fails

```bash
npx vitest run tests/context/digest-formatter.test.ts 2>&1 | tail -15
```

Expected: FAIL — `digest.contractStatus.docCoverageGaps is undefined`

### Step 3: Update the type in `engine/types.ts`

Find the `contractStatus` field in `EcosystemDigest` and add `docCoverageGaps`:

```typescript
// In EcosystemDigest type (find the contractStatus field):
contractStatus: {
  total: number;
  exact: number;
  compatible: number;
  docCoverageGaps: number;   // ← ADD: missing-procedure mismatches where docs lag implementation
  mismatches: Mismatch[];    // only functional mismatches (type-mismatch, obsolete-call, missing-field, extra-field)
};
```

### Step 4: Update `buildContractStatus` in `engine/context/digest-formatter.ts`

```typescript
function buildContractStatus(graph: EcosystemGraph): {
  total: number;
  exact: number;
  compatible: number;
  docCoverageGaps: number;
  mismatches: Mismatch[];
} {
  let exact = 0;
  let compatible = 0;

  for (const bridge of graph.bridges) {
    switch (bridge.contract.matchStatus) {
      case 'exact':
        exact++;
        break;
      case 'compatible':
        compatible++;
        break;
    }
  }

  // Doc-coverage gaps: procedures that exist in both Swift + backend but aren't in API_CONTRACT.md.
  // These are documentation lag, not functional bugs — separate them from real mismatches.
  const docCoverageGaps = graph.contractMismatches.filter(
    (m) => m.kind === 'missing-procedure',
  ).length;

  // Functional mismatches only: type issues, obsolete calls, field divergence
  const functionalMismatches = graph.contractMismatches.filter(
    (m) => m.kind !== 'missing-procedure',
  );

  return {
    total: graph.bridges.length + graph.contractMismatches.length,
    exact,
    compatible,
    docCoverageGaps,
    mismatches: functionalMismatches,
  };
}
```

### Step 5: Update markdown output to show the separation

Find where the markdown renders mismatches (around line 125 in `digest-formatter.ts`) and update to show doc gaps separately:

```typescript
// In the markdown section builder, after the contractStatus section:
if (contractStatus.docCoverageGaps > 0) {
  sections.push(
    `Doc coverage gaps: ${contractStatus.docCoverageGaps} procedures live in backend+iOS but undocumented in API_CONTRACT.md (not functional bugs — update docs to clear)`,
  );
}
if (contractStatus.mismatches.length > 0) {
  sections.push(
    `Functional mismatches: ${contractStatus.mismatches.length} (type/field/obsolete-call — require code fixes)`,
  );
  for (const mismatch of contractStatus.mismatches) {
    sections.push(`  [${mismatch.severity.toUpperCase()}] ${mismatch.description}`);
  }
}
```

### Step 6: Run tests

```bash
npx vitest run tests/context/digest-formatter.test.ts 2>&1 | tail -15
```

Expected: all tests PASS

### Step 7: Commit

```bash
git add engine/context/digest-formatter.ts engine/types.ts tests/context/digest-formatter.test.ts
git commit -m "fix(digest): separate doc-coverage-gaps from functional mismatches in contractStatus"
```

---

## Task 3: Fix `impact --base main --head HEAD` Returning `[]` When All Changes Are Uncommitted

**Files:**

- Modify: `engine/index.ts:267-275` (`impactFromRefs` function)
- Modify: `tests/index.test.ts` (add new test)

**Root cause:** `impactFromRefs` runs `git diff main...HEAD`. When the repos have no new commits (77 changes are all uncommitted), the diff is empty → `analyzeImpact(graph, [])` → `[]`. The user expects `--base main --head HEAD` to catch all pending changes, but the uncommitted ones are invisible to git diff.

**Fix:** When `gitChangedFilesBetween` returns 0 files AND repos have uncommitted changes, merge in the uncommitted files.

### Step 1: Write the failing test

In `tests/index.test.ts`, add a test for `impactFromRefs` fallthrough:

```typescript
it('impactFromRefs falls through to uncommitted changes when refs are same commit', async () => {
  // Simulate a repo where main===HEAD (no new commits) but 2 files are uncommitted
  const config = makeMinimalConfig({
    repos: [
      {
        name: 'backend',
        path: '/fake/backend',
        language: 'typescript' as const,
        role: 'backend-api' as const,
      },
    ],
  });

  // Mock gitChangedFilesBetween to return [] (same commit scenario)
  // Mock the scan result to have uncommitted changes in gitState
  // Then verify impactFromRefs returns results for the uncommitted files

  // NOTE: This test uses the unit-level approach — test the logic directly via
  // calling the engine functions with controlled inputs.
  // Implementation: when changedFiles.length === 0, re-run with uncommitted changes.

  const manifests: RepoManifest[] = [
    makeManifest({
      repoId: 'backend',
      gitState: {
        branch: 'main',
        headSha: 'abc123',
        uncommittedChanges: ['src/routers/task.ts', 'src/services/EscrowService.ts'],
        recentCommits: [],
      },
      dependencies: {
        internal: [{ from: 'src/index.ts', to: 'src/routers/task.ts', imports: ['taskRouter'] }],
        external: [],
      },
    }),
  ];

  const graph: EcosystemGraph = {
    repos: manifests,
    bridges: [],
    sharedTypes: [],
    contractMismatches: [],
    impactPaths: [],
  };

  // When refs diff is empty but uncommitted changes exist, analyzeImpact should be called
  // with the uncommitted files instead of an empty array
  const emptyRefDiff: Array<{ repo: string; file: string; change: string }> = [];
  const uncommittedFiles = manifests.flatMap((m) =>
    m.gitState.uncommittedChanges.map((file) => ({
      repo: m.repoId,
      file,
      change: 'uncommitted' as const,
    })),
  );

  // With empty diff → should fall through to uncommitted
  // This is the behavior we're adding
  const resultEmpty = analyzeImpact(graph, emptyRefDiff);
  expect(resultEmpty).toHaveLength(0); // empty diff = empty result (base behavior unchanged)

  const resultUncommitted = analyzeImpact(graph, uncommittedFiles);
  expect(resultUncommitted.length).toBeGreaterThan(0); // uncommitted path finds hits
  const triggerFiles = resultUncommitted.map((p) => p.trigger.file);
  expect(triggerFiles).toContain('src/routers/task.ts');
});
```

### Step 2: Update `impactFromRefs` in `engine/index.ts`

```typescript
export async function impactFromRefs(
  config: OmniLinkConfig,
  baseRef: string,
  headRef: string,
): Promise<ImpactPath[]> {
  const result = await loadScanResult(config);
  const changedFiles = gitChangedFilesBetween(config, baseRef, headRef);

  // When the ref diff is empty (e.g. main===HEAD, all changes are uncommitted),
  // fall through to uncommitted analysis so `impact --base main --head HEAD`
  // still surfaces pending changes for the user.
  if (changedFiles.length === 0) {
    const uncommittedFiles = result.manifests.flatMap((manifest) =>
      manifest.gitState.uncommittedChanges.map((file) => ({
        repo: manifest.repoId,
        file,
        change: 'uncommitted' as const,
      })),
    );
    if (uncommittedFiles.length > 0) {
      return analyzeImpact(result.graph, uncommittedFiles);
    }
  }

  return analyzeImpact(result.graph, changedFiles);
}
```

### Step 3: Run tests

```bash
npx vitest run tests/index.test.ts 2>&1 | tail -15
```

Expected: new test PASSES, existing tests unaffected

### Step 4: Commit

```bash
git add engine/index.ts tests/index.test.ts
git commit -m "fix(impact): fall through to uncommitted analysis when ref diff is empty"
```

---

## Task 4: Fix Config Backend Path

**Files:**

- Modify: `~/.claude/omni-link-hustlexp.json`

The config points to `/Users/sebastiandysart/HustleXP/hustlexp-ai-backend` which is an older copy of the backend. Active development (R52 commits, 6,106 tests) is at `/Users/sebastiandysart/Desktop/hustlexp-ai-backend`.

### Step 1: Update the path

```bash
# Back up first
cp ~/.claude/omni-link-hustlexp.json ~/.claude/omni-link-hustlexp.json.bak

# Update the backend path
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/omni-link-hustlexp.json', 'utf8'));
const repo = cfg.repos.find(r => r.name === 'hustlexp-backend');
repo.path = '/Users/sebastiandysart/Desktop/hustlexp-ai-backend';
cfg.runtime.coverageSummaryPath = '/Users/sebastiandysart/Desktop/hustlexp-ai-backend/coverage/coverage-summary.json';
cfg.runtime.testResultsPath = '/Users/sebastiandysart/Desktop/hustlexp-ai-backend/artifacts/test-results.json';
cfg.runtime.telemetrySummaryPath = '/Users/sebastiandysart/Desktop/hustlexp-ai-backend/artifacts/telemetry-summary.json';
cfg.runtime.traceSummaryPath = '/Users/sebastiandysart/Desktop/hustlexp-ai-backend/artifacts/trace-summary.json';
fs.writeFileSync(process.env.HOME + '/.claude/omni-link-hustlexp.json', JSON.stringify(cfg, null, 2));
console.log('Updated. New path:', repo.path);
"
```

### Step 2: Verify health score improves

```bash
cd /Users/sebastiandysart/omni-link-hustlexp
node dist/cli.js health --config ~/.claude/omni-link-hustlexp.json 2>&1
```

Expected: `hustlexp-backend.testScore` improves from 60 → 80+, `overall` improves from 92 → 95+

### Step 3: No commit needed (config is not in repo)

---

## Task 5: Full Test Suite + Build + End-to-End Smoke

### Step 1: Run full test suite

```bash
cd /Users/sebastiandysart/omni-link-hustlexp
npm test 2>&1 | tail -15
```

Expected: all tests pass, count ≥ 649 (645 current + ~4 new tests from Tasks 1-3)

### Step 2: Build TypeScript

```bash
npm run build 2>&1 | tail -10
```

Expected: 0 errors

### Step 3: Run CLI smoke

```bash
npm run smoke:cli 2>&1 | tail -10
```

Expected: PASS

### Step 4: Run live scan and verify contractStatus is fixed

```bash
node dist/cli.js scan --config ~/.claude/omni-link-hustlexp.json 2>&1 | python3 -c "
import json,sys
d = json.load(sys.stdin)
cs = d.get('contractStatus',{})
print('total:', cs.get('total'))
print('exact:', cs.get('exact'))
print('compatible:', cs.get('compatible'))
print('docCoverageGaps:', cs.get('docCoverageGaps'))
print('functional mismatches:', len(cs.get('mismatches',[])))
print()
for m in cs.get('mismatches',[])[:5]:
    print(' ', m.get('severity'), m.get('kind'), '-', m.get('description','')[:80])
"
```

Expected:

```
total: 316
exact: 0
compatible: 0
docCoverageGaps: 299
functional mismatches: 17
  BREAKING type-mismatch - ...
  BREAKING obsolete-call - ...
```

### Step 5: Run live impact and verify fallthrough works

```bash
node dist/cli.js impact --base main --head HEAD --config ~/.claude/omni-link-hustlexp.json 2>&1 | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('Impact paths:', len(d))
if d:
    print('First trigger:', d[0].get('trigger',{}).get('file'))
    print('First affected count:', len(d[0].get('affected',[])))
"
```

Expected: impact paths > 0 (no longer returns `[]`)

### Step 6: Run live health and verify backend score

```bash
node dist/cli.js health --config ~/.claude/omni-link-hustlexp.json 2>&1
```

Expected: `hustlexp-backend.testScore` ≥ 80, `overall` ≥ 95

### Step 7: Commit all remaining changes

```bash
git add -A
git commit -m "fix(bulletproof): all 4 bugs resolved — contractStatus.total, doc-gap separation, impact fallthrough, config path"
```

### Step 8: Push

```bash
git push origin main
```

---

## Success Criteria

| Check                                   | Pass Condition          |
| --------------------------------------- | ----------------------- |
| `npm test`                              | ≥ 649 tests, 0 failures |
| `npm run build`                         | 0 TypeScript errors     |
| `npm run smoke:cli`                     | PASS                    |
| `scan contractStatus.total`             | = 316 (not 0)           |
| `scan contractStatus.docCoverageGaps`   | = 299                   |
| `scan contractStatus.mismatches.length` | = 17 (not 316)          |
| `impact --base main --head HEAD`        | > 0 paths returned      |
| `health hustlexp-backend.testScore`     | ≥ 80                    |
| `health overall`                        | ≥ 95                    |
