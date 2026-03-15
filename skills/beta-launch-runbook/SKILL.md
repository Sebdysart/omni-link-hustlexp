---
name: beta-launch-runbook
description: 'Use when preparing HustleXP for public beta launch, verifying launch readiness, or determining what blockers remain before going live'
---

# HustleXP Beta Launch Runbook

The scorecard reads 100/100 — the journeys work. That is necessary but not sufficient. Five hard gates must clear before a single beta user touches real money. Work through them in order. Do not skip gates or reorder them.

---

## How to Use This Runbook

When asked about beta launch readiness, beta blockers, or "what do we need to do to launch":

1. State the current gate status (which gates are open, which are blocked)
2. Identify the first unclosed hard block and explain the exact fix
3. Never suggest launching while Gate 1, 2, or 3 have open items
4. Distinguish hard blocks (Gates 1–3) from required (Gate 4–5) from deferred (B3 list)

---

## Gate 1 — Legal (HARD BLOCK)

Nothing ships until every item below is complete. Legal documents are in `HUSTLEXP-DOCS/`. Six documents have unfilled placeholders.

- [ ] Fill `[State]` in ALL 6 documents — governing jurisdiction. **California requires separate counsel review**: triggers PAGA exposure and AB5/Dynamex independent contractor complications. Do not default to California without explicit legal sign-off.
- [ ] Fill `[Effective Date]` in all 6 documents:
  - Hustler Agreement
  - Poster Agreement
  - Beta NDA
  - Acceptable Use Policy (AUP)
  - Arbitration Agreement
  - Background Check Consent
- [ ] Fill `[Address]` — HustleXP legal department mailing address in Arbitration Agreement Sections 3.2 and 5.1
- [ ] Publish cancellation fee schedule at `https://hustlexp.com/legal/cancellation-fees` — Poster Agreement Exhibit A references this URL live; the page must exist before any Poster Agreement is executed
- [ ] Hire gig economy lawyer — must review: PAGA waiver enforceability, AAA 2024 fee schedule alignment, FCRA adverse action timeline for Checkr integration
- [ ] Checkr authorization — if no email response within 5 business days, follow up by phone via `dashboard.checkr.com` (account: "hustlr", email: dycejr@outlook.com)

---

## Gate 2 — P0 Revenue (HARD BLOCK)

Real money transactions must not occur with these bugs. The platform earns $0 and/or charges users incorrectly until both are fixed.

### Bug 1: Platform fee wired to $0

**File**: `hustlexp-ai-backend/src/services/StripeService.ts` line 162
**Problem**: `application_fee_amount` is not set correctly — platform earns $0 on every transaction
**Fix**: Use the `hustlexp-revenue-fixer` skill — it contains the exact patch
**Test**: After fix, create a test charge and verify `application_fee_amount` appears non-zero in Stripe dashboard

### Bug 2: Escrow fee uses wrong field

**File**: `hustlexp-ai-backend/src/services/EscrowService.ts` line 337
**Problem**: `grossPayoutCents = task.price` — should be `escrow.amount`
**Impact**: Fee calculation is based on task listing price, not actual escrowed amount — these can diverge
**Fix**: Change `task.price` → `escrow.amount` on line 337
**Test**: Create escrow with a different amount than task.price, verify fee is calculated from escrow.amount

---

## Gate 3 — Financial Safety (HARD BLOCK)

Users cannot file disputes without this. A fake success response means disputes are silently dropped.

### Bug: DisputeScreen fake submission

**File**: `hustlexp-ios/HustleXP/Screens/Shared/DisputeScreen.swift` lines 73–85
**Problem**: Dispute submission uses `DispatchQueue.main.asyncAfter(deadline: .now() + 2)` — simulates a 2-second delay then shows fake success. No dispute is stored in the database.
**Fix**: Replace the fake async block with a real tRPC call via `TRPCClient.shared`. Use the `ios-tRPC-wirer` skill for the wiring pattern.
**Test**: File a dispute in the app, verify a row appears in the `disputes` table in the database

---

## Gate 4 — iOS Feature Parity (Required for user trust)

These do not block financial transactions but will cause user-facing failures visible to beta testers.

- [ ] Remove squad stubs in `SquadService.swift` lines 151–171 — `getSquadTasks()`, `acceptSquadTask()`, and `getLeaderboard()` are all hardcoded mock returns, not real API calls
- [ ] Fix biometric proof result in `ProofSubmissionViewModel.swift` lines 280–284 — returns a mock response, not the real API result; users see false success on biometric proof submission
- [ ] Commit the 1 uncommitted change in the `hustlexp-ios` repo before launch (run `git status` to identify)

