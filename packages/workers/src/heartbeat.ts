import { Redis } from 'ioredis';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_SECONDS = 30;
const PREFIX = 'worker:heartbeat:';

/**
 * Publishes a liveness key per platform (`worker:heartbeat:<platform>`).
 * The API reads these via GET /api/health/workers so the dashboard can show
 * per-platform worker status and operators can tell at a glance whether a
 * platform process died.
 */
export function startWorkerHeartbeat(redisUrl: string, platforms: readonly string[]): { stop: () => Promise<void> } {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  const keys = platforms.map((p) => `${PREFIX}${p}`);

  const beat = async (): Promise<void> => {
    try {
      const ts = Date.now();
      await Promise.all(keys.map((key) => redis.set(key, String(ts), 'EX', HEARTBEAT_TTL_SECONDS)));
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
