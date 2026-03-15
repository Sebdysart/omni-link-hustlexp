---
name: stripe-webhook-auditor
description: 'Use when wiring Stripe webhook handlers in HustleXP, debugging missing revenue logging, subscription renewal gaps, payout failures, or auditing webhook event coverage'
---

# Stripe Webhook Auditor

This skill provides the complete architecture, known gaps, and fix patterns for HustleXP's Stripe webhook pipeline. When subscription revenue is missing, when payout failures are silent, or when you need to audit webhook coverage, start here.

---

## Architecture: How Webhooks Flow

HustleXP uses a **store-then-dispatch** pattern. There is NO business logic in the HTTP handler.

```
Stripe → POST /webhooks/stripe (server.ts)
           ↓
    StripeWebhookService.processWebhook()
    (backend/src/services/StripeWebhookService.ts)
           ↓
    1. Verify signature (stripe.webhooks.constructEvent)
    2. INSERT INTO stripe_events … ON CONFLICT DO NOTHING  ← idempotency S-1
    3. writeToOutbox({ queueName: 'critical_payments' })   ← BullMQ enqueue
           ↓
    stripe-event-worker (backend/src/jobs/stripe-event-worker.ts)
    processStripeEventJob(job)
           ↓
    1. Atomic UPDATE claim (WHERE claimed_at IS NULL AND processed_at IS NULL)
    2. switch(type) → dispatch to processor
    3. UPDATE stripe_events SET result='success', processed_at=NOW()
```

**Key files:**

- HTTP ingestion: `backend/src/server.ts` lines ~661–691
- Signature verify + store + enqueue: `backend/src/services/StripeWebhookService.ts`
- Event dispatch switch: `backend/src/jobs/stripe-event-worker.ts`
- Subscription lifecycle: `backend/src/services/StripeSubscriptionProcessor.ts`
- Revenue ledger writes: `backend/src/services/RevenueService.ts`

---

## P1 Revenue Bug: `invoice.payment_succeeded` Is NOT Wired

**Symptom**: Month 1 subscription revenue is logged. Month 2, 3, etc. are invisible.

**Root cause**: The `switch(type)` in `stripe-event-worker.ts` has no `case 'invoice.payment_succeeded'`.

**What IS wired vs. what IS NOT:**

| Event                           | Status      | Where handled                                       |
| ------------------------------- | ----------- | --------------------------------------------------- |
| `customer.subscription.created` | WIRED       | `processSubscriptionEvent()`                        |
| `customer.subscription.updated` | WIRED       | `processSubscriptionEvent()`                        |
| `customer.subscription.deleted` | WIRED       | `processSubscriptionEvent()`                        |
| `checkout.session.completed`    | WIRED       | `handleCheckoutSessionCompleted()`                  |
| `payment_intent.succeeded`      | WIRED       | `processEntitlementPurchase()` (per-task only)      |
| `invoice.payment_failed`        | WIRED       | `handleInvoicePaymentFailed()` — grace period logic |
| `account.updated`               | WIRED       | `handleAccountUpdated()` — KYC sync                 |
| **`invoice.payment_succeeded`** | **MISSING** | **Nothing — P1 revenue gap**                        |
| `payout.paid`                   | MISSING     | Unhandled event type (logged as skipped)            |
| `payout.failed`                 | MISSING     | Silent failure — Hustlers not notified              |
| `charge.dispute.created`        | MISSING     | Stripe chargeback — escrow not frozen               |

---

## The Fix: Adding `invoice.payment_succeeded`

**Step 1 — Verify it's missing:**

```bash
grep -n "invoice.payment_succeeded\|invoice_payment_succeeded" \
  /Users/sebastiandysart/Desktop/hustlexp-ai-backend/backend/src/jobs/stripe-event-worker.ts
# Should return zero results
```

**Step 2 — Understand the revenue ledger schema:**

`RevenueService.logEvent()` accepts `eventType: 'subscription'` for renewal revenue. The ledger already has a `subscription_revenue` column in its P&L view. Use `RevenueService` — do NOT write to `revenue_ledger` directly.

