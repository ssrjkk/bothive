import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { PrismaClient } from '../../../api/prisma/generated/prisma/client.js';
import { encryptCredential } from '@bothive/core';
import { deliverWebhookJob, dispatchWebhooks } from '../webhooks.js';

const fetchMock = vi.fn();

function fakePrisma(records: Record<string, unknown>[]) {
  return {
    webhook: {
      findMany: vi.fn().mockResolvedValue(records),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('deliverWebhookJob', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a successful delivery', async () => {
    const prisma = fakePrisma([]);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await deliverWebhookJob(
      { webhookId: 'w1', url: 'https://x.test/hook', secret: null, body: '{}' },
      prisma,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: expect.objectContaining({
        lastStatus: 'ok',
        lastError: null,
        lastDeliveredAt: expect.any(Date),
        deliveryCount: { increment: 1 },
      }),
    });
  });

  it('records a failed delivery and rethrows so BullMQ retries', async () => {
    const prisma = fakePrisma([]);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      deliverWebhookJob(
        { webhookId: 'w1', url: 'https://x.test/hook', secret: null, body: '{}' },
        prisma,
      ),
    ).rejects.toThrow('500');

    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: expect.objectContaining({
        lastStatus: 'failed',
        lastError: expect.stringContaining('500'),
        lastDeliveredAt: expect.any(Date),
      }),
    });
  });

  it('still rethrows when bookkeeping fails (webhook deleted mid-retry)', async () => {
    const prisma = {
      webhook: { update: vi.fn().mockRejectedValue(new Error('record not found')) },
    } as unknown as PrismaClient;
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      deliverWebhookJob(
        { webhookId: 'gone', url: 'https://x.test/hook', secret: null, body: '{}' },
        prisma,
      ),
    ).rejects.toThrow('500');
  });

  it('decrypts enc-prefixed secrets before signing', async () => {
    process.env.ENCRYPTION_KEY = 'test-webhook-enc-key';
    try {
      const encrypted = encryptCredential('super-secret');
      expect(encrypted).toMatch(/^enc:/);

      const prisma = fakePrisma([]);
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const body = JSON.stringify({ type: 'message', botId: 'b1' });
      await deliverWebhookJob(
        { webhookId: 'w1', url: 'https://x.test/hook', secret: encrypted, body },
        prisma,
      );

      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['x-bothive-signature']).toBe(
        `sha256=${createHmac('sha256', 'super-secret').update(body).digest('hex')}`,
      );
    } finally {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  it('signs with a legacy plaintext secret unchanged', async () => {
    const prisma = fakePrisma([]);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const body = JSON.stringify({ type: 'message', botId: 'b1' });
    await deliverWebhookJob(
      { webhookId: 'w1', url: 'https://x.test/hook', secret: 'legacy-secret', body },
      prisma,
    );

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-bothive-signature']).toBe(
      `sha256=${createHmac('sha256', 'legacy-secret').update(body).digest('hex')}`,
    );
  });
});

describe('dispatchWebhooks', () => {
  it('queries only enabled webhooks matching the bot (or all bots) and the event type', async () => {
    const prisma = fakePrisma([]);

    await dispatchWebhooks(prisma, {
      botId: 'b1',
      platform: 'twitch',
      type: 'message',
      payload: {},
      timestamp: new Date(),
    });

    expect(prisma.webhook.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        OR: [{ botId: 'b1' }, { botId: null }],
        events: { has: 'message' },
      },
    });
  });
});
