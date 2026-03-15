---
name: ios-screen-builder
description: Use when building new SwiftUI screens for HustleXP iOS, adding navigation routes, creating ViewModels, or wiring backend tRPC procedures to new UI components
---

# HustleXP iOS Screen Builder

## TL;DR Checklist for Every New Screen

1. Create `{FeatureName}ViewModel.swift` — `@Observable final class`, uses `TRPCClient.shared`
2. Create `{FeatureName}Screen.swift` — `struct`, holds `@State private var viewModel = {FeatureName}ViewModel()`
3. Add a case to the correct route enum in `Router.swift`
4. Register the case in the correct `*Stack.swift` `.navigationDestination` switch

---

## File Locations

| Screen type         | File path                                                      |
| ------------------- | -------------------------------------------------------------- |
| Hustler-facing      | `hustleXP final1/Screens/Hustler/{FeatureName}Screen.swift`    |
| Hustler ViewModel   | `hustleXP final1/Screens/Hustler/{FeatureName}ViewModel.swift` |
| Poster-facing       | `hustleXP final1/Screens/Poster/{FeatureName}Screen.swift`     |
| Poster ViewModel    | `hustleXP final1/Screens/Poster/{FeatureName}ViewModel.swift`  |
| Shared (both roles) | `hustleXP final1/Screens/Shared/{FeatureName}Screen.swift`     |

All paths are relative to: `/Users/sebastiandysart/HustleXP/HUSTLEXPFINAL1/hustleXP final1/`

---

## Critical: TRPCClient.shared Real Signature

The actual method signature (from `Services/TRPCClient.swift`) is:

```swift
TRPCClient.shared.call(
    router: String,      // e.g. "jury"
    procedure: String,   // e.g. "submitVote"
    type: ProcedureType, // .query (GET) or .mutation (POST) — defaults to .mutation
    input: Encodable
) async throws -> Decodable
```

**NOT** `procedure: "jury.submitVote"` — router and procedure are separate parameters.

Queries (read): `type: .query`
Mutations (write): `type: .mutation` (default, can be omitted)

---

## Canonical ViewModel Pattern

ViewModels use `@Observable` (not `ObservableObject`/`@Published`). All state vars are plain `var`.

```swift
import Foundation

@Observable
final class JuryVotingViewModel {
    var isLoading = false
    var errorMessage: String?
    var voteTally: VoteTally?
    var hasVoted = false

    func loadTally(disputeId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            struct Input: Encodable { let disputeId: String }
            voteTally = try await TRPCClient.shared.call(
                router: "jury",
                procedure: "getVoteTally",
                type: .query,
                input: Input(disputeId: disputeId)
            )
        } catch let error as APIError {
            errorMessage = error.userFacingMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func submitVote(disputeId: String, vote: JuryVote, confidence: Double = 1.0) async {
        isLoading = true
        defer { isLoading = false }
        do {
            struct Input: Encodable {
                let disputeId: String
                let vote: String
                let confidence: Double
            }
            let _: VoteResult = try await TRPCClient.shared.call(
                router: "jury",
                procedure: "submitVote",
                input: Input(disputeId: disputeId, vote: vote.rawValue, confidence: confidence)
            )
            hasVoted = true
        } catch let error as APIError {
            errorMessage = error.userFacingMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
```

Key rules:

- Catch `APIError` first (has `.userFacingMessage`), then generic `Error`
- Define inline `Input` structs as `Encodable` inside the function — keeps the ViewModel self-contained
- If types already exist in a Service file (e.g. `JuryService.swift`), import/reuse them instead of redefining
- `isLoading = true` + `defer { isLoading = false }` on every async func

---

## Canonical Screen Pattern

