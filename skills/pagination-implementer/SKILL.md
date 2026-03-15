---
name: pagination-implementer
description: 'Use when adding pagination to list procedures in HustleXP backend, fixing unbounded list endpoints, or implementing offset-based pagination — never cursor-based'
---

# HustleXP Pagination Implementer

This skill exists because of a documented, recurring AI failure: **every AI assistant defaults to cursor-based pagination (`{ items, nextCursor }`) for this codebase, which is wrong and will break every test and iOS caller.** HustleXP uses offset-based pagination exclusively.

**Read this entire skill before writing a single line of code.**

---

## The Only Pagination Pattern That Exists in This Codebase

### WRONG — Do not use (cursor-based):

```typescript
// THIS PATTERN DOES NOT EXIST IN HUSTLEXP — NEVER IMPLEMENT IT
.input(z.object({
  cursor: z.string().optional(),   // ❌ WRONG
  limit: z.number().default(20),
}))
// ...
return { items, nextCursor }       // ❌ WRONG — this shape does not exist
```

### CORRECT — Offset-based (the only valid pattern):

```typescript
// ALL paginated procedures use this input shape:
.input(z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  // ... other filters specific to the procedure
}))
```

### CORRECT — Return shape:

```typescript
// All OFFSET-BASED paginated procedures return exactly this shape:
return { collection, total };
// collection: T[]  — the page of items
// total: number    — count of ALL matching records (for client-side pagination UI)
```

**Exception:** `task.listByPoster` and `task.listByWorker` use cursor-based pagination — see "Cursor-Based Procedures" section below.

---

## History: Why This Skill Exists

During the March 2026 coverage sprint, ALL 15 AI-generated test files had cursor-based pagination expectations (`{ items, nextCursor }`). Every single actual router uses offset-based pagination (`{ collection, total }`). This was a systematic AI hallucination from a cursor refactoring that was planned but never implemented. The lesson: never assume cursor pagination in this codebase, even if it "seems more modern."

---

## Cursor-Based Procedures (Do NOT convert to offset)

`task.listByPoster` (task.ts:81) and `task.listByWorker` (task.ts:120) use `Schemas.cursorPagination`:

- Input: `{ cursor?: string, limit: number }`
- Return: `{ tasks: Task[], nextCursor: string | undefined }`
- `Schemas.cursorPagination` is defined in `trpc.ts` and uses cursor + limit (no offset)

DO NOT convert these to offset-based `{ collection, total }`. These procedures have a BREAKING CHANGE comment from 2026-03-02 documenting their cursor shape. Any change requires updating iOS `TaskService` callers.

---

## Backend Implementation

### Step 1: Locate the procedure

The 12 highest-priority unbounded procedures needing offset pagination (from omni-link evolution audit):

| Procedure                       | File                                   | Line |
| ------------------------------- | -------------------------------------- | ---- |
| `admin.listUsers`               | `backend/src/routers/admin.ts`         | 35   |
| `admin.listTasks`               | `backend/src/routers/admin.ts`         | 128  |
| `instant.listAvailable`         | `backend/src/routers/instant.ts`       | 21   |
| `notification.getList`          | `backend/src/routers/notification.ts`  | 28   |
| `recurringTask.listMine`        | `backend/src/routers/recurringTask.ts` | 196  |
| `recurringTask.listOccurrences` | `backend/src/routers/recurringTask.ts` | 305  |
| `squad.listMine`                | `backend/src/routers/squad.ts`         | 158  |
| `squad.listInvites`             | `backend/src/routers/squad.ts`         | 384  |
| `squad.listTasks`               | `backend/src/routers/squad.ts`         | 550  |
| `task.listOpen`                 | `backend/src/routers/task.ts`          | 153  |
| `task.listApplicants`           | `backend/src/routers/task.ts`          | 564  |
| `taskDiscovery.search`          | `backend/src/routers/taskDiscovery.ts` | 324  |

