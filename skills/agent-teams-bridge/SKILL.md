---
name: agent-teams-bridge
description: Detects and bridges between sub-agent delegation and native Agent Teams peer-to-peer messaging. Enables mesh networking with task self-claiming.
---

# Agent Teams Bridge

This skill enables seamless switching between linear sub-agent delegation and native Claude Code Agent Teams peer-to-peer messaging.

## Detection

Check for the Agent Teams capability:

```
if CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set:
  → Use native `message @teammate` and `broadcast` for parallel work
  → Use shared task list with self-claiming
else:
  → Fall back to standard sub-agent spawning with structured handoff
```

## Agent Teams Mode (Peer-to-Peer)

When Agent Teams are active, you operate as a **peer** rather than a **subordinate**:

1. **Claim tasks** from the shared task list instead of waiting for delegation
2. **Broadcast** status updates to all team members
3. **Direct message** specific teammates when you need their output
4. **Self-coordinate** — no single coordinator bottleneck

### Message Format

```json
{
  "type": "task_update | request | completion | blocker",
  "from": "@your-agent-name",
  "to": "@target | broadcast",
  "payload": {
    "task_id": "unique-id",
    "status": "claimed | in-progress | blocked | complete",
    "output": "result or null",
    "needs": ["list of dependencies still pending"]
  },
  "summary": "Human-readable status line"
}
```

## Sub-Agent Fallback Mode

When Agent Teams are NOT available:

1. Use the standard structured handoff protocol (see `structured-handoff` skill)
2. Coordinator delegates linearly via sub-agent spawning
3. Results flow back through the coordinator

## Shared Task List

Maintain in CLAUDE.md under `## Active Task Board`:

```markdown
## Active Task Board [agent-teams-bridge]
| Task ID | Description | Assigned | Status | Updated |
|---------|-------------|----------|--------|---------|
| T-001   | Refactor auth module | @backend-specialist | in-progress | 10:30 |
| T-002   | Update iOS DTOs | @ios-specialist | claimed | 10:31 |
| T-003   | Write migration | unclaimed | pending | 10:28 |
```

## Integration with omni-link

- Before claiming a task that touches API surfaces, run `/impact` to check cross-repo effects
- Broadcast contract mismatches to all team members when detected
- Use `/scan` output as shared context in the bulletin board
