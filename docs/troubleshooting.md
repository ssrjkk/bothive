# Troubleshooting

Symptom → cause → fix for the most common issues. For alert-triggered incidents see [runbooks/0001](runbooks/0001-incident-response.md).

## API won't start

- **`JWT_SECRET must be set...` / `ENCRYPTION_KEY...`** — secrets missing or too weak. Set them in `.env` (copy `.env.example`). `ENCRYPTION_KEY` must be **32 hex chars** (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- **`PASSWORD_PEPPER must be set in production`** — set `NODE_ENV=development` locally or provide a pepper.
- **Prisma client errors at startup** — the generated client is stale. Run `npm run db:generate` (root) then rebuild.

## Bots never connect / stay `connecting`

- Worker for that platform is down or has no leader: `docker compose logs workers-<platform> | grep -iE "leader|error"`. Restart the service.
- Credential cannot be decrypted → token decodes to `null`: `ENCRYPTION_KEY` differs between API and workers, or credentials were written under a different key. Re-enter the credential in the dashboard.
- Platform token revoked/expired (Twitch shows 401): refresh the credential, then disconnect/reconnect the bot from the dashboard.

## Bots connect then immediately disconnect (reconnect loop)

- `docker compose logs workers-<platform> | grep -iE "disconnect|reconnect"`.
- Platform API rate limit hit → outbound rate limiter backs off; check `WORKER_CONCURRENCY` and platform-specific limits.
- Twitch: missing `moderator:read:followers` scope disables follow polling (log warning) — connect still works, followers just won't fire.

## Messages/events missing

- Confirm the event reached Redis: `docker compose exec redis redis-cli LLEN bothive:telegram-queue` (or platform queue).
- Confirm webhook delivery: `GET /api/webhooks` → check `lastStatus`/`lastError` columns; `docs/webhooks.md` covers HMAC + retries.
- Scripts not firing on an event: check the script's trigger and `enabled`; interval scripts only fire on the **leader** (one replica) — see runbook 0002.

## Actions fail (`Unknown action`, `not connected`)

- Action not implemented for the platform (Twitch has no `react`): supported actions per platform are in `docs/api.md`.
- `Bot X not connected` — the bot is not in the in-memory connection map; reconnect it.

## Redis

- **Password set but connections fail** — `REDIS_PASSWORD` in `.env` must match what compose started with; restarting Redis with a new password while workers keep the old one causes auth errors.
- **`QueueBacklog` alert** — consumer paused or concurrency too low. Bump `WORKER_CONCURRENCY` (workers) and confirm leadership.
- **Redis memory grows** — bot memory (`bot:memory:*`) and rate-limit counters accumulate; see [capacity-planning.md](capacity-planning.md) for sizing and TTL notes.

## Postgres

- **Too many connections / pool exhausted** — `DATABASE_URL` includes `?connection_limit=10`; scaling up many workers still shares the pool. Raise `connection_limit` carefully (each Prisma connection = one Postgres connection).
- **Migrations not applied** — the API image runs `prisma migrate deploy` on start; run it manually: `docker compose exec api npx prisma migrate deploy`.

## Metrics / Grafana

- **`ApiUnreachable` alert fires spuriously** — `METRICS_TOKEN` empty while the API falls back to JWT auth that Prometheus can't send. Set a token and restart `prometheus`.
- **Grafana shows no data** — check `docker compose logs prometheus` for scrape errors (`credentials_file` token mismatch, wrong port).

## Miscellaneous

- **Port already in use** — compose binds Postgres to `127.0.0.1:5433`, Redis `127.0.0.1:6380`, API `3000`, dashboard `80`, Prometheus `9090`, Alertmanager `9093`, Grafana `3001`. Adjust `ports` in `docker-compose.yml`.
- **`.env` changes don't take effect** — env is read at container start; `docker compose up -d` (recreates containers).
- **Code changes don't show** — the compose images build from `Dockerfile`; rebuild with `docker compose up -d --build`. For local dev use `npm run dev` (api + workers + dashboard via Vite) instead.
