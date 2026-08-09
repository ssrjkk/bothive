# Deployment

## Docker Compose (recommended)

```bash
# 1. secrets — copy the example and fill in ENCRYPTION_KEY / PASSWORD_PEPPER / JWT_SECRET
cp .env.example .env

# 2. start the whole stack
docker compose up -d --build
```

| Service                 | Port | Purpose                            |
| ----------------------- | ---- | ---------------------------------- |
| `postgres`              | 5432 | source of truth (Prisma)           |
| `redis`                 | 6379 | BullMQ queues, bot memory, pub/sub |
| `api`                   | 3000 | Fastify HTTP API                   |
| `workers-<platform>` ×4 | —    | one BullMQ consumer per platform   |
| `dashboard`             | 80   | nginx → React SPA, proxies `/api`  |
| `prometheus`            | 9090 | scrapes `GET /metrics`             |
| `grafana`               | 3001 | dashboards on Prometheus           |

## First run

1. Seed the first admin (migrations run automatically — the API image executes `npx prisma migrate deploy` before starting):

   ```bash
   docker compose exec api npx prisma db seed
   ```

2. Sign in at http://localhost:80 with `admin@botfarm.local` / `admin123` and **change the password immediately** (Settings → Change Password).
3. Create accounts (platform credentials) under **Accounts**, then add bots.

> The dashboard `nginx` container proxies `/api` to the API — same-origin, so no CORS config is needed. For a separate dashboard origin, set `CORS_ORIGIN` in `.env`.

## Scaling workers

One process runs per platform (`workers-telegram`, `workers-twitch`, `workers-youtube`, `workers-twitter`). Because they are independent services, a crash in one platform never takes down the others, and each can be scaled on its own:

```bash
docker compose up -d --scale workers-telegram=3
```

Control concurrency per process with `WORKER_CONCURRENCY` (default `10`). A worker also publishes a **heartbeat** (`worker:heartbeat:<platform>` in Redis, TTL 30s) carrying its timestamp, job concurrency and package version; `GET /api/health/workers` reports liveness per platform (plus concurrency/version) to the dashboard.

### Securing Redis

Set `REDIS_PASSWORD` in `.env` to enable authentication: docker-compose starts Redis with `--requirepass`, and the API and every worker automatically send the password on every connection (BullMQ queues, bot memory, pub/sub, leader-election and rate-limit clients all go through the same option helper). Leave it unset for a plain Redis.

### Redis HA with Sentinel

All Redis clients read the same connection options, so moving from a single instance to a Sentinel-managed (failover) setup is config-only:

- `REDIS_SENTINELS=host1:26379,host2:26379` — when set, every connection goes through Sentinel and `REDIS_URL` is ignored.
- `REDIS_SENTINEL_NAME=mymaster` — Sentinel master name (defaults to `mymaster`).
- `REDIS_TLS=true` — TLS for cloud-managed Redis (or use `rediss://`).
- `REDIS_DB=0` — optional logical database index for all connections.

## Behind a reverse proxy

- Set `TRUST_PROXY=true` only when the API sits behind a trusted proxy (nginx/traefik). It makes `request.ip` respect `X-Forwarded-For` — required for correct login rate-limiting. Leave it unset when the API is exposed directly, otherwise clients can spoof their IP.
- Terminate TLS at the proxy (Let's Encrypt / a load balancer). The API and dashboard expect plain HTTP internally.
- The API emits security headers on every response; if you front it with nginx, keep them or re-add them.

## Metrics & observability

- `GET /metrics` exposes Prometheus metrics: HTTP counters/histograms (rate, latency, response size per route), BullMQ queue depths (`bothive_queue_jobs_total`) and worker backlog (`bothive_worker_queue_depth`), per-bot health/uptime/action/reconnect/script metrics (`bothive_bot_*`), worker liveness and concurrency (`bothive_worker_up`, `bothive_worker_concurrency_current`), proxy health scores (`bothive_proxy_health_score`), Prisma row counts and Node runtime gauges.
- Protect it with `METRICS_TOKEN` (Bearer), or leave it to JWT auth. `METRICS_OPEN=true` opens it fully — only for local experiments.
- `GET /health/ready` probes **both** Postgres and Redis and returns 503 when either is unavailable — safe to use as a readiness probe.
- **Alerting**: `prometheus/rules/bothive.yml` ships 9 alert rules (API down/high error rate/slow p95, workers down, queue backlog, stuck failed jobs, unhealthy bots, unhealthy proxies). Prometheus evaluates them automatically; the bundled Alertmanager (`alertmanager.yml`) currently uses a null receiver — edit it to add a webhook/email and start getting notified.
- Grafana ships preconfigured to Prometheus (provisioned datasource) plus the **BotHive — API overview** dashboard (`grafana/dashboards/bothive.json`), organized into tab rows: **Overview**, **Bots**, **Workers & Queues** and **Proxies**. Default login is `admin`/`admin` — override with `GF_ADMIN_USER` / `GF_ADMIN_PASSWORD`.
- Prometheus reads the token from `credentials_file` written at container start; it does **not** expand env vars inside `authorization.credentials` in the config. If `METRICS_TOKEN` is empty the API falls back to JWT auth, which Prometheus cannot satisfy — set a token or the `ApiUnreachable` alert will fire.
- **Sentry error tracking** (optional): set `SENTRY_DSN` and the API and workers report errors to Sentry — API request errors via an `onError` hook (with route/method/status/user context) and worker script-action failures (with `botId`, `action`, `trigger` context). Without `SENTRY_DSN` the SDK is a complete no-op (no telemetry, no network). `SENTRY_ENVIRONMENT` labels the environment (default `production`), `SENTRY_TRACES_SAMPLE_RATE` controls transaction sampling (default `0` = off). Release is derived from `npm_package_version`, so `Sentry.init` should not need changes per deploy.

## Non-Docker

```bash
npm install
docker compose up -d postgres redis     # infra only
npx prisma migrate deploy               # from packages/api
npm run dev                              # api + workers + dashboard
```

Requires Node ≥ 20, PostgreSQL 16+, Redis 7+.

## Backups

Daily `pg_dump` + Redis snapshots with rotation and off-site copy guidance — see [docs/backup.md](backup.md). `backups/backup.sh` and `backups/restore.sh` run against the running compose stack.
