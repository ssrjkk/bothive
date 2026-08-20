import { prisma } from './prisma.js';

export interface LogRow {
  botId: string;
  level: string;
  message: string;
  meta: object;
  createdAt: Date;
}

/**
 * Batches log rows into a single `createMany` instead of one INSERT per log.
 * Events (and their script logs) are the hottest write path in the workers; a
 * busy bot can emit hundreds per minute, and each was a round-trip to Postgres.
 * The DB write is deferred to the flush, while the Redis publish (live log
 * stream) happens immediately on enqueue so the dashboard stays realtime.
 *
 * Best-effort like the old per-row write: a failed flush drops the batch and
 * is logged — log history is diagnostics, never a reason to break the event
 * pipeline. The buffer is capped so a DB outage cannot grow memory forever.
 */

const FLUSH_INTERVAL_MS = 250;
const MAX_BUFFERED_ROWS = 2000;

const buffer: LogRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

function scheduleFlush(): void {
  if (flushTimer || flushing) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushLogs();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

/** Buffers a log row; publishes to the live stream immediately. */
export function enqueueLog(row: LogRow): void {
  buffer.push(row);
  if (buffer.length > MAX_BUFFERED_ROWS) {
    // DB is down or the flush is wedged — drop the oldest rows to bound memory.
    buffer.splice(0, buffer.length - MAX_BUFFERED_ROWS);
  }
  scheduleFlush();
}

/**
 * Writes all buffered rows in one statement. Idempotent and safe to call
 * concurrently: overlapping calls share a single in-flight flush.
 */
export function flushLogs(): Promise<void> {
  if (!flushing) {
    const rows = buffer.splice(0, buffer.length);
    flushing = (async () => {
      if (rows.length === 0) return;
      try {
        await prisma.log.createMany({ data: rows });
      } catch (err) {
        console.error('[log-batcher] batch write failed:', err);
      }
    })().finally(() => {
      flushing = null;
      // Rows enqueued while the flush was in flight need another pass.
      if (buffer.length > 0) scheduleFlush();
    });
  }
  return flushing;
}
