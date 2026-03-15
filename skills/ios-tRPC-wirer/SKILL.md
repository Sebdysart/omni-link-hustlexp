---
name: ios-tRPC-wirer
description: Use when replacing iOS stub implementations, fake DispatchQueue delays, hardcoded arrays, or 501 throws with real tRPC API calls in the HustleXP iOS app
---

# HustleXP iOS tRPC Wirer

Use this skill whenever you encounter any of the following stub patterns in the iOS source:

- `DispatchQueue.main.asyncAfter(deadline: .now() + N) { ... }` faking success
- A function returning `[]` (empty array) with a comment saying "not exposed by backend contract"
- `throw NSError(domain: "HustleXP", code: 501, ...)` for a feature that exists in the backend
- `dataService.validateBiometricProof()` or any local mock validation

---

## The One Rule: Never Call TRPCClient Wrong

The canonical calling convention uses **two separate named parameters** — `router:` and `procedure:` — not a combined dot-string:

```swift
// CORRECT — always split router and procedure
let result: SomeOutput = try await trpc.call(
    router: "dispute",
    procedure: "create",
    input: someInput
)

// WRONG — no combined "dispute.create" single-string overload exists
let result = try await TRPCClient.shared.call(procedure: "dispute.create", input: ...)
```

The default `type:` parameter is `.mutation`. For reads (queries), pass `type: .query`.

---

## TRPCClient Calling Convention (canonical)

```swift
// From Services/TRPCClient.swift — the only real signature:
func call<Input: Encodable, Output: Decodable>(
    router: String,
    procedure: String,
    type: ProcedureType = .mutation,   // omit for mutations, pass .query for reads
    input: Input
) async throws -> Output
```

Access via `TRPCClient.shared` (singleton) or via `private let trpc = TRPCClient.shared` stored in a service.

The decoder automatically applies `keyDecodingStrategy = .convertFromSnakeCase` — backend snake_case fields map to Swift camelCase properties without any manual mapping.

---

## Error Handling — Catch APIError, Not TRPCError

The client throws `APIError` (defined in TRPCClient.swift), not `TRPCError`. Use this pattern:

```swift
do {
    let result: SomeOutput = try await trpc.call(
        router: "dispute",
        procedure: "create",
        input: input
    )
    // handle success
} catch let error as APIError {
    switch error {
    case .unauthorized:
        errorMessage = "Authentication required"
    case .forbidden(let msg):
        errorMessage = msg
    case .constitutionalViolation(let code, let message):
        errorMessage = "[\(code)] \(message)"   // e.g. HX200: Dispute already in progress
    default:
        errorMessage = error.userFacingMessage
    }
} catch {
    errorMessage = "Network error. Please try again."
}
```

Never catch a bare `TRPCError` struct from the iOS side — that type is the raw JSON error response, not the thrown error.

---

## ViewModel Wiring Pattern (@Observable)

ViewModels in this codebase are `@Observable @MainActor final class`. The correct async pattern:

```swift
@Observable
@MainActor
final class DisputeViewModel {
    var isLoading = false
    var errorMessage: String?
    var submissionState: SubmissionState = .idle

    private let trpc = TRPCClient.shared

    func submitDispute(taskId: String, reason: DisputeReason, description: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            struct CreateDisputeInput: Encodable {
                let taskId: String    // backend: task_id (encoder uses snake_case via keyEncodingStrategy)
                let reason: String
                let description: String
            }

            // NOTE: backend input uses snake_case field names, but Swift Encodable structs
            // need to use camelCase with a custom encoder, OR use snake_case property names.
            // TRPCClient does NOT set keyEncodingStrategy on the encoder — only keyDecodingStrategy
            // is set for responses. Send exactly the field names the backend expects.
            struct CreateDisputeInputRaw: Encodable {
                let task_id: String
                let reason: String
                let description: String
            }

            let result: CreateDisputeOutput = try await trpc.call(
                router: "dispute",
                procedure: "create",
                input: CreateDisputeInputRaw(
                    task_id: taskId,
                    reason: reason.backendValue,
                    description: description
                )
            )
            submissionState = .success(disputeId: result.dispute.id)
        } catch let error as APIError {
            errorMessage = error.userFacingMessage
            submissionState = .failed(errorMessage!)
        } catch {
            errorMessage = "Network error. Please try again."
            submissionState = .failed(errorMessage!)
        }
    }
}
```

