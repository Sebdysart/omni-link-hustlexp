---
name: hustlexp-tdd
description: 'Use when implementing any feature or fix in HustleXP backend, before writing implementation code — enforces 88.88% coverage floor and correct mock/pagination patterns'
---

# HustleXP TDD Discipline Guide

**STOP. Do not write implementation code yet.** This skill enforces the TDD cycle for HustleXP backend. Every feature, fix, or refactor follows RED → GREEN → REFACTOR → VERIFY — in that order, no exceptions.

---

## Why This Matters

The backend ecosystem health is 100/100. It got there by reaching 88.88% line coverage in March 2026. Dropping below that threshold cascades:

```
Coverage < 88.88%
→ testScore = round(sqrt(coverage/100)*100) drops below 94
→ backend overall drops from ~99
→ ecosystem health drops from 100 to ~88
→ orbit config flags HEALTH-CRITICAL
```

**88.88% is a hard floor. Non-negotiable. Never merge code that drops coverage below it.**

---

## The TDD Cycle

### Step 1 — RED: Write the test first

Create the test file before touching any source file.

```
Location: backend/tests/unit/{service-name}.test.ts
          backend/tests/unit/{router-name}.test.ts
Runner:   vitest
Config:   vitest.config.ts in backend root
```

Run it. It must fail with a clear error — either "cannot find module" or the assertion failing. If the test passes before you write implementation, the test is wrong.

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run tests/unit/your-new-feature.test.ts
# Expected: FAIL — this is correct
```

### Step 2 — GREEN: Write minimal implementation

Write the smallest amount of code that makes the test pass. Do not write more than the test demands.

### Step 3 — REFACTOR: Clean up

Clean the implementation. Run the single test file again to confirm it still passes.

### Step 4 — VERIFY: Full suite + coverage

This step is mandatory before any commit.

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run --coverage 2>&1 | grep -E "Coverage|Lines|Statements|Branches|Functions|Tests|failed"
```

The Lines coverage reported must be ≥ 88.88%. If it is not, add more tests before committing.

Full suite health check:

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run 2>&1 | tail -5
# Must show 0 failures
```

---

## The Canonical Mock Pattern

Use this exact structure. Do not improvise.

```typescript
// AT TOP OF FILE — before any describe blocks
vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    escrow: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    // Only mock the models your service actually touches
  },
}));

