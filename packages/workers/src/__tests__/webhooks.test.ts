import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { dispatchWebhooks } from '../webhooks.js';

const fetchMock = vi.fn();

function fakePrisma(records: Record<string, unknown>[]) {
  return {
    webhook: {
      findMany: vi.fn().mockResolvedValue(records),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe('dispatchWebhooks', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a successful delivery', async () => {
    const prisma = fakePrisma([{ id: 'w1', url: 'https://x.test/hook', secret: null, botId: null, events: ['message'] }]);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await dispatchWebhooks(prisma, { botId: 'b1', platform: 'twitch', type: 'message', payload: { text: 'hi' }, timestamp: new Date() });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: expect.objectContaining({ lastStatus: 'ok', lastError: null, lastDeliveredAt: expect.any(Date), deliveryCount: { increment: 1 } }),
    });
  });

  it('retries then records a failed delivery after all attempts are exhausted', async () => {
    const prisma = fakePrisma([{ id: 'w1', url: 'https://x.test/hook', secret: null, botId: null, events: ['message'] }]);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await dispatchWebhooks(prisma, { botId: 'b1', platform: 'twitch', type: 'message', payload: {}, timestamp: new Date() }, { retryDelaysMs: [0, 0] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: expect.objectContaining({ lastStatus: 'failed', lastError: expect.stringContaining('500'), lastDeliveredAt: expect.any(Date) }),
    });
  });

  it('recovers after transient failures and records a success', async () => {
    const prisma = fakePrisma([{ id: 'w1', url: 'https://x.test/hook', secret: null, botId: null, events: ['message'] }]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await dispatchWebhooks(prisma, { botId: 'b1', platform: 'twitch', type: 'message', payload: {}, timestamp: new Date() }, { retryDelaysMs: [0, 0] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(prisma.webhook.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: expect.objectContaining({ lastStatus: 'ok', lastError: null, lastDeliveredAt: expect.any(Date), deliveryCount: { increment: 1 } }),
    });
  });

  it('does not deliver to webhooks that do not match the event type or bot', async () => {
    const prisma = fakePrisma([
      { id: 'w1', url: 'https://x.test/hook', secret: null, botId: 'b2', events: ['message'] },
      { id: 'w2', url: 'https://x.test/hook', secret: null, botId: null, events: ['follow'] },
    ]);

    await dispatchWebhooks(prisma, { botId: 'b1', platform: 'twitch', type: 'message', payload: {}, timestamp: new Date() });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.webhook.update).not.toHaveBeenCalled();
  });
});
