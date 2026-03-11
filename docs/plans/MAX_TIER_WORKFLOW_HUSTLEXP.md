# Max-Tier Workflow for HustleXP

**Status:** Authoritative — single source of truth for the maximum possible workflow across the HustleXP ecosystem (HUSTLEXPFINAL1, hustlexp-ai-backend, HUSTLEXP-DOCS) with omni-link-hustlexp as the control plane.

**Principle:** Authority first, then code. No mutation without check. Apply only when the affected slice is reconciled.

---

## 1. Non-Negotiables

| Rule                              | Meaning                                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No protected-branch mutation**  | `main` is never mutated directly by automation. All changes land via branch → PR → merge.                                                                                     |
| **Authority before code**         | Before editing API, schema, or contract surface: run `authority-status` and treat docs/backend/Swift drift as the first queue to work down.                                   |
| **simulateOnly until reconciled** | Keep `simulateOnly: true` until the touched authority slice has no unresolved drift; only then consider `apply` for execution plans.                                          |
| **review-pr before apply**        | Always run `review-pr` (and optionally `publish-review`) before any `apply`; never apply then review.                                                                         |
| **Product frozen**                | FINISHED_STATE.md, FEATURE_FREEZE.md, AI_GUARDRAILS.md, and SCREEN_FEATURE_MATRIX define scope. No net-new feature families without updating authority first.                 |
| **Phase-gated**                   | CURRENT_PHASE.md (in HUSTLEXP-DOCS) is the gate. Current phase: **Reconciliation / Integration Hardening**. Next: Contract-locked feature delivery → Risk-bounded automation. |

---

## 2. Phase Map

```
CURRENT:  Reconciliation / Integration Hardening
          ├── Reconcile CURRENT_PHASE.md, FINISHED_STATE.md, API_CONTRACT.md to real implementation
          ├── Document backend procedures in specs/04-backend/API_CONTRACT.md
          ├── Remove or remap obsolete Swift tRPC calls
          ├── Normalize payload drift (docs ↔ backend ↔ Swift)
          └── Success: authority drift no longer blocks bounded apply/review

NEXT:     Contract-locked feature delivery
          └── New work only on reconciled contract slices; changes gated by review-pr

THEN:     Risk-bounded automation
          └── apply/rollback allowed on feature branches with green policy and reconciled slice
```

---

## 3. Session Start (Every Dev / AI Session)

Run once when opening the project or starting a build session. Use config: `~/.claude/omni-link-hustlexp.json` (or repo-local `.omni-link.json`).

| Step | Command            | Purpose                                                                                   |
| ---- | ------------------ | ----------------------------------------------------------------------------------------- |
| 1    | `watch --once`     | Refresh daemon state (cold &lt;20s, warm &lt;1s).                                         |
| 2    | `authority-status` | Get phase, procedures, drift queues (docsOnly, backendOnly, obsoleteCalls, payloadDrift). |
| 3    | `scan --markdown`  | Ecosystem snapshot: repos, authority summary, contract mismatches, recent changes.        |

**Minimum before any code change:** Steps 1–3. If you are about to touch API/schema/contracts, also run `impact` and `health` so you see cross-repo impact and per-repo health.

**Interpretation:**

- **docsOnly** — Procedures in docs but not in backend: remove from docs or prove implementation exists.
- **backendOnly** — Procedures in backend but not in docs: add to API_CONTRACT.md (or agreed authority).
- **obsoleteCalls** — Swift calls to procedures no longer in backend: remove or remap before further work.
- **payloadDrift** — Endpoint exists but request/response shapes differ: normalize schemas before merging.
- **authority_drift** — Top-level divergence; in reconciliation mode it blocks `apply`; in strict mode it should block review approval.

---

## 4. Before Any API / Schema / Contract Change

| Step | Command                                                | Purpose                                                                            |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1    | Session-start sequence (watch, authority-status, scan) | Establish baseline.                                                                |
| 2    | `impact`                                               | See which files/repos are affected by your change.                                 |
| 3    | `health`                                               | Per-repo and overall health (todo, dead code, test, quality).                      |
| 4    | Decide slice                                           | Identify the “authority slice” (procedures, routers, types) you are touching.      |
| 5    | Reconcile slice (if needed)                            | Fix docsOnly/backendOnly/obsoleteCalls/payloadDrift for that slice before editing. |

