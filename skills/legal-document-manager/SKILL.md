---
name: legal-document-manager
description: 'Use when changing fee percentages in HustleXP code, preparing legal documents for execution, checking placeholder status, or verifying legal-code sync after any financial change'
---

# HustleXP Legal Document Manager

## Trigger Conditions

Activate this skill whenever:

- Any fee percentage changes in backend code (platform fee, tip cut, cancellation fee, background check fee)
- A legal document is being prepared for user signature or execution
- Placeholder status is requested
- Legal-code sync verification is needed after any financial change

## Document Suite Location

All 6 legal documents live at:
`/Users/sebastiandysart/HustleXP/HUSTLEXP-DOCS/legal/`

### The 6 Documents

| File                                     | Purpose                                      |
| ---------------------------------------- | -------------------------------------------- |
| `HustleXP-Hustler-Agreement.docx`        | Hustler (worker) primary contract            |
| `HustleXP-Poster-Agreement.docx`         | Poster (task creator) primary contract       |
| `HustleXP-Beta-NDA-Agreement.docx`       | Beta participant NDA + consent               |
| `HustleXP-Acceptable-Use-Policy.docx`    | Platform-wide AUP                            |
| `HustleXP-Arbitration-Agreement.docx`    | Standalone arbitration + class action waiver |
| `HustleXP-Background-Check-Consent.docx` | FCRA consent + Checkr auth                   |

Document status: All 6 are bulletproofed as of 2026-03-15 (14 patches applied). Do NOT re-patch — they are verified correct.

---

## HARD BLOCK: 3 Unfilled Placeholders

**No user may sign any document until all applicable placeholders are filled.**

| Placeholder        | Appears In                 | Location                                              |
| ------------------ | -------------------------- | ----------------------------------------------------- |
| `[State]`          | ALL 6 documents            | Governing jurisdiction — throughout each document     |
| `[Effective Date]` | ALL 6 documents            | Preamble / execution date                             |
| `[Address]`        | Arbitration Agreement ONLY | Sections 3.2 and 5.1 (opt-out notice mailing address) |

**Critical warning on `[State]`:** Do NOT choose California without counsel review. California triggers PAGA exposure and AB5/Dynamex independent contractor complications.

---

## Fee Disclosure Sync: Code ↔ Legal

**This is bidirectional.** When fee percentages change in code, legal documents MUST be updated before the next user signs. When legal documents update prohibited categories or fee schedules, code must be reviewed.

### Fee Change Lookup Table

| Code Location / Fee Type  | Current Value      | Legal Documents to Update            | Sections                |
| ------------------------- | ------------------ | ------------------------------------ | ----------------------- |
| Platform fee %            | 15%                | Hustler Agreement + Poster Agreement | Fee disclosure sections |
| Tip platform cut %        | 0% → being changed | Hustler Agreement + Poster Agreement | Tip/gratuity disclosure |
| Cancellation fee schedule | See Exhibit A      | Poster Agreement                     | Exhibit A + Section 4.4 |
| Background check fee      | —                  | Background Check Consent             | Fee disclosure          |

### When a Fee Changes — Full Workflow

1. Identify the fee type that changed (platform %, tip cut %, cancellation schedule, background check fee)
2. Look up the table above for which documents need updating
3. Open the relevant `.docx` files in `/Users/sebastiandysart/HustleXP/HUSTLEXP-DOCS/legal/`
4. Update the fee disclosure sections to match the new percentages
5. Log the legal change in `TODO.md` in HUSTLEXP-DOCS
6. Commit both the code change and the legal doc change together in the same PR when possible

**Example — tip cut change from 0% to 7%:**

- Documents to update: `HustleXP-Hustler-Agreement.docx` AND `HustleXP-Poster-Agreement.docx`
- Find the tip/gratuity disclosure section in each
- Update percentage from 0% to 7%
- Commit alongside the TippingService.ts change

---

## Cancellation Fee Schedule

- Referenced URL: `https://hustlexp.com/legal/cancellation-fees`
- Referenced in: Poster Agreement — Exhibit A and Section 4.4
- Status: **NOT yet published** — must be live and versioned before Poster Agreement is executed

---

## Pre-Execution Counsel Review Items

These items require legal counsel sign-off before any document is executed with users:

1. **PAGA waiver enforceability** — in whichever `[State]` is chosen
2. **AAA fee schedule** — verify current as of 2024 rules (Arbitration Agreement)
3. **FCRA adverse action timeline** — verify compliant for Checkr integration (14-day notice window)
4. **Viking River Cruises v. Moriana compliance** — U.S. Supreme Court 2022 — for PAGA waiver in Arbitration Agreement

---

## Response Pattern for Fee Change Questions

When asked "we changed fee X — is there anything else we need to do?", always:

1. **Immediately identify** whether the fee type maps to a legal document update (use the table above)
2. **Name the specific documents** that need updating
3. **Name the specific sections** within those documents
4. **State the workflow**: open .docx at the legal directory path, update the section, log in TODO.md, commit together
5. **Check placeholder status**: if any of the 3 HARD BLOCK placeholders are unfilled, surface that as a blocker before any document goes to users
6. **Flag counsel review items** if a document is being prepared for actual execution

---

## Document Version History (do not re-apply these patches)

14 patches applied across 4 documents as of 2026-03-15:

- Poster Agreement: data breach clause added + Exhibit A added
- Beta NDA: CA/IL recording restrictions added
- Arbitration Agreement: 6 fixes (memo paragraphs, JAMS→AAA, arbitrator fees, batch timeline cap)
- Background Check Consent: credit score right fixed, NY Article 23-A added
