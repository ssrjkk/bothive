# Security model

BotHive treats the data it holds as sensitive: platform tokens, chat credentials and admin sessions. This page documents how they are protected and what operators must do to keep a deployment safe.

## Secrets at rest

- **Account credentials** (tokens, refresh tokens, client secrets, API keys) are encrypted with **AES-256-GCM** before they touch the database. The API never returns them — it only reports `credentials.token: true` / `hasSecret: true`.
- **Webhook HMAC secrets** are encrypted with the same cipher (`enc:` prefix). Legacy plaintext values still verify on delivery, but every new write is encrypted — decrypting happens only at delivery time inside the workers.
- The `ENCRYPTION_KEY` (32-byte hex) is validated at startup; the API **refuses to start** without it. Rotating it makes previously stored credentials undecryptable — treat it as permanent.
- **Passwords** are hashed with **scrypt** plus a global `PASSWORD_PEPPER`. The API also refuses to start without a strong pepper.
- Sessions use **httpOnly**, `SameSite=Lax` cookies carrying short-lived JWTs. A constant-time dummy hash keeps login timing uniform for unknown emails.

### Key rotation

`ENCRYPTION_KEY` has **no key versioning**: every stored credential is wrapped
with the single current key (derived as `sha256(ENCRYPTION_KEY)`), so rotating
it makes all previously stored credentials undecryptable — bots cannot start,
webhook signatures fail to verify, proxy credentials break. Treat the key as
permanent and only rotate in a planned maintenance window.

**Recovery — rotation already happened and things broke:**

1. Restore the **previous** `ENCRYPTION_KEY` value to every API and worker (the key is read from the environment at process start — a rolling restart is enough).
2. Verify: `GET /health/ready` returns 200, and send a test message on one bot per platform.
3. Check logs for `[credential-cipher] decryption failed` — a single failure means some stored value still uses a key you no longer hold (e.g. a backup restored from before the rotation).

**Planned rotation (safe path):**

1. Pick a maintenance window; you will touch every account credential.
2. With the **old** key still active, export a backup **with** credentials: `GET /api/backup/export?includeCredentials=true` (store the JSON offline like a secret — it contains `enc:`-prefixed ciphertexts bound to the old key).
3. Deploy the **new** `ENCRYPTION_KEY` to API and workers together (any window where one side has the old key and the other the new one breaks delivery — roll out in one deploy).
4. Re-enter every credential through the dashboard/API (Accounts → edit each account, webhook secrets, proxy URLs) so each value is re-encrypted with the new key. Verify one bot per platform.
5. Only after all credentials have been re-saved, destroy the old-key backup and remove the old key from your secret store.

> A backup exported with `includeCredentials=true` re-imports the stored
> ciphertexts **unchanged** (they keep the `enc:` prefix), so importing it under
> the new key does **not** re-encrypt anything — it only helps if you ever
> restore the old key.

## Authentication & RBAC

- JWTs are **pinned to issuer/audience** (`bothive` / `bothive-dashboard`) at both signing and verification, so a token minted for another service cannot be replayed against the API.
- Roles are **re-read from the database on every request**, never trusted from the JWT claim — a demoted or deleted user loses access immediately, even with a stale token. The WebSocket log stream does the same re-check.
- Fail-closed: an unknown/missing role resolves to read-only `viewer`.
- Only `admin` can create/delete users, change roles, and manage scripts, queues, webhooks, settings, backups and **bulk operations**. `viewer` is read-only (GET/HEAD/OPTIONS only).
- Bulk-operation errors are returned as a fixed `operation failed` message — raw exception text is never echoed to clients.
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
- Custom actions execute in a **worker thread** (`env: {}`, no host secrets) so a runaway after an `await` is killed by `worker.terminate()` instead of pinning the process.
- Heap is capped twice over: the worker thread has `resourceLimits.maxOldGenerationSizeMb` and each `vm.Script` enforces a 64MB context heap via `resourceLimits` — a memory-exhausting script is terminated instead of OOMing the host.
- Config is validated at save time (catastrophic regexes, sandbox escapes, disallowed webhook URLs) — enforced on normal saves _and_ backup import.
- Backup imports reject payloads from a **newer format version** rather than silently mis-importing them.

## Transport & headers

- The API and dashboard emit security headers on every response: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy` and **HSTS** (`Strict-Transport-Security`).
- Login/register responses that carry the JWT in the body set `Cache-Control: no-store` so proxies and browsers cannot cache the token.
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
- [ ] Verify release image signatures with `cosign verify` before deploying.

## Supply-chain integrity

- Releases sign Docker images with **cosign** (keyless, via GitHub OIDC). Verify a published image before deploying it:

  ```bash
  cosign verify ssrjkk/bothive-api:<tag> \
    --certificate-identity-regexp 'https://github.com/ssrjkk/bothive/.github/workflows/release.yml@refs/tags/v.*' \
    --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
  ```

  (Replace `bothive-api` with `bothive-workers` / `bothive-dashboard` and `<tag>` with the release tag.)

- Every push/PR builds a **CycloneDX SBOM** and runs a **Trivy misconfiguration scan** of `Dockerfile` and `docker-compose.yml` (CIS Docker Benchmark-aligned checks). Results land in the GitHub Security tab and workflow artifacts.
