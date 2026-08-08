# ADR-0002: One BullMQ worker process per platform + leader election

- **Status:** Accepted
- **Date:** 2026-08
- **Deciders:** maintainer

## Context

The system orchestrates bots across four platforms (Telegram, Twitch, YouTube, Twitter). Events arrive from platform SDK callbacks and custom scripts; bot actions (say, timeout, ban, react) are executed by workers. Two requirements drove the topology:

1. **Fault isolation** — a crash or infinite loop in one platform's adapters must not take down the others.
2. **Scale-out** — each platform should be scalable independently (`docker compose up --scale workers-telegram=2`).

Additionally, several jobs must run at most once across all replicas of a platform: script-interval firing, proxy pool reconciliation, and control jobs.

## Decision

- Run **one BullMQ worker process per platform** (`workers-telegram`, `workers-twitch`, `workers-youtube`, `workers-twitter`), each consuming its own queue and sharing the same workers image (`node dist/index.js --platform <name>`).
- Each platform queue is backed by Redis; `WORKER_CONCURRENCY` (default 10) bounds per-process job concurrency.
- **Leader election** per platform via a Redis lease `bothive:leader:<platform>` (SET NX PX, TTL `LEADER_TTL_MS`, renewed on an interval). The elected leader is the only replica that is `resume()`d; non-leaders stay `pause()`d so control jobs wait in the queue.
- Worker exposes an `instanceId` and publishes a heartbeat (`worker:heartbeat:<platform>`, TTL 30s) with concurrency and package version; `GET /api/health/workers` aggregates liveness per platform.

## Consequences

- **Positive:** platform-level fault isolation; independent scaling; single execution of singleton jobs guaranteed by the lease; a dead leader is replaced automatically when its lease expires.
- **Negative:** more processes = more memory per platform; leader lease adds a Redis dependency at worker startup; a partition can briefly leave a platform with two "leaders" until the old lease expires (protected by the processJob leadership guard, which requeues in-flight jobs rather than double-execute).
- **Risk:** if Redis is down, workers cannot elect a leader and stay paused (jobs accumulate safely).

## Alternatives considered

- Single multi-platform worker with one queue — rejected: no fault isolation, no per-platform scaling.
- Auto-scaling per queue via BullMQ's own rate-limit — rejected: does not solve the "run once" problem that leader election solves.
