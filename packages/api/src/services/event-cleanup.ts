import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

export interface EventCleanupHandle {
  stop: () => void;
}

/**
 * Retention sweep for the event store. Every platform event is persisted so it
 * can be replayed, but an unbounded table grows forever on a busy bot farm.
 * Mirrors log cleanup: a background interval deletes events older than
 * EVENT_RETENTION_DAYS (default 30). Old events are diagnostics; a replay of
 * anything past the retention window is gone by design.
 */
export function startEventCleanup(
  prisma: PrismaClient,
  intervalMs = 6 * 60 * 60 * 1000,
): EventCleanupHandle {
  const retentionDays = Math.max(1, parseInt(process.env.EVENT_RETENTION_DAYS ?? '30', 10) || 30);

  const cleanup = async (): Promise<void> => {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await prisma.eventRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (result.count > 0) {
        console.log(
          `[event-cleanup] deleted ${result.count} events older than ${retentionDays} days`,
        );
      }
    } catch (err) {
      console.error('[event-cleanup] failed:', err);
    }
  };

  void cleanup();
  const timer = setInterval(() => void cleanup(), intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
