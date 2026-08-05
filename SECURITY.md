# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Report them privately via a [security advisory](https://github.com/ssrjkk/bothive/security/advisories/new) or by direct message to the maintainer ([Telegram](https://t.me/ssrjkk)). Include:

- the affected version / commit
- a minimal reproduction
- the impact (what an attacker can do)

You will get a response within a few days. If the report is valid, a fix will be released and (only then) credited — optionally.

## Scope

Everything in this repository is in scope: the API, the workers, the script sandbox, webhook delivery, the dashboard and the Docker images.

Out of scope: platform credentials themselves (you must store them safely), and already-disclosed CVEs in dependencies.

## Supported versions

Only the `main` branch is supported. Deployments should track `main` (or a tagged release once the project starts cutting them).

## What to include when fixing

Any security fix must come with a regression test proving the unsafe case is blocked, and must not weaken:

- AES-256-GCM credential encryption at rest
- scrypt + pepper password hashing
- per-request role checks (RBAC re-read from DB)
- script sandbox isolation and SSRF guards on `fetch` and webhooks

See [docs/security.md](docs/security.md) for the full threat model.
