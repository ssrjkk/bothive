import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { LookupAddress } from 'node:dns';
import { createHmac } from 'node:crypto';
import type { PrismaClient } from '../../../api/prisma/generated/prisma/client.js';
import { encryptCredential } from '@bothive/core';
import { deliverWebhookJob, dispatchWebhooks } from '../webhooks.js';

// The core webhook guard runs a hostname DNS check by default (SSRF defence).
// test hosts like `x.test` never resolve in CI, so stub the resolver to a
// public address; otherwise every delivery aborts with ENOTFOUND before fetch.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));
import { lookup } from 'node:dns/promises';

const fetchMock = vi.fn();

function fakePrisma(records: Record<string, unknown>[]) {
  return {
    webhook: {
      findMany: vi.fn().mockResolvedValue(records),
      update: vi.fn().mockResolvedValue({}),
    },
    webhookDelivery: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaClient;
}

describe('deliverWebhookJob', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    (
      vi.mocked(lookup) as unknown as Mock<
        (hostname: string, options: { all: true }) => Promise<LookupAddress[]>
      >
    ).mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a successful delivery', async () => {
    const prisma = fakePrisma([]);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await deliverWebhookJob(
      {
        webhookId: 'w1',
        url: 'https://x.test/hook',
        secret: null,
        body: '{}',
        eventType: 'message',
        botId: 'b1',
      },
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
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: 'w1',
        eventType: 'message',
        botId: 'b1',
        status: 'ok',
        statusCode: 200,
        attempt: 1,
        latencyMs: expect.any(Number),
      }),
    });
    expect(prisma.webhookDelivery.deleteMany).toHaveBeenCalledWith({
      where: { webhookId: 'w1', createdAt: { lt: expect.any(Date) } },
    });
  });

  it('records a failed delivery and rethrows so BullMQ retries', async () => {
    const prisma = fakePrisma([]);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      deliverWebhookJob(
        {
          webhookId: 'w1',
          url: 'https://x.test/hook',
          secret: null,
          body: '{}',
          eventType: 'message',
          botId: null,
        },
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
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'failed',
        statusCode: 500,
        error: expect.stringContaining('500'),
      }),
    });
  });

  it('records the retry attempt number for failed deliveries', async () => {
    const prisma = fakePrisma([]);
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(
      deliverWebhookJob(
        {
          webhookId: 'w1',
          url: 'https://x.test/hook',
          secret: null,
          body: '{}',
          eventType: 'message',
          botId: null,
        },
        prisma,
        3,
      ),
    ).rejects.toThrow('503');

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attempt: 3 }),
    });
  });

  it('still rethrows when bookkeeping fails (webhook deleted mid-retry)', async () => {
    const prisma = {
      webhook: { update: vi.fn().mockRejectedValue(new Error('record not found')) },
      webhookDelivery: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaClient;
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      deliverWebhookJob(
        {
          webhookId: 'gone',
          url: 'https://x.test/hook',
          secret: null,
          body: '{}',
          eventType: 'message',
          botId: null,
        },
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
        {
          webhookId: 'w1',
          url: 'https://x.test/hook',
          secret: encrypted,
          body,
          eventType: 'message',
          botId: 'b1',
        },
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
      {
        webhookId: 'w1',
        url: 'https://x.test/hook',
        secret: 'legacy-secret',
        body,
        eventType: 'message',
        botId: 'b1',
      },
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
      select: { id: true, url: true, secret: true },
    });
  });

  it('caches a negative webhook match so repeat events skip the query', async () => {
    const prisma = fakePrisma([]);
    const event = {
      botId: 'b-neg',
      platform: 'twitch',
      type: 'raid',
      payload: {},
      timestamp: new Date(),
    };

    await dispatchWebhooks(prisma, event);
    await dispatchWebhooks(prisma, event);
    expect(prisma.webhook.findMany).toHaveBeenCalledTimes(1);
  });
});
