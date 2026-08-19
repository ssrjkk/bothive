import { Queue, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';
import { getBullmqOtel } from '../otel.js';

const connection = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisConnectionOptions(),
);

// Without an 'error' listener ioredis emits an uncaught 'error' event on a
// dropped connection and would crash the whole API process. BullMQ owns
// queue-level failure handling; this listener only keeps the event from being
// unhandled.
connection.on('error', (err) => {
  console.error('[api] Redis error:', err?.message ?? err);
});

const telemetry = getBullmqOtel();

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
} as const;

const queues = {
  telegram: new Queue('telegram-queue', { connection, defaultJobOptions, telemetry }),
  twitch: new Queue('twitch-queue', { connection, defaultJobOptions, telemetry }),
  youtube: new Queue('youtube-queue', { connection, defaultJobOptions, telemetry }),
  twitter: new Queue('twitter-queue', { connection, defaultJobOptions, telemetry }),
  crypto: new Queue('crypto-queue', { connection, defaultJobOptions, telemetry }),
} as const;

type QueueName = keyof typeof queues;

export function getQueue(platform: string): Queue {
  const q = queues[platform as QueueName];
  if (!q) throw new Error(`Unknown platform: ${platform}`);
  return q;
}

export async function enqueueConnect(botId: string, platform: string): Promise<Job> {
  const queue = getQueue(platform);
  // Connect jobs deliberately carry no credentials: the worker resolves them
  // from the database itself, so account keys/tokens never transit Redis.
  return queue.add(
    'connect',
    {
      id: botId,
      type: 'connect',
      botId,
      data: {},
    },
    {
      jobId: `connect-${botId}`,
      attempts: 1,
      // A custom jobId keeps connect jobs deduplicated while one is waiting or
      // active (double-start can't queue two connects), but BullMQ refuses to
      // re-add a job whose id still exists in the completed/failed set. Removing
      // finished control jobs immediately lets a later stop/start or restart
      // enqueue a fresh connect instead of silently reusing the old one.
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function enqueueDisconnect(botId: string, platform: string): Promise<Job> {
  const queue = getQueue(platform);
  return queue.add(
    'disconnect',
    {
      id: botId,
      type: 'disconnect',
      botId,
      data: {},
    },
    {
      jobId: `disconnect-${botId}`,
      attempts: 3,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function enqueueAction(
  botId: string,
  platform: string,
  action: { type: string; payload: Record<string, unknown> },
): Promise<Job> {
  const queue = getQueue(platform);
  return queue.add(
    'execute',
    {
      id: `${botId}-${Date.now()}`,
      type: 'execute',
      botId,
      data: action,
    },
    {
      jobId: `execute-${botId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // No automatic retries: an action may be a live trade order, and a retry
      // after a success-then-crash would place the same order twice. The
      // worker-level clients likewise never auto-retry order calls; failures
      // surface once for the caller to inspect.
      attempts: 1,
    },
  );
}

/**
 * Enqueues a raw Telegram webhook update for the telegram worker to process
 * through grammy (`bot.handleUpdate`). Deduplicated per (bot, update_id):
 * Telegram retries a webhook POST until it receives a 2xx, so a retried
 * delivery that already reached the queue must not be processed twice (that
 * would double-emit platform events and double-run scripts).
 */
export async function enqueueTelegramUpdate(
  botId: string,
  update: Record<string, unknown>,
): Promise<Job> {
  const queue = getQueue('telegram');
  const updateId = typeof update.update_id === 'number' ? update.update_id : Date.now();
  return queue.add(
    'update',
    {
      id: `${botId}-${updateId}`,
      type: 'update',
      botId,
      data: update,
    },
    {
      jobId: `tg-update-${botId}-${updateId}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function getQueueMetrics(platform: string) {
  const queue = getQueue(platform);
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { platform, waiting, active, completed, failed, delayed };
}

export async function getAllQueueMetrics() {
  const results = await Promise.all((Object.keys(queues) as QueueName[]).map(getQueueMetrics));
  return results;
}

/**
 * Recent failed jobs across all queues. Connect jobs carry no credentials
 * (workers resolve them from the database), and other payloads are safe;
 * only safe fields are exposed anyway — never `data`.
 */
export async function getFailedJobs(limit = 20) {
  const results = await Promise.all(
    (Object.keys(queues) as QueueName[]).map(async (platform) => {
      const jobs = await queues[platform].getJobs(['failed'], 0, limit);
      return jobs.map((job) => {
        const data = (job.data ?? {}) as { type?: string; botId?: string };
        return {
          id: job.id,
          platform,
          name: job.name,
          type: data.type ?? null,
          botId: data.botId ?? null,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
          timestamp: job.timestamp,
        };
      });
    }),
  );
  return results.flat();
}

export { connection as redisConnection };
