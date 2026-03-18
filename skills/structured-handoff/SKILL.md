---
name: structured-handoff
description: Enforces structured JSON handoff protocol between sub-agents. Auto-summarizes context, pushes to shared memory, and triggers next agent with full dependency chain.
---

# Structured Handoff Protocol

When delegating work to a sub-agent or receiving a handoff from another agent, you MUST use the structured handoff format.

## Handoff JSON Schema

Every inter-agent message MUST be a JSON object with these fields:

```json
{
  "context": "Brief project state — what has been done so far",
  "task": "Explicit instruction — what the receiving agent must do",
  "dependencies": ["list of prior outputs, memory keys, or file paths"],
  "expected_format": "Markdown | JSON | Code",
  "constraints": ["list of constraints or blockers"],
  "ecosystem_state": "omni-link digest summary if available",
  "summary": "Human-readable one-liner for the main session"
}
```

## Rules

1. **NEVER delegate without context.** Every handoff must include `context` summarizing what happened before.
2. **NEVER leave dependencies implicit.** If Agent B needs the output of Agent A, list it in `dependencies`.
3. **ALWAYS include `expected_format`** so the receiving agent knows how to structure its output.
4. **ALWAYS write a `summary`** — this is what the main session and humans see.
5. **ALWAYS push the handoff to the Shared Bulletin Board** in CLAUDE.md after sending.

## Usage Pattern

```
/handoff @specialist-name

Analyzes the last N turns, generates the structured handoff JSON,
writes it to CLAUDE.md > Shared Bulletin Board, and invokes the target agent.
```

## Integration with omni-link

When performing a handoff that involves code changes:
- Run `/scan` to get the current ecosystem state
- Include the relevant portion of the digest in `ecosystem_state`
- Run `/impact` if the handoff involves API surface changes
- Include contract mismatches in `constraints` if any exist

## Receiving a Handoff

When you receive a structured handoff:
1. Parse the JSON
2. Read all `dependencies` from memory or the filesystem
3. Execute the `task` according to `expected_format`
4. Generate your own handoff JSON as output (for the next agent or back to coordinator)
5. Update the Shared Bulletin Board with your completion status
