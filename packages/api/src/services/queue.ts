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

const WEBHOOK_QUEUE_NAME = 'webhook-queue';

export function getQueue(platform: string): Queue {
  const q = queues[platform as QueueName];
  if (!q) throw new Error(`Unknown platform: ${platform}`);
  return q;
}

// --- Dead-letter queues -----------------------------------------------------
//
// Workers move jobs that exhaust their retry budget into `<name>-dlq` queues
// (see base-worker.moveToDlq and webhooks.ts). These helpers let the API
// enumerate and replay them. The DLQ payload never carries secrets: connect
// jobs resolve credentials from the DB and action payloads are user content.

/** DLQ queue names per platform, plus the webhook queue. */
const DLQ_NAMES: Record<string, string> = {
  telegram: 'telegram-queue-dlq',
  twitch: 'twitch-queue-dlq',
  youtube: 'youtube-queue-dlq',
  twitter: 'twitter-queue-dlq',
  crypto: 'crypto-queue-dlq',
  webhook: `${WEBHOOK_QUEUE_NAME}-dlq`,
};

export interface DeadLetterJobView {
  id: string;
  platform: string;
  name: string | null;
  type: string | null;
  botId: string | null;
  failedReason: string | null;
  attemptsMade: number;
  timestamp: number;
}

const dlqQueues = new Map<string, Queue>();

function getDlq(platform: string): Queue {
  const name = DLQ_NAMES[platform];
  if (!name) throw new Error(`Unknown DLQ platform: ${platform}`);
  const existing = dlqQueues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection,
    telemetry,
    defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000 },
  });
  dlqQueues.set(name, queue);
  return queue;
}

/** Cached webhook delivery queue for DLQ replays (never re-create per call). */
let webhookQueue: Queue | undefined;

function getWebhookQueue(): Queue {
  if (!webhookQueue) {
    webhookQueue = new Queue(WEBHOOK_QUEUE_NAME, { connection, telemetry });
  }
  return webhookQueue;
}

function toDlqView(platform: string, job: Job): DeadLetterJobView {
  const data = (job.data ?? {}) as {
    name?: unknown;
    type?: unknown;
    botId?: unknown;
    failedReason?: unknown;
    attemptsMade?: unknown;
  };
  return {
    id: job.id ?? String(job.timestamp),
    platform,
    name: typeof data.name === 'string' ? data.name : null,
    type: typeof data.type === 'string' ? data.type : null,
    botId: typeof data.botId === 'string' ? data.botId : null,
    failedReason: typeof data.failedReason === 'string' ? data.failedReason : null,
    attemptsMade: Number(data.attemptsMade) || 0,
    timestamp: job.timestamp ?? Date.now(),
  };
}

/** Lists dead-lettered jobs across every platform DLQ (admins only). */
export async function getDeadLetterJobs(limit = 20): Promise<DeadLetterJobView[]> {
  const results = await Promise.all(
    Object.keys(DLQ_NAMES).map(async (platform) => {
      const jobs = await getDlq(platform).getJobs([], 0, limit);
      return jobs.map((job) => toDlqView(platform, job));
    }),
  );
  return results.flat();
}

/** DLQ backlog (waiting jobs) per platform — feeds the Prometheus gauge. */
export async function getDeadLetterJobCounts(): Promise<
  Array<{ platform: string; waiting: number }>
> {
  return Promise.all(
    Object.keys(DLQ_NAMES).map(async (platform) => ({
      platform,
      waiting: await getDlq(platform).getWaitingCount(),
    })),
  );
}

/**
 * Removes DLQ jobs older than `cutoff` (bounded per platform per run). DLQ jobs
 * are never consumed, so without a retention sweep the queues grow forever.
 * Returns the total number of removed jobs.
 */
export async function pruneDeadLetterJobs(cutoff: Date, maxPerPlatform = 1000): Promise<number> {
  let removed = 0;
  for (const platform of Object.keys(DLQ_NAMES)) {
    const dlq = getDlq(platform);
    const jobs = await dlq.getJobs([], 0, maxPerPlatform);
    for (const job of jobs) {
      if (!job.id) continue;
      if (job.timestamp < cutoff.getTime()) {
        await dlq.remove(job.id).catch(() => undefined);
        removed += 1;
      }
    }
  }
  return removed;
}

/**
 * Replays a dead-lettered job back onto its original queue. The worker
 * re-executes the job type from the preserved payload; connect/update jobs
 * carry no secrets, and execute payloads are user content.
 */
export async function replayDeadLetterJob(
  platform: string,
  jobId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!DLQ_NAMES[platform]) return { ok: false, reason: `Unknown DLQ platform: ${platform}` };
  const dlq = getDlq(platform);
  const job = await dlq.getJob(jobId);
  if (!job) return { ok: false, reason: 'Dead-letter job not found' };

  const data = (job.data ?? {}) as {
    name?: unknown;
    type?: unknown;
    botId?: unknown;
    payload?: unknown;
  };
  const targetName = data.name && typeof data.name === 'string' ? data.name : 'default';
  const type = typeof data.type === 'string' ? data.type : 'default';
  const botId = typeof data.botId === 'string' ? data.botId : null;

  let target: Queue;
  try {
    target = platform === 'webhook' ? getWebhookQueue() : getQueue(platform);
  } catch {
    return { ok: false, reason: 'Target queue not found' };
  }

  const payload =
    data.payload && typeof data.payload === 'object'
      ? { ...(data.payload as Record<string, unknown>), botId }
      : { botId };
  await target.add(
    targetName,
    {
      id: botId ? `${botId}-${Date.now()}` : `replay-${Date.now()}`,
      type,
      botId,
      data: payload,
    },
    {
      jobId: `replay-${platform}-${jobId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  );
  await dlq.remove(jobId).catch(() => undefined);
  return { ok: true };
}

/** Replays every dead-lettered job on every platform DLQ. */
export async function replayAllDeadLetterJobs(): Promise<{ replayed: number; failed: number }> {
  let replayed = 0;
  let failed = 0;
  for (const platform of Object.keys(DLQ_NAMES)) {
    const jobs = await getDlq(platform).getJobs([], 0, 500);
    for (const job of jobs) {
      if (!job.id) continue;
      const result = await replayDeadLetterJob(platform, job.id);
      if (result.ok) replayed += 1;
      else failed += 1;
    }
  }
  return { replayed, failed };
}

/**
 * Enqueues a stored-event replay for a platform worker. The worker's
 * `case 'event'` re-emits the envelope with `replay: true`, so scripts,
 * webhooks and AI re-run exactly as on the original emission.
 */
export async function enqueueEventReplay(
  platform: string,
  botId: string,
  event: {
    botId: string;
    platform: string;
    type: string;
    v: number;
    eventId: string;
    payload: Record<string, unknown>;
    timestamp: Date | string;
    raw?: unknown;
  },
): Promise<Job> {
  const queue = getQueue(platform);
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return queue.add(
    'event',
    {
      id: `replay-${event.eventId}-${nonce}`,
      type: 'event',
      botId,
      data: { event },
    },
    {
      jobId: `event-replay-${event.eventId}-${nonce}`,
      // Retry across leadership transitions: a replay enqueued while no worker
      // holds the platform lease is rejected once ("not the leader, requeue"),
      // and a couple of retries ride out the takeover window.
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  );
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
