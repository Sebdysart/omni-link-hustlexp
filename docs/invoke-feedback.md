# /invoke feedback journal

Evidence-cited findings about the **omni-link plugin itself**, accumulated by the `/invoke`
skill (`skills/invoke/SKILL.md`) as it routes and executes tasks. Each run appends a dated,
task-titled entry so the toolkit improves the more it is used. Turn recurring findings into
real skill/agent/command PRs.

## Format

```
## <YYYY-MM-DD> — task: <short task summary>

- GAP: <missing capability> — <evidence path> — <suggested fix>
- OVERLAP: <ambiguous coverage> — <evidence path(s)> — <suggested fix>
- STALE: <outdated/weak description> — <evidence path> — <suggested fix>
```

Classifications: **GAP** (nothing covers it), **OVERLAP** (two+ capabilities collide),
**STALE/WEAK** (description outdated or too vague to route on). No evidence, no finding.
Append-only — never rewrite earlier entries.

---

## 2026-06-05 — task: introduce the /invoke front door

- Seed entry. `skills/invoke/SKILL.md` added as the recommended task router + plugin
  self-critique entry point. `skills/using-omni-link/SKILL.md` Skill Registry was refreshed
  to the full current skill set and `v2.0.0` in the same change, resolving the prior STALE
  finding (registry listed 10 of 31 skills and said `v1.0.0`).
