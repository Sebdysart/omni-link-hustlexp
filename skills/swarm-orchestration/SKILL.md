---
name: swarm-orchestration
description: Orchestrate multi-agent swarms via the ruflo engine for parallel task execution, dynamic topology, and intelligent coordination. Use when scaling beyond single agents, implementing orbit loops, or running attack/fix workflows.
---

# Swarm Orchestration

Use this skill when you need to coordinate multiple agents for parallel work — orbit loop attack/fix rounds, bulk code review, or distributed testing.

## When to Use

- Running a HustleXP orbit loop with attack and fix agents
- Parallelizing independent tasks across specialized workers
- Coordinating queen-led hierarchical workflows

## Topology Patterns

### Hierarchical (Queen-Worker) — default for HustleXP

The queen agent analyzes, delegates, and rebalances. Workers specialize:

- **attack-auth** — security audit, auth domain
- **attack-fin** — financial logic validation
- **fixer-auth** — auth bug remediation
- **fixer-fin** — financial bug remediation

### Mesh (Peer-to-Peer)

Equal peers communicate directly. Best for review consensus and brainstorming.

### Adaptive

Automatically switches topology based on task complexity.

## Orbit Loop Pattern

```
1. Queen dispatches attack agents by domain weight (self-learning loop informs priority)
2. Attack agents produce findings → stored in vector memory
3. Triage phase: compare findings against past rounds via vector search
4. Queen dispatches fix agents for prioritized findings
5. Verify phase: re-test all fixed areas
6. Record round findings for next iteration's learning
```

## Rules

1. **ALWAYS use hierarchical topology** for orbit loops — a queen must coordinate.
2. **ALWAYS record findings** after each round so the self-learning loop can weight future priorities.
3. **NEVER skip triage** — vector search against past findings prevents duplicate work and surfaces regressions.
4. **ALWAYS verify fixes** before marking a round complete.
5. **Respect authority gates** — the HustleXP plugin blocks execution when authority drift is unresolved.
