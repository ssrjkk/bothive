# ADR-0005: Versioned, idempotent events with a replayable store and dead-letter queues

- **Status:** Accepted
- **Date:** 2026-09
- **Deciders:** maintainer

## Context

A multi-platform bot farm multiplexes five volatile provider APIs (Telegram, Twitch, YouTube, Twitter/X, Binance) into one control plane. Providers change event shapes and rate limits without notice; webhooks are redelivered; workers fail over and reconnect, re-delivering the tail of a live connection. Every one of those conditions previously caused the same symptom set: scripts double-firing, webhooks double-posting, analytics double-counting, and jobs that exhausted retries vanishing into BullMQ's trimmed failed set.

The resilience toolbox already covered connects (circuit breakers, adaptive backoff with jitter), sends (rate limits), and operators (health scores). The **data plane** — what an event IS and what happens to it after it fires — had no contract at all.

## Decision

**1. Versioned event contracts** (`packages/core/src/contracts/`)
Every emitted event is stamped with `v` — the contract version of its `(platform, eventType)` payload shape, resolved from a registry (`contract-registry.ts`). Webhook envelopes carry it, the store persists it, and replay validates it: an event whose contract is no longer supported is rejected (`422 UNSUPPORTED_CONTRACT`) instead of being mis-parsed by a newer adapter.

**2. Idempotency keys** (`packages/core/src/utils/idempotency.ts`)
Every event carries `eventId`, derived deterministically from the platform's natural id (message id, callback query id, tweet id, update id) when one exists, else a UUID. Workers claim natural-id keys in a Redis dedup window (`SET NX EX`) before fan-out, with an in-memory fallback so a Redis outage degrades rather than double-fires. Replays bypass the claim deliberately.

**3. Replayable event store** (`EventRecord` table + worker batch writer)
Every emitted event is persisted (batched `createMany` with `skipDuplicates`, idempotent by unique `eventId`). `GET /api/events` browses the history; `POST /api/events/:id/replay` re-runs a stored event through the platform worker under its ORIGINAL contract version — scripts and webhooks fire again, AI auto-reply is skipped (`event.replayed`), and the same `eventId` prevents a second store row. Retention is bounded by `EVENT_RETENTION_DAYS` (default 30).

**4. Dead-letter queues** (`<queue>-dlq` + API replay endpoints)
Jobs that exhaust their retry budget are preserved in a per-platform DLQ (including webhook deliveries) with payload and failure reason, instead of being dropped by `removeOnFail`. Operators inspect and replay them via `GET /api/queues/dead-letter` and `POST /api/queues/dead-letter/:platform/:id/replay`; retention is bounded by `DLQ_RETENTION_DAYS` (default 30).

## Consequences

- **Positive:** provider redelivery and worker failover can no longer double-run scripts/webhooks; lost deliveries are recoverable (webhook DLQ) and auditable (event store); a provider shape change is a version bump, not a silent break; alerting can watch DLQ depth and replay rates (`DeadLetterBacklog`, `EventReplaySpike`).
- **Negative:** one extra DB write per event (batched, best-effort) and an extra Redis round-trip per natural-id event; the store and DLQ need retention sweeps (scheduled in the API process); scripts see a larger `ctx.event` envelope (`v`, `eventId`, `replayed`).
- **Risk:** the dedup window is a trade-off — two distinct events sharing a natural id within 5 minutes are treated as one (fixed per adapter by choosing a genuinely unique id, e.g. callback query id, not message id).

## Alternatives considered

- Per-platform in-memory dedup sets (the pre-existing `seenX` sets) — kept as a second net, but they reset on reconnect and are per-process; the Redis claim is the cross-process guarantee.
- Deduping webhook delivery by `jobId` alone — rejected: replay needs a fresh delivery, so job ids now carry an eventId + nonce and rely on emit-level idempotency for duplicate protection.
- Event replay as a raw webhook re-POST — rejected: replay must re-run scripts (worker-side), not just re-notify.