```swift
import SwiftUI

struct JuryVotingScreen: View {
    let disputeId: String
    @State private var viewModel = JuryVotingViewModel()

    var body: some View {
        ZStack {
            Color.brandBlack.ignoresSafeArea()

            if viewModel.isLoading {
                ProgressView()
                    .tint(Color.brandPurple)
            } else if let tally = viewModel.voteTally {
                ScrollView {
                    VStack(spacing: 24) {
                        // Main content
                        VoteTallyView(tally: tally)

                        if !viewModel.hasVoted {
                            VoteButtonsView { vote in
                                Task {
                                    await viewModel.submitVote(disputeId: disputeId, vote: vote)
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            } else {
                EmptyState(icon: "scale.3d", title: "Loading...", message: "")
            }

            if let error = viewModel.errorMessage {
                VStack {
                    Spacer()
                    Text(error)
                        .foregroundStyle(Color.errorRed)
                        .padding()
                        .background(Color.surfaceElevated)
                        .cornerRadius(12)
                        .padding()
                }
            }
        }
        .navigationTitle("Jury Vote")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.brandBlack, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await viewModel.loadTally(disputeId: disputeId) }
    }
}

#Preview {
    NavigationStack {
        JuryVotingScreen(disputeId: "dispute-preview-123")
    }
}
```

---

## Navigation Registration (2-step process)

### Step 1 — Add case to the correct route enum in `Router.swift`

File: `hustleXP final1/Navigation/Router.swift`

```
Hustler screens → enum HustlerRoute: Hashable
Poster screens  → enum PosterRoute: Hashable
Shared screens  → enum SharedRoute: Hashable
Settings screens→ enum SettingsRoute: Hashable
```

Example — adding jury voting to SharedRoute:

```swift
enum SharedRoute: Hashable {
    // existing cases...
    case juryVoting(disputeId: String)
}
```

To trigger navigation from any screen:

```swift
@Environment(Router.self) private var router
// ...
router.navigateToHustler(.taskDetail(taskId: id))  // for HustlerRoute
// There is no navigateToShared — SharedRoute cases are appended to the role stack
// e.g. router.hustlerPath.append(SharedRoute.juryVoting(disputeId: id))
// or embed in HustlerRoute/PosterRoute as needed
```

### Step 2 — Register in the correct Stack file

| Route enum    | Stack file                       |
| ------------- | -------------------------------- |
| HustlerRoute  | `Navigation/HustlerStack.swift`  |
| PosterRoute   | `Navigation/PosterStack.swift`   |
| SettingsRoute | `Navigation/SettingsStack.swift` |

Add a case inside `.navigationDestination(for: HustlerRoute.self)`:

```swift
case .juryVoting(let disputeId):
    JuryVotingScreen(disputeId: disputeId)
```

---

## Reusing Existing Service Types

Several backend-connected services and their models already exist. Prefer them over redefining types:

| Feature          | Existing service file                   | Key types                              |
| ---------------- | --------------------------------------- | -------------------------------------- |
| Jury voting      | `Services/JuryService.swift`            | `JuryVote`, `VoteTally`, `VoteResult`  |
| Daily challenges | `Services/DailyChallengeService.swift`  | `DailyChallengeService.DailyChallenge` |
| Featured listing | `Services/FeaturedListingService.swift` | `FeatureOption`                        |
| Messaging        | `Services/MessagingService.swift`       | `HXMessage`, `HXConversation`          |
| Tasks            | `Services/TaskService.swift`            | `HXTask`                               |
| Auth             | `Services/AuthService.swift`            | `AuthService.shared`                   |

When a service already exists, you can call it directly from the ViewModel OR call `TRPCClient.shared` directly. Both patterns are valid; prefer the service when it already handles the tRPC plumbing for that domain.

---

## 3 Missing Screens — Ready-to-Build Recipes

### Recipe 1: Jury Voting Screen

- **Path**: `Screens/Shared/JuryVotingScreen.swift`
- **ViewModel**: `Screens/Shared/JuryVotingViewModel.swift`
- **Backend calls**:
  - `router: "jury", procedure: "getVoteTally", type: .query` → `VoteTally`
  - `router: "jury", procedure: "submitVote", type: .mutation` → `VoteResult`
- **Input**: `disputeId: String`
- **Types to reuse**: `JuryVote`, `VoteTally`, `VoteResult` from `Services/JuryService.swift`
- **Navigation**: Add `case juryVoting(disputeId: String)` to `SharedRoute` (embed in `HustlerRoute` + `PosterRoute` if deep-linking needed), register in both `HustlerStack.swift` and `PosterStack.swift`
- **Trigger point**: `DisputeScreen.swift` (existing) — add a "Vote" button that pushes this route