Only after the slice is reconciled (or explicitly documented as accepted drift) should you edit code.

---

## 5. Per Task / Per PR (Pre-Merge)

| Step | Command / Action                          | Purpose                                                                                                              |
| ---- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | `watch --once` (if not done this session) | Ensure daemon is current.                                                                                            |
| 2    | `authority-status`                        | Confirm no new drift in the changed area.                                                                            |
| 3    | `review-pr --base main --head HEAD`       | Generate review artifact: risk, owners, policy, contract mismatches, execution plan.                                 |
| 4    | Fix or document                           | Resolve blocking mismatches or document accepted exceptions.                                                         |
| 5    | `publish-review` (optional)               | Post review to GitHub/GitLab (idempotent comment).                                                                   |
| 6    | Merge only when                           | Required checks pass (see §7), and review-pr shows low/medium risk without unresolved authority_drift for the slice. |

**Apply (optional, only when slice reconciled and policy green):**

- `apply --plan .omni-link/execution-plan.json` — branch-oriented, never on `main`, rollback plan and execution ledger required.
- If something fails: `rollback` using the generated rollback plan.

---

## 6. Full Command Order (Reference)

Recommended sequence when running the full max-tier loop locally:

```bash
export CONFIG="$HOME/.claude/omni-link-hustlexp.json"

# 1. Daemon and authority
node dist/cli.js watch --once --config "$CONFIG"
node dist/cli.js authority-status --config "$CONFIG"

# 2. Ecosystem snapshot and analysis
node dist/cli.js scan --markdown --config "$CONFIG"
node dist/cli.js impact --config "$CONFIG"
node dist/cli.js health --config "$CONFIG"

# 3. Review (pre-merge)
node dist/cli.js review-pr --base main --head HEAD --config "$CONFIG"
node dist/cli.js publish-review --pr <PR_NUMBER> --base main --head HEAD --config "$CONFIG"   # optional

# 4. Apply only when slice reconciled and policy green
# node dist/cli.js apply --plan .omni-link/execution-plan.json --config "$CONFIG"
# node dist/cli.js rollback --config "$CONFIG"   # if needed
```

From repo root of `omni-link-hustlexp`; or use `omni-link-hustlexp` on PATH if installed.

---

## 7. Pre-Merge Gates (Required Checks)

These must pass before merge (enforced by policy in config and, when implemented, by CI):

| Check                    | Meaning                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| **ios-build**            | iOS app builds (Xcode).                                                                |
| **ios-tests**            | iOS tests pass.                                                                        |
| **backend-typecheck**    | Backend `tsc --noEmit` (or equivalent).                                                |
| **backend-tests**        | Backend test suite.                                                                    |
| **docs-authority-check** | authority-status run; no _blocking_ drift for changed slice (or documented exception). |
| **contract-sync**        | review-pr run; no unresolved BREAKING contract mismatches for the changed slice.       |

Optional but recommended: **omni-link verify** (lint, test, build, smoke, contract fixtures) in the omni-link-hustlexp repo if you changed the control plane.

---

## 8. Cloud / CI (Max-Tier)

**Where:** GitHub Actions (or equivalent) in each of the three repos (or a dedicated “ecosystem” workflow that checks out all three).

**On every push / PR:**

1. **Checkout** — Repo(s) affected; for cross-repo checks, checkout all three (e.g. HUSTLEXPFINAL1 + submodule or sibling clones for backend and docs).
2. **Install omni-link-hustlexp** — `npm ci` in omni-link-hustlexp (or use published package).
3. **Build** — `npm run build` in omni-link-hustlexp.
4. **Run with project config** — Config must point at the three repo paths (e.g. from env or a committed path map).
   - `watch --once`
   - `authority-status` → **fail job if** authority_drift is present and policy is strict (or emit warning in reconciliation mode).
   - `scan` (or `scan --markdown`) → capture artifact.
   - `review-pr --base main --head HEAD` → **fail job if** review reports blocking policy or BREAKING contract mismatches (per project policy).
