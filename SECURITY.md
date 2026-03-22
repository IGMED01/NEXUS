# Security Policy

## Supported versions

This project is actively maintained. Security fixes are applied on `main` first.

| Version | Supported |
| ------- | --------- |
| main    | ✅        |
| older tags | ⚠️ best effort |

## Reporting a vulnerability

Please do **not** open public issues for vulnerabilities or exposed secrets.

Use private reporting:

- GitHub Security Advisory: `Security` tab → `Report a vulnerability`
- Or open a private advisory draft directly:
  - [Create advisory](https://github.com/IGMED01/learning-context-system/security/advisories/new)

When reporting, include:

1. what was exposed or bypassed
2. reproduction steps
3. potential impact
4. suggested remediation (if available)

## Security model scope

This repository includes scan safety defaults and redaction heuristics, but it is **not** a full DLP system.

See:

- `docs/security-model.md`
- `learning-context.config.json` (`security` section)

## Hard rule

Never include real credentials, production tokens, or private keys in issues, pull requests, or examples.