### Recipe 2: Daily Challenges Screen (Hustler)

- **Path**: `Screens/Hustler/DailyChallengesScreen.swift`
- **ViewModel**: `Screens/Hustler/DailyChallengesViewModel.swift`
- **Backend calls**:
  - `router: "challenges", procedure: "getTodaysChallenges", type: .query` → `[DailyChallengeService.DailyChallenge]`
- **Input**: none — use `struct EmptyInput: Encodable {}` as input
- **Types to reuse**: `DailyChallengeService` and its `DailyChallenge` struct already parse the response
- **Navigation**: Add `case dailyChallenges` to `HustlerRoute`, register in `HustlerStack.swift`
- **Trigger point**: Hustler Home tab — add a "Daily Challenges" card/button

### Recipe 3: Featured Listing Screen (Poster)

- **Path**: `Screens/Poster/FeaturedListingScreen.swift`
- **ViewModel**: `Screens/Poster/FeaturedListingViewModel.swift`
- **Backend calls**:
  - `router: "featured", procedure: "promoteTask"` → `{ clientSecret: String, listingId: String? }` (returns Stripe clientSecret for payment)
  - `router: "featured", procedure: "confirmPromotion"` → after Stripe payment succeeds
- **Input**: `taskId: String, featureType: String` (featureType one of: "promoted", "highlighted", "urgent_boost")
- **Types to reuse**: `FeaturedListingService.FeatureOption` for the option list; `FeaturedListingService.options` static array
- **Navigation**: Add `case featuredListing(taskId: String)` to `PosterRoute`, register in `PosterStack.swift`
- **Trigger point**: Poster task detail screen — add "Promote Task" button

---

## AppConfig URL Pattern

Never hardcode backend URLs. `TRPCClient` reads from `AppConfig.backendBaseURL` automatically:

```swift
// AppConfig.swift uses #if DEBUG for environment switching
// All TRPCClient calls inherit the correct URL — no extra setup needed
```

---

## Design System Quick Reference

| Token                   | Usage                                     |
| ----------------------- | ----------------------------------------- |
| `Color.brandBlack`      | Screen background (always on ZStack root) |
| `Color.brandPurple`     | Primary accent, CTAs                      |
| `Color.surfaceElevated` | Cards and elevated surfaces               |
| `Color.textPrimary`     | Primary text                              |
| `Color.textSecondary`   | Captions, labels                          |
| `Color.errorRed`        | Error messages                            |
| `Color.successGreen`    | Success states                            |
| `Color.moneyGreen`      | Monetary values                           |

Components: `HXButton`, `HXText`, `HXIcon`, `HXAvatar`, `HXInput` (from `Components/Atoms/`), `EmptyState`, `LoadingState`, `ErrorState` (from `Components/Molecules/`).

---

## Build Verification

```bash
xcodebuild -scheme "hustleXP final1" \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  build 2>&1 | grep -E "error:|Build succeeded"
```

A clean build produces `** BUILD SUCCEEDED **` with zero `error:` lines.

---

## Common Mistakes to Avoid

1. **Wrong TRPCClient signature** — do NOT use `procedure: "jury.submitVote"`. Always pass `router:` and `procedure:` as separate params.
2. **Wrong navigation registration location** — routes go in `*Stack.swift` `.navigationDestination`, NOT inline in `Router.swift`.
3. **Wrong route enum** — Hustler screens → `HustlerRoute`, Poster screens → `PosterRoute`, both-role screens → add to both or use `SharedRoute` embedded in both stacks.
4. **ObservableObject instead of @Observable** — ViewModels use `@Observable final class`, not `class ... : ObservableObject`. State vars are plain `var`, not `@Published var`.
5. **Hardcoded backend URL** — use `TRPCClient.shared` which reads `AppConfig.backendBaseURL` automatically.
6. **Redefining existing types** — check `Services/` for existing models before creating new ones. `JuryVote`, `VoteTally`, `DailyChallenge` etc. already exist.
