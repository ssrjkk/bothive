# ADR-0004: Prometheus metrics + Alertmanager on a single-node compose deploy

- **Status:** Accepted
- **Date:** 2026-08
- **Deciders:** maintainer

## Context

The service must be observable and alerting-capable for a single-node Docker Compose deployment (no Kubernetes, no managed monitoring). The API already exposes a Prometheus text format endpoint (`GET /metrics`) with HTTP, BullMQ queue depth, per-bot health/action/reconnect/script, worker liveness/concurrency, proxy health, Prisma row counts and Node runtime metrics. It also exposes `GET /health` and `GET /health/ready` (probes Postgres and Redis, returns 503 when either is down).

## Decision

- Ship a **Prometheus + Alertmanager + Grafana stack** as compose services scraping `GET /metrics`.
- Protect the metrics endpoint with a Bearer `METRICS_TOKEN` (JWT auth fallback); Prometheus reads the token from a `credentials_file` written at container start — env vars are **not** expanded inside the config.
- Ship alert rules (`prometheus/rules/bothive.yml`, 9 rules: API down/high error rate/slow p95, workers down, queue backlog, stuck failed jobs, unhealthy bots/proxies) evaluated by Prometheus.
- Ship Alertmanager (`alertmanager.yml`) with a **null receiver** by default so nothing notifies until the operator edits in a real webhook/email.
- Ship a provisioned Grafana (datasource → Prometheus) with the **BotHive — API overview** dashboard in tab rows (Overview, Bots, Workers & Queues, Proxies). `GF_ADMIN_USER` / `GF_ADMIN_PASSWORD` override the default admin/admin login.
- TLS terminates at a reverse proxy; the API and dashboard stay plain HTTP internally (`TRUST_PROXY=true` only behind a trusted proxy so `request.ip` respects `X-Forwarded-For` for login rate-limiting).

## Consequences

- **Positive:** self-hosted, no external SaaS dependency; dashboards and alerts are code (`gitops`-friendly); queue and bot health are visible per bot.
- **Negative:** Prometheus/Grafana add memory/CPU to the single node; dashboards/alerting need active maintenance; a null Alertmanager receiver gives no notifications until configured.
- **Risk:** if `METRICS_TOKEN` is empty, the API falls back to JWT auth that Prometheus cannot satisfy — the `ApiUnreachable` alert fires spuriously. Docs call this out.

## Alternatives considered

- Hosted monitoring (Datadog, New Relic) — rejected: cost + external dependency for a self-hosted single-user deploy.
- Log-based alerting (ELK + alerting) — rejected: heavier, slower to alert; metrics first, logs stay in Docker.
- Kubernetes + Prometheus Operator — rejected: overkill for one node; compose matches the deploy target.
