import { BullMQOtel } from 'bullmq-otel';
import { isTracingEnabled } from '@bothive/core';

let instance: BullMQOtel | undefined;

/**
 * Shared BullMQ telemetry add-on for this process. Passed to the API's queues
 * so the producer records the enqueue span and hands the trace context to the
 * worker via the job payload (bullmq-otel), stitching a full request→job→
 * result trace across processes. Returns undefined when OTLP tracing is not
 * configured, which BullMQ treats as "no telemetry" (no spans, no overhead).
 */
export function getBullmqOtel(): BullMQOtel | undefined {
  if (!isTracingEnabled()) return undefined;
  if (!instance) instance = new BullMQOtel({ tracerName: 'bothive-api' });
  return instance;
}
