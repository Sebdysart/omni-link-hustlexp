---
name: sparc-methodology
description: Apply the SPARC methodology (Specification, Pseudocode, Architecture, Refinement, Completion) for structured, high-quality code generation. Use for complex features, architectural changes, or any work requiring deliberate design before implementation.
---

# SPARC Methodology

SPARC structures complex coding tasks into five deliberate phases to prevent hasty, error-prone implementation.

## When to Use

- Implementing a complex feature with multiple moving parts
- Making architectural changes that affect multiple modules
- Any task where "just start coding" would likely produce rework

## Phases

### 1. Specification

Define what success looks like. Write acceptance criteria, identify inputs/outputs, list constraints. Do NOT write code yet.

### 2. Pseudocode

Sketch the algorithm in plain language or pseudocode. Identify edge cases. Validate the approach against the specification before committing to implementation.

### 3. Architecture

Decide where the code lives, which modules it touches, what interfaces it exposes. Check against existing conventions (run omni-link scan if unsure).

### 4. Refinement

Implement the code, then immediately review it against the specification. Fix deviations, add error handling, ensure tests exist for each acceptance criterion.

### 5. Completion

Run the full verification pipeline (lint, test, build). Confirm all acceptance criteria are met. Only then consider the task done.

## Rules

1. **NEVER skip Specification** — unclear goals produce unclear code.
2. **ALWAYS write pseudocode before implementation** for non-trivial tasks.
3. **ALWAYS check architecture against omni-link conventions** before creating new files.
4. **ALWAYS run verification after Refinement** — do not self-certify completion.
