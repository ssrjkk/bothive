import { initTracing } from '@bothive/core';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';

// Loaded via `node --import` BEFORE the API entry module so the http, fastify
// and ioredis instrumentation hooks are installed before anything imports them.
// No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
initTracing({
  serviceName: 'bothive-api',
  serviceVersion: process.env.npm_package_version ?? 'dev',
  instrumentations: [
    new HttpInstrumentation(),
    new FastifyInstrumentation(),
    new IORedisInstrumentation(),
  ],
});
