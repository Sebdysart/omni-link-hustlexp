---
name: verification-quality
description: Enforce rigorous verification standards for all code changes. Ensures lint, test, coverage, build, smoke, and contract checks all pass before any change is considered complete. Use as the final gate before merge.
---

# Verification Quality

Use this skill as the final quality gate before considering any change complete.

## When to Use

- Before opening a PR
- After completing a feature or fix
- Before any merge to main

## Verification Levels

### Basic (`npm run verify`)

Lint + test + coverage + build + CLI smoke + benchmark smoke + pack check

### Max (`npm run verify:max`)

Basic + max-tier smoke + contract fixture smoke + package install smoke

### Stress (`npm run verify:stress`)

Max + full polyglot stress harness + live provider gates (if credentials configured)

### HustleXP (`npm run verify:hustlexp`)

Max + authority tests + bridge tests + profile integration + benchmark

## Rules

1. **ALWAYS run at least `npm run verify`** before considering work complete.
2. **Run `npm run verify:max`** for any change that touches public command surfaces, contract fixtures, or the engine pipeline.
3. **NEVER skip lint** — 0 errors is non-negotiable.
4. **NEVER commit with failing tests** — fix them or explain why they are expected failures.
5. **Check `npm audit --audit-level=moderate`** — must stay at zero vulnerabilities.
6. **If a smoke test fails, it blocks** — do not work around it.
