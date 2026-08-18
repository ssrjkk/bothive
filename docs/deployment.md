# Deployment

## Docker Compose (recommended)

```bash
# 1. secrets — copy the example and fill in ENCRYPTION_KEY / PASSWORD_PEPPER / JWT_SECRET
cp .env.example .env

# 2. start the whole stack
docker compose up -d --build
```

| Service                 | Port  | Purpose                            |
| ----------------------- | ----- | ---------------------------------- |
| `postgres`              | 5433  | source of truth (Prisma)           |
| `redis`                 | 6380  | BullMQ queues, bot memory, pub/sub |
| `api`                   | 3000  | Fastify HTTP API                   |
| `workers-<platform>` ×4 | —     | one BullMQ consumer per platform   |
| `dashboard`             | 80    | nginx → React SPA, proxies `/api`  |
| `prometheus`            | 9090  | scrapes `GET /metrics`             |
| `grafana`               | 3001  | dashboards on Prometheus           |
| `jaeger`                | 16686 | distributed tracing UI (OTLP)      |

## First run

1. Seed the first admin (migrations run automatically — the API image executes `npx prisma migrate deploy` before starting):

   ```bash
   docker compose exec api npx prisma db seed
   ```

2. Sign in at http://localhost:80 with `admin@botfarm.local` / `admin123` and **change the password immediately** (Settings → Change Password).
3. Create accounts (platform credentials) under **Accounts**, then add bots.

> The dashboard `nginx` container proxies `/api` to the API — same-origin, so no CORS config is needed. For a separate dashboard origin, set `CORS_ORIGIN` in `.env`.

## Database migrations

Migrations are applied automatically: the API image runs `npx prisma migrate deploy` on startup, so a normal `docker compose up -d --build` picks up every new migration.

Non-Docker (or manual control):

```bash
# from packages/api — applies all pending migrations, never re-runs applied ones
npx prisma migrate deploy
# optional: confirm the schema is in sync
npx prisma migrate status
```

Notes for the `20260817000001_add_crypto_account_keys` migration (already shipped):

- It adds two **additive, nullable** columns to `Account`: `apiSecret` (TEXT) and `apiKeys` (JSONB). There is no backfill and no data transformation — existing rows are untouched, so it is safe to deploy without downtime or a backup.
- `apiKeys` holds the encrypted Binance key-pair rotation pool (`[{ apiKey, apiSecret }]`); values are stored with the `enc:` prefix, same as every other credential. Never write plaintext secrets there — the API encrypts on write and the workers decrypt in-process.
- Verify after deploy: create a crypto account in the dashboard, add Binance keys, and confirm the bot trades; if you manage the DB by hand, check with `SELECT "apiKeys" IS NOT NULL FROM "Account"` for an account that has keys set.
- Rollback (only if the migration has never been applied in production): drop the two columns. Applied migrations should not be edited — if you must revert after deploy, write a new corrective migration instead.
- Runtime state (dry-run positions and the daily spend counter) lives in Redis under `bothive:crypto:*` keys and self-heals — no action needed on deploy. Migrating PostgreSQL does not affect them, and losing Redis only resets the dry-run ledger and the current day's spend window.

## Scaling workers

One process runs per platform (`workers-telegram`, `workers-twitch`, `workers-youtube`, `workers-twitter`). Because they are independent services, a crash in one platform never takes down the others, and each can be scaled on its own:

```bash
docker compose up -d --scale workers-telegram=3
```

Control concurrency per process with `WORKER_CONCURRENCY` (default `10`). A worker also publishes a **heartbeat** per instance (`worker:heartbeat:<platform>:<instance>` in Redis, TTL 30s) carrying its timestamp, job concurrency, sandbox worker count and package version; `GET /api/health/workers` reports liveness per instance and platform (plus concurrency/version) to the dashboard. This works because each platform worker starts with a fresh random instance id — every process publishes its own key even under `--scale`.

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

