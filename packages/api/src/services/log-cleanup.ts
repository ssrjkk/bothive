import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

export interface LogCleanupHandle {
  stop: () => void;
}

export function startLogCleanup(
  prisma: PrismaClient,
  intervalMs = 6 * 60 * 60 * 1000,
): LogCleanupHandle {
  const retentionDays = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS ?? '30', 10) || 30);

  const cleanup = async (): Promise<void> => {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await prisma.log.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (result.count > 0) {
        console.log(`[log-cleanup] deleted ${result.count} logs older than ${retentionDays} days`);
      }
    } catch (err) {
      console.error('[log-cleanup] failed:', err);
    }
  };

  void cleanup();
  const timer = setInterval(() => void cleanup(), intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
