import type { PlatformEvent } from '@bothive/core';
import { prisma } from './prisma.js';

export interface EventRecordRow {
  botId: string;
  platform: string;
  type: string;
  version: number;
  eventId: string;
  payload: object;
  createdAt: Date;
}

/**
 * Batches platform events into Postgres so the event store (and thus replay)
 * is populated without one INSERT per event. A busy bot can emit hundreds of
 * messages a minute; the same hot path that once wrote logs one-by-one now
 * writes events too, so it uses the same createMany batching trick.
 *
 * Idempotent by `eventId` (unique): `skipDuplicates` means a re-emitted event
 * (reconnect replay, webhook redelivery, manual replay) never creates a second
 * row. Best-effort like the log batcher — a DB outage drops the batch instead
 * of breaking the event pipeline.
 */

const FLUSH_INTERVAL_MS = 250;
const MAX_BUFFERED_ROWS = 2000;

const buffer: EventRecordRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

function scheduleFlush(): void {
  if (flushTimer || flushing) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

/** Buffers a platform event for the store (no await — fire and forget). */
export function enqueueEvent(event: PlatformEvent): void {
  buffer.push({
    botId: event.botId,
    platform: event.platform,
    type: event.type,
    version: event.v,
    eventId: event.eventId,
    payload: (event.payload ?? {}) as object,
    createdAt: event.timestamp,
  });
  if (buffer.length > MAX_BUFFERED_ROWS) {
    // DB is down or the flush is wedged — drop the oldest rows to bound memory.
    buffer.splice(0, buffer.length - MAX_BUFFERED_ROWS);
  }
  scheduleFlush();
}

/**
 * Writes all buffered events in one statement, skipping rows whose eventId
 * already exists. Idempotent and safe to call concurrently: overlapping calls
 * share a single in-flight flush.
 */
export function flushEvents(): Promise<void> {
  if (!flushing) {
    const rows = buffer.splice(0, buffer.length);
    flushing = (async () => {
      if (rows.length === 0) return;
      try {
        await prisma.eventRecord.createMany({ data: rows, skipDuplicates: true });
      } catch (err) {
        console.error('[event-batcher] batch write failed:', err);
      }
    })().finally(() => {
      flushing = null;
      if (buffer.length > 0) scheduleFlush();
    });
  }
  return flushing;
}
