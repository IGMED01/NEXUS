# Privacy and Security Roadmap

## Goal

Reduce the chance of leaking sensitive material while still preserving useful context for code learning.

## Scope

- ignored files
- inline secret redaction
- privacy docs
- safe scanning defaults

## Current state

- a dedicated security module now separates ignore policy from redaction policy
- `.env*`, private keys, credential files, and cloud/tool configs are ignored before chunking
- inline secret-like values, JWT-like tokens, and connection strings are redacted
- scan stats expose ignored sensitive files plus redaction categories

## Milestones

### Milestone 1 - Baseline protection

- [x] keep the obvious sensitive patterns covered
- [x] keep tests for ignored files and inline redaction
- [x] report ignored sensitive files and redaction categories

### Milestone 2 - Better policy control

- [x] allowlist/denylist style configuration
- [x] per-project scan rules
- clearer operator messaging around what never enters context

### Milestone 3 - Safer real-world adoption

- [x] regression tests for secret handling
- [x] better coverage of token formats and accidental credential patterns
- [x] document limitations honestly

## Done means

- users know what the scanner ignores, what it redacts, and what still requires judgment

## Non-goals

- pretending this is a complete DLP system
