# `authority-status`

Summarize the HustleXP authority layer against the live workspace.

It reports:

- current docs phase and blocked work classes
- docs vs backend vs Swift procedure coverage
- obsolete Swift calls
- payload drift between Swift models and the docs contract
- recommended reconciliation actions before `apply`

Usage:

```bash
omni-link authority-status --config .omni-link.json
```