**Critical: Input encoding uses the encoder WITHOUT `keyEncodingStrategy`.** The `TRPCClient` encoder only sets `dateEncodingStrategy = .iso8601`. For fields the backend expects in `snake_case`, either use `snake_case` Swift property names directly, or add `CodingKeys`. Do not assume automatic camelCase→snake_case conversion on the send path.

---

## Screen Integration Pattern

Call async ViewModel methods from SwiftUI Button actions using `Task {}`:

```swift
Button("Submit Report") {
    Task {
        await viewModel.submitDispute(
            taskId: taskId,
            reason: selectedReason,
            description: details
        )
    }
}
.disabled(viewModel.isLoading || selectedReason == nil)
```

For data loading on screen appear, use `.task {}` modifier (auto-cancelled on dismiss):

```swift
.task {
    await viewModel.loadLeaderboard()
}
```

---

## The 4 Known Open Stubs — Exact Locations and Fixes

### Stub 1: DisputeScreen.swift:73-85 → `dispute.create` [P0 — Financial Safety]

**File**: `Screens/Shared/DisputeScreen.swift`

> **BACKEND PROCEDURE DOES NOT EXIST — TWO-STEP FIX REQUIRED**
>
> The `dispute` router is **NOT present** in `backend/src/routers/index.ts`. There is no `dispute.create` procedure. The only dispute-adjacent router is `disputeAI`, which is admin-only AI analysis (not a user-facing create endpoint).
>
> **This stub CANNOT be replaced with a real tRPC call until step 1 is complete.**
>
> **Step 1 — Backend (do this first):** Create `backend/src/routers/dispute.ts` with a `create` mutation that accepts `{ taskId: string, reason: string, description: string }` (or `task_id` snake_case — match whatever Zod schema you define), transitions the task to DISPUTED state, locks escrow, and inserts a dispute record. Register it in `backend/src/routers/index.ts` as `dispute: disputeRouter`.
>
> **Step 2 — iOS (only after Step 1 is deployed):** Replace the DispatchQueue stub below with a real `TRPCClient.shared.call(router: "dispute", procedure: "create", ...)` call.
>
> Do NOT wire the iOS side against a non-existent procedure — the call will fail at runtime with a 404/NOT_FOUND tRPC error and the fake success will no longer fire, breaking the screen entirely.

**Current fake** (lines 73-85):

```swift
private func submitDispute() {
    guard selectedReason != nil else { return }
    isSubmitting = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
        isSubmitting = false
        withAnimation(.spring(response: 0.5)) { showConfirmation = true }
    }
}
```

**Target backend procedure (once implemented)**: `dispute.create` (mutation, protectedProcedure)
**Suggested backend input shape** (define in `dispute.ts` Zod schema):

```typescript
{ task_id: string; reason: 'PROOF_INSUFFICIENT' | 'WORK_NOT_DONE' | 'QUALITY_ISSUE' | 'OTHER'; description: string; evidence_urls?: string[] }
```

**Suggested backend output shape**:
`{ dispute: { id, task_id, opened_by, reason, state: 'OPEN', created_at }; task: { id, state: 'DISPUTED' }; escrow: { id, state: 'LOCKED_DISPUTE' } }`

**iOS fix template (apply only after backend Step 1 is done)**:

```swift
// 1. Define output types
struct CreateDisputeResponse: Decodable {
    struct DisputeRecord: Decodable {
        let id: String
        let state: String
    }
    let dispute: DisputeRecord
}

// 2. Define raw input (snake_case to match backend)
private struct CreateDisputeInput: Encodable {
    let task_id: String
    let reason: String
    let description: String
    let evidence_urls: [String]?
}

// 3. Map DisputeReason enum to backend string values
extension DisputeReason {
    var backendValue: String {
        switch self {
        case .notCompleted: return "WORK_NOT_DONE"
        case .qualityIssue: return "QUALITY_ISSUE"
        case .noShow: return "WORK_NOT_DONE"
        case .wrongItem: return "OTHER"
        case .safety: return "OTHER"
        case .communication: return "OTHER"
        case .other: return "OTHER"
        }
    }
}

// 4. Replace submitDispute() with async version
private func submitDispute() {
    guard let reason = selectedReason else { return }
    isSubmitting = true
    Task {
        defer { isSubmitting = false }
        do {
            let _: CreateDisputeResponse = try await TRPCClient.shared.call(
                router: "dispute",
                procedure: "create",
                input: CreateDisputeInput(
                    task_id: taskId,
                    reason: reason.backendValue,
                    description: details.isEmpty ? reason.rawValue : details,
                    evidence_urls: attachedPhotos.isEmpty ? nil : attachedPhotos
                )
            )
            await MainActor.run {
                withAnimation(.spring(response: 0.5)) { showConfirmation = true }
            }
        } catch let error as APIError {
            await MainActor.run {
                // Show error — add @State var errorMessage: String? to screen
                print("Dispute submission failed: \(error.userFacingMessage)")
            }
        } catch {
            print("Dispute submission network error: \(error.localizedDescription)")
        }
    }
}
```

**Why this is P0**: Fake success silently accepts disputes without creating a database record, locking escrow, or transitioning task state to DISPUTED. Financial invariants are violated on every submission. The fix requires backend work before iOS wiring.

---

### Stub 2: SquadService.swift:151-171 → 3 procedures [B3-deferred but wirable]

**File**: `Services/SquadService.swift`

**Backend procedures** (from `backend/src/routers/squad.ts`):

#### getSquadTasks → `squad.listTasks` (query)

```swift
// Backend input: { squadId: uuid, limit?: number, offset?: number }
// Backend output: array of squad task rows
struct ListTasksInput: Encodable {
    let squadId: String
    let limit: Int?
    let offset: Int?
}
// Wire as:
func getSquadTasks(squadId: String) async throws -> [SquadTask] {
    return try await TRPCClient.shared.call(
        router: "squad",
        procedure: "listTasks",
        type: .query,
        input: ListTasksInput(squadId: squadId, limit: 50, offset: nil)
    )
}
```

#### acceptSquadTask → `squad.acceptTask` (mutation)

```swift
// Backend input: { squadTaskId: uuid }
struct AcceptTaskInput: Encodable { let squadTaskId: String }
func acceptSquadTask(squadTaskId: String) async throws {
    struct VoidOutput: Decodable {}
    let _: VoidOutput = try await TRPCClient.shared.call(
        router: "squad",
        procedure: "acceptTask",
        input: AcceptTaskInput(squadTaskId: squadTaskId)
    )
}
```

#### getLeaderboard → `squad.leaderboard` (query, void input)

```swift
// Backend input: void (z.void())
struct EmptyInput: Encodable {}   // already defined in codebase
func getLeaderboard() async throws -> [HXSquad] {
    return try await TRPCClient.shared.call(
        router: "squad",
        procedure: "leaderboard",
        type: .query,
        input: EmptyInput()
    )
}
```

---

### Stub 3: ProofSubmissionViewModel.swift:280-284 and 310 → `biometric.submitBiometricProof`

**File**: `ViewModels/ProofSubmissionViewModel.swift`

**IMPORTANT — Two mock locations, both must be replaced:**

- **Line 281**: mock call in the happy path after API success
- **Line 310**: same mock call in the `catch` block as a fallback

