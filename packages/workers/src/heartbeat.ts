import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_SECONDS = 30;
const PREFIX = 'worker:heartbeat:';

export interface WorkerHeartbeatEntry {
  platform: string;
  concurrency: number;
}

export { parseWorkerHeartbeat, type WorkerHeartbeat } from '@bothive/core';

/**
 * Publishes a liveness key per platform (`worker:heartbeat:<platform>`) with
 * the job concurrency of that worker. The API reads these via
 * GET /api/health/workers so the dashboard can show per-platform worker status,
 * and the /metrics endpoint exposes `bothive_worker_concurrency_current`.
 */
export function startWorkerHeartbeat(
  redisUrl: string,
  entries: readonly WorkerHeartbeatEntry[],
): { stop: () => Promise<void> } {
  const redis = new Redis(redisUrl, { ...redisConnectionOptions(), lazyConnect: true });
  const version = process.env.npm_package_version ?? 'dev';

  const beat = async (): Promise<void> => {
    try {
      const ts = Date.now();
      await Promise.all(
        entries.map((entry) =>
          redis.set(
            `${PREFIX}${entry.platform}`,
            JSON.stringify({ ts, concurrency: entry.concurrency, version }),
            'EX',
            HEARTBEAT_TTL_SECONDS,
          ),
        ),
      );
    } catch (err) {
      console.error('[workers] Heartbeat publish failed:', err);
    }
  };

  void redis.connect().catch((err) => {
    console.error('[workers] Heartbeat connection failed:', err);
  });
  void beat();

  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

  return {
    stop: async () => {
      clearInterval(timer);
      // Do not delete the heartbeat keys here: with `--scale workers-X=N` the
      // key is shared by several replicas of the same platform, and removing it
      // would hide the surviving ones. The 30s TTL expires it on its own.
      try {
        await redis.quit();
      } catch {
        /* best-effort */
      }
    },
  };
}
