# API reference

Base URL: `/api` (proxied by the dashboard nginx in Docker; the API itself listens on `API_PORT`).

## Conventions

- **Auth**: `Authorization: Bearer <jwt>` or an httpOnly `bothive_token` cookie. Tokens are short-lived; roles are re-read from the DB per request.
- **RBAC**: `admin` = full access; `viewer` = read-only (GET/HEAD/OPTIONS). Admin-only endpoints are marked ⛔.
- **Responses**: success → `{ success: true, data: … }`; failure → `{ success: false, error: { code, message, details? } }`.
- Every response carries security headers; login/register/password are rate-limited.

## Health & observability

| Method | Path                  | Auth      | Description                                                                                                                                         |
| ------ | --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`             | —         | liveness + version info                                                                                                                             |
| GET    | `/health/ready`       | —         | probes Postgres and Redis; 503 when either is unavailable                                                                                           |
| GET    | `/api/health/workers` | any       | per-platform worker liveness from Redis heartbeats (`{ platform, alive, lastSeen, concurrency, version }`)                                          |
| GET    | `/metrics`            | token/JWT | Prometheus metrics (HTTP rate/latency, queue depths, bot health/uptime/actions, proxy health, worker liveness/concurrency, DB counts, Node runtime) |

## Auth & users

| Method | Path                       | Auth     | Description                                                                                                      |
| ------ | -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/register`       | —        | register the **first** admin (closed once a user exists; set `ALLOW_REGISTRATION=false` to disable), sets cookie |
| POST   | `/api/auth/login`          | —        | login, sets httpOnly cookie, returns token + user                                                                |
| POST   | `/api/auth/logout`         | any      | clears the session cookie                                                                                        |
| GET    | `/api/auth/me`             | any      | current user                                                                                                     |
| PATCH  | `/api/auth/password`       | any      | change own password (requires `currentPassword`)                                                                 |
| GET    | `/api/auth/users`          | ⛔ admin | list all users (id, email, name, role, createdAt)                                                                |
| POST   | `/api/auth/users`          | ⛔ admin | create user `{ email, password, name?, role? }` (role defaults to `viewer`)                                      |
| PATCH  | `/api/auth/users/:id/role` | ⛔ admin | set `role` to `admin`/`viewer`; last admin cannot be demoted                                                     |
| DELETE | `/api/auth/users/:id`      | ⛔ admin | delete user; self-deletion and deleting the last admin are refused                                               |

## Bots

| Method | Path                                       | Auth | Description                                                 |
| ------ | ------------------------------------------ | ---- | ----------------------------------------------------------- |
| GET    | `/api/bots`                                | any  | list bots (page via `page`/`pageSize`)                      |
| GET    | `/api/bots/:id`                            | any  | bot detail                                                  |
| POST   | `/api/bots`                                | any  | create bot `{ name, platform, accountId, config? }`         |
| PATCH  | `/api/bots/:id`                            | any  | update `{ name?, config? }`                                 |
| DELETE | `/api/bots/:id`                            | any  | delete bot (logs + scripts cascade; webhooks become global) |
| POST   | `/api/bots/:id/start` / `stop` / `restart` | any  | lifecycle (enqueued via BullMQ)                             |
| POST   | `/api/bots/:id/action`                     | any  | inject a platform action                                    |
| GET    | `/api/bots/:id/memory`                     | any  | bot memory keys                                             |
| DELETE | `/api/bots/:id/memory/:key` / `memory`     | any  | clear memory                                                |

## Accounts

| Method | Path                | Auth | Description                                                               |
| ------ | ------------------- | ---- | ------------------------------------------------------------------------- |
| GET    | `/api/accounts`     | any  | list accounts (credentials redacted)                                      |
| GET    | `/api/accounts/:id` | any  | single account                                                            |
| POST   | `/api/accounts`     | any  | create `{ name, platform, credentials? }` — credentials encrypted at rest |
| PATCH  | `/api/accounts/:id` | any  | update name/platform/credentials                                          |
| DELETE | `/api/accounts/:id` | any  | delete                                                                    |

## Scripts

