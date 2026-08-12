# Security Policy

## Supported versions

Security fixes are applied on a best-effort basis to the default branch of this repository.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately via GitHub Security Advisories on this repository, or contact the maintainers through the GitHub profile associated with this project.

Include:

- a description of the issue
- steps to reproduce
- affected component (frontend, API, docs, scripts)
- impact assessment if known

We will acknowledge receipt when possible and coordinate a fix before any public disclosure.

## Secrets and deployment

This repository is intentionally **secret-free**:

- never commit client secrets, connection strings, certificates, or tokens
- use .NET User Secrets, environment variables, or your platform secret store
- keep tenant-specific IDs and hosts out of source; use placeholders and runtime configuration

See [docs/projectmanagement/secret-management.md](docs/projectmanagement/secret-management.md).
