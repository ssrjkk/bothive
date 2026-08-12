# SLOs / SLIs

Service-level objectives for the BotHive API and worker fleet. Every SLI below is derived from the Prometheus metrics the stack already exports (`packages/api/src/metrics/prometheus.ts`), and every SLO has a matching burn-rate alert in `prometheus/rules/bothive.yml` and a k6 scenario in `load/` that exercises it.

## SLIs (what we measure)

| SLI             | Metric                                                                     | Notes                                                                                              |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Availability    | `rate(http_requests_total)` excluding `5xx` ÷ all requests                 | Prometheus `up{job="api"}` covers scrape reachability; per-request counters cover response quality |
| Latency         | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` | includes `_seconds` histogram on every route                                                       |
| Worker liveness | `bothive_worker_up` (per platform)                                         | heartbeat every 10 s, TTL 30 s                                                                     |
| Job latency     | `bothive_queue_jobs{state="waiting"}` / `bothive_worker_queue_depth`       | how long control jobs wait for a consumer                                                          |
| Bot health      | `bothive_bot_health_score` (0–100, 1 h sliding window)                     | fed by every connect/action success or failure                                                     |
| Data freshness  | `Log[createdAt]` vs. wall clock                                            | every event is logged via `writeLog`                                                               |

## SLOs (what we promise)

| SLO                     | Target                     | Measurement window           | Prometheus alert                                        |
| ----------------------- | -------------------------- | ---------------------------- | ------------------------------------------------------- |
| API availability        | ≥ 99.5%                    | rolling 30 d, errors = `5xx` | `ApiAvailabilityBurnRate` (14.4× over 1 h)              |
| API latency, p95        | ≤ 300 ms                   | 5 m bucket, rolling          | `ApiLatencySLOPage` (p95 > 300 ms for 10 m)             |
| Worker up, per platform | 99.9%                      | 30 d                         | `WorkerDown` / `AllWorkersDown`                         |
| Control jobs started    | 95% within 60 s of enqueue | 30 d                         | `QueueBacklog`                                          |
| Bot health score        | ≥ 50 for running bots      | 30 d                         | `BotUnhealthy`                                          |
| Log loss (RPO)          | ≤ 5 min                    | continuous                   | — (covered by `docs/backup.md` + log cleanup retention) |

## Error budget & burn rate

- **Error budget** = 100% − SLO. For 99.5% availability that is 0.5% of requests; for a 30-day window roughly 3.6 h of total outage.
- **Burn rate** = observed error rate ÷ allowed error rate. 1× consumes the whole 30-day budget in 30 days; 14.4× in 50 hours; 6× in 5 days.
- Alerting is burn-rate based, multi-window: a short, very hot window (`14.4×` over a 1h rate, held `for: 2m`) catches a full outage immediately; a cooler but persistent window (`6×` over `6h`, held `for: 15m`) catches slow degradation. This avoids both "alerting on every 5xx" and "noticing a real SLO breach after a week".

## Alert routing

`alertmanager.yml` routes `severity="page"` alerts (the SLO burn-rate rules) to the webhook receiver; everything else stays on the null receiver for evaluation-only. Wire the webhook to PagerDuty/Opsgenie/Slack per the instructions in that file.

## Related

- Capacity guidance: `docs/capacity-planning.md`
- Incident process: `docs/runbooks/0001-incident-response.md`
- Load scenarios that validate these SLOs: `load/README.md`
