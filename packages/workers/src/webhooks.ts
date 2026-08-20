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
  eventType: string;
  botId: string | null;
}

const WEBHOOK_QUEUE_NAME = 'webhook-queue';
const WEBHOOK_ATTEMPTS = 5;
const WEBHOOK_CONCURRENCY = 5;
/** Delivery history rows older than this are pruned on each write. */
const DELIVERY_RETENTION_MS = 30 * 24 * 3600 * 1000;
/** How long a matched-webhook lookup is cached in this process. */
const WEBHOOK_MATCH_CACHE_TTL_MS = 5000;
/** Upper bound on cached (botId, eventType) lookup keys (FIFO eviction). */
const WEBHOOK_MATCH_CACHE_MAX = 1000;
/** The retention prune is at most once per webhook per hour, not per delivery. */
const PRUNE_INTERVAL_MS = 3600_000;

interface CachedWebhookMatch {
  expiresAt: number;
  webhooks: WebhookJobData[];
}

/**
 * Matched webhooks per (botId, eventType). Events are hot (a busy bot can emit
 * hundreds per minute) and most have no webhook configured; hitting Postgres on
 * every event is wasted I/O. A short TTL bounds staleness when a webhook is
 * created/updated/disabled to ~5s. Negative results are cached too.
 */
const webhookMatchCache = new Map<string, CachedWebhookMatch>();
const lastPruneByWebhook = new Map<string, number>();

function webhookMatchCacheKey(botId: string, eventType: string): string {
  return `${botId}\u0000${eventType}`;
}

function getCachedWebhookMatch(botId: string, eventType: string): CachedWebhookMatch | undefined {
  const entry = webhookMatchCache.get(webhookMatchCacheKey(botId, eventType));
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry;
}

function cacheWebhookMatch(botId: string, eventType: string, webhooks: WebhookJobData[]): void {
  if (webhookMatchCache.size >= WEBHOOK_MATCH_CACHE_MAX) {
    const oldest = webhookMatchCache.keys().next().value as string | undefined;
    if (oldest !== undefined) webhookMatchCache.delete(oldest);
  }
  webhookMatchCache.set(webhookMatchCacheKey(botId, eventType), {
    expiresAt: Date.now() + WEBHOOK_MATCH_CACHE_TTL_MS,
    webhooks,
  });
}

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
    let webhooks = getCachedWebhookMatch(event.botId, event.type)?.webhooks;
    if (webhooks === undefined) {
      const rows = await prisma.webhook.findMany({
        where: {
          enabled: true,
          OR: [{ botId: event.botId }, { botId: null }],
          events: { has: event.type },
        },
        select: { id: true, url: true, secret: true },
      });
      webhooks = rows.map((w) => ({
        webhookId: w.id,
        url: w.url,
        secret: w.secret ?? null,
        body: '',
        eventType: event.type,
        botId: event.botId,
      }));
      cacheWebhookMatch(event.botId, event.type, webhooks);
    }
    if (webhooks.length === 0) return;

    const body = JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() });
    const queue = getQueue();
    await Promise.all(
      webhooks.map((w) =>
        queue.add(
          'deliver',
          {
            webhookId: w.webhookId,
            url: w.url,
            secret: w.secret,
            body,
            eventType: event.type,
            botId: event.botId,
          } as WebhookJobData,
          {
            jobId: `webhook-${w.webhookId}-${event.botId}-${event.type}-${event.timestamp.getTime()}`,
          },
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
 * Every attempt (successful or not) appends a row to the delivery history.
 */
export async function deliverWebhookJob(
  data: WebhookJobData,
  db: PrismaClient = prisma,
  attempt = 1,
): Promise<void> {
  const { webhookId, url, secret, body } = data;
  const startedAt = Date.now();
  const recordHistory = async (
    status: 'ok' | 'failed',
    statusCode: number | null,
    error: string | null,
  ): Promise<void> => {
    try {
      await db.webhookDelivery.create({
        data: {
          webhookId,
          eventType: data.eventType ?? 'unknown',
          botId: data.botId ?? null,
          status,
          statusCode,
          attempt,
          error: error?.slice(0, 300) ?? null,
          latencyMs: Date.now() - startedAt,
        },
      });
      // Prune at most once per hour per webhook — running the retention delete
      // on every delivery would double the write load of a busy webhook for
      // rows that (mostly) already satisfy the window.
      const now = Date.now();
      if (now - (lastPruneByWebhook.get(webhookId) ?? 0) >= PRUNE_INTERVAL_MS) {
        lastPruneByWebhook.set(webhookId, now);
        await db.webhookDelivery.deleteMany({
          where: { webhookId, createdAt: { lt: new Date(now - DELIVERY_RETENTION_MS) } },
        });
      }
    } catch {
      // History is best-effort; a failed row must never break delivery.
    }
  };

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
    await recordHistory('ok', 200, null);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    const statusCode =
      typeof (err as Error & { status?: unknown })?.status === 'number'
        ? (err as Error & { status: number }).status
        : null;
    console.error(`[webhooks] delivery to ${url} failed:`, err);
    try {
      await db.webhook.update({
        where: { id: webhookId },
        data: { lastStatus: 'failed', lastError: message, lastDeliveredAt: new Date() },
      });
    } catch {
      // Webhook may have been deleted while retrying; bookkeeping is best-effort.
    }
    await recordHistory('failed', statusCode, message);
    throw err;
  }
}

export function startWebhookWorker(): void {
  if (webhookWorker) return;
  webhookWorker = new Worker(
    WEBHOOK_QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      await deliverWebhookJob(job.data, prisma, job.attemptsMade + 1);
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
