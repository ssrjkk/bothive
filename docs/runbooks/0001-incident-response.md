# Runbook 0001 — Incident response

Severity levels: **SEV-1** (full outage / data loss), **SEV-2** (degraded: some bots or queues down), **SEV-3** (single bot or non-critical).

## First steps

```bash
docker compose ps                          # what is running / restarting
docker compose logs --tail=200 api         # API logs
docker compose logs --tail=200 workers-telegram
curl -s http://localhost:3000/health/ready # 503 => postgres/redis unreachable
```

## Alert map

Alerts come from `prometheus/rules/bothive.yml` (evaluated by Prometheus; notifications only after you edit the Alertmanager receiver).

| Alert              | Meaning                            | Likely cause                                                             | Action                                                                                                           |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `ApiDown`          | `/health` failing > 2m             | API crash-loop, Postgres/Redis down, bad `ENCRYPTION_KEY`/secrets        | `docker compose logs api`; check `health/ready`; fix env; `docker compose up -d api`                             |
| `ApiHighErrorRate` | 5xx > 5% for 5m                    | DB deadlocks, bad migration, backend platform API rejecting tokens       | `docker compose logs api`; check Prometheus `http_requests_total{status=~"5.."}`; revoke/refresh affected tokens |
| `ApiSlowP95`       | p95 latency > 2s                   | DB pool exhausted, slow queue, Redis blocking                            | check `connection_limit` in `DATABASE_URL`; `docker compose logs`; check `bothive_queue_jobs_total`              |
| `WorkersDown`      | `worker_up == 0` for a platform    | worker crash/restart loop, Redis unreachable, bad platform token decrypt | `docker compose logs workers-<platform>`; confirm `ENCRYPTION_KEY` matches API                                   |
| `QueueBacklog`     | queue depth > threshold            | consumer paused (no leader), worker concurrency too low, dead Redis      | verify leadership: `docker compose logs workers-<platform>                                                       | grep -i leader`; bump `WORKER_CONCURRENCY` |
| `StuckFailedJobs`  | failed jobs accumulating           | action permanently failing (bad token/ban), script error                 | `docker compose logs workers-<platform>`; fix or clean queue (see runbook 0002)                                  |
| `UnhealthyBots`    | bot health gauge < 1 for N minutes | platform SDK disconnected, credential revoked, rate-limited              | `docker compose logs workers-<platform>`; reconnect from dashboard; refresh token                                |
| `UnhealthyProxies` | proxy health score low             | proxy down / rate-limited                                                | replace proxy under Accounts → Proxies; check `bothive_proxy_health_score`                                       |

## Common root causes

- **Every service restarting** → Postgres/Redis not healthy, or a secret was rotated (`JWT_SECRET`/`ENCRYPTION_KEY`) without updating all consumers.
- **One platform down, others fine** → platform-specific issue: revoked token, changed API, adapter crash. Restart just that service.
- **Bots stuck "connecting"** → leader is not elected or Redis lease is flapping. Check `docker compose logs workers-<platform> | grep -iE "leader|reconnect"`.
- **401/403 on platform API calls** → token expired/revoked; update credentials in the dashboard (Accounts) and reconnect the bot.

## Escalation / notification

- Default Alertmanager receiver is **null** — edit `alertmanager.yml` (webhook/email) and reload: `curl -X POST localhost:9090/-/reload` (Prometheus web lifecycle) or `docker compose restart alertmanager`.
- For sustained issues, capture `docker compose logs` for the affected services before restarting.

## Post-incident

1. Confirm recovery: `/health/ready` → `ok`, queue depth back to normal, affected bots reconnected.
2. Update runbooks with anything not covered above.
