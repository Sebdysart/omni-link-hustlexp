---
name: owners
description: Resolve owner assignments for repos, APIs, paths, and packages using omni-link ownership rules.
disable-model-invocation: true
---

# /owners — Resolve Ownership

Use `/owners` to inspect the ownership model omni-link resolved from your config. This is the source of truth used by `review-pr`, `apply`, and policy enforcement.

## Inputs

- `ownership.defaultOwner`
- `ownership.rules[]`
- repo metadata, API routes, file paths, and package dependencies

## Output

`/owners` returns:

1. Global owner assignments
2. Per-repo owner assignments
3. Match provenance for each owner mapping
