import { BullMQOtel } from 'bullmq-otel';
import { isTracingEnabled } from '@bothive/core';

let instance: BullMQOtel | undefined;

/**
 * Shared BullMQ telemetry add-on for this process. BullMQ's `telemetry`
 * option accepts one instance per Queue/Worker; job lifecycle spans are
 * forwarded to the global trace provider that `initTracing` registered.
 * Returns undefined when OTLP tracing is not configured, which BullMQ treats
 * as "no telemetry" (no spans, no overhead).
 */
export function getBullmqOtel(): BullMQOtel | undefined {
  if (!isTracingEnabled()) return undefined;
  if (!instance) instance = new BullMQOtel({ tracerName: 'bothive-workers' });
  return instance;
}