**Note:** `task.listByPoster` (task.ts:81) and `task.listByWorker` (task.ts:120) are intentionally excluded — they already use cursor-based pagination and must NOT be converted. See "Cursor-Based Procedures" section below.

### Step 2: Determine the query layer

**Critical**: HustleXP routers use raw SQL via `db.query()`, NOT Prisma. The patterns differ:

**Raw SQL pattern (used by squad.ts, admin.ts, task.ts, and most routers):**

```typescript
.query(async ({ ctx, input }) => {
  const { limit, offset } = input

  const [result, countResult] = await Promise.all([
    db.query<RowType>(
      `SELECT ...
       FROM table t
       WHERE condition = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [filterValue, limit, offset]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM table t
       WHERE condition = $1`,
      [filterValue]  // NO limit/offset here
    ),
  ])

  return {
    collection: result.rows.map(r => ({ /* shape the row */ })),
    total: parseInt(countResult.rows[0]?.count || '0', 10),
  }
})
```

**Prisma pattern (used by some newer routers):**

```typescript
.query(async ({ ctx, input }) => {
  const { limit, offset } = input

  const [collection, total] = await Promise.all([
    ctx.prisma.modelName.findMany({
      take: limit,
      skip: offset,
      where: { /* filters */ },
      orderBy: { createdAt: 'desc' },
    }),
    ctx.prisma.modelName.count({ where: { /* same filters */ } }),
  ])

  return { collection, total }
})
```

### Step 3: Input schema — exact pattern

If the procedure currently has no pagination inputs, add them:

```typescript
.input(z.object({
  // existing fields stay as-is
  squadId: Schemas.uuid,
  // add these:
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
}))
```

If the procedure already has `limit` and `offset` but returns a plain array (no `total`), you only need to add the count query and wrap the return in `{ collection, total }`.

### Step 4: squad.listTasks — specific notes

`squad.listTasks` already has `limit`/`offset` in its input schema (as of March 2026). The current implementation:

- Has `limit` and `offset` params (marked `.optional()` with `?? 50` fallback)
- Does apply `LIMIT $2 OFFSET $3` in the SQL
- BUT returns a plain array, not `{ collection, total }`

To complete the pagination contract for `squad.listTasks`, add a parallel count query and wrap the return:

```typescript
// Add alongside the existing db.query:
const countResult = await db.query<{ count: string }>(
  `SELECT COUNT(*)::text as count
   FROM squad_task_assignments sta
   WHERE sta.squad_id = $1`,
  [input.squadId]
)

// Change return from:
return result.rows.map(r => ({ ... }))
// To:
return {
  collection: result.rows.map(r => ({ ... })),
  total: parseInt(countResult.rows[0]?.count || '0', 10),
}
```

---

## iOS Caller Update (Always Required)

After changing a backend procedure's return shape, find and update the iOS service.

**iOS service files are at:**
`/Users/sebastiandysart/HustleXP/HUSTLEXPFINAL1/hustleXP final1/Services/`

**For `squad.listTasks` specifically:**
The iOS `SquadService.swift` `getSquadTasks()` method currently returns an empty array stub:

```swift
// Current state — NOT wired to backend:
func getSquadTasks(squadId: String) async throws -> [SquadTask] {
    HXLogger.info("SquadService: Squad task feed is not exposed by the live backend contract...", category: "Squad")
    return []
}
```

After backend pagination is complete, wire it:

```swift
struct ListTasksInput: Encodable {
    let squadId: String
    let limit: Int
    let offset: Int
}

struct PaginatedSquadTasks: Decodable {
    let collection: [SquadTask]
    let total: Int
}

func getSquadTasks(squadId: String, limit: Int = 20, offset: Int = 0) async throws -> PaginatedSquadTasks {
    let input = ListTasksInput(squadId: squadId, limit: limit, offset: offset)
    let response: PaginatedSquadTasks = try await trpc.call(
        router: "squad",
        procedure: "listTasks",
        input: input
    )
    HXLogger.info("SquadService: Fetched \(response.collection.count) of \(response.total) squad tasks", category: "Squad")
    return response
}
```

