---
name: invoke
description: One-shot task front-door. Catalogs omni-link's own skills/agents/commands, routes the task to the best ones and executes it with them, then logs evidence-cited gaps in the plugin to docs/invoke-feedback.md so it improves the more you use it. Use via /invoke <task>, or when asked to find the right skill for a task.
---

# /invoke — Task Router & Plugin Self-Critique

`/invoke <task>` is the single front door to the omni-link plugin. Instead of remembering
which of the 30+ skills, 8 agents, and 12 commands fits a job, hand the task to `/invoke`: it
**catalogs** the plugin's own capabilities, **routes** the task to the best ones, **executes**
the task with them, and **records** — with evidence — where the plugin itself fell short, so
the toolkit gets sharper the more you use it.

This is a meta skill. It does not reimplement other skills' logic; it **composes** them and
honors every existing Iron Law (see `using-omni-link`).

## How to use

```
/invoke <free-text task>
```

Example: `/invoke add a Stripe refund endpoint to the backend and wire the iOS client`.

## Phase 1 — Catalog & route

1. Build a **live catalog** of the plugin's capabilities — do not rely on memory or a
   hand-maintained list:
   - skills: read the frontmatter `description` of every `skills/*/SKILL.md`
   - agents: read the frontmatter `description` of every `agents/*.md`
   - commands: read the frontmatter `description` of every `commands/*.md`
2. Use the `using-omni-link` Skill Registry trigger table as **priors**, but always reconcile
   it against the live catalog so newly added skills are never missed.
3. Match the task against the catalog and emit a **ranked routing shortlist**. For each pick:
   `name → one-line rationale → the trigger/keyword that matched`. Order by dependency
   (grounding → impact → generation → quality gate).

## Phase 2 — Execute

Carry out the task by invoking the shortlisted skills/agents/commands **in dependency order**.
Compose, never duplicate. Respect the Iron Laws while routing:

- run `/scan` first if the digest may be stale;
- run `/impact` before editing any API surface, shared type, or schema;
- apply `convention-enforcer` during code generation;
- pass `anti-slop-gate` and `uncertainty-checklist` before finalizing any generated code.

If the task is ambiguous or spans repos, route through `ecosystem-planner` first.

## Phase 3 — Reflect & log (Iron Law)

While routing and executing, watch for ways the **plugin itself** could be better for a task
like this, and classify each as:

- **GAP** — no skill/agent/command covers this; you had to improvise.
- **OVERLAP** — two or more capabilities ambiguously cover the same ground.
- **STALE / WEAK** — a description is outdated, misleading, or too vague to route on.

Every finding **must cite evidence**: the offending `skills/.../SKILL.md` (or agent/command)
path, what is wrong, and a concrete suggested improvement. **No evidence, no finding** — never
invent a gap. This is the same Iron Law that governs evolution suggestions.

Then persist: **read `docs/invoke-feedback.md` first** (to avoid duplicates), and **append** a
dated, task-titled entry. When nothing is wrong, append `No new gaps identified.` under the
entry so the journal still records that the task ran. Never rewrite earlier entries.

## Rules

1. **ALWAYS cite evidence** for every improvement finding (`path — what's wrong — suggestion`).
   No file/line/finding, no suggestion.
2. **ALWAYS dedupe** against `docs/invoke-feedback.md` before logging; bump or cross-reference
   an existing finding instead of repeating it.
3. **PREFER an existing skill** over inventing a new one — recommend what exists; only flag a
   GAP when nothing fits.
4. **NEVER weaken an existing Iron Law** to make routing easier.
5. **Keep the journal append-only** — concise entries, newest at the bottom, history intact.

## Example

`/invoke add a Stripe refund endpoint`

- **Route:** `cross-repo-impact` (touches the payments API surface) → `stripe-webhook-auditor`
  (closest Stripe-domain skill) → `convention-enforcer` → `anti-slop-gate`.
- **Execute:** run `/impact`, implement the endpoint matching detected conventions, gate the
  output.
- **Reflect & log:** append to `docs/invoke-feedback.md` →
  `GAP: no refund-flow skill; closest is skills/stripe-webhook-auditor/SKILL.md, which covers
webhook verification, not refund issuance — consider a refund-flow skill.`