| Method | Path                     | Auth | Description                                         |
| ------ | ------------------------ | ---- | --------------------------------------------------- |
| GET    | `/api/scripts`           | any  | list scripts                                        |
| GET    | `/api/scripts/:id`       | any  | single script                                       |
| POST   | `/api/scripts`           | any  | create `{ botId, name, trigger, config, enabled? }` |
| PATCH  | `/api/scripts/:id`       | any  | update (config re-validated for safety)             |
| DELETE | `/api/scripts/:id`       | any  | delete                                              |
| GET    | `/api/scripts/patterns`  | any  | list generator patterns                             |
| POST   | `/api/scripts/generate`  | any  | draft a script from a pattern                       |
| POST   | `/api/scripts/:id/test`  | any  | fire a synthetic trigger event                      |
| POST   | `/api/scripts/:id/clone` | any  | duplicate a script                                  |

## Webhooks

| Method | Path                     | Auth     | Description                                           |
| ------ | ------------------------ | -------- | ----------------------------------------------------- |
| GET    | `/api/webhooks`          | any      | list (HMAC secret never returned)                     |
| POST   | `/api/webhooks`          | ⛔ admin | create `{ name, url, events[], botId?, secret? }`     |
| PATCH  | `/api/webhooks/:id`      | ⛔ admin | update fields                                         |
| DELETE | `/api/webhooks/:id`      | ⛔ admin | delete                                                |
| POST   | `/api/webhooks/:id/test` | ⛔ admin | synthetic delivery with optional `sample`/`eventType` |

See [webhooks.md](webhooks.md) for the delivery payload and `X-BotHive-Signature` header.

## Queues

| Method | Path                 | Auth     | Description                                                                                                                                  |
| ------ | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/queues`        | any      | per-platform BullMQ metrics (waiting/active/completed/failed/delayed)                                                                        |
| GET    | `/api/queues/failed` | ⛔ admin | recent failed jobs (`id, platform, name, type, botId, attemptsMade, failedReason, timestamp`) — payloads with credentials are never included |

## Proxies

| Method | Path                    | Auth     | Description                                                                                    |
| ------ | ----------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/api/proxies`          | ⛔ admin | list proxies (credentials stripped from URLs)                                                  |
| GET    | `/api/proxies/:id`      | ⛔ admin | single proxy                                                                                   |
| POST   | `/api/proxies`          | ⛔ admin | create `{ url, type?, priority? }` — url encrypted at rest (`http`/`https`/`socks5`/`socks5h`) |
| PATCH  | `/api/proxies/:id`      | ⛔ admin | update `{ url?, type?, priority?, enabled? }`                                                  |
| POST   | `/api/proxies/:id/test` | ⛔ admin | reachability probe; resets `healthScore` to 100 or 0 and sets `lastFailedAt`                   |
| DELETE | `/api/proxies/:id`      | ⛔ admin | delete                                                                                         |

The leader worker refreshes the pool from the database every reconcile cycle and selects a healthy high-priority proxy (round-robin, 30s failure cooldown, health decay/boost) for every bot connect. Metrics: `bothive_proxy_health_score{proxy_id,type,priority}`, `bothive_proxies_total{state=enabled|unhealthy}`.

## Logs & stats

| Method | Path               | Auth | Description                                                  |
| ------ | ------------------ | ---- | ------------------------------------------------------------ |
| GET    | `/api/logs`        | any  | log stream (`botId?`, `level?`, `limit?`, `offset?`)         |
| GET    | `/api/logs/export` | any  | CSV export of recent logs                                    |
| GET    | `/api/logs/:botId` | any  | logs for one bot                                             |
| GET    | `/api/stats`       | any  | dashboard stats incl. per-platform and per-status bot counts |

## Backup & bulk

| Method | Path                 | Auth     | Description                                                    |
| ------ | -------------------- | -------- | -------------------------------------------------------------- |
| GET    | `/api/backup/export` | ⛔ admin | full snapshot (accounts incl. encrypted tokens, bots, scripts) |
| POST   | `/api/backup/import` | ⛔ admin | restore snapshot in one transaction; re-validated for safety   |
| POST   | `/api/bulk/bots`     | any      | start/stop/restart/delete many bots                            |
| POST   | `/api/bulk/scripts`  | any      | enable/disable/delete many scripts                             |

## Error codes

`UNAUTHORIZED` (401) · `FORBIDDEN` (403) · `VALIDATION_ERROR` (422) · `NOT_FOUND` (404) · `CONFLICT` (409) · `RATE_LIMITED` (429) · `BAD_REQUEST` (400).
