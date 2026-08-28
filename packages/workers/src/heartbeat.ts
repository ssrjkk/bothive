import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_SECONDS = 30;
const PREFIX = 'worker:heartbeat:';

export interface WorkerHeartbeatEntry {
  platform: string;
  /** Unique id of this worker process; disambiguates replicas of the same platform. */
  instanceId: string;
  concurrency: number;
  /** Latest queue wait percentiles (seconds) for the platform's worker. */
  wait?: () => { p50: number; p95: number; p99: number };
  /** Number of live script-sandbox worker threads (leak canary). */
  sandboxWorkers?: () => number;
}

export { parseWorkerHeartbeat, type WorkerHeartbeat } from '@bothive/core';

/**
 * Publishes a liveness key per worker INSTANCE (`worker:heartbeat:<platform>:<instance>`)
 * with the job concurrency of that worker, its process memory and the latest
 * queue wait percentiles. The instance suffix matters when a platform is scaled
 * (`--scale workers-X=N`): without it every replica would overwrite the same
 * key and the surviving replicas would be invisible to health checks. The API
 * reads these via GET /api/health/workers so the dashboard can show per-platform
 * worker status, and the /metrics endpoint exposes `bothive_worker_up`,
 * `bothive_worker_memory_bytes`, `bothive_worker_sandbox_workers` and
 * `bothive_queue_wait_seconds`.
 */
export function startWorkerHeartbeat(
  redisUrl: string,
  entries: readonly WorkerHeartbeatEntry[],
): { stop: () => Promise<void> } {
  const redis = new Redis(redisUrl, { ...redisConnectionOptions(), lazyConnect: true });
  redis.on('error', (err) => console.error('[heartbeat] Redis error:', err?.message ?? err));
  const version = process.env.npm_package_version ?? 'dev';

  const beat = async (): Promise<void> => {
    try {
      const ts = Date.now();
      const memory = process.memoryUsage();
      await Promise.all(
        entries.map((entry) => {
          const wait = entry.wait?.() ?? { p50: 0, p95: 0, p99: 0 };
          return redis.set(
            `${PREFIX}${entry.platform}:${entry.instanceId}`,
            JSON.stringify({
              ts,
              concurrency: entry.concurrency,
              version,
              rss: memory.rss,
              heapUsed: memory.heapUsed,
              heapTotal: memory.heapTotal,
              waitP50: Number(wait.p50.toFixed(3)),
              waitP95: Number(wait.p95.toFixed(3)),
              waitP99: Number(wait.p99.toFixed(3)),
              sandboxWorkers: entry.sandboxWorkers?.() ?? 0,
            }),
            'EX',
            HEARTBEAT_TTL_SECONDS,
          );
        }),
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
      // Do not delete this instance's heartbeat key here: the key is per
      // instance (`worker:heartbeat:<platform>:<instance>`), and a graceful
      // stop leaves a fresh key that would otherwise linger as a live replica
      // until the 30s TTL expires. The TTL handles it on its own.
      try {
        await redis.quit();
      } catch {
        /* best-effort */
      }
    },
  };
}
