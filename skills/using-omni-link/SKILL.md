---
name: using-omni-link
description: Meta skill loaded at session start. Defines iron laws, skill registry, and aggressive evolution posture for the omni-link ecosystem plugin.
---

# omni-link — Ecosystem-Aware Development

You have access to **omni-link**, a multi-repo ecosystem plugin that scans up to 4 repositories via tree-sitter AST parsing, builds an EcosystemGraph (API bridges, type lineage, contract mismatches, impact paths), and injects a token-budgeted digest into your context at session start.

## Iron Laws

These are non-negotiable. Violating any of these is a blocking error.

1. **NEVER hallucinate imports, types, routes, or procedures.** Every import path, type name, API route, and tRPC procedure you reference MUST exist in the ecosystem manifest. If you are unsure, verify against the digest or run `/scan`.
2. **ALWAYS verify against the manifest** before generating code that references cross-repo contracts, shared types, or API endpoints.
3. **NEVER introduce a package not in the dependency list** without explicitly calling it out and confirming with the user.
4. **NEVER use placeholder code** (TODO throws, not-implemented stubs, console.log placeholders) in production code generation.
5. **ALWAYS run impact analysis** (`/impact`) before making changes to API surfaces, shared types, or database schemas.
6. **ALWAYS match the detected conventions** of the target repository (naming, file organization, error handling, testing patterns).

## Digest Format

The ecosystem digest injected at session start contains:

```
repos:          List of scanned repos with branch, language, uncommitted change count
contractStatus: Total API bridges, how many are exact/compatible/mismatched
mismatches:     Specific contract mismatches with provider/consumer file:line
evolution:      Ranked improvement suggestions with evidence citations
conventions:    Per-repo naming, file org, error handling, testing patterns
apiSurface:     Summary of routes, procedures, and exports across all repos
recentChanges:  Summary of recent git activity across the ecosystem
```

When the digest includes **contract mismatches**, you MUST acknowledge them before proceeding with any work. Do not silently ignore mismatches.

## Skill Registry

Invoke these skills based on the trigger conditions described:

| Skill                   | Trigger                                   | Purpose                                                         |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `ecosystem-grounding`   | Session start, after rescan               | Ground yourself in the ecosystem state before doing work        |
| `cross-repo-impact`     | Before API/schema/type changes            | Analyze ripple effects across repos                             |
| `anti-slop-gate`        | Before finalizing any code generation     | Block hallucinated imports, phantom packages, wrong conventions |
| `convention-enforcer`   | During code generation                    | Match detected codebase patterns                                |
| `dependency-navigator`  | "Where is X used?", tracing dependencies  | Cross-repo exploration and tracing                              |
| `health-audit`          | Periodic health checks, `/health` command | Score and assess ecosystem health                               |
| `ecosystem-planner`     | Multi-repo feature planning               | Order tasks across repos, identify coordination points          |
| `business-evolution`    | Session start, `/evolve` command          | Surface improvement opportunities with evidence                 |
| `upgrade-executor`      | Executing multi-repo changes              | Orchestrate changes provider-first with validation              |
| `uncertainty-checklist` | Before presenting any generated code      | Self-audit checklist for import/type/placeholder verification   |

## Max-Tier Anti-Hallucination Mode

omni-link v1.0.0 introduces structural anti-hallucination safeguards across all layers:

### Agent Prompts

All three sub-agents (`validator`, `cross-repo-reviewer`, `evolution-strategist`) include mandatory Anti-Hallucination Protocol sections requiring uncertainty disclosure, CoT verification in `<thinking>` tags, and evidence-before-assertion discipline.

### Validator Critic Agent

A dedicated `validator` agent performs read-only verification of generated code:

- Verifies every import resolves to a real file
- Confirms every package exists in `package.json`
- Validates every API call against the ecosystem manifest
- Detects placeholders and phantom packages

Dispatched via `/verify`. Returns PASS / FAIL / INCONCLUSIVE.

### Neurosymbolic Rule Engine

Hard rules enforced via `checkRules()` in the quality pipeline:

- `no-fetch-without-catch` — fetch() must have error handling
- `no-raw-env-access` — process.env.X needs a `??` fallback
- `no-any-cast` — `as any` banned in production code
- `no-hardcoded-secret` — API keys must not be inlined

### Enriched Digest (Code Quotes)

The ecosystem digest now includes actual type signatures and route signatures — not just counts. Claude can see the real field names and parameter types, eliminating hallucinated field access.

### Dry-Run Mode

Set `simulateOnly: true` in your omni-link config to run all operations in preview mode. Use `/apply` to execute for real after human review.

### Uncertainty Checklist

The `uncertainty-checklist` skill is a pre-presentation self-audit that Claude runs silently before showing code. It prevents overconfident wrong code from reaching the user.

## Aggressive Evolution Posture

omni-link is configured with an **aggressive evolution posture**. This means:

- At session start, review the `evolutionOpportunities` in the digest and surface the top suggestions to the user.
- When you notice patterns that match known gaps (incomplete CRUD, missing pagination, no caching, missing rate limiting), proactively mention them.
- Every suggestion MUST include evidence: specific `file:line` references from the actual codebase.
- Never fabricate evidence. If you cannot cite a real file and line, do not make the suggestion.

## Available Commands

| Command   | What It Does                                                |
| --------- | ----------------------------------------------------------- |
| `/scan`   | Force full ecosystem rescan, refresh the digest             |
| `/impact` | Analyze impact of uncommitted changes across repos          |
| `/health` | Full ecosystem health audit with per-repo scores            |
| `/evolve` | Run business evolution analysis, surface suggestions        |
| `/verify` | Dispatch Validator critic agent to review generated code    |
| `/apply`  | Execute operations previewed in dry-run (simulateOnly) mode |

## When In Doubt

- If the digest is stale or you suspect changes since last scan: run `/scan`.
- If you are about to modify an API endpoint or shared type: run `/impact` first.
- If generated code references imports you have not verified: run the anti-slop-gate check.
- If you are unsure about a convention: check the digest's `conventionSummary` for the target repo.
