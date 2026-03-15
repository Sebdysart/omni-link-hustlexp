---
name: zod-audit
description: Use when auditing tRPC procedure input validation in HustleXP backend, adding Zod schemas to mutation procedures, or verifying hustlerProcedure and posterProcedure inputs are validated
---

# Zod Input Validation Audit Skill

## Context

This skill covers auditing and adding Zod input validation to tRPC procedures in the HustleXP backend.

- **Backend location**: `/Users/sebastiandysart/Desktop/hustlexp-ai-backend/backend/src/routers/`
- **tRPC setup**: `/Users/sebastiandysart/Desktop/hustlexp-ai-backend/backend/src/trpc.ts`
- **iOS services**: `/Users/sebastiandysart/HustleXP/HUSTLEXPFINAL1/hustleXP final1/Services/`
- **Current coverage**: ~66% (300/456 procedures) — target 95%+
- **~456 tRPC procedures** across 49 routers

## Procedure Wrappers (from `backend/src/trpc.ts`)

Four procedure types in order of privilege:

```typescript
publicProcedure; // No auth — public queries only
protectedProcedure; // Firebase auth required — any authenticated user
hustlerProcedure; // Auth + default_mode === 'worker'
posterProcedure; // Auth + default_mode === 'poster'
adminProcedure; // Auth + admin_roles table entry
```

Authentication is handled by the wrapper. Zod `.input()` is the separate validation layer on top.

## The Canonical Zod Pattern

```typescript
import { z } from 'zod';
import { router, hustlerProcedure, posterProcedure, Schemas } from '../trpc.js';

export const myRouter = router({
  // BEFORE (no validation — dangerous):
  doSomething: hustlerProcedure.mutation(async ({ ctx, input }) => {
    /* input is any */
  }),

  // AFTER (with validation):
  doSomething: hustlerProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        reason: z.string().min(1).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // input.taskId and input.reason are now typed + validated
    }),
});
```

## Reusable Schemas from `Schemas` Export

`trpc.ts` exports a `Schemas` object — always prefer these over re-defining:

```typescript
import { Schemas } from '../trpc.js';

// IDs
Schemas.uuid; // z.string().uuid()

// Task creation
Schemas.createTask; // full task creation shape

// Escrow
Schemas.fundEscrow; // { escrowId, stripePaymentIntentId }
Schemas.releaseEscrow; // { escrowId, stripeTransferId? }

// Proof
Schemas.submitProof; // { taskId, description? }
Schemas.reviewProof; // { proofId, decision, reason? }

// XP
Schemas.awardXP; // { taskId, escrowId, baseXP }

// Pagination — offset-based (what all existing routers use)
Schemas.pagination; // { limit, offset } — use this, NOT cursor
Schemas.cursorPagination; // { cursor?, limit } — reserved for future

// Onboarding AI
Schemas.submitCalibration; // { calibrationPrompt, onboardingVersion }
Schemas.confirmRole; // { confirmedMode, overrideAI }
```

## Common Inline Types (when Schemas doesn't cover it)

```typescript
// Task-related IDs
taskId: z.string().uuid();
workerId: z.string().uuid();
posterId: z.string().uuid();
squadId: z.string().uuid();
escrowId: z.string().uuid();

// Money (always in cents — never floats)
amountCents: z.number().int().positive();

// Bounded strings
reason: z.string().min(1).max(1000);
description: z.string().min(1).max(5000);
note: z.string().max(500).optional();

// Pagination — offset-based (ALL routers use this, not cursor-based)
limit: z.number().int().min(1).max(100).default(20);
offset: z.number().int().min(0).default(0);

// Status enums — match what iOS sends (check Swift struct)
status: z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
```

## CRITICAL: Check iOS Callers Before Writing Schemas

Never add required fields that iOS doesn't send. The iOS app is the source of truth for what fields exist.

**Step 1 — Find the matching Swift service:**

```
/Users/sebastiandysart/HustleXP/HUSTLEXPFINAL1/hustleXP final1/Services/<RouterName>Service.swift
```

**Step 2 — Find the call site.** iOS services use `TRPCClient.shared.call()`:

```swift
// Example from SquadService.swift:
let _: EmptyResponse = try await trpc.call(
    router: "squad",
    procedure: "disband",
    input: DisbandInput(id: id)
)
```

**Step 3 — Match the Swift struct to a Zod schema:**

```swift
// Swift struct DisbandInput:
struct DisbandInput: Encodable {
    let id: String
}
```

```typescript
// Correct Zod schema (matches what iOS currently sends):
.input(z.object({ id: z.string().uuid() }))
// NOTE: squad.ts:455 currently uses { squadId } — this is a LIVE BUG (see below)
// Field name must match what Swift sends
```

**Step 4 — Check `keyDecodingStrategy`**: `TRPCClient.swift` uses `.convertFromSnakeCase`, so iOS sends camelCase keys. The backend receives camelCase. Zod schemas should use camelCase field names.

