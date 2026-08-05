# Security model

BotHive treats the data it holds as sensitive: platform tokens, chat credentials and admin sessions. This page documents how they are protected and what operators must do to keep a deployment safe.

## Secrets at rest

- **Account credentials** (tokens, refresh tokens, client secrets, API keys) are encrypted with **AES-256-GCM** before they touch the database. The API never returns them — it only reports `credentials.token: true` / `hasSecret: true`.
- The `ENCRYPTION_KEY` (32-byte hex) is validated at startup; the API **refuses to start** without it. Rotating it makes previously stored credentials undecryptable — treat it as permanent.
- **Passwords** are hashed with **scrypt** plus a global `PASSWORD_PEPPER`. The API also refuses to start without a strong pepper.
- Sessions use **httpOnly**, `SameSite=Lax` cookies carrying short-lived JWTs. A constant-time dummy hash keeps login timing uniform for unknown emails.

## Authentication & RBAC

- Roles are **re-read from the database on every request**, never trusted from the JWT claim — a demoted or deleted user loses access immediately, even with a stale token.
- Fail-closed: an unknown/missing role resolves to read-only `viewer`.
- Only `admin` can create/delete users, change roles, and manage scripts, queues, webhooks, settings and backups. `viewer` is read-only (GET/HEAD/OPTIONS only).
- BotHive refuses to demote or delete the **last admin**, and you cannot delete your own account.
- Login, registration and password changes are **rate-limited** in Redis.
- User management is only reachable by admins: `POST/DELETE /api/auth/users`, `PATCH /api/auth/users/:id/role`.

## SSRF hardening

- Webhook targets and script `fetch` URLs are rejected if they resolve to **private / loopback** ranges.
- `WEBHOOK_DNS_CHECK=true` additionally resolves hostnames and blocks private-IP results (one DNS lookup per delivery).
- Script `fetch` re-validates **every redirect hop**, so a redirect chain cannot smuggle traffic to an internal host.
- `ALLOW_PRIVATE_WEBHOOK_URLS=true` disables these protections — it must never be set in production.

## Sandbox

- Scripts run in a hardened Node `vm`: no access to the host realm, return values sanitized, infinite loops killed by timeout, per-bot cooldowns.
- Config is validated at save time (catastrophic regexes, sandbox escapes, disallowed webhook URLs) — enforced on normal saves *and* backup import.

## Transport & headers

- The API emits security headers on every response: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`.
- Behind a proxy, terminate TLS there (Let's Encrypt / LB) and set `TRUST_PROXY=true` so `request.ip` honors `X-Forwarded-For` for correct rate limiting. Leave `TRUST_PROXY` unset when exposed directly to avoid IP spoofing.
- `EXPOSE_ERROR_STACK=true` includes stack traces in API errors — never enable it in production.

## Metrics

- `GET /metrics` is protected: `METRICS_TOKEN` (Bearer) if set, otherwise JWT auth. `METRICS_OPEN=true` disables protection — local experiments only.

## Operator checklist

- [ ] Unique, strong `JWT_SECRET`, `ENCRYPTION_KEY`, `PASSWORD_PEPPER` in `.env` — never committed.
- [ ] Change the seeded `admin@botfarm.local` / `admin123` password immediately.
- [ ] Only give `admin` to people who need it; prefer `viewer` for read-only access.
- [ ] Keep `ALLOW_PRIVATE_WEBHOOK_URLS`, `EXPOSE_ERROR_STACK`, `METRICS_OPEN` unset.
- [ ] Set `TRUST_PROXY=true` exactly when the API is behind a trusted proxy.
- [ ] Backups (`GET /api/backup/export`) contain encrypted credentials — store the JSON like a secret.
