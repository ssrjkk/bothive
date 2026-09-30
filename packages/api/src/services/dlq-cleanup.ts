import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { pruneDeadLetterJobs } from './queue.js';

export interface DlqCleanupHandle {
  stop: () => void;
}

/**
 * Retention sweep for the dead-letter queues. Jobs that exhaust their retry
 * budget sit in the DLQ forever (nothing consumes them), so without a sweep
 * Redis grows unboundedly on a busy fleet. Mirrors log/event cleanup: a
 * background interval removes DLQ jobs older than DLQ_RETENTION_DAYS (default
 * 30). The DLQ is a triage surface, not an archive.
 */
export function startDlqCleanup(
  _prisma: PrismaClient,
  intervalMs = 6 * 60 * 60 * 1000,
): DlqCleanupHandle {
  const retentionDays = Math.max(1, parseInt(process.env.DLQ_RETENTION_DAYS ?? '30', 10) || 30);

  const cleanup = async (): Promise<void> => {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const removed = await pruneDeadLetterJobs(cutoff);
      if (removed > 0) {
        console.log(
          `[dlq-cleanup] removed ${removed} dead-letter jobs older than ${retentionDays} days`,
        );
      }
    } catch (err) {
      console.error('[dlq-cleanup] failed:', err);
    }
  };

  void cleanup();
  const timer = setInterval(() => void cleanup(), intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
