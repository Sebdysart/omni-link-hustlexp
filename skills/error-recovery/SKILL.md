---
name: error-recovery
description: Auto-triage protocol for sub-agent failures, blockers, and stalled tasks. Retries with modified strategy, escalates, or pivots.
---

# Error Recovery Protocol

When a sub-agent fails, stalls, or reports a blocker, this protocol activates.

## Stalling Prevention

1. **Three-Strike Rule:** If the same error occurs 3 times, STOP retrying. Analyze logs and propose a strategy pivot.
2. **Timeout Detection:** If a sub-agent hasn't produced output in 60 seconds, consider it stalled.
3. **Context Drift:** After every major action, summarize current state to prevent the context window from degrading.

## Triage Decision Tree

```
Error received →
  ├─ Is it a known error type (ScanError, ConfigError, PathTraversalError)?
  │   ├─ ScanError/git phase → Check repo path exists, verify git init, retry once
  │   ├─ ScanError/parse phase → Skip file, continue with remaining files
  │   ├─ ConfigError → Report field + suggestion to user, do not retry
  │   └─ PathTraversalError → Report path issue, block further operations
  │
  ├─ Is it a network/timeout error?
  │   └─ Retry with exponential backoff (1s, 2s, 4s), max 3 attempts
  │
  ├─ Is it a dependency blocker?
  │   ├─ Can we work around it? → Proceed with partial results
  │   └─ Hard dependency? → Escalate to coordinator with blocker report
  │
  └─ Unknown error?
      └─ Log full error, escalate to coordinator, suggest manual intervention
```

## Blocker Report Format

```json
{
  "type": "blocker",
  "agent": "@agent-name",
  "task_id": "T-xxx",
  "error": "Error description",
  "attempts": 2,
  "strategy": "What was tried",
  "suggestion": "Recommended next step",
  "can_partial": true,
  "partial_output": "What was completed before the blocker"
}
```

## Integration with omni-link

- Use `ScanResult.failures[]` to detect which repos failed scanning
- Check `ScanError.phase` to determine retry strategy
- Use `qualityCheck()` to validate recovered/partial output before accepting it
