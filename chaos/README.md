# Compose-level chaos / E2E

Verifies the **real** stack (`docker compose`) recovers from infrastructure
faults end-to-end, complementing the unit-level worker chaos tests in
`packages/workers/src/__tests__/base-worker.chaos.test.ts`.

## Scenarios

| Scenario                | Fault injected                                    | What must happen                                                                                                    |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `postgres_outage`       | `docker compose stop postgres`                    | `/health/ready` → 503 (`database: unavailable`), back to 200 after `start`                                          |
| `redis_outage`          | `docker compose stop redis`                       | `/health/ready` → 503 (`redis: unavailable`), `bothive_worker_up` → 0, workers re-publish heartbeats after recovery |
| `worker_hang_detection` | `docker compose pause workers-telegram` (SIGSTOP) | worker marked down once the 30s heartbeat TTL expires; recovers on `unpause`                                        |
| `worker_crash_recovery` | `docker compose kill workers-telegram` (SIGKILL)  | worker process returns after restart and re-publishes its heartbeat                                                 |
| `redis_eviction`        | clamp `maxmemory` to 1 MB, fill with TTL keys     | TTL keys are evicted under `volatile-lru`; non-TTL BullMQ queue metadata survives                                   |

Job-requeue / at-least-once semantics are **not** re-tested here — they are
covered at the unit level (mocked BullMQ) in `base-worker.chaos.test.ts`.

### Future compose-level scenarios

These are valuable but need dedicated load generators or worker instrumentation
rather than plain `docker compose` commands:

- **Database connection-pool exhaustion** — saturate Postgres so the API cannot
  obtain a connection from its Prisma pool and `/health/ready` returns 503.
- **Worker memory pressure** — drive a worker close to its container memory
  limit and verify the sandbox heap cap / OOM behavior kicks in before the host
  process dies.

## Running locally

Requires Docker (daemon running) and `curl`. Start the minimal stack with the
compose secrets set, then run the harness:

```bash
# 1. Secrets (required by docker-compose.yml)
export JWT_SECRET=$(openssl rand -hex 16)
export ENCRYPTION_KEY=$(openssl rand -hex 16)
export PASSWORD_PEPPER=$(openssl rand -hex 16)
export METRICS_TOKEN=local-chaos-token

# 2. Build and start only what the chaos suite needs
docker compose up -d --build postgres redis api workers-telegram

# 3. Run the whole suite (default) or pick scenarios
METRICS_TOKEN=local-chaos-token bash chaos/chaos.sh
bash chaos/chaos.sh postgres_outage redis_outage
```

`BOTHIVE_BASE_URL` (default `http://localhost:3000`) points at the API.
`CHAOS_TIMEOUT` (default 180s) bounds how long each recovery step may take.

If a run is interrupted mid-scenario, `chaos.sh` now runs an `EXIT` trap that
restarts `postgres`, `redis` and `workers-telegram` and unpauses the worker.

## In CI

`.github/workflows/chaos.yml` builds the API + worker images, starts
`postgres redis api workers-telegram`, waits for readiness, runs `chaos/chaos.sh`
and tears the stack down. Logs are uploaded as an artifact on failure.
