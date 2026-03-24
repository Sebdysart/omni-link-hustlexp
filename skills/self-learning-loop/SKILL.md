---
name: self-learning-loop
description: Use the self-learning loop to improve orbit rounds over time. Records findings, analyzes domain risk weights, detects regressions, and recommends attack priorities for the next round. Use between orbit rounds.
---

# Self-Learning Loop

Use this skill between orbit rounds to make each subsequent round smarter. The loop learns which domains produce the most bugs, which fixes regress, and where to focus attack effort.

## When to Use

- Before starting a new orbit round (R53 after R52)
- After completing a round to record findings
- When triaging to check if a finding is a regression

## Workflow

### 1. Record findings after a round

After R52 completes, record all findings with domain, severity, and fix status.

### 2. Generate learning report before R53

Query all prior findings. The report includes:

- **Domain weights** — domains with more critical/unfixed findings get higher priority
- **Regression candidates** — previously-fixed findings flagged for re-verification
- **Recommended priorities** — high/medium/low per domain based on evidence
- **Learning confidence** — how much data the loop has to make good recommendations (0.0 = no data, 1.0 = sufficient data)

### 3. Apply priorities to swarm dispatch

Use the recommended priorities to configure the queen agent's task dispatch. High-priority domains get more attack agents.

### 4. After fixes, find similar past findings

Use vector search to check if a new finding matches a previously-fixed issue — this is a regression flag.

## Rules

1. **ALWAYS record findings** after every round. The loop cannot learn from rounds it does not see.
2. **ALWAYS generate a learning report** before starting a new round. Skipping this means the round runs blind.
3. **NEVER ignore regression candidates** — they indicate a fix that did not hold.
4. **Treat learning confidence < 0.3 as advisory only** — too few data points for reliable weighting.
5. **Mark findings as fixed** when they are resolved so the loop does not keep weighting them.
