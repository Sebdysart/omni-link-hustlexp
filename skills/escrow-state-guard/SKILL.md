---
name: escrow-state-guard
description: 'Use when modifying EscrowService, StripeService, DisputeService, or any code that reads or writes escrow state, creates PaymentIntents, releases funds, or handles disputes in HustleXP'
---

# Escrow State Guard

This skill enforces mandatory pre-change verification before any modification to the HustleXP escrow subsystem. The escrow pipeline handles real money. Violations cause financial loss, regulatory exposure, or double-payouts.

**STOP. Before writing a single line of code, complete every item in the checklist below.**

---

## The Escrow State Machine

Valid transitions only. Any other transition is illegal and must throw.

```
PENDING       → FUNDED         (Stripe PaymentIntent confirmed)
FUNDED        → RELEASED       (task completed + poster approved)
FUNDED        → REFUNDED       (task cancelled or poster wins dispute)
FUNDED        → LOCKED_DISPUTE (dispute filed by either party)
LOCKED_DISPUTE → RELEASED      (dispute resolved in worker's favor)
LOCKED_DISPUTE → REFUNDED      (dispute resolved in poster's favor)
LOCKED_DISPUTE → REFUND_PARTIAL (split resolution)
```

Terminal states — no further transitions ever: `RELEASED`, `REFUNDED`, `REFUND_PARTIAL`

**There is no such thing as PENDING → RELEASED, PENDING → REFUNDED (direct), or any path that skips FUNDED.**

---

## Four Invariants — Never Violate

### INV-1: State machine integrity

Never skip states. PENDING cannot go directly to RELEASED. Every transition must be in the valid list above. If a proposed change introduces a transition not listed, **STOP and reject it**.

### INV-2: KYC Gate (Feb 2026 audit fix — CRITICAL)

`EscrowService.release()` MUST verify both conditions before any funds move:

1. Worker has `stripe_connect_id` set (not null)
2. Worker's Stripe account has `payouts_enabled: true`

File: `backend/src/services/EscrowService.ts`, `release()` method, lines ~341–380.

Any change that adds a new payout path, adds an alternate `release` method, or adds a bypass flag MUST include this same KYC check. No exceptions.

### INV-3: Fee correctness

Platform fee must be: `Math.round(escrow.amount * 0.15 * 100)` — 15% of the **escrow amount** in cents.

- Never $0
- Never omitted from the Stripe transfer/payout call
- Config: `config.stripe.platformFeePercent` (default 15)

### INV-4: Surge correctness

`escrow.amount` = `task.price` + `surge_premium`. Always use `escrow.amount` for fee calculations, never `task.price` alone. Surge premium must flow into the platform cut.

---

## Pre-Change Checklist (MANDATORY)

Answer every question before touching any file.

**1. Which state transition does this change affect?**

- Write it out: `FROM_STATE → TO_STATE`
- Is it in the valid transitions list above?
- If NOT in the list → **STOP. Do not implement. Explain why to the user.**

**2. Does this change touch `release()`?**

- Yes → Confirm INV-2 KYC gate remains intact (both `stripe_connect_id` and `payouts_enabled` checks still present after your edit)
- Any new payout path must include the identical KYC check

**3. Does this change affect fee calculation?**

- Yes → Confirm INV-3: fee uses `escrow.amount`, not `task.price`
- Yes → Confirm INV-4: surge premium is included in `escrow.amount`

**4. Does this change introduce a new way to move money?**

- Instant payouts, bank transfers, alternative payout methods — ALL must go through the same FUNDED → RELEASED flow
- "Instant" refers only to Stripe's payout speed setting, not a state machine shortcut
- There is no valid escrow path that bypasses FUNDED state

**5. Run the baseline test suite before making any changes:**

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run backend/tests/unit/escrow-service.test.ts
```

Must be green before you start. If it is not green, fix the test environment first.

---

## Files That Require This Guard

Any modification to these files triggers the full checklist:

| File                                     | Why                                                      |
| ---------------------------------------- | -------------------------------------------------------- |
| `backend/src/services/EscrowService.ts`  | Primary FSM — all state transitions live here            |
| `backend/src/services/StripeService.ts`  | PaymentIntent creation and capture                       |
| `backend/src/services/DisputeService.ts` | Dispute state transitions (FUNDED → LOCKED_DISPUTE path) |
| `backend/src/routers/escrow.ts`          | tRPC procedures — callers of the FSM                     |

---

## Red Flags — STOP Immediately

If any of the following are true about a proposed change, refuse to implement and explain why:

- The change introduces a state transition not in the valid list
- The change adds a payout path that bypasses `payouts_enabled` check
- The change uses `task.price` instead of `escrow.amount` in fee math
- The change adds a method like `instantRelease()`, `directPayout()`, or `bankTransfer()` that does not go through the FUNDED → RELEASED flow
- The change sets `application_fee_amount` to `0` or removes it from the Stripe call
- The change transitions escrow state from worker-side code without poster confirmation
- The change lets PENDING skip directly to any terminal state

---

## How to Implement a New Payout Feature Correctly

If the request is "add instant payouts to bank accounts":

1. This is a **Stripe payout speed** change, not a state machine change.
2. The escrow must still go through: FUNDED → RELEASED via `EscrowService.release()`
3. After RELEASED, Stripe's transfer can use `method: 'instant'` if the worker's bank supports it
4. The KYC gate (INV-2) still applies — `payouts_enabled` must be true
5. Fees still apply — INV-3 and INV-4 unchanged
6. Verify: `npx vitest run backend/tests/unit/escrow-service.test.ts` green before and after

**Correct approach sketch:**

```typescript
// In StripeService.ts — after EscrowService.release() succeeds
// Change ONLY the payout speed, not the escrow flow
await stripe.payouts.create(
  {
    amount: netPayoutCents,
    currency: 'usd',
    method: 'instant', // <-- this is the only "instant" change
  },
  {
    stripeAccount: workerStripeConnectId,
  },
);
```

The escrow state machine is untouched. The KYC gate is untouched. The fee calculation is untouched.

---

## Post-Change Verification

After making any change:

1. Run escrow unit tests:

   ```bash
   npx vitest run backend/tests/unit/escrow-service.test.ts
   npx vitest run backend/tests/unit/escrow-service-branches.test.ts
   npx vitest run backend/tests/unit/escrow-router.test.ts
   ```

2. Run full suite:

   ```bash
   npx vitest run
   ```

3. Confirm state machine valid-transitions map in `EscrowService.ts` (`VALID_TRANSITIONS`) is unchanged unless you explicitly added a documented new valid transition.

4. Confirm KYC gate (INV-2) still present in `release()` — both `stripe_connect_id` and `payouts_enabled` checks.

5. If any test fails, **do not push**. Fix before committing to any escrow-touching branch.

---

## Context: Why These Rules Exist

- **Feb 2026 audit** found KYC gate was missing from `release()` — funds could be sent to workers who had not completed Stripe Connect onboarding, violating FinCEN/BSA compliance. Fix committed. Must never be removed.
- **Surge premium bug class**: Calculating fees on `task.price` instead of `escrow.amount` causes platform undercut when surge is active — real revenue loss.
- **State machine integrity**: Double-release is prevented by a PostgreSQL trigger (`prevent_double_release`), but invalid transitions cause undefined behavior upstream.
- **payloadDrift floor**: 11 irreducible type-repr differences between Swift and TypeScript exist in this subsystem. Do not attempt to "fix" them by changing escrow field names or types — they are structural and documented.
