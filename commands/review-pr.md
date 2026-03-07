---
name: review-pr
description: Generate a branch-aware PR review artifact with risk, impact, owners, and an execution plan.
disable-model-invocation: true
---

# /review-pr — PR Review Artifact

Use `/review-pr` to compare a base ref and head ref, compute cross-repo impact, score risk, resolve owners, and generate a bounded execution plan.

## Typical usage

```bash
omni-link review-pr --base main --head HEAD
```

## Output

The review artifact includes:

1. Changed refs and affected repos
2. Impact paths and contract mismatches
3. Risk score and policy decisions
4. Owner assignments
5. A branch/PR-oriented execution plan with rollback instructions