Both lines contain `dataService.validateBiometricProof(...)`. Replacing only the first (line 281) leaves a second mock still active in error recovery paths. Audit the file for both occurrences before committing.

**Current fake** (lines 280-284 and ~310):

```swift
let result = dataService.validateBiometricProof(submission: submission, taskId: taskId)
```

**Backend procedure**: `biometric.submitBiometricProof` (mutation, hustlerProcedure)

**Backend input** (from `backend/src/routers/biometric.ts`):

```typescript
{
  proof_id: uuid;
  task_id: uuid;
  photo_url: string;  // must be a valid URL
  gps_coordinates: { latitude: number; longitude: number };
  gps_accuracy_meters: number;
  gps_timestamp: string; // ISO datetime
  task_location: { latitude: number; longitude: number };
  lidar_depth_map_url?: string;
  time_lock_hash: string;
  submission_timestamp: string; // ISO datetime
}
```

Note: This is a complex multi-field input with BIPA compliance requirements (biometric consent must be granted first). Do not wire this stub until confirming `GDPRService.hasBiometricConsent` consent is granted in the app flow.

---

## How to Find the Matching Backend Procedure

1. Open `backend/src/routers/` — each file is a router (e.g., `squad.ts` → router name `"squad"`)
2. Find the tRPC procedure name (e.g., `create:`, `listTasks:`, `acceptTask:`)
3. Check whether it is `.query(...)` or `.mutation(...)` to know the `type:` parameter
4. Read the `.input(z.object({ ... }))` block for required field names and types
5. The tRPC path = `router + "." + procedure` (e.g., `"squad"` + `"listTasks"` = `squad.listTasks`)
6. The router name in iOS matches the key in `backend/src/routers/index.ts` export map

**NOTE**: Always verify the router file exists before wiring iOS. The `dispute` router is a known example of a router that does NOT exist yet — see Stub 1 above. If a router file is absent from `index.ts`, the iOS call will fail at runtime.

**Auth levels**: `protectedProcedure` = any logged-in user; `hustlerProcedure` = hustler role; `posterProcedure` = poster role; `adminProcedure` = admin only. The iOS auth token handles this automatically — just ensure `TRPCClient.shared.setAuthToken()` was called after Firebase sign-in.

---

## Input Encoding Gotcha (Most Common Mistake)

The backend Zod schemas use `camelCase` field names for manually constructed inputs (e.g., `squadId`, `squadTaskId`) but `snake_case` for DB-row-shaped inputs (e.g., `task_id`, `evidence_urls`). Always read the actual `.input(z.object(...))` in the backend router to determine the exact field names expected — do not assume.

The TRPCClient encoder does **not** apply `keyEncodingStrategy = .convertToSnakeCase`. Send field names exactly as the backend Zod schema declares them.

---

## Smoke Test (No Device Required)

After wiring, verify syntax by building the iOS target:

```bash
xcodebuild -scheme "hustleXP final1" -destination "platform=iOS Simulator,name=iPhone 16" build 2>&1 | grep -E "error:|BUILD"
```

If it compiles clean, the wiring is syntactically correct. Runtime correctness requires a running backend at `AppConfig.backendBaseURL`.

---

## File Structure Reference

```
hustleXP final1/
  Services/
    TRPCClient.swift         ← The client; call via TRPCClient.shared
    ProofService.swift       ← Good reference for real tRPC call patterns
    SquadService.swift       ← Contains 3 stubs (getSquadTasks, acceptSquadTask, getLeaderboard)
  Screens/
    Shared/
      DisputeScreen.swift    ← Contains P0 DispatchQueue.main.asyncAfter stub (line 73)
  ViewModels/
    ProofSubmissionViewModel.swift  ← Contains biometric mock validation stub (line 280)
    CreateTaskViewModel.swift       ← Good reference for @Observable ViewModel pattern
```
