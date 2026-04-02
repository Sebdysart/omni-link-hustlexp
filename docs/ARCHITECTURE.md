# Omni-Link Architecture

## Purpose
CLI and agent orchestration engine for HustleXP. Provides command-line tools and AI agent coordination for managing the HustleXP ecosystem.

## Key Directories
- **engine/** — Core orchestration logic, task routing, agent lifecycle
- **agents/** — AI agent definitions, capabilities, and configurations
- **commands/** — CLI command implementations

## Code Ownership
All code in engine/, agents/, and commands/ is owned by @Sebdysart (defined in CODEOWNERS).

## Security
- **CodeQL scanning** enabled for TypeScript security analysis on every push and PR
- **SECURITY.md** defines vulnerability disclosure policy
- **Dependabot** configured for npm and GitHub Actions dependency updates

## Performance
- **Benchmark regression testing** runs on every PR comparing against main branch
- Performance data tracked over time to detect regressions

## Contributing
All PRs require:
- TypeScript type-check pass (npx tsc --noEmit)
- CodeQL security scan pass
- Benchmark comparison (no significant regression)
- Code review from @Sebdysart
