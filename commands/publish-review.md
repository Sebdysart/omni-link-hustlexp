---
name: publish-review
description: Publish or replay provider comments and check runs from a saved omni-link PR review artifact.
disable-model-invocation: true
---

# /publish-review — Provider Review Publish

Use `/publish-review` after `/review-pr` when you want to push the review artifact through the configured provider transport. This keeps analysis and provider-side writes as separate steps.

## Typical usage

```bash
omni-link publish-review --pr 42 --base main --head HEAD
```

## Safety model

1. `/publish-review` never mutates your code or protected branches
2. The default provider mode is `dry-run`
3. `replay` mode writes deterministic provider payloads to disk for verification
4. Provider selection comes from `reviewProvider`
5. Live provider modes fetch PR or MR metadata before publish so omni-link can resolve missing head SHAs and skip closed, merged, or locked review targets
6. `github` mode requires `github.owner`, `github.repo`, and a GitHub token
7. `gitlab` mode requires `gitlab.namespace`, `gitlab.project`, and a GitLab token

## Output

The publish result includes:

1. Provider and publish mode
2. Target owner, repo, pull request number, and resolved head SHA
3. Negotiated provider capabilities
4. Live provider metadata when available
5. Comment publish status
6. Check-run publish status
