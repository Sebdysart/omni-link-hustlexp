# HustleXP Max-Tier Boot Workflow

**Authority:** `HUSTLEXP-DOCS/docs/plans/2026-03-11-max-tier-boot-workflow-design.md`
**Audience:** Claude Code (primary executor) + human (audit)
**Mandate:** Zero improvisation. Every fork pre-labeled. Every command absolute-path + timeout.

---

## Enforced Rules (non-negotiable)

1. All CLI commands use full absolute paths and `timeout 30s`
2. Output format after every phase: `PHASE: X | PATH: Y | ACTIONS_TAKEN: [list] | EXIT: LABEL`
3. Any CLI failure or timeout → immediate `EXIT-READ-FAIL-2`
4. Max 2 re-entries to any phase; third attempt = `EXIT-LOOP-FAIL` → surface to human
5. Snapshot assembled exactly as defined below; no other fields permitted
6. Claude never selects a git SHA for rollback — always surface to human

---

## Snapshot Schema

```json
{
  "digest": {
    "timestamp": "ISO8601",
    "staleness_hours": "integer"
  },
  "tests": {
    "pass_rate_percent": "float",
    "failing_tests": "integer",
    "coverage_percent": "float"
  },
  "drift": {
    "count": "integer",
    "severity": "none | informational | blocking",
    "areas": ["string"]
  },
  "health": {
    "current": "integer",
    "target": 95,
    "delta": "integer"
  },
  "extra": {
    "security_alert": "boolean"
  }
}
```

---

## Snapshot Assembly (mandatory first action of PHASE 1)

Run these 4 commands sequentially. Merge outputs into snapshot schema above.

**Step 1 — Digest** (from session-start context, no CLI needed)

```
timestamp = digest.generatedAt from omni-link session-start inject
staleness_hours = Math.floor((Date.now() - new Date(generatedAt)) / 3600000)
```

**Step 2 — Tests** (read persisted coverage, or regenerate)

```bash
cat /Users/sebastiandysart/Desktop/hustlexp-ai-backend/coverage/coverage-summary.json
# If file missing or older than 24h:
npx --prefix /Users/sebastiandysart/Desktop/hustlexp-ai-backend vitest run --coverage
cat /Users/sebastiandysart/Desktop/hustlexp-ai-backend/coverage/coverage-summary.json
```

Parse: `total.lines.pct` → `coverage_percent`, `total.lines.covered/total` → `pass_rate_percent`, count failing test names from last run output → `failing_tests`.

**Step 3 — Drift + security_alert** (single CLI call)

```bash
node /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js authority-status
```

Parse: `payloadDrift` → `drift.count`, areas list → `drift.areas`, `contractStatus.mismatches.length > 0` → `extra.security_alert`.

**Step 4 — Health**

```bash
node /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js health
```

Parse: overall score → `health.current`, compute `health.delta = 95 - health.current`.

**On any parse failure:** `EXIT-READ-FAIL-1` — do not proceed.

---

## PHASE 1: READ

**Purpose:** Assemble and validate snapshot. No interpretation.

1. Run Snapshot Assembly (above)
2. Validate all fields present with correct types
   - Missing or malformed → **EXIT-READ-FAIL-1** (request fresh session start, terminate boot)
   - Pass → **EXIT-READ-OK** → proceed to PHASE 2

---

## PHASE 2: ASSESS

**Purpose:** Classify ecosystem state. Execute in strict order. Stop at first terminal exit.

### Step 1 — Digest freshness

```
IF staleness_hours > 24
  → EXIT-ASSESS-DIGEST-STALE
ELSE continue
```

### Step 2 — Test health

```
IF failing_tests ≥ 1 AND pass_rate_percent < 95
  → EXIT-ASSESS-TESTS-FAILING
ELSE continue
```

### Step 3 — Drift triage (HustleXP-specific)

**Irreducible floor check (apply first):**

```
IF drift.count == 11
  OR every area in drift.areas matches ANY of:
    - contains "enum" or "string literal"
    - contains "Record<" or "[String:Bool]" or "Dictionary"
    - contains "named struct" or "inline object"
THEN force severity = "informational"
```

**After triage:**

```
IF severity == "blocking"   → EXIT-ASSESS-DRIFT-BLOCKING
IF severity == "informational" → EXIT-ASSESS-DRIFT-INFORMATIONAL
IF severity == "none"       → continue
```

### Step 4 — Health delta

```
IF delta ≥ 21               → EXIT-ASSESS-HEALTH-CRITICAL-21
IF 11 ≤ delta ≤ 20          → EXIT-ASSESS-HEALTH-MAJOR-11
IF 6 ≤ delta ≤ 10           → EXIT-ASSESS-HEALTH-MINOR-6
IF delta ≤ 5                → continue
```

### Step 5 — Security gate

```
IF security_alert == true   → EXIT-ASSESS-EXTRA-ALERT
ALL CLEAR                   → EXIT-ASSESS-HAPPY → PHASE 3
```

---

## PHASE 3: DECIDE

**Purpose:** One-to-one mapping of assessment exit to action plan. No new analysis.

