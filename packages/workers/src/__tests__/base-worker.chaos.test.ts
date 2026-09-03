import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { BaseWorker, mapLimit } from '../base-worker.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

class TestWorker extends BaseWorker {
  readonly platformName = 'test';
  readonly connects: string[] = [];
  readonly disconnects: string[] = [];

  constructor() {
    super('bothive-test', process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    this.connects.push(String(credentials.botId));
  }

  async disconnect(botId: string): Promise<void> {
    this.disconnects.push(botId);
  }

  async executeAction(
    _botId: string,
    _action: { type: string; payload: object },
  ): Promise<unknown> {
    return undefined;
  }

  protected hasLiveConnection(_botId: string): boolean {
    return false;
  }
}

/** Simulates a platform outage: every connect attempt throws. */
class FailingWorker extends TestWorker {
  async connect(credentials: Record<string, unknown>): Promise<void> {
    this.connects.push(String(credentials.botId));
    throw new Error('provider down');
  }
}

interface WorkerState {
  bots: Map<string, { status: string; reconnectAttempts: number }>;
  reconnectTimers: Map<string, NodeJS.Timeout>;
  scheduleReconnect(botId: string, credentials: Record<string, unknown>): Promise<void>;
  publishHealthScores(): Promise<void>;
  ensureBot(botId: string): {
    status: string;
    reconnectAttempts: number;
    actionsSuccess: number;
    actionsFailed: number;
    scriptExecutions: number;
  };
}

const instances: TestWorker[] = [];

function invoke<T>(worker: TestWorker, method: string, ...args: unknown[]): T {
  return (worker as unknown as Record<string, (...a: unknown[]) => T>)[method].call(
    worker,
    ...args,
  );
}

async function redisClient() {
  const { Redis } = await import('ioredis');
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
}

function makeWorker(): TestWorker;
function makeWorker<T extends TestWorker>(cls: new () => T): T;
function makeWorker<T extends TestWorker>(cls?: new () => T): T | TestWorker {
  const w = cls ? new cls() : new TestWorker();
  instances.push(w);
  return w;
}

beforeEach(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const redis = await redisClient();
  for (const pattern of ['bothive:leader:*', 'bothive:outbound:*', 'bothive:health:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
  const { prisma } = await import('../prisma.js');
  await prisma.bot.deleteMany({ where: { id: { in: ['b1'] } } });
  await prisma.account.deleteMany({ where: { id: { in: ['a1'] } } });
  await prisma.bot.deleteMany({ where: { platform: 'test' } });
  await prisma.account.deleteMany({ where: { platform: 'test' } });
  await ensureTestUser();
  await prisma.account.upsert({
    where: { id: 'a1' },
    update: { token: 'tok' },
    create: {
      id: 'a1',
      name: 'chaos account',
      platform: 'test',
      token: 'tok',
      ownerId: TEST_OWNER_ID,
    },
  });
  await prisma.bot.upsert({
    where: { id: 'b1' },
    update: { status: 'running' },
    create: {
      id: 'b1',
      name: 'chaos bot',
      platform: 'test',
      status: 'running',
      accountId: 'a1',
      config: {},
      ownerId: TEST_OWNER_ID,
    },
  });
});

afterEach(async () => {
  for (const w of instances) {
    const state = w as unknown as {
      worker: { close(): Promise<void> };
      queue: { close(): Promise<void> };
      reconnectTimers: Map<string, NodeJS.Timeout>;
      leaderTimer?: NodeJS.Timeout;
      reconcileTimer?: NodeJS.Timeout;
    };
    if (state.leaderTimer) clearInterval(state.leaderTimer);
    if (state.reconcileTimer) clearInterval(state.reconcileTimer);
    for (const timer of state.reconnectTimers.values()) clearTimeout(timer);
    state.reconnectTimers.clear();
    await state.worker.close().catch(() => {});
    await state.queue.close().catch(() => {});
  }
  instances.length = 0;
  const redis = await redisClient();
  for (const pattern of ['bothive:leader:*', 'bothive:outbound:*', 'bothive:health:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
  vi.restoreAllMocks();
});

describe('mapLimit (chaos: bounded concurrency)', () => {
  it('never exceeds the concurrency limit and processes every item', async () => {
    const inFlight = new Set<number>();
    let maxInFlight = 0;

    const results = await mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 3, async (i) => {
      inFlight.add(i);
      maxInFlight = Math.max(maxInFlight, inFlight.size);
      await new Promise((r) => setTimeout(r, 5));
      inFlight.delete(i);
      return i * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBe(3);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(inFlight.size).toBe(0);
  });

  it('handles a burst larger than the concurrency limit without deadlock', async () => {
    let active = 0;
    let maxActive = 0;
    await mapLimit(
      Array.from({ length: 50 }, (_, i) => i),
      5,
      async (i) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 2));
        active -= 1;
        return i;
      },
    );
    expect(maxActive).toBe(5);
  });
});

describe('BaseWorker reconnect resilience (chaos: platform outage)', () => {
  it('marks a bot disconnected and schedules exactly one reconnect after a failed auto-start', async () => {
    const w = makeWorker(FailingWorker);
    const state = w as unknown as WorkerState;

    await w.autoStartBots();
    expect(w.connects).toEqual(['b1']);
    expect(state.bots.get('b1')?.status).toBe('error');
    expect(state.bots.get('b1')?.reconnectAttempts).toBe(1);
    expect(state.reconnectTimers.has('b1')).toBe(true);

    // A pending reconnect timer prevents a duplicate connect on the next cycle.
    await w.autoStartBots();
    expect(w.connects).toEqual(['b1']);
  });

  it('grows the reconnect attempt counter across consecutive failures', async () => {
    vi.useFakeTimers();
    try {
      const w = makeWorker();
      const state = w as unknown as WorkerState;
      state.bots.set('b1', { status: 'error', reconnectAttempts: 0 });

      for (let i = 0; i < 4; i++) {
        await state.scheduleReconnect('b1', { botId: 'b1' });
      }
      expect(state.bots.get('b1')?.reconnectAttempts).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the maximum reconnect attempts and marks the bot in error', async () => {
    vi.useFakeTimers();
    try {
      const w = makeWorker();
      const state = w as unknown as WorkerState;
      state.bots.set('b1', { status: 'error', reconnectAttempts: 0 });

      // MAX_RECONNECT_ATTEMPTS = 10, plus one call that trips the give-up branch.
      for (let i = 0; i <= 10; i++) {
        await state.scheduleReconnect('b1', { botId: 'b1' });
      }

      expect(state.bots.get('b1')?.status).toBe('error');
      expect(state.bots.get('b1')?.reconnectAttempts).toBe(0);
      expect(state.reconnectTimers.has('b1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BaseWorker health publication (chaos: metric visibility)', () => {
  it('publishes action counters and score to the Redis health key', async () => {
    const w = makeWorker();
    const state = w as unknown as WorkerState;

    await w.executeRateLimited('b1', { type: 'sendMessage', payload: {} });
    await w.executeRateLimited('b1', { type: 'sendMessage', payload: {} });

    const spy = vi.spyOn(w, 'executeAction').mockRejectedValue(new Error('boom'));
    await expect(w.executeRateLimited('b1', { type: 'sendMessage', payload: {} })).rejects.toThrow(
      'boom',
    );
    spy.mockRestore();

    await state.publishHealthScores();

    const redis = await redisClient();
    const raw = await redis.get('bothive:health:b1');
    await redis.quit();
    expect(raw).toBeDefined();
    const payload = JSON.parse(raw as string);
    expect(payload.actionsSuccess).toBe(2);
    expect(payload.actionsFailed).toBe(1);
    expect(payload.score).toBeLessThan(100);
    expect(typeof payload.updatedAt).toBe('string');
  });

  it('counts script executions for metrics', async () => {
    const w = makeWorker();
    const state = w as unknown as WorkerState;
    w.recordScriptExecution('b1');
    w.recordScriptExecution('b1');
    await state.publishHealthScores();

    const redis = await redisClient();
    const raw = await redis.get('bothive:health:b1');
    await redis.quit();
    const payload = JSON.parse(raw as string);
    expect(payload.scriptExecutions).toBe(2);
  });
});
