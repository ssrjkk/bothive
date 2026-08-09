import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { BaseWorker, mapLimit } from '../base-worker.js';

// Shared in-memory "Redis" state recording every key written, so health
// payloads and the leader lease are observable from the tests.
const redisMock = vi.hoisted(() => ({
  state: {
    leaderKey: 'bothive:leader:test',
    holder: null as string | null,
    keys: new Map<string, string>(),
    outbound: new Map<string, number>(),
  },
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'ready';
    constructor(_url: string, _opts?: unknown) {}
    async connect(): Promise<void> {}
    async set(key: string, value: string, ...rest: unknown[]): Promise<string | null> {
      if (rest.includes('NX') && redisMock.state.holder !== null) return null;
      redisMock.state.keys.set(key, value);
      if (key === redisMock.state.leaderKey) redisMock.state.holder = value;
      return 'OK';
    }
    async get(key: string): Promise<string | null> {
      return redisMock.state.keys.get(key) ?? null;
    }
    async pexpire(_key: string, _ms: number): Promise<number> {
      return 1;
    }
    async del(key: string): Promise<number> {
      redisMock.state.keys.delete(key);
      if (key === redisMock.state.leaderKey) redisMock.state.holder = null;
      return 1;
    }
    async incr(key: string): Promise<number> {
      const next = (redisMock.state.outbound.get(key) ?? 0) + 1;
      redisMock.state.outbound.set(key, next);
      return next;
    }
    async disconnect(): Promise<void> {}
  }
  return { Redis: FakeRedis };
});

vi.mock('bullmq', () => {
  class FakeWorker {
    opts = { concurrency: 1 };
    constructor(_queue: string, _processor: (job: unknown) => unknown, _opts?: unknown) {}
    on() {
      return this;
    }
    async waitUntilReady(): Promise<void> {}
    async pause(): Promise<void> {}
    async resume(): Promise<void> {}
    async close(): Promise<void> {}
  }
  class FakeQueue {
    async close(): Promise<void> {}
    async add(): Promise<never> {
      throw new Error('not implemented');
    }
  }
  return { Worker: FakeWorker, Queue: FakeQueue, Job: class {} };
});

vi.mock('../prisma.js', () => ({
  prisma: {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    bot: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock('../log-publisher.js', () => ({ publishLog: vi.fn() }));
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
    super('bothive:test', 'redis://fake:6379');
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

  getStatus(): string {
    return 'running';
  }

  isConnected(): boolean {
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

function makeWorker(): TestWorker;
function makeWorker<T extends TestWorker>(cls: new () => T): T;
function makeWorker<T extends TestWorker>(cls?: new () => T): T | TestWorker {
  const w = cls ? new cls() : new TestWorker();
  instances.push(w);
  return w;
}

beforeEach(() => {
  redisMock.state.holder = null;
  redisMock.state.keys.clear();
  redisMock.state.outbound.clear();
});

afterEach(async () => {
  for (const w of instances) await w.stopLeadership().catch(() => {});
  instances.length = 0;
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
    const prisma = (await import('../prisma.js')).prisma;
    const w = makeWorker(FailingWorker);
    const state = w as unknown as WorkerState;

    vi.mocked(prisma.bot.findMany).mockResolvedValue([
      {
        id: 'b1',
        platform: 'test',
        status: 'running',
        config: {},
        account: { token: 'tok', clientId: null, secret: null, refreshToken: null, apiKey: null },
      },
    ] as never);

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

    const raw = redisMock.state.keys.get('bothive:health:b1');
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

    const payload = JSON.parse(redisMock.state.keys.get('bothive:health:b1') as string);
    expect(payload.scriptExecutions).toBe(2);
  });
});
