import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../prisma.js', () => ({
  prisma: {
    log: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));

import { enqueueLog, flushLogs } from '../log-batcher.js';
import { prisma } from '../prisma.js';

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
  beforeEach(async () => {
    await flushLogs();
    vi.mocked(prisma.log.createMany).mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches multiple rows into a single createMany', async () => {
    enqueueLog(row('a'));
    enqueueLog(row('b'));
    await flushLogs();

    const calls = vi.mocked(prisma.log.createMany).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].data).toHaveLength(2);
  });

  it('flushes nothing when the buffer is empty', async () => {
    await flushLogs();
    expect(vi.mocked(prisma.log.createMany)).not.toHaveBeenCalled();
  });

  it('drops the oldest rows beyond the buffer cap', async () => {
    for (let i = 0; i < 2100; i++) enqueueLog(row(`m${i}`));
    await flushLogs();

    const calls = vi.mocked(prisma.log.createMany).mock.calls;
    expect(calls).toHaveLength(1);
    const rows = calls[0][0].data as Array<{ message: string }>;
    expect(rows).toHaveLength(2000);
    expect(rows[0].message).toBe('m100');
    expect(rows[1999].message).toBe('m2099');
  });

  it('flushes rows enqueued while a flush is in flight', async () => {
    let resolveCreate!: () => void;
    vi.mocked(prisma.log.createMany).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    enqueueLog(row('first'));
    const first = flushLogs();
    enqueueLog(row('second'));
    resolveCreate();
    await first;
    await flushLogs();

    const calls = vi.mocked(prisma.log.createMany).mock.calls;
    expect(calls).toHaveLength(2);
    expect((calls[0][0].data as Array<{ message: string }>).map((r) => r.message)).toEqual([
      'first',
    ]);
    expect((calls[1][0].data as Array<{ message: string }>).map((r) => r.message)).toEqual([
      'second',
    ]);
  });
});