- `GET /metrics` exposes Prometheus metrics: HTTP counters/histograms (rate, latency, response size per route), BullMQ queue depths (`bothive_queue_jobs`), worker backlog (`bothive_worker_queue_depth`) and queue wait percentiles (`bothive_queue_wait_seconds{quantile="p50"|"p95"|"p99"}`), per-bot health/uptime/action/reconnect/script metrics (`bothive_bot_*`, including `bothive_bot_script_executions_total` / `bothive_bot_script_errors_total` for the script failure rate), worker liveness, concurrency, memory and sandbox trends (`bothive_worker_up`, `bothive_worker_concurrency_current`, `bothive_worker_memory_bytes{type="rss"|"heapUsed"|"heapTotal"}`, `bothive_worker_sandbox_workers`), proxy health scores (`bothive_proxy_health_score`), Prisma row counts and Node runtime gauges. Since the review, all worker gauges carry a `platform` **and** `instance` label (so each process under `--scale` is visible separately, and `bothive_worker_concurrency_current` sums the live instances), bot error counters are real cumulative counters (increments are applied per scrape so `rate()`/`increase()` in alerts are correct), and gauges that have no live instance emit no samples instead of false zeros. The queue wait percentiles come from a rolling 10-minute window of enqueue→active times sampled by each platform worker and published with its heartbeat; worker memory is the process RSS/heap sampled each heartbeat.
- Protect it with `METRICS_TOKEN` (Bearer), or leave it to JWT auth. `METRICS_OPEN=true` opens it fully — only for local experiments.
- `GET /health/ready` probes **both** Postgres and Redis and returns 503 when either is unavailable — safe to use as a readiness probe.
- **Alerting**: `prometheus/rules/bothive.yml` ships 17 alert rules (API down/high error rate/slow p95, workers down, queue backlog, stuck failed jobs, unhealthy bots, unhealthy proxies, script failure spikes, queue delay p95, worker heap growth, reconnect thrashing, sandbox worker leaks, plus SLO burn-rate pages). Prometheus evaluates them automatically; the bundled Alertmanager (`alertmanager.yml`) currently uses a null receiver — edit it to add a webhook/email and start getting notified.
- Grafana ships preconfigured to Prometheus (provisioned datasource) plus the **BotHive — API overview** dashboard (`grafana/dashboards/bothive.json`), organized into tab rows: **Overview**, **Bots**, **Workers & Queues** and **Proxies**. Default login is `admin`/`admin` — override with `GF_ADMIN_USER` / `GF_ADMIN_PASSWORD`.
- Prometheus reads the token from `credentials_file` written at container start; it does **not** expand env vars inside `authorization.credentials` in the config. `docker-compose` defaults `METRICS_TOKEN` to `bothive-local` so the bundled Prometheus can scrape the API out of the box — override with a strong random value before exposing anything publicly. (If you run without a token, the API falls back to JWT auth, which Prometheus cannot satisfy — set a token or the `ApiUnreachable` alert will fire.)
- **Sentry error tracking** (optional): set `SENTRY_DSN` and the API and workers report errors to Sentry — API request errors via an `onError` hook (with route/method/status/user context) and worker script-action failures (with `botId`, `action`, `trigger` context). Without `SENTRY_DSN` the SDK is a complete no-op (no telemetry, no network). `SENTRY_ENVIRONMENT` labels the environment (default `production`), `SENTRY_TRACES_SAMPLE_RATE` controls transaction sampling (default `0` = off). Release is derived from `npm_package_version`, so `Sentry.init` should not need changes per deploy.
- **Distributed tracing** (optional): set `OTEL_EXPORTER_OTLP_ENDPOINT` (defaults to empty = tracing off) and the API and workers export OTLP traces — HTTP, ioredis, Fastify and BullMQ job lifecycle are instrumented. The bundled `jaeger` service collects them; open the UI at http://localhost:16686. See [docs/tracing.md](tracing.md) for the full walkthrough.
- **Query performance**: the `postgres` service runs with `pg_stat_statements` (and `track_io_timing`) enabled so slow queries are one SQL statement away. `docs/query-performance.md` walks through finding the top queries, running `EXPLAIN ANALYZE`, and adding indexes back into the Prisma schema.
- **API docs**: an OpenAPI 3 spec is generated from the registered routes at `/api/docs/json`, with an interactive Swagger UI at `/api/docs` (read-only dev tool; exempted from the strict CSP so the UI can render).

## Security scanning

- The `Security scan` GitHub Action (`security.yml`) runs on every push/PR to `main` and weekly (Mon 03:00):
  - **npm audit** — fails on HIGH/CRITICAL vulnerabilities in production deps across all workspaces (`npm audit --omit=dev --audit-level=high`); dev/tooling-only advisories don't block.
  - **Trivy image scan** — builds the `api`, `workers` and `dashboard` images (`docker compose build`) and scans each for vulnerabilities and secrets (`scanners: vuln,secret`). Fails on HIGH/CRITICAL **fixable** findings (`ignore-unfixed: true`) and uploads the SARIF report to the GitHub Security tab.
  - **CodeQL** — static analysis of the JS/TS sources; results land in the Security tab.
- Scan results are visible in the repo **Security** tab (Code scanning). Dependabot alerts are handled separately by GitHub.
- Keep the lockfile current: run `npm audit` locally after dependency changes and fix HIGH/CRITICAL findings before pushing.

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