| Assessment Exit         | Exact Action Plan (in order)                                                                                                                                                                                                                          | Next                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **HAPPY**               | Standard boot — report state, proceed with user task                                                                                                                                                                                                  | PHASE 4                     |
| **DIGEST-STALE**        | `node /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js scan` → re-assemble snapshot                                                                                                                                                              | Re-enter PHASE 1            |
| **TESTS-FAILING**       | 1. List failing test names 2. Invoke `superpowers:systematic-debugging` per failure 3. Apply fix 4. `npx vitest run` to verify                                                                                                                        | EXIT-DECIDE-TESTS-HOLD      |
| **DRIFT-BLOCKING**      | 1. `node /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js authority-status` 2. Surface real mismatch fields to human 3. Human confirms fix scope 4. Apply Swift/TS code fix                                                                      | Re-enter PHASE 2            |
| **DRIFT-INFORMATIONAL** | Log: "PayloadDrift=N is irreducible type-repr floor. No action." Continue.                                                                                                                                                                            | PHASE 4                     |
| **HEALTH-CRITICAL-21**  | 1. `git -C /Users/sebastiandysart/Desktop/hustlexp-ai-backend log --oneline -8` 2. Output to human 3. Wait for human to supply stable SHA 4. `git -C /Users/sebastiandysart/Desktop/hustlexp-ai-backend reset --hard <HUMAN_SHA>` 5. `npx vitest run` | EXIT-DECIDE-HEALTH-ROLLBACK |
| **HEALTH-MAJOR-11**     | 1. `node /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js health` 2. Identify lowest-scoring repo 3. Invoke `omni-link:stabilize` skill 4. Re-assess after completion                                                                            | Re-enter PHASE 2            |
| **HEALTH-MINOR-6**      | Invoke `omni-link:stabilize` skill → continue                                                                                                                                                                                                         | PHASE 4                     |
| **EXTRA-ALERT**         | Log security alert. Surface `contractStatus.mismatches` to human. Do not proceed until human clears.                                                                                                                                                  | EXIT-DECIDE-SAFE-MODE       |

---

## PHASE 4: ACT

**Purpose:** Execute action plan → verify → confirm or escalate.

1. Execute exact steps from PHASE 3 action plan
2. Re-assemble fresh snapshot (mini READ — Steps 1-4 above)
3. Verify:

   ```
   Did the target metric improve or resolve? (yes / no)
   New assessment exit == expected post-action state? (yes / no)

   Both yes  → EXIT-ACT-SUCCESS (boot complete — report status to human)
   Either no (retry ≤ 2) → log diff, re-enter PHASE 4
   Either no (retry 3)   → EXIT-ACT-FAIL-RECOVERABLE (surface to human, stop)
   Security or real blocking drift still present → EXIT-ACT-FAIL-HARD (stop all work, surface to human)
   ```

---

## Post-Boot Status Report (emit after EXIT-ACT-SUCCESS)

```
BOOT COMPLETE
=============
Ecosystem health : {current}/100 (target: 95, delta: {delta})
Test coverage    : {coverage_percent}%
Failing tests    : {failing_tests}
PayloadDrift     : {count} ({severity})
Security alert   : {security_alert}
Digest age       : {staleness_hours}h
Boot exit path   : {all phase exits in order}
Ready for        : {user task description}
```

---

## Exit Code Registry

| Code                            | Meaning                                     |
| ------------------------------- | ------------------------------------------- |
| EXIT-READ-OK                    | Snapshot valid, proceed                     |
| EXIT-READ-FAIL-1                | Snapshot malformed/incomplete               |
| EXIT-READ-FAIL-2                | CLI command failed or timed out             |
| EXIT-ASSESS-DIGEST-STALE        | Digest > 24h old                            |
| EXIT-ASSESS-TESTS-FAILING       | ≥1 failing test                             |
| EXIT-ASSESS-DRIFT-BLOCKING      | Real contract mismatch                      |
| EXIT-ASSESS-DRIFT-INFORMATIONAL | Irreducible type-repr drift only            |
| EXIT-ASSESS-HEALTH-CRITICAL-21  | Health delta ≥ 21                           |
| EXIT-ASSESS-HEALTH-MAJOR-11     | Health delta 11-20                          |
| EXIT-ASSESS-HEALTH-MINOR-6      | Health delta 6-10                           |
| EXIT-ASSESS-EXTRA-ALERT         | Security mismatch detected                  |
| EXIT-ASSESS-HAPPY               | All gates clear                             |
| EXIT-DECIDE-TESTS-HOLD          | Test fix in progress, awaiting verification |
| EXIT-DECIDE-HEALTH-ROLLBACK     | Rollback initiated, awaiting human SHA      |
| EXIT-DECIDE-SAFE-MODE           | Security alert escalated to human           |
| EXIT-ACT-SUCCESS                | Boot complete                               |
| EXIT-ACT-FAIL-RECOVERABLE       | Verification failed after 2 retries         |
| EXIT-ACT-FAIL-HARD              | Blocking issue not resolved                 |
| EXIT-LOOP-FAIL                  | Phase re-entered 3 times, escalate          |
| EXIT-TIMEOUT                    | Boot exceeded 7 minutes                     |

---

## HustleXP Ecosystem Constants

```
Backend repo     : /Users/sebastiandysart/Desktop/hustlexp-ai-backend
iOS repo         : /Users/sebastiandysart/HustleXP/HUSTLEXPFINAL1
Docs repo        : /Users/sebastiandysart/HustleXP/HUSTLEXP-DOCS
omni-link binary : /Users/sebastiandysart/omni-link-hustlexp/dist/cli.js
Coverage file    : /Users/sebastiandysart/Desktop/hustlexp-ai-backend/coverage/coverage-summary.json
Health target    : 95
Drift floor      : 11 (irreducible — always informational)
simulateOnly     : false
```

---

_Cross-reference: `HUSTLEXP-DOCS/docs/plans/2026-03-11-max-tier-boot-workflow-design.md`_
