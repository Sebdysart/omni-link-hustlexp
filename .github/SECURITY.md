# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in omni-link-hustlexp, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: sebastiandysart@gmail.com
3. Include: description, reproduction steps, impact assessment
4. Expected response time: 48 hours

## Scope

This policy covers:
- The omni-link engine (`engine/`)
- CLI commands (`commands/`)
- Agent definitions (`agents/`)
- Configuration handling (`config/`)

## Security Measures

- CodeQL scanning runs weekly and on every PR
- npm audit runs in CI on every push
- Dependabot monitors all dependencies
- All PRs require CI pass before merge