---

## Gate 5 — Backend Security (P1, pre-public-launch)

- [ ] **Zod validation coverage**: currently 79% (229/290 mutations). Target: 95%+. Use the `zod-audit` skill to identify unvalidated mutations and add `.input(z.object(...))` schemas.
- [ ] **Rate limiting**: verify `security.ts` middleware covers all 139+ mutation routes. Run a route count to confirm no mutations bypass the rate limiter.

---

## 6-Journey Smoke Test

Run all 6 journeys manually before launch day. Do not skip any. Record pass/fail for each step.

**J1 — Hustler Earn**

1. Browse available tasks as a Hustler
2. Accept a task
3. Complete the task and submit proof
4. Poster approves completion
5. Verify: Stripe payout initiated, `application_fee_amount` non-zero in Stripe dashboard

**J2 — Poster Help**

1. Create a task as a Poster
2. Fund escrow (Stripe PaymentIntent confirms)
3. Approve Hustler completion
4. Verify: escrow releases, Hustler receives correct net amount, platform fee appears

**J3 — Messaging**

1. Hustler and Poster exchange at least 3 messages on an active task
2. Verify: messages persist in DB, both parties see them in real time

**J4 — Trust**

1. Upload ID document as a Hustler
2. Complete background check consent flow
3. Verify: trust tier updates in Hustler profile

**J5 — Disputes**

1. File a dispute on a completed task (after Gate 3 is fixed)
2. Verify: dispute appears in DB, jury notification sent, vote recorded, resolution applied
3. Confirm: escrow transitions from `LOCKED_DISPUTE` → correct terminal state

**J6 — Admin**

1. Ban a test user via admin panel
2. Refund an escrow via admin panel
3. View financials dashboard — verify transaction history is accurate

---

## Launch Day Verification Commands

Run these in order on launch day. All three must pass before opening beta invites.

```bash
# 1. Backend test suite — must show 0 failures and ≥ 88.88% coverage
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend
npx vitest run --coverage 2>&1 | tail -5

# 2. Ecosystem health — must show 100/100 overall
node /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js health

# 3. Payload drift — must be ≤ 11 (the irreducible floor; anything above 11 is a regression)
node /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js authority-status
```

**Interpreting payloadDrift**: The floor is exactly 11. These are irreducible Swift↔TypeScript type-representation differences (named enums vs string literals, `[String:Bool]` vs `Record<string,boolean>`, named structs vs inline objects). They are not real field mismatches. Do not attempt to fix them. If drift reads >11, a real regression has been introduced — stop and investigate before proceeding.

---

## First 24 Hours Post-Launch Monitoring

Check each of these within the first 24 hours of accepting beta users:

| Check               | What to Look For                                                              | Tool                        |
| ------------------- | ----------------------------------------------------------------------------- | --------------------------- |
| Stripe platform fee | `application_fee_amount` > 0 on all charges                                   | Stripe dashboard → Payments |
| Dispute storage     | Disputes filed by users appear in `disputes` table                            | Supabase / DB query         |
| Server errors       | Monitor for 500s in Hono server logs                                          | Backend logs                |
| Escrow fee accuracy | Spot-check 3 completed tasks: `escrow.amount` used for fee (not `task.price`) | DB query                    |

---

## Deferred — Do NOT Work On These Until Beta Revenue Is Flowing

These items are B3 (post-beta). Do not let anyone pull you onto these during the beta sprint.

- Checkr full API integration (pending account authorization — contact in progress)
- Android app
- Squads full feature (stub removal in Gate 4 is sufficient for beta; full feature is B3)
- Insurance claims full UI
- AWS Rekognition biometric step-up authentication
- FCM push token registration hardening
- Real R2 photo upload in messaging (current implementation is sufficient for beta)

---

## Gate Summary Card

| Gate                                                 | Type       | Status                       |
| ---------------------------------------------------- | ---------- | ---------------------------- |
| Gate 1: Legal documents                              | HARD BLOCK | Open — placeholders unfilled |
| Gate 2: Revenue bugs (StripeService + EscrowService) | HARD BLOCK | Open — 2 bugs confirmed      |
| Gate 3: DisputeScreen fake success                   | HARD BLOCK | Open — bug confirmed         |
| Gate 4: iOS feature parity                           | Required   | Partial — 3 items            |
| Gate 5: Backend security                             | P1         | Partial — Zod at 79%         |
| 6-Journey smoke test                                 | Pre-launch | Not yet run                  |

**Do not launch until Gates 1, 2, and 3 are all closed.**
