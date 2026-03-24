---
name: token-optimization
description: Reduce token consumption by 30-50% using deduplication, compression, relevance filtering, and truncation. Composes with omni-link's existing token pruner for maximum efficiency. Use when context windows are tight or costs need optimization.
---

# Token Optimization

Use this skill when token budgets are tight or when you want to reduce costs without losing signal.

## When to Use

- Context digest exceeds the configured token budget
- Multiple similar findings inflate the context unnecessarily
- Verbose descriptions consume tokens without adding signal
- Large memory sets need to be summarized before injection

## Strategy Stack

The TokenOptimizer applies four strategies in order:

### 1. Deduplication (Jaccard similarity threshold)

Removes near-duplicate content. Two entries with ≥85% word overlap are collapsed to one.

### 2. Compression (light or aggressive)

- **Light** — collapses whitespace, removes empty lines, normalizes punctuation
- **Aggressive** — additionally removes markdown formatting overhead and filler words

### 3. Relevance Filtering (minimum score)

Drops content that scores below the relevance threshold. Technical content (code, errors, APIs) scores higher; empty/whitespace-only content scores zero.

### 4. Truncation (max length)

Content exceeding the maximum character length is truncated with an indicator.

## Composition with omni-link

The TokenOptimizer runs **before** omni-link's `pruneToTokenBudget`. The pipeline is:

```
raw content → TokenOptimizer (dedup, compress, filter) → omni-link pruner (priority-ranked section trimming)
```

This layered approach achieves higher savings than either system alone.

## Rules

1. **ALWAYS run token optimization before the omni-link pruner** — it reduces the work the pruner has to do.
2. **Use light compression by default** — aggressive compression can lose readability.
3. **NEVER set relevance threshold above 0.5** — you will drop too much useful content.
4. **Monitor savings percentage** — target 30-50%. Below 20% means content is already lean; above 60% means you may be losing signal.
