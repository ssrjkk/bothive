# Distributed tracing

Bothive can export OpenTelemetry (OTLP) traces to any OTLP-compatible collector
— including the bundled Jaeger service. Everything is opt-in: with no
`OTEL_EXPORTER_OTLP_ENDPOINT` set, the OpenTelemetry SDK stays a no-op (no
spans, no exporters, no network).

## What is instrumented

- **HTTP** (`@opentelemetry/instrumentation-http`) — every outbound request
  from the API and workers becomes a child span.
- **Redis** (`@opentelemetry/instrumentation-ioredis`) — every ioredis command.
- **Fastify** (`@opentelemetry/instrumentation-fastify`) — every API request
  (`packages/api` only).
- **BullMQ** (`bullmq-otel`) — every job in the workers: enqueue → wait →
  active → complete/failed spans, propagated from the producer (API) to the
  consumer (worker) via the job payload, so a full request→job→result trace is
  stitched together across processes.

## Quick start (compose)

Tracing is wired into `docker-compose.yml` via the `x-otel-env` anchor:

```bash
# .env
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
OTEL_TRACES_SAMPLE_RATE=0.1
```

`docker compose up -d --build`, then open the Jaeger UI at
http://localhost:16686 and search for a service (`bothive-api`,
`bothive-workers`).

- `OTEL_EXPORTER_OTLP_ENDPOINT` — base URL of an OTLP/HTTP collector. The SDK
  appends `/v1/traces`. Empty (default) = tracing disabled. To override just
  the traces path use `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`.
- `OTEL_TRACES_SAMPLE_RATE` — fraction of root spans to keep, `0..1`
  (default `0.1` = 10%). Head sampling with a `ParentBasedSampler`, so a child
  span is kept whenever its parent is.

The compose `jaeger` service (`jaegertracing/all-in-one`) listens on
`127.0.0.1:16686` (UI) and `127.0.0.1:4318` (OTLP/HTTP), with
`COLLECTOR_OTLP_ENABLED=true`. Replace the endpoint with any other collector
(e.g. Tempo, Grafana Cloud) — only the `OTEL_EXPORTER_OTLP_ENDPOINT` changes.

## How it is wired

- `packages/core/src/utils/tracing.ts` — `initTracing()` builds a
  `NodeTracerProvider` (service name from the package, batch span processor,
  sampler above), registers it and patches the instrumentations. It is
  idempotent and never throws: any misconfiguration degrades to "no tracing".
- `packages/api/src/tracing-preload.ts` / `packages/workers/src/tracing-preload.ts`
  — loaded **before** the app entrypoint via `node --import
dist/tracing-preload.js` (see the Dockerfiles and every `command` in
  `docker-compose.yml`). Patching must happen before the first HTTP/Redis
  client is created, which is why a preload is used instead of importing from
  the app code.
- `packages/workers/src/otel.ts` — `getBullmqOtel()` returns a cached
  `BullMQOtel` instance when tracing is enabled; it is passed to every
  `Queue`/`Worker` via the `telemetry` option (BullMQ 6). Undefined = BullMQ's
  "no telemetry" fast path.
- Shutdown (`shutdownTracing`) is called from the API's and workers'
  graceful-shutdown handlers, flushing pending spans so a SIGTERM during
  `docker compose down` does not drop the last batches.

## What sampling means for you

At `0.1`, one in ten root spans is exported. For a low-traffic self-hosted
deploy the traces are still mostly empty, so bump `OTEL_TRACES_SAMPLE_RATE=1`
if you want every job. The sampler only drops _root_ spans; children follow
their parent, so a kept job's full internal breakdown is always intact.

## Troubleshooting

- Nothing in Jaeger but the stack is up? Confirm the endpoint from inside the
  containers: `docker compose exec api sh -c 'wget -qO- http://jaeger:4318/v1/traces'`.
- Checking whether a container even initialised tracing: at startup
  `initTracing` logs `[tracing] initialized service=<name> url=<endpoint>`
  (stdout) or warns `[tracing] initialization failed; tracing disabled` on a
  misconfiguration. Both the API and workers entrypoints flush spans via
  `shutdownTracing()` on `SIGTERM`/`SIGINT`, so a `docker compose down` does
  not drop the last batch.
- Redis commands flood the trace list; they are useful for job latency
  breakdowns but noisy. The `@opentelemetry/instrumentation-ioredis` `enabled`
  flag can be toggled in the preloads.
