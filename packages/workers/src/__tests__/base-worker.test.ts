import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { BaseWorker } from '../base-worker.js';

// Shared in-memory "Redis" state so the leader-lease and rate-limit behavior is
// observable from the tests.
const redisMock = vi.hoisted(() => ({
  state: {
    leaderKey: 'bothive:leader:test',
    holder: null as string | null,
    outbound: new Map<string, number>(),
  },
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'ready';
    constructor(_url: string, _opts?: unknown) {}
    async connect(): Promise<void> {}
    async set(key: string, value: string, ...rest: unknown[]): Promise<string | null> {
      // SET ... NX fails while another instance holds the lease.
      if (
        rest.includes('NX') &&
        redisMock.state.holder !== null &&
        redisMock.state.holder !== undefined
      ) {
        return null;
      }
      redisMock.state.holder = value;
      return 'OK';
    }
    async get(key: string): Promise<string | null> {
      return key === redisMock.state.leaderKey ? redisMock.state.holder : null;
    }
    async pexpire(_key: string, _ms: number): Promise<number> {
      return 1;
    }
    async del(_key: string): Promise<number> {
      redisMock.state.holder = null;
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
    processor: (job: unknown) => unknown;
    opts = { concurrency: 1 };
    pauseCalls = 0;
    resumeCalls = 0;
    handlers: Record<string, (job: unknown, ...args: unknown[]) => unknown> = {};
    constructor(
      _queue: string,
      processor: (job: unknown) => unknown,
      _opts?: { concurrency?: number },
    ) {
      this.processor = processor;
    }
    on(event: string, cb: (job: unknown, ...args: unknown[]) => unknown) {
      this.handlers[event] = cb;
      return this;
    }
    async waitUntilReady(): Promise<void> {}
    async pause(): Promise<void> {
      this.pauseCalls += 1;
    }
    async resume(): Promise<void> {
      this.resumeCalls += 1;
    }
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
      findUnique: vi.fn().mockResolvedValue(null),
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
  readonly actions: { botId: string; action: { type: string; payload: object } }[] = [];
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

  async executeAction(botId: string, action: { type: string; payload: object }): Promise<unknown> {
    this.actions.push({ botId, action });
    return undefined;
  }

  protected hasLiveConnection(): boolean {
    return false;
  }
}

const instances: TestWorker[] = [];

function makeWorker(): TestWorker {
  const w = new TestWorker();
  instances.push(w);
  return w;
}

afterEach(async () => {
  for (const w of instances) await w.stopLeadership().catch(() => {});
  instances.length = 0;
  redisMock.state.holder = null;
  redisMock.state.outbound.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Reconnect backoff is jittered ±25%; pin the midpoint so delays are exact.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

const OUTBOUND_BUDGET = Number(process.env.OUTBOUND_MAX_PER_WINDOW ?? 30);

describe('BaseWorker outbound rate limiting', () => {
  it('allows within-budget actions and forwards them to executeAction', async () => {
    const w = makeWorker();
    await w.executeRateLimited('b1', { type: 'sendMessage', payload: { chatId: 1, text: 'x' } });
    expect(w.actions).toEqual([
      { botId: 'b1', action: { type: 'sendMessage', payload: { chatId: 1, text: 'x' } } },
    ]);
  });

  it('blocks over-budget actions without executing them', async () => {
    const w = makeWorker();
    for (let i = 0; i < OUTBOUND_BUDGET; i++) {
      await w.executeRateLimited('b1', { type: 'sendMessage', payload: {} });
    }
    expect(w.actions).toHaveLength(OUTBOUND_BUDGET);

    await expect(w.executeRateLimited('b1', { type: 'sendMessage', payload: {} })).rejects.toThrow(
      /rate limit/i,
    );
    expect(w.actions).toHaveLength(OUTBOUND_BUDGET);
  });

  it('never throttles exempt housekeeping actions', async () => {
    const w = makeWorker();
    for (let i = 0; i < 40; i++) {
      await w.executeRateLimited('b1', {
        type: 'deleteMessage',
        payload: { chatId: 1, messageId: i },
      });
    }
    expect(w.actions).toHaveLength(40);
  });

  it('enforces a per-bot rateLimitPerMinute budget when configured', async () => {
    const w = makeWorker();
    const state = w as unknown as {
      bots: Map<string, { status: string; reconnectAttempts: number; rateLimitPerMinute: number }>;
    };
    state.bots.set('b1', { status: 'running', reconnectAttempts: 0, rateLimitPerMinute: 2 });

    await w.executeRateLimited('b1', { type: 'sendMessage', payload: {} });
    await w.executeRateLimited('b1', { type: 'sendMessage', payload: {} });
    expect(w.actions).toHaveLength(2);

    await expect(w.executeRateLimited('b1', { type: 'sendMessage', payload: {} })).rejects.toThrow(
      /rate limit/i,
    );
    expect(w.actions).toHaveLength(2);
  });
});

describe('BaseWorker leader election', () => {
  it('acquires leadership, resumes the worker and renews the lease', async () => {
    const a = makeWorker();
    await a.start();
    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);
    expect(
      (a as unknown as { worker: { resumeCalls: number } }).worker.resumeCalls,
    ).toBeGreaterThanOrEqual(1);

    // Renewal path: while still owning the lease, another check stays leader.
    await (a as unknown as { ensureLeadershipState(): Promise<void> }).ensureLeadershipState();
    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);
  });

  it('keeps a second instance paused (no duplicate connections)', async () => {
    const a = makeWorker();
    const b = makeWorker();
    await a.start();
    await b.start();

    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);
    expect((b as unknown as { isLeader: boolean }).isLeader).toBe(false);
    expect((b as unknown as { worker: { resumeCalls: number } }).worker.resumeCalls).toBe(0);
    expect(a.connects).toHaveLength(0);
  });

  it('transfers leadership when the leader releases the lease', async () => {
    const a = makeWorker();
    const b = makeWorker();
    await a.start();
    await b.start();
    expect((b as unknown as { isLeader: boolean }).isLeader).toBe(false);

    await a.stopLeadership();
    await (b as unknown as { ensureLeadershipState(): Promise<void> }).ensureLeadershipState();

    expect((b as unknown as { isLeader: boolean }).isLeader).toBe(true);
    expect(
      (b as unknown as { worker: { resumeCalls: number } }).worker.resumeCalls,
    ).toBeGreaterThanOrEqual(1);
  });

  it('steps down when the lease is taken by another instance', async () => {
    const a = makeWorker();
    await a.start();
    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);

    // Another process took the lease.
    redisMock.state.holder = 'other-instance';
    await (a as unknown as { ensureLeadershipState(): Promise<void> }).ensureLeadershipState();

    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(false);
  });
});

describe('BaseWorker processJob leadership guard', () => {
  it('executes a rate-limited execute job when leader', async () => {
    const a = makeWorker();
    await a.start();

    const processor = (
      a as unknown as { worker: { processor: (job: unknown) => Promise<unknown> } }
    ).worker.processor;
    await processor({
      id: 'j1',
      data: {
        type: 'execute',
        botId: 'b1',
        data: { type: 'sendMessage', payload: { chatId: 1, text: 'hi' } },
      },
    });

    expect(a.actions).toEqual([
      { botId: 'b1', action: { type: 'sendMessage', payload: { chatId: 1, text: 'hi' } } },
    ]);
  });

  it('rejects jobs on a non-leader so they are requeued, never double-executed', async () => {
    const a = makeWorker();
    const b = makeWorker();
    await a.start();
    await b.start();

    const processor = (
      b as unknown as { worker: { processor: (job: unknown) => Promise<unknown> } }
    ).worker.processor;
    await expect(
      processor({ id: 'j1', data: { type: 'connect', botId: 'b1', data: {} } }),
    ).rejects.toThrow(/leader/i);
    expect(a.connects).toHaveLength(0);
    expect(b.connects).toHaveLength(0);
  });
});

describe('BaseWorker connect job credentials', () => {
  class CapturingWorker extends TestWorker {
    readonly credentialSets: Record<string, unknown>[] = [];
    async connect(credentials: Record<string, unknown>): Promise<void> {
      this.credentialSets.push(credentials);
    }
  }

  it('builds decrypted credentials from the bot row and sanitizes the crypto config', async () => {
    const { prisma } = await import('../prisma.js');
    vi.mocked(prisma.bot.findUnique).mockResolvedValue({
      id: 'b1',
      platform: 'crypto',
      status: 'running',
      config: {
        crypto: {
          symbols: ['BTCUSDT'],
          wallet: { address: `0x${'a'.repeat(40)}`, privateKey: 'enc:pk' },
        },
      },
      account: {
        token: 'enc:token',
        apiKey: 'enc:key',
        apiSecret: 'enc:secret',
        apiKeys: [{ apiKey: 'enc:key2', apiSecret: 'enc:secret2' }],
        clientId: null,
        secret: null,
        refreshToken: null,
      },
    } as never);

    const w = new CapturingWorker();
    instances.push(w);
    await w.start();
    const processor = (
      w as unknown as { worker: { processor: (job: unknown) => Promise<unknown> } }
    ).worker.processor;
    await processor({ id: 'j1', data: { type: 'connect', botId: 'b1', data: {} } });

    expect(w.credentialSets).toHaveLength(1);
    const credentials = w.credentialSets[0];
    expect(credentials.botId).toBe('b1');
    expect(credentials.token).toBe('enc:token');
    expect(credentials.apiKey).toBe('enc:key');
    expect(credentials.apiSecret).toBe('enc:secret');
    expect(credentials.apiKeys).toEqual([{ apiKey: 'enc:key2', apiSecret: 'enc:secret2' }]);
    const crypto = credentials.crypto as { wallet?: Record<string, unknown> };
    expect(crypto.wallet).toEqual({ address: `0x${'a'.repeat(40)}` });
    expect(JSON.stringify(crypto)).not.toContain('privateKey');
    expect(vi.mocked(prisma.bot.findUnique)).toHaveBeenCalledWith({
      where: { id: 'b1' },
      include: { account: true },
    });
  });

  it('schedules a reconnect when credentials cannot be resolved', async () => {
    const { prisma } = await import('../prisma.js');
    vi.mocked(prisma.bot.findUnique).mockResolvedValue(null);

    const w = makeWorker();
    await w.start();
    const processor = (
      w as unknown as { worker: { processor: (job: unknown) => Promise<unknown> } }
    ).worker.processor;
    await processor({ id: 'j1', data: { type: 'connect', botId: 'nope', data: {} } });

    expect(w.connects).toHaveLength(0);
    const state = w as unknown as {
      reconnectTimers: Map<string, NodeJS.Timeout>;
      bots: Map<string, { status: string; reconnectAttempts: number }>;
    };
    expect(state.reconnectTimers.has('nope')).toBe(true);
    expect(state.bots.get('nope')?.reconnectAttempts).toBe(1);
  });
});

describe('BaseWorker circuit breaker & adaptive backoff', () => {
  interface WorkerState {
    bots: Map<string, { status: string; reconnectAttempts: number }>;
    reconnectTimers: Map<string, NodeJS.Timeout>;
    circuitBreakers: Map<string, unknown>;
    getCircuitBreaker(botId: string): {
      getState(): string;
      recordFailure(): void;
      recordSuccess(): void;
    };
    getHealth(botId: string): { getScore(): number; getFailureRate(): number };
    scheduleReconnect(botId: string, credentials: Record<string, unknown>): Promise<void>;
  }

  /** Mirrors the real platform subclasses: a successful connect marks the bot connected. */
  class AutoMarkingWorker extends TestWorker {
    async connect(credentials: Record<string, unknown>): Promise<void> {
      this.connects.push(String(credentials.botId));
      await this.markConnected(String(credentials.botId));
    }
  }

  function makeMarkingWorker(): AutoMarkingWorker {
    const w = new AutoMarkingWorker();
    instances.push(w);
    return w;
  }

  it('opens the connection circuit after repeated reconnect failures', async () => {
    vi.useFakeTimers();
    try {
      const w = makeWorker();
      const state = w as unknown as WorkerState;
      state.bots.set('b1', { status: 'error', reconnectAttempts: 0 });

      for (let i = 0; i < 5; i++) {
        await state.scheduleReconnect('b1', { botId: 'b1' });
      }

      expect(state.getCircuitBreaker('b1').getState()).toBe('open');
      // a recovery probe is scheduled at the cooldown, not a fast backoff
      expect(state.reconnectTimers.has('b1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('probes once after the cooldown and closes the circuit on success', async () => {
    vi.useFakeTimers();
    try {
      const { prisma } = await import('../prisma.js');
      vi.mocked(prisma.bot.findUnique).mockResolvedValue({
        id: 'b1',
        platform: 'test',
        status: 'running',
        config: {},
        account: {
          token: null,
          clientId: null,
          secret: null,
          refreshToken: null,
          apiKey: null,
          apiSecret: null,
          apiKeys: null,
        },
      } as never);
      const w = makeMarkingWorker();
      const state = w as unknown as WorkerState;
      state.bots.set('b1', { status: 'error', reconnectAttempts: 0 });

      for (let i = 0; i < 5; i++) {
        await state.scheduleReconnect('b1', { botId: 'b1' });
      }
      expect(state.getCircuitBreaker('b1').getState()).toBe('open');
      expect(w.connects).toHaveLength(0);

      // cooldown elapses -> exactly one probe connect succeeds -> circuit closes
      await vi.advanceTimersByTimeAsync(61_000);

      expect(w.connects).toEqual(['b1']);
      expect(state.getCircuitBreaker('b1').getState()).toBe('closed');
      expect(state.reconnectTimers.has('b1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks successful and failed actions in the bot health score', async () => {
    const w = makeWorker();
    const state = w as unknown as WorkerState;
    const health = state.getHealth('b1');
    expect(health.getScore()).toBe(100);

    await w.executeRateLimited('b1', { type: 'sendMessage', payload: {} });
    expect(health.getScore()).toBe(100);

    const spy = vi.spyOn(w, 'executeAction').mockRejectedValue(new Error('platform down'));
    await expect(w.executeRateLimited('b1', { type: 'sendMessage', payload: {} })).rejects.toThrow(
      'platform down',
    );
    expect(health.getScore()).toBe(50);
    spy.mockRestore();
  });
});
