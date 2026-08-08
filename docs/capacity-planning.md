# Capacity planning

Sizing guidance for the default single-node BotHive deployment. Rules of thumb, not guarantees — measure with the bundled Prometheus/Grafana and adjust.

## Workload model

- Each platform runs **one worker process** by default (`workers-telegram`, `workers-twitch`, `workers-youtube`, `workers-twitter`); each can be scaled out independently with leader election guaranteeing one active consumer per platform.
- Per-process job concurrency: `WORKER_CONCURRENCY` (default `10`).
- All state lives in Postgres (source of truth) and Redis (queues, bot memory, rate-limit counters, leases, heartbeats).

## CPU / RAM baseline (per platform worker)

| Bots per platform | Concurrency                                | Notes                                                                   |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| ≤ 100             | default 10                                 | fine on 1 vCPU / 512 MB per worker                                      |
| 100–1000          | 20–50                                      | monitor latency; per-bot outbound rate limit is the bottleneck, not CPU |
| 1000+             | scale out (`--scale workers-<platform>=2`) | add replicas; Postgres pool is the shared limit                         |

Total for the whole stack on a single node: **2–4 vCPU, 4–8 GB RAM** comfortably covers hundreds of bots across all four platforms. The API (~150–300 MB), Prometheus, Grafana and Redis each add roughly 100–300 MB.

## Redis

- **Memory** mostly comes from bot memory (`bot:memory:*`), BullMQ queues and outbound rate-limit counters.
  - Estimate bot memory: `avg_bytes_per_bot × bots`. A default limit per bot exists; check `MEMORY_USAGE` via `docker compose exec redis redis-cli INFO memory`.
  - **512 MB default is enough** for most single-node setups; bump to 1–2 GB for heavy script usage. Persistence: RDB snapshots (default schedule) — acceptable RPO for ephemeral state; see `docs/backup.md`.
- **maxmemory policy**: keep `noeviction` if you prefer errors over silent data loss; consider `allkeys-lru` only for throwaway caches. Do not evict queue keys while bots are mid-flight.
- Watch `connected_clients` ≈ one connection per worker replica + API + polling. A few dozen connections is normal.

## Postgres

- Small-to-medium: 1–2 vCPU, 1–2 GB RAM. `logs` is the fastest-growing table (every event is logged) — the API ships log cleanup (`packages/api/src/services/log-cleanup.ts`); tune retention if disk grows.
- Connection budget: each Prisma client uses a pool (`connection_limit=10` in `DATABASE_URL`). Total Postgres connections ≈ `10 × (number of API + worker processes)`. Keep `max_connections` (default 100) headroom; raise `connection_limit` only when queue depth is the bottleneck.
- Indexes already cover the hot paths (`Log[botId, createdAt]`, `Bot[platform, status]`, `Script[botId, trigger]`). Avoid ad-hoc queries over `Log.meta` JSON.

## Scaling workers out

```bash
docker compose up -d --scale workers-telegram=3
```

- Only one replica per platform **processes jobs** (leader lease `bothive:leader:<platform>`); the others stay paused. Extra replicas add redundancy, not throughput — to increase throughput raise `WORKER_CONCURRENCY` first, then add replicas.
- Each extra replica adds one Prisma pool + one Redis client → check Postgres connection headroom.

## Observability for sizing decisions

Prometheus metrics that answer "am I at capacity?" (Grafana dashboard "BotHive — API overview"):

- `bothive_queue_jobs_total` / `bothive_worker_queue_depth` — backlog trend; sustained growth → raise concurrency or add replicas.
- `bothive_worker_concurrency_current` vs. max — saturating concurrency with idle CPUs → add replicas.
- `process_cpu` / `process_resident_memory_bytes` (Node runtime gauges) — actual per-process usage.
- `bothive_bot_*` health/action/reconnect metrics — per-bot rate limiting vs. platform API limits.

## Signposts to re-evaluate

- Worker CPU sustained > 70% with backlog → scale out.
- Postgres connections near `max_connections` → raise `connection_limit`/`max_connections` or add replicas.
- Redis `used_memory` > 60% of `maxmemory` → increase, or tune bot-memory TTL / log retention.
- Queue `failed` growing faster than it drains → actions are failing permanently (invalid tokens, bans); fix credentials, don't just add capacity.