## Known Active Mismatches (LIVE BUGS)

These are confirmed field-name mismatches between iOS and backend that cause runtime failures right now. Fix before adding new validation.

### LIVE BUG: squad.disband field mismatch

- **iOS sends** (`SquadService.swift`, `DisbandInput`): `{ id: String }`
- **Backend validates** (`squad.ts:455`): `.input(z.object({ squadId: Schemas.uuid }))` — expects `squadId`
- **Effect**: `squad.disband` fails in production — Zod rejects the iOS payload because `id` does not match the expected `squadId` field
- **Fix options** (pick one, verify against DB column name first):
  - Change `squad.ts:455` to `.input(z.object({ id: Schemas.uuid }))` and update the handler to use `input.id`
  - Change `SquadService.swift` `DisbandInput` to use `squadId` instead of `id`
- **Before fixing**: grep the DB query in the handler to confirm whether the SQL uses `squad_id` or `id` as the parameter name — this determines which side is "correct"

## Finding Unvalidated Procedures

```bash
# Method 1: Find procedures missing .input() in a specific router
grep -n "\.mutation\|\.query" /Users/sebastiandysart/Desktop/hustlexp-ai-backend/backend/src/routers/squad.ts | grep -v "\.input("

# Method 2: Cross-reference procedure declarations with .input() calls
grep -n "posterProcedure\|hustlerProcedure\|protectedProcedure\|publicProcedure\|adminProcedure" backend/src/routers/squad.ts
grep -n "\.input(" backend/src/routers/squad.ts
# Compare line numbers — procedures without a preceding .input() are unvalidated

# Method 3: Coverage scan across all routers
for f in /Users/sebastiandysart/Desktop/hustlexp-ai-backend/backend/src/routers/*.ts; do
  total=$(grep -c "\.mutation\b\|\.query\b" "$f" 2>/dev/null || echo 0)
  validated=$(grep -c "\.input(" "$f" 2>/dev/null || echo 0)
  echo "$(basename $f): $validated/$total validated"
done
```

## Priority Routers (Worst Coverage, Most Impact)

Based on current audit (as of Mar 2026):

| Router             | Validated | Total | Gap | Priority                    |
| ------------------ | --------- | ----- | --- | --------------------------- |
| `squad.ts`         | 15        | 41    | 26  | High — squad ops            |
| `referral.ts`      | 3         | 11    | 8   | High                        |
| `recurringTask.ts` | 10        | 22    | 12  | High                        |
| `subscription.ts`  | 4         | 14    | 10  | High — billing              |
| `task.ts`          | 18        | 34    | 16  | Critical — task lifecycle   |
| `ui.ts`            | 5         | 12    | 7   | Medium                      |
| `challenges.ts`    | 2         | 8     | 6   | Medium                      |
| `featured.ts`      | 3         | 8     | 5   | Medium                      |
| `escrow.ts`        | 10        | 12    | 2   | Critical — financial safety |
| `admin.ts`         | 7         | 18    | 11  | High — admin ops            |

**Always prioritize financial routers (escrow, subscription, stripeConnect) regardless of gap size.**

## Procedures That Legitimately Have No .input()

Some procedures take no input and that is correct:

```typescript
// Correct — no-arg query using .input(z.void()) or just no .input()
leaderboard: protectedProcedure
  .input(z.void())
  .query(async ({ ctx }) => { ... })

// Also correct — .query() with no input when iOS sends EmptyInput()
listMine: protectedProcedure
  .input(z.object({}).optional())
  .query(async ({ ctx }) => { ... })
```

Check the iOS call site. If iOS sends `EmptyInput()`, the backend can accept `z.void()` or `z.object({}).optional()`.

## Step-by-Step Audit Workflow

1. **Identify gap** — run the coverage scan above, pick a router
2. **Read the router** — note procedure names and types
3. **Find iOS caller** — locate the Swift service file, read the input struct for each unvalidated procedure
4. **Write schema** — use Schemas.\* where applicable, inline z.object() otherwise
5. **Test** — run vitest, check 0 failures and coverage maintained
6. **Track progress** — report updated count

## After Every Change

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run 2>&1 | tail -15
# Requirements:
# - 0 test failures
# - Statement coverage must stay >= 88.88%
# - If coverage drops, add tests before committing
```

## Progress Tracking Format

When reporting audit progress, always use this format:

```
Zod Audit Progress: X/456 validated (Y%)
Session additions: +N procedures in [router list]
Remaining priority: squad.ts (26 gap), task.ts (16 gap), recurringTask.ts (12 gap)
```

## What NOT To Do

- Do NOT add `.input(z.any())` — this defeats the purpose
- Do NOT add required fields the iOS caller doesn't send — it will break existing callers
- Do NOT change field names in existing validated procedures — breaks iOS
- Do NOT use cursor-based pagination — all routers use offset (`Schemas.pagination`)
- Do NOT skip the iOS caller check — you will write the wrong shape
- Do NOT commit without running the full test suite first
