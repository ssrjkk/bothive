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

| Alert                         | Meaning                          | Likely cause                                                                             | Action                                                                                                           |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ApiUnreachable`              | `up{job="api"} == 0` for 2m      | API crash-loop, Postgres/Redis down, bad `ENCRYPTION_KEY`/secrets, empty `METRICS_TOKEN` | `docker compose logs api`; check `health/ready`; fix env; `docker compose up -d api`                             |
| `ApiHighErrorRate`            | 5xx > 5% for 10m                 | DB deadlocks, bad migration, backend platform API rejecting tokens                       | `docker compose logs api`; check Prometheus `http_requests_total{status=~"5.."}`; revoke/refresh affected tokens |
| `ApiSlowResponses`            | p95 latency > 5s for 10m         | DB pool exhausted, slow queue, Redis blocking                                            | check `connection_limit` in `DATABASE_URL`; `docker compose logs`; check `bothive_queue_jobs`                    |
| `AllWorkersDown`              | every platform worker is down    | Redis unreachable, shared secret rotated, infra failure                                  | `docker compose ps`; check Redis; `docker compose logs workers-<platform>`                                       |
| `WorkerDown`                  | `bothive_worker_up == 0` for 15m | worker crash/restart loop, Redis unreachable, bad platform token decrypt                 | `docker compose logs workers-<platform>`; confirm `ENCRYPTION_KEY` matches API                                   |
| `QueueBacklog`                | > 100 waiting jobs for 15m       | consumer paused (no leader), worker concurrency too low, dead Redis                      | verify leadership: `docker compose logs workers-<platform> \| grep -i leader`; bump `WORKER_CONCURRENCY`         |
| `QueueHighWait`               | queue wait p95 elevated          | concurrency saturated, slow jobs blocking the queue                                      | raise `WORKER_CONCURRENCY`; check for stuck jobs                                                                 |
| `QueueFailures`               | failed jobs for 30m              | action permanently failing (bad token/ban), script error                                 | `docker compose logs workers-<platform>`; fix or clean queue (see runbook 0002)                                  |
| `BotUnhealthy`                | bot health score < 50 for 15m    | platform SDK disconnected, credential revoked, rate-limited                              | `docker compose logs workers-<platform>`; reconnect from dashboard; refresh token                                |
| `BotReconnectThrashing`       | bot reconnecting repeatedly      | token flapping, platform-side ban, network issue                                         | check bot logs; verify credential; check platform status                                                         |
| `ProxyUnhealthy`              | proxy health score == 0 for 10m  | proxy down / rate-limited                                                                | replace proxy under Accounts → Proxies; check `bothive_proxy_health_score`                                       |
| `ScriptFailureSpike`          | script errors spiking            | bad script code, sandbox timeout, external API down in `fetch`                           | `docker compose logs workers-<platform>`; check recent script edits                                              |
| `WorkerMemoryGrowth`          | worker heap growing steadily     | memory leak in adapter or script                                                         | restart worker; check script memory usage; file issue                                                            |
| `WorkerSandboxLeak`           | sandbox workers not releasing    | script hanging, sandbox not cleaned up                                                   | restart worker; check `bothive_worker_sandbox_workers`                                                           |
| `CryptoHighErrorRate`         | crypto worker errors > threshold | Binance API down, bad API keys, network issue                                            | `docker compose logs workers-crypto`; verify API keys; check Binance status                                      |
| `CryptoNoFills`               | crypto orders not filling        | order size too small, market illiquid, dry-run mode                                      | check `tradeMode`; verify order params; check market conditions                                                  |
| `CryptoVolumeSpike`           | unusual crypto order volume      | script loop, misconfigured trigger                                                       | check active crypto scripts; pause if runaway                                                                    |
| `ApiAvailabilityBurnRate`     | SLO burn rate high (fast page)   | error rate consuming error budget rapidly                                                | investigate API errors; check downstream deps                                                                    |
| `ApiAvailabilityBurnRateSlow` | SLO burn rate elevated (slow)    | sustained low-level errors draining budget                                               | review error logs; plan fix before budget exhausted                                                              |
| `ApiLatencySLOPage`           | latency SLO at risk              | p95 latency consuming error budget                                                       | check DB performance; check queue depth; scale if needed                                                         |

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
