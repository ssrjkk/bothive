import type { PrismaClient } from '@prisma/client';
import { deliverWebhook } from '@bothive/core';

export interface WebhookDispatchEvent {
  botId: string;
  platform: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface DispatchOptions {
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 5000];

async function deliverWithRetry(url: string, secret: string | null, body: string, retryDelaysMs: number[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await deliverWebhook(url, secret, body);
      return;
    } catch (err) {
      if (attempt > retryDelaysMs.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt - 1]));
    }
  }
}

export async function dispatchWebhooks(prisma: PrismaClient, event: WebhookDispatchEvent, opts: DispatchOptions = {}): Promise<void> {
  const retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  try {
    const webhooks = await prisma.webhook.findMany({ where: { enabled: true } });
    const targets = webhooks.filter(
      (w) => (!w.botId || w.botId === event.botId) && (w.events as string[]).includes(event.type),
    );
    if (targets.length === 0) return;
    const body = JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() });
    await Promise.all(targets.map(async (w) => {
      try {
        await deliverWithRetry(w.url, w.secret ?? null, body, retryDelaysMs);
        await prisma.webhook.update({
          where: { id: w.id },
          data: { lastStatus: 'ok', lastError: null, lastDeliveredAt: new Date(), deliveryCount: { increment: 1 } },
        });
      } catch (err) {
        console.error(`[webhooks] delivery to ${w.url} failed:`, err);
        try {
          await prisma.webhook.update({
            where: { id: w.id },
            data: { lastStatus: 'failed', lastError: String((err as Error)?.message ?? err), lastDeliveredAt: new Date() },
          });
        } catch {
          // last error bookkeeping is best-effort
        }
      }
    }));
  } catch (err) {
    console.error('[webhooks] dispatch failed:', err);
  }
}
