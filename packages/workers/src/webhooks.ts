import type { PrismaClient } from '../../api/prisma/generated/prisma/client.js';
import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { deliverWebhook, decryptCredential, redisConnectionOptions } from '@bothive/core';
import { prisma } from './prisma.js';

export interface WebhookDispatchEvent {
  botId: string;
  platform: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

interface WebhookJobData {
  webhookId: string;
  url: string;
  secret: string | null;
  body: string;
}

const WEBHOOK_QUEUE_NAME = 'webhook-queue';
const WEBHOOK_ATTEMPTS = 5;
const WEBHOOK_CONCURRENCY = 5;

let webhookConnection: Redis | undefined;
let webhookQueue: Queue | undefined;
let webhookWorker: Worker | undefined;

function getConnection(): Redis {
  if (!webhookConnection) {
    webhookConnection = new Redis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
      redisConnectionOptions(),
    );
  }
  return webhookConnection;
}

function getQueue(): Queue {
  if (!webhookQueue) {
    webhookQueue = new Queue(WEBHOOK_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: WEBHOOK_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return webhookQueue;
}

/**
 * Enqueues webhook delivery jobs for the event. The database query is targeted
 * (enabled + bot match + event type) instead of scanning every webhook, and each
 * delivery is a BullMQ job, so retries/backoff survive a worker crash.
 */
export async function dispatchWebhooks(
  prisma: PrismaClient,
  event: WebhookDispatchEvent,
): Promise<void> {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        enabled: true,
        OR: [{ botId: event.botId }, { botId: null }],
        events: { has: event.type },
      },
    });
    if (webhooks.length === 0) return;

    const body = JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() });
    const queue = getQueue();
    await Promise.all(
      webhooks.map((w) =>
        queue.add(
          'deliver',
          { webhookId: w.id, url: w.url, secret: w.secret ?? null, body } as WebhookJobData,
          { jobId: `webhook-${w.id}-${event.botId}-${event.type}-${event.timestamp.getTime()}` },
        ),
      ),
    );
  } catch (err) {
    console.error('[webhooks] dispatch enqueue failed:', err);
  }
}

/**
 * Delivers one webhook and records the outcome. Throws on failure so BullMQ
 * retries the job with exponential backoff; the `lastStatus: 'failed'` bookkeeping
 * happens before the throw so the dashboard reflects it even between retries.
 */
export async function deliverWebhookJob(
  data: WebhookJobData,
  db: PrismaClient = prisma,
): Promise<void> {
  const { webhookId, url, secret, body } = data;
  try {
    // Secrets are encrypted at rest (enc: prefix); legacy plaintext values are
    // passed through unchanged by decryptCredential.
    await deliverWebhook(url, decryptCredential(secret), body);
    await db.webhook.update({
      where: { id: webhookId },
      data: {
        lastStatus: 'ok',
        lastError: null,
        lastDeliveredAt: new Date(),
        deliveryCount: { increment: 1 },
      },
    });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    console.error(`[webhooks] delivery to ${url} failed:`, err);
    try {
      await db.webhook.update({
        where: { id: webhookId },
        data: { lastStatus: 'failed', lastError: message, lastDeliveredAt: new Date() },
      });
    } catch {
      // Webhook may have been deleted while retrying; bookkeeping is best-effort.
    }
    throw err;
  }
}

export function startWebhookWorker(): void {
  if (webhookWorker) return;
  webhookWorker = new Worker(
    WEBHOOK_QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      await deliverWebhookJob(job.data);
    },
    {
      connection: getConnection(),
      concurrency: WEBHOOK_CONCURRENCY,
    },
  );
  webhookWorker.on('completed', (job) => console.log(`[webhooks] Job ${job.id} completed`));
  webhookWorker.on('failed', (job, err) =>
    console.error(`[webhooks] Job ${job?.id} failed:`, err.message),
  );
}

export async function stopWebhookWorker(): Promise<void> {
  if (webhookWorker) {
    await webhookWorker.close();
    webhookWorker = undefined;
  }
  if (webhookQueue) {
    await webhookQueue.close();
    webhookQueue = undefined;
  }
  if (webhookConnection) {
    await webhookConnection.quit().catch(() => undefined);
    webhookConnection = undefined;
  }
}