Fields needed:

- `eventType: 'subscription'`
- `userId` — from `invoice.metadata.user_id`
- `amountCents` — from `invoice.amount_paid`
- `stripeEventId` — from the Stripe event `id` (idempotency key already stored in `stripe_events`)
- `stripeSubscriptionId` — from `invoice.subscription`

**Step 3 — Add the case in `stripe-event-worker.ts`:**

```typescript
case 'invoice.payment_succeeded': {
  await handleInvoicePaymentSucceeded(event, stripeEventId);
  break;
}
```

**Step 4 — Implement the handler (idempotent):**

```typescript
async function handleInvoicePaymentSucceeded(
  event: StripeEventEnvelope,
  stripeEventId: string,
): Promise<void> {
  const invoice = getEventObject<Record<string, unknown>>(event);
  if (!invoice) throw new Error('invoice.payment_succeeded missing invoice object');

  // Only log subscription renewals — not one-time charges
  const billingReason = invoice.billing_reason as string;
  if (billingReason !== 'subscription_cycle') {
    log.info({ stripeEventId, billingReason }, 'Skipping non-renewal invoice');
    return;
  }

  const userId = (invoice.metadata as Record<string, string> | undefined)?.user_id;
  if (!userId) throw new Error('invoice.payment_succeeded missing user_id metadata');

  const amountPaid = invoice.amount_paid as number;
  const subscriptionId = invoice.subscription as string;

  // Idempotency: stripe_events.stripe_event_id is already the dedup key (S-1).
  // RevenueService.logEvent does NOT have its own dedup — rely on the stripe_events
  // claim gate in processStripeEventJob (claimed_at IS NULL) preventing double-fire.
  const { RevenueService } = await import('../services/RevenueService.js');
  await RevenueService.logEvent({
    eventType: 'subscription',
    userId,
    amountCents: amountPaid,
    stripeEventId,
    stripeSubscriptionId: subscriptionId,
    metadata: { billingReason, invoiceId: invoice.id },
  });

  log.info(
    { userId, amountPaid, subscriptionId, stripeEventId },
    'Subscription renewal revenue logged',
  );
}
```

---

## Idempotency Rules — How HustleXP Enforces Them

HustleXP has TWO layers of idempotency protection (not one):

**Layer 1 — Ingestion (StripeWebhookService.ts):**

```sql
INSERT INTO stripe_events (stripe_event_id, type, created, payload_json)
VALUES ($1, $2, to_timestamp($3), $4::jsonb)
ON CONFLICT (stripe_event_id) DO NOTHING
```

Stripe replaying the same event → `rowCount === 0` → outbox NOT enqueued again.

**Layer 2 — Processing (stripe-event-worker.ts):**

```sql
UPDATE stripe_events
SET claimed_at = NOW(), result = 'processing'
WHERE stripe_event_id = $1
  AND claimed_at IS NULL
  AND processed_at IS NULL
RETURNING payload_json, type
```

If `rowCount === 0` → already claimed or processed → worker exits early, no-op.

**Consequence for new handlers**: You do NOT need a separate `findFirst` check before writing business logic. The atomic claim in the worker guarantees each event is processed at most once. Use `stripeEventId` as a cross-reference field (for audit trail and P&L replay), not as a runtime dedup check.

---

## Revenue Ledger: `RevenueService.logEvent()` Reference

Import: `import { RevenueService } from '../services/RevenueService.js'`

Valid `eventType` values:

- `'platform_fee'` — task completion fee (15%)
- `'featured_listing'` — featured task purchase
- `'skill_verification'` — skill badge purchase
- `'subscription'` — subscription payment (month 1 AND renewals)
- `'xp_tax'` — XP tax deduction
- `'per_task_fee'` — per-task entitlement
- `'chargeback'` — Stripe dispute loss (negative amount)
- `'chargeback_reversal'` — Stripe dispute won (positive recovery)

For subscription renewals, always set `billingReason: 'subscription_cycle'` in metadata for audit trails.