vi.mock('../../src/lib/redis', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// IN beforeEach — ALWAYS reset mock call history
beforeEach(() => {
  vi.clearAllMocks(); // clears call history, preserves mock implementations
});
```

---

## CRITICAL: Which Mock Reset to Use

This caused a real bug in the March 2026 sprint. Get this right.

| Method                 | Clears call history | Resets implementations | Use when                                          |
| ---------------------- | ------------------- | ---------------------- | ------------------------------------------------- |
| `vi.clearAllMocks()`   | Yes                 | No                     | **Always in beforeEach**                          |
| `vi.resetAllMocks()`   | Yes                 | Yes                    | **Never in beforeEach** — breaks once-queue tests |
| `vi.restoreAllMocks()` | Yes                 | Restores originals     | Only when using `vi.spyOn()`                      |

The once-queue pattern (`.mockResolvedValueOnce()`) depends on implementations surviving between test setup and test execution. `vi.resetAllMocks()` wipes those queued values. Use `vi.clearAllMocks()`.

---

## Pagination Test Shape

HustleXP routers use offset-based pagination. Cursor-based pagination was planned but never implemented. AI tools sometimes generate the wrong shape from memory.

```typescript
// CORRECT — always this shape
const result = await caller.something.listItems({ limit: 10, offset: 0 });
expect(result.collection).toHaveLength(10);
expect(result.total).toBe(totalCount);

// WRONG — cursor pagination does not exist in this codebase
expect(result.items).toHaveLength(10); // ❌
expect(result.nextCursor).toBeDefined(); // ❌
```

---

## The Timestamp Collision Trap

Stripe deduplication uses timestamps. If two operations occur in the same millisecond in a test, the dedup logic treats the second as a duplicate and returns the first result — making the test pass for the wrong reason, or fail unexpectedly.

```typescript
// BAD — same millisecond, dedup fires
const r1 = await stripeService.createPaymentIntent(...)
const r2 = await stripeService.createPaymentIntent(...) // may dedup against r1

// GOOD — 1ms gap guarantees distinct timestamps
const r1 = await stripeService.createPaymentIntent(...)
await new Promise(r => setTimeout(r, 1))
const r2 = await stripeService.createPaymentIntent(...)
```

---

## Coverage Exclusions

These paths are intentionally excluded from coverage measurement in `vitest.config.ts`:

- `server.ts` — startup/infra, not unit-testable
- `backend/src/test/**` — test helpers don't count toward coverage

Do not add new exclusions without explicit approval. Every exclusion is a coverage debt.

---

## Example: Adding a Feature to EscrowService

Concrete walkthrough for "calculate and store worker reputation delta on task release."

### RED — write the failing test first

```typescript
// backend/tests/unit/escrow-service.test.ts (add to existing file or create new)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    escrow: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workerReputation: {
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma';
import { EscrowService } from '../../src/services/escrow-service';

describe('EscrowService.releaseWithReputationDelta', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // clearAllMocks — NOT resetAllMocks
  });

  it('calculates and stores positive reputation delta on successful release', async () => {
    const mockEscrow = {
      id: 'escrow-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      amount: 100,
      status: 'FUNDED',
    };

    vi.mocked(prisma.escrow.findUnique).mockResolvedValueOnce(mockEscrow);
    vi.mocked(prisma.escrow.update).mockResolvedValueOnce({ ...mockEscrow, status: 'RELEASED' });
    vi.mocked(prisma.workerReputation.upsert).mockResolvedValueOnce({
      workerId: 'worker-1',
      delta: 10,
    });

    const result = await EscrowService.release('escrow-1', { rating: 5 });

    expect(prisma.workerReputation.upsert).toHaveBeenCalledWith({
      where: { workerId: 'worker-1' },
      create: expect.objectContaining({ workerId: 'worker-1', delta: expect.any(Number) }),
      update: expect.objectContaining({ delta: expect.any(Number) }),
    });
    expect(result.reputationDelta).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run tests/unit/escrow-service.test.ts` → **FAIL** (expected).

### GREEN — write the implementation

Now open `src/services/escrow-service.ts` and add the minimal code to make the test pass.

### VERIFY — confirm coverage floor holds

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run --coverage 2>&1 | grep -E "Lines|failed"
# Lines must be ≥ 88.88%
# failed must be 0
```

---

## Red Flags — Stop Immediately

If you catch yourself doing any of these, stop and return to step 1:

- Writing implementation code before a test file exists
- Saying "I'll add tests after"
- Running coverage and seeing Lines < 88.88% and committing anyway
- Writing `expect(result.items)` or `expect(result.nextCursor)` (cursor shape — wrong)
- Using `vi.resetAllMocks()` in `beforeEach`
- Not calling `vi.clearAllMocks()` in `beforeEach` at all (state pollution between tests)
- Adding a new source file without a corresponding test file

---

## Coverage Math Reference

```
testScore = round(sqrt(coverage / 100) * 100)

At 88.88% lines:  testScore = round(sqrt(0.8888) * 100) = round(94.28) = 94
At 80.00% lines:  testScore = round(sqrt(0.80)   * 100) = round(89.44) = 89
At 70.00% lines:  testScore = round(sqrt(0.70)   * 100) = round(83.67) = 84

backend overall = round(todo*0.15 + dead*0.25 + test*0.25 + quality*0.35)
ecosystem       = round(average of backend + iOS + docs scores)

Maintain testScore ≥ 94 to keep ecosystem at 100/100.
```
