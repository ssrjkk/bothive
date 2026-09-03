import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { enqueueLog, flushLogs } from '../log-batcher.js';
import { prisma } from '../prisma.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

function row(message: string) {
  return {
    botId: 'b1',
    level: 'info',
    message,
    meta: {},
    createdAt: new Date(),
  };
}

describe('log-batcher', () => {
  const createManySpy = vi.spyOn(prisma.log, 'createMany');

  beforeEach(async () => {
    await flushLogs();
    createManySpy.mockClear();
    await prisma.log.deleteMany();
    await prisma.bot.deleteMany();
    await prisma.account.deleteMany();
    await ensureTestUser();
    await prisma.account.create({
      data: {
        id: 'acc1',
        name: 'Test Account',
        platform: 'telegram',
        token: 'test-token',
        ownerId: TEST_OWNER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.bot.create({
      data: {
        id: 'b1',
        name: 'Test Bot',
        platform: 'telegram',
        accountId: 'acc1',
        status: 'idle',
        config: {},
        ownerId: TEST_OWNER_ID,
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches multiple rows into a single createMany', async () => {
    enqueueLog(row('a'));
    enqueueLog(row('b'));
    await flushLogs();

    expect(createManySpy).toHaveBeenCalledTimes(1);
    const count = await prisma.log.count();
    expect(count).toBe(2);
  });

  it('flushes nothing when the buffer is empty', async () => {
    await flushLogs();
    expect(createManySpy).not.toHaveBeenCalled();
  });

  it('drops the oldest rows beyond the buffer cap', async () => {
    for (let i = 0; i < 2100; i++) enqueueLog(row(`m${i}`));
    await flushLogs();

    expect(createManySpy).toHaveBeenCalledTimes(1);
    const count = await prisma.log.count();
    expect(count).toBe(2000);
    const messages = (await prisma.log.findMany({ select: { message: true } })).map(
      (r) => r.message,
    );
    // The buffer keeps the 2000 newest rows (m100..m2099); the DB applies a
    // single `now()` to the whole createMany, so createdAt is identical across
    // rows and cannot be used as a stable sort key here.
    expect(new Set(messages)).toEqual(
      new Set(Array.from({ length: 2000 }, (_, i) => `m${i + 100}`)),
    );
    expect(messages).toHaveLength(2000);
  });

  it('flushes rows enqueued while a flush is in flight', async () => {
    const realImpl =
      createManySpy.getMockImplementation() ?? prisma.log.createMany.bind(prisma.log);
    let resolveCreate!: () => void;
    createManySpy.mockImplementationOnce(
      ((...args: unknown[]) =>
        new Promise<{ count: number }>((resolve) => {
          resolveCreate = () => {
            (realImpl as (...a: unknown[]) => Promise<{ count: number }>)(...args).then(resolve);
          };
        })) as never,
    );

    enqueueLog(row('first'));
    const first = flushLogs();
    enqueueLog(row('second'));
    resolveCreate();
    await first;
    await flushLogs();

    const messages = (await prisma.log.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (r) => r.message,
    );
    expect(messages).toContain('first');
    expect(messages).toContain('second');
  });
});
