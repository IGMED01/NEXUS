# Security and Scan Safety Model

## Goal

Reduce accidental secret leakage during workspace scanning without pretending the tool is a full DLP product.

## Core idea

The scanner now applies three layers:

1. **Ignore**
   - some files are too risky to read at all
2. **Redact**
   - some files are useful, but secret-like fragments must be masked
3. **Report**
   - scan stats expose how much was ignored or redacted

## What is ignored before chunking

The scanner skips high-risk files such as:

- `.env`, `.env.local`, `.env.production`, `.env.test`
- `.npmrc`, `.pypirc`, `.netrc`
- `id_rsa`, `id_dsa`, `id_ed25519`
- `.aws/credentials`
- `.docker/config.json`
- `.kube/config`
- certificate / key material like `.pem`, `.key`, `.pfx`, `.crt`, `.cer`
- Terraform variable files like `.tfvars`
- folders or paths named `secrets/` or `private/`

These files do not become chunks.

## What is redacted inside allowed files

When a file is still useful to scan, the scanner masks:

- private key blocks
- inline API keys and access tokens
- bearer tokens
- JWT-like tokens
- connection strings and DSNs bound to obvious config variable names
- common secret assignments such as `password`, `secret`, `client_secret`

## Why ignore and redact are different

- **Ignore** is safer, but loses all context from that file.
- **Redact** preserves structure and learning value while masking risky values.

The tool uses ignore for obvious credential containers, and redact for normal source files that may accidentally embed secrets.

## What scan statistics now tell you

The scanner reports:

- total ignored sensitive files
- redacted files
- total replacements
- redaction categories:
  - private key blocks
  - inline secrets
  - token patterns
  - JWT-like tokens
  - connection strings

## Project-level policy overrides

The default policy is intentionally strict, but the project config can now override it through `learning-context.config.json`.

Supported fields:

- `security.ignoreSensitiveFiles`
- `security.redactSensitiveContent`
- `security.ignoreGeneratedFiles`
- `security.allowSensitivePaths`
- `security.extraSensitivePathFragments`

What each field means:

- **ignoreSensitiveFiles**
  - if `true`, obvious credential containers never become chunks
- **redactSensitiveContent**
  - if `true`, secret-like fragments inside useful files are masked
- **ignoreGeneratedFiles**
  - if `true`, generated artifacts like `README.LEARN.md` stay out of the scan
- **allowSensitivePaths**
  - explicit repo-relative exceptions for safe fixtures that would normally match the sensitive-file policy
- **extraSensitivePathFragments**
  - extra repo-specific path fragments that should always be ignored

Operational rule:

- prefer **tight defaults**
- use `allowSensitivePaths` only for deliberate examples
- do not turn protections off globally unless you understand the data in that repo

## Limits

This is **not** a complete security product.

It can still miss:

- uncommon secret formats
- secrets hidden in binary blobs
- secrets encoded in misleading names
- business-sensitive text that does not look like a credential

So the right mental model is:

> safer default scanning, not perfect exfiltration prevention

## Operational rule

If a repository contains highly sensitive material, do not rely only on redaction. Combine:

- repo-level exclusions
- narrow workspace roots
- human review
- memory discipline