5. **Publish artifact** — Upload scan and review-pr outputs so reviewers and dashboards can use them.

**Nightly / scheduled (optional):**

- Full `watch` + `authority-status` + `scan` + `health` + `evolve`.
- Run live benchmark: `npm run benchmark:hustlexp:live -- --config <path>`.
- Publish summary (e.g. to Slack, or a static report) for ecosystem health and drift trends.

---

## 9. Integration with HUSTLEXP-DOCS

| Doc                                  | Role in max-tier workflow                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **CURRENT_PHASE.md**                 | Phase gate. Workflow respects “Reconciliation” and next phases; no automation pretends bootstrap when code is beyond it.   |
| **EXECUTION_QUEUE.md**               | Frontend build order. When building screens, Cursor/agent runs one step at a time; omni-link does not override step order. |
| **FINISHED_STATE.md**                | Product scope. No feature outside this without authority update.                                                           |
| **FEATURE_FREEZE.md**                | No new features without process.                                                                                           |
| **AI_GUARDRAILS.md**                 | AI executes, does not design; PER system (PER-0–PER-Ω) applies.                                                            |
| **specs/04-backend/API_CONTRACT.md** | Authority for API surface. Reconcile here first when fixing docsOnly/backendOnly/payloadDrift.                             |
| **specs/02-architecture/schema.sql** | Authority for schema. Schema changes follow same “authority first” rule.                                                   |

---

## 10. Success Criteria (Workflow)

Max-tier workflow is “done” for a change when:

- **Docs authority** matches the backend provider surface for the slice you changed.
- **Swift consumer calls** match the backend provider surface for that slice.
- **Payload drift** is zero or explicitly documented and accepted.
- **review-pr** reports low or medium risk and no unresolved **authority_drift** for that slice.
- **apply** (if used) is branch-oriented and never mutates `main`; rollback plan and execution ledger exist.
- **Required checks** (ios-build, ios-tests, backend-typecheck, backend-tests, docs-authority-check, contract-sync) are green.

---

## 11. Definition of Max Tier (Ecosystem)

The HustleXP ecosystem operates at **max tier** when:

1. **Authority is the source of truth** — Docs (CURRENT_PHASE, API_CONTRACT, schema) reflect real implementation; drift is the exception and is tracked.
2. **Three-way alignment** — HUSTLEXP-DOCS (intent), hustlexp-ai-backend (provider), HUSTLEXPFINAL1 (consumer) are reconciled for the active slices.
3. **Control plane is mandatory** — Session start and pre-merge flows always run watch → authority-status → scan; review-pr before merge; apply only when slice reconciled.
4. **Automation is bounded** — No direct main mutation; policy-gated; rollback plans and execution ledger for apply.
5. **Cloud checks run** — CI runs authority-status and review-pr (and optionally health, impact) on every push/PR with clear pass/fail for drift and contract.
6. **Benchmarks are met** — Cold daemon &lt;20s, warm &lt;1s; procedure/call counts and bridge matches meet the live benchmark targets (see omni-link-hustlexp README).

---

## 12. Quick Reference

| When                                  | Do this                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Open project**                      | watch --once → authority-status → scan --markdown                                                        |
| **Before API/schema/contract change** | + impact, health; reconcile slice then edit                                                              |
| **Before opening PR**                 | review-pr; fix or document mismatches; optional publish-review                                           |
| **Before merge**                      | All required checks green; review-pr low/medium risk; no unresolved authority_drift for slice            |
| **Optional apply**                    | Only when slice reconciled and policy green; apply then rollback if needed                               |
| **CI**                                | Run watch, authority-status, scan, review-pr; fail on blocking drift or BREAKING mismatches (per policy) |

---

_Document version: 1.0. Generated for HustleXP ecosystem with omni-link-hustlexp as control plane. Aligns with CURRENT_PHASE.md (Reconciliation), omni-link README playbook, and max-tier execution backlog._
