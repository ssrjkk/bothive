# Load testing

[k6](https://k6.io) scenarios that exercise the BotHive API the way the dashboard does. They are read-only (no bots/accounts are created), so they are safe to run against staging or a local `docker compose up` stack.

## Scenarios

| File        | What it checks                                                                             | Gate                                 |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| `smoke.js`  | every major endpoint answers (login, health, bots, accounts, stats, queues, scripts, logs) | 1 VU, error rate < 1%                |
| `load.js`   | sustained 30-VU read mix                                                                   | error rate < 1% **and** p95 < 300 ms |
| `stress.js` | ramp to 100 VUs to find the breaking point                                                 | p95 < 1 s, p99 < 3 s                 |
| `soak.js`   | 20 VUs for 30 min to catch leaks and backlog creep                                         | error rate < 1%, p95 < 300 ms        |

The `load.js` and `soak.js` thresholds mirror the SLOs in `docs/slo.md` — a failing run is a violated SLO, not just a slow test.

## Running

Install k6 (`choco install k6`, `winget install k6`, or download from k6.io), start the stack, then:

```bash
# Defaults assume http://localhost:3000 and an admin@example.com account.
k6 run load/smoke.js
k6 run load/load.js
k6 run load/stress.js
k6 run load/soak.js
```

Point at another environment and a real account:

```bash
k6 run \
  -e BASE_URL=https://staging.bothive.example \
  -e LOAD_USER_EMAIL=admin@example.com \
  -e LOAD_USER_PASSWORD='<password>' \
  load/load.js
```

From a container (no local k6):

```bash
docker run --rm -i -v "$PWD/load:/load" grafana/k6 run /load/load.js
```

## What to watch during a run (Grafana "BotHive — API overview")

- `http_req_duration` p95 vs. the 300 ms SLO — latency is the first thing to move.
- `http_req_failed` — 5xx spikes point at code/dependency problems, not load.
- `bothive_queue_jobs_total` / `bothive_worker_queue_depth` — reads do not enqueue jobs, but watch that nothing else drifts.
- Postgres connections and process RSS (node runtime gauges) during `soak.js` for leaks.

## Interpreting a failure

- **`load.js` fails on `http_req_failed`**: 5xx errors at moderate load → investigate first (logs, `ApiHighErrorRate` alert), then re-run.
- **`load.js` fails on `http_req_duration`**: p95 above 300 ms → check slow queries, connection pool saturation, then capacity (`docs/capacity-planning.md`).
- **`stress.js` failure point** tells you the real ceiling: note the VU count at which p95 or the error rate crosses the gate, and keep operating capacity below it (recommend: at most ~70% of the stress ceiling).