---

## Webhook Audit Checklist

Run this to see all currently handled event types:

```bash
grep -n "case '" /Users/sebastiandysart/Desktop/hustlexp-ai-backend/backend/src/jobs/stripe-event-worker.ts
```

Current handled cases as of March 2026:

1. `customer.subscription.created`
2. `customer.subscription.updated`
3. `customer.subscription.deleted`
4. `checkout.session.completed`
5. `payment_intent.succeeded`
6. `invoice.payment_failed`
7. `account.updated`

Missing cases (check before adding — confirm still absent):

- `invoice.payment_succeeded` — P1 revenue bug
- `payout.paid` — Hustler payout confirmation
- `payout.failed` — Hustler payout failure (silent today)
- `charge.dispute.created` — Stripe chargeback filing

---

## Test Pattern for New Webhook Handlers

Test file location: `backend/tests/unit/` — e.g., `stripe-invoice-payment-succeeded.test.ts`

Required mocks (copy from `stripe-webhook-branches.test.ts`):

```typescript
vi.mock('../../src/config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_...',
      webhookSecret: 'whsec_...',
      platformFeePercent: 15,
      minimumTaskValueCents: 500,
    },
  },
}));
vi.mock('../../src/db', () => ({ db: { query: vi.fn(), transaction: vi.fn() } }));
vi.mock('../../src/logger', () => ({
  workerLogger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
  stripeLogger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../../src/jobs/outbox-helpers', () => ({
  writeToOutbox: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
}));
```

Test structure — verify TDD: RED then GREEN:

```typescript
it('logs subscription renewal revenue for invoice.payment_succeeded', async () => {
  // Arrange: mock the atomic claim returning a matching row
  const mockDb = (await import('../../src/db')).db as { query: ReturnType<typeof vi.fn> };
  mockDb.query
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ payload_json: mockInvoiceEvent, type: 'invoice.payment_succeeded' }],
    }) // claim
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'revenue-1' }] }) // RevenueService INSERT
    .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // mark success

  const mockJob = {
    data: { stripeEventId: 'evt_test_renewal', type: 'invoice.payment_succeeded' },
  } as Job<StripeEventJobData>;

  // Act
  await processStripeEventJob(mockJob);

  // Assert: the revenue INSERT was called
  const revenueCalls = mockDb.query.mock.calls.filter((c) =>
    String(c[0]).includes('revenue_ledger'),
  );
  expect(revenueCalls.length).toBeGreaterThan(0);
});

it('skips non-renewal invoices (billing_reason != subscription_cycle)', async () => {
  // billing_reason: 'manual' or 'subscription_create' should NOT log revenue
});

it('is idempotent — second job for same event is a no-op', async () => {
  // mockDb.query returns rowCount: 0 for the claim → function returns early
  // Assert: revenue INSERT never called
});
```

---

## Common Mistakes to Avoid

1. **Do NOT add a `findFirst` check inside the handler for idempotency** — the `stripe-event-worker` atomic claim already prevents double-processing. Adding a second check is redundant noise.

2. **Do NOT write to `revenue_ledger` directly** — always use `RevenueService.logEvent()`. The table has append-only triggers (HX701, HX702) enforced at DB level.

3. **Do NOT return a non-200 to Stripe unless signature fails** — the HTTP handler in `server.ts` always returns 200 on successful storage. Returning 4xx/5xx for a processing error causes Stripe to replay for 3 days. Soft failures belong in the worker (which re-throws for BullMQ's built-in retry).

4. **Do NOT modify `StripeWebhookService.ts` for new event types** — that file is pure ingestion (signature verify + store + enqueue). All new business logic goes in `stripe-event-worker.ts` switch cases or a new processor file.

5. **`billing_reason` values for `invoice.payment_succeeded`:**
   - `subscription_cycle` — renewal payment (log revenue)
   - `subscription_create` — first payment (may already be covered by `checkout.session.completed`)
   - `manual` — one-time invoice (usually skip)
   - Always filter on `subscription_cycle` to avoid double-counting month 1.
