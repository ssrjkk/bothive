import { Queue, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';
import { getBullmqOtel } from '../otel.js';

const connection = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisConnectionOptions(),
);

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
} as const;

type QueueName = keyof typeof queues;

export function getQueue(platform: string): Queue {
  const q = queues[platform as QueueName];
  if (!q) throw new Error(`Unknown platform: ${platform}`);
  return q;
}

export async function enqueueConnect(
  botId: string,
  platform: string,
  credentials: Record<string, unknown>,
): Promise<Job> {
  const queue = getQueue(platform);
  return queue.add(
    'connect',
    {
      id: botId,
      type: 'connect',
      botId,
      data: { ...credentials, botId },
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
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
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
 * Recent failed jobs across all queues. Job payloads can contain decrypted
 * credentials (connect jobs), so only safe fields are exposed — never `data`.
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
