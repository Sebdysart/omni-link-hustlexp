---
name: rollback
description: Roll back the last generated bounded execution plan using the saved review artifact.
disable-model-invocation: true
---

# /rollback — Roll Back Execution

Use `/rollback` after a generated execution plan has been created by `/review-pr` and optionally executed by `/apply`.

## What it does

1. Loads the saved review artifact
2. Reads the execution plan branch name
3. Deletes generated local branches in affected repos
4. Returns a rollback result summary

## Safety

- `/rollback` never mutates protected branches directly
- If no saved execution plan exists, `/rollback` returns an error instead of guessing
