---
name: hustlexp-revenue-fixer
description: Use when fixing HustleXP revenue collection bugs including Stripe platform fee not being collected (application_fee_amount missing), escrow fee miscalculation using task.price instead of escrow.amount, self-insurance pool never funded, tip platform cut absent, subscription renewal revenue not logged, or XP tax path unreachable. Covers all platform fee issues and financial invariant checks.
---

# HustleXP Revenue Fixer Runbook

## Financial Invariants — Check BEFORE and AFTER every fix

- **INV-1**: Escrow state machine — PENDING → FUNDED → RELEASED/REFUNDED/DISPUTED only. Never skip states.
- **INV-2**: `payouts_enabled` AND `stripe_connect_id` must be verified before any escrow release.
- **INV-3**: `application_fee_amount` must ALWAYS be set on PaymentIntent creation. If it is absent, platform earns $0.
- **INV-4**: Fee calculations must use `escrow.amount` (task price + surge), never bare `task.price`.

---

## Bug Inventory and Fixes (dependency-safe order)

### P0 Bug 1 — application_fee_amount never passed (HIGHEST URGENCY)

**File**: `backend/src/services/StripeService.ts` line 162
**Problem**: Platform fee is stored in PaymentIntent metadata only. `application_fee_amount` is never passed to the Stripe API. Platform earns $0 in platform fees.
**Fix**: Inside `stripe.paymentIntents.create(...)`, add:

```typescript
application_fee_amount: Math.round(taskPrice * 0.15 * 100),
```

Note: 15% of task price, converted to cents (integer). Do NOT use dollars.
**Verification**: Stripe dashboard → Payments → filter by connected account → confirm platform fee shown on each charge.

---

### P0 Bug 2 — Escrow fee calculation uses wrong amount

**File**: `backend/src/services/EscrowService.ts` line 337
**Problem**: `grossPayoutCents = task.price` — this misses the surge premium. Surge is applied to `escrow.amount`, not base `task.price`.
**Fix**: Change `task.price` to `escrow.amount` on line 337.
**Verification**: Create a surged task; confirm platform fee includes surge premium in the payout record.

---

### P1 Bug 3 — Self-insurance pool never funded

**File**: `backend/src/services/EscrowService.ts` — inside `release()` method
**Problem**: `SelfInsurancePoolService.recordContribution()` exists but is never called. Pool is permanently $0.
**Fix**: Add after every successful escrow release:

```typescript
await SelfInsurancePoolService.recordContribution(escrowId, contributionAmount);
```

**Verification**: Check `self_insurance_pool` table after a test escrow release — row must appear.

---

### P1 Bug 4 — Tips earn $0 and cost Stripe fees

**File**: `backend/src/services/TippingService.ts` line 98
**Problem**: Tips have no platform cut. Platform pays Stripe processing fees on tips with zero offsetting revenue.
**Fix**: Add 5–8% platform cut on tips.
**LEGAL REQUIREMENT**: After changing tip fee percentage, update fee disclosure sections in both:

- Poster Agreement
- Hustler Agreement
  Use the `legal-document-manager` skill for those updates. Do NOT ship this fix without the legal doc update.

---

### P1 Bug 5 — Subscription renewal revenue not logged

**Problem**: The `invoice.payment_succeeded` Stripe webhook is not wired for recurring subscriptions. Only month-1 revenue is logged; all renewal revenue is silently lost.
**Fix**: Wire a handler for the `invoice.payment_succeeded` event in the Stripe webhook router.
**Verification**: Trigger a test subscription renewal via Stripe CLI and confirm revenue row is created.

---

### P1 Bug 6 — XP tax path unreachable

**File**: `backend/src/services/EscrowService.ts` line 436
**Problem**: `paymentMethod` is hardcoded to `'escrow'`, making the XP tax branch unreachable for any other payment method.
**Fix**: Derive `paymentMethod` from task metadata instead of hardcoding.

---

## Fix Order (dependency-safe)

1. StripeService.ts:162 — `application_fee_amount` (P0, zero dependencies, do first)
2. EscrowService.ts:337 — `escrow.amount` vs `task.price` (P0, understand escrow model first)
3. EscrowService.ts release() — self-insurance pool call (additive, low risk)
4. TippingService.ts:98 — tip platform cut + legal docs (requires legal-document-manager skill)
5. Stripe webhook router — wire `invoice.payment_succeeded`
6. EscrowService.ts:436 — XP tax path

---

## Test Sequence After All Fixes

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run --coverage 2>&1 | tail -20
```

Must show: **0 failures** and **coverage ≥ 88.88%** (backend testScore threshold to keep ecosystem health at 100/100).

---

## Key Project Paths

- Backend: `/Users/sebastiandysart/Desktop/hustlexp-ai-backend`
- StripeService: `backend/src/services/StripeService.ts`
- EscrowService: `backend/src/services/EscrowService.ts`
- TippingService: `backend/src/services/TippingService.ts`
- Stripe webhook router: `backend/src/routers/` (search for `invoice.payment_succeeded`)