**For other procedures:** Search for the call site:

```bash
grep -rn "squad.listMine\|task.listByPoster\|notification.getList" \
  "/Users/sebastiandysart/HustleXP/HUSTLEXPFINAL1/hustleXP final1/Services/"
```

Update the return type decoding from `[T]` to a struct with `collection: [T]` and `total: Int`. iOS uses `keyDecodingStrategy = .convertFromSnakeCase` (set on `TRPCClient.shared`), so `collection` and `total` map directly from the JSON response.

---

## Test Pattern

Tests live in `backend/tests/unit/` or `backend/tests/integration/`.

```typescript
// vitest — always test collection AND total
describe('squad.listTasks', () => {
  it('returns paginated collection with total', async () => {
    // setup: ensure test records exist
    const result = await caller.squad.listTasks({ squadId, limit: 10, offset: 0 });

    expect(result).toHaveProperty('collection');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.collection)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  it('respects limit and offset', async () => {
    // If you can seed data, test actual pagination behavior:
    const page1 = await caller.squad.listTasks({ squadId, limit: 5, offset: 0 });
    const page2 = await caller.squad.listTasks({ squadId, limit: 5, offset: 5 });

    expect(page1.collection).toHaveLength(5);
    expect(page2.total).toBe(page1.total); // same total across pages
    // items should differ between pages
    const page1Ids = page1.collection.map((t) => t.id);
    const page2Ids = page2.collection.map((t) => t.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  it('defaults limit=20 offset=0 when not specified', async () => {
    const result = await caller.squad.listTasks({ squadId });
    expect(result.collection.length).toBeLessThanOrEqual(20);
  });
});
```

**NEVER write a test expecting `{ items, nextCursor }` — that shape does not exist.**

---

## Verification Checklist

After implementing pagination on any procedure:

```bash
cd /Users/sebastiandysart/Desktop/hustlexp-ai-backend

# 1. Run full test suite — must stay green
npx vitest run 2>&1 | tail -15

# 2. Confirm no cursor-based shapes leaked in
grep -rn "nextCursor\|items.*cursor\|cursor.*items" backend/src/routers/ backend/tests/

# 3. Confirm coverage stays at or above threshold
# Target: >= 88.88% line coverage (keeps ecosystem health at 100/100)
# Coverage report is in the vitest output above
```

Must confirm:

- [ ] All tests pass (zero failures)
- [ ] Coverage >= 88.88% (check the summary line)
- [ ] No `nextCursor` anywhere in the changed files
- [ ] Return shape is `{ collection: T[], total: number }`
- [ ] iOS service updated if the procedure was previously stubbed or returning wrong shape
- [ ] Count query uses same `WHERE` conditions as the data query (no count inflation)

---

## Common Mistakes to Avoid

1. **Do not return `{ items, nextCursor }`** — this is cursor pagination and does not exist in this codebase.

2. **Do not omit the `total` field** — iOS uses it to render pagination controls. Returning only `collection` will break the UI.

3. **Do not apply `LIMIT`/`OFFSET` to the count query** — the count query must always count all matching records, not just the current page.

4. **Do not change existing plain-array procedures without updating iOS** — some older procedures return plain arrays and iOS decodes them as `[T]`. Changing to `{ collection, total }` without updating the Swift decoder will cause runtime crashes.

5. **Do not use `Math.min(input.limit ?? 50, 100)` inline** — the Zod schema `.min(1).max(100)` already enforces the cap. Just use `input.limit` directly after Zod validation.

6. **When adding NEW pagination, do not use `.optional()` on `limit` and `offset`** — use `.default(20)` and `.default(0)` instead, so they are always present after Zod parsing and no null-coalescing is needed throughout the handler. (`squad.listTasks` is a legacy exception that predates this rule and uses `.optional()` with `?? 50` fallbacks.)
