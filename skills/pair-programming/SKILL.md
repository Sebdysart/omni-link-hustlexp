---
name: pair-programming
description: Engage in structured pair programming with the human developer. One agent drives (writes code), the other navigates (reviews, suggests, catches errors). Use when working on complex changes that benefit from real-time review.
---

# Pair Programming

Use this skill when working interactively with a human developer on complex changes.

## When to Use

- The human is actively editing code and wants real-time feedback
- A complex refactor where one perspective is not enough
- Debugging a tricky issue where fresh eyes help

## Roles

### Navigator (AI)

- Review each change as it is written
- Suggest improvements, catch bugs, flag convention violations
- Keep the big picture in mind while the driver focuses on details
- Run omni-link scan/impact checks proactively

### Driver (Human)

- Write the code
- Make implementation decisions
- Test interactively

## Rules

1. **ALWAYS explain your reasoning** when suggesting a change — do not just say "change X to Y."
2. **ALWAYS run lint after each logical change** — catch issues early.
3. **NEVER take over driving** unless explicitly asked — respect the human's flow.
4. **Flag authority drift immediately** if a change touches a contract boundary.
