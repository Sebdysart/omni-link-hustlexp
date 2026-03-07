---
name: watch
description: Refresh or maintain daemon-backed ecosystem state for faster repeated analysis.
disable-model-invocation: true
---

# /watch — Refresh Daemon State

Use `/watch` to build or refresh the local daemon state store. This keeps a warm graph on disk so repeated `scan`, `impact`, `owners`, and `review-pr` commands can reuse the latest ecosystem state.

## Recommended config

```json
{
  "daemon": {
    "enabled": true,
    "preferDaemon": true
  }
}
```

## Safety

- `/watch` does not mutate your application code
- It only refreshes omni-link state in the configured daemon store path
- Use `/watch --once` when you want a one-shot refresh instead of a long-lived watch loop
