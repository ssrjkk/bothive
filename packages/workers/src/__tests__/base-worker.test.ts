import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Prisma } from '../../../api/prisma/generated/prisma/client.js';
import { BaseWorker } from '../base-worker.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

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
    super('bothive-test', process.env.REDIS_URL ?? 'redis://localhost:6379');
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

  protected hasLiveConnection(_botId: string): boolean {
    return false;
  }
}

const instances: TestWorker[] = [];

let flushKeys: (patterns: string[]) => Promise<void>;

function makeWorker(): TestWorker {
  const w = new TestWorker();
  instances.push(w);
  return w;
}

/** Accesses a private/protected method on a BaseWorker at runtime. */
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

beforeEach(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const redis = await redisClient();
  for (const pattern of ['bothive:leader:*', 'bothive:outbound:*', 'bothive:health:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
  flushKeys = async () => {};
  const { prisma } = await import('../prisma.js');
  await prisma.bot.deleteMany({ where: { id: { in: ['b1'] } } });
  await prisma.account.deleteMany({ where: { id: { in: ['acc1'] } } });
  await prisma.bot.deleteMany({ where: { platform: 'test' } });
  await prisma.account.deleteMany({ where: { platform: 'test' } });
  await ensureTestUser();
  await prisma.account.upsert({
    where: { id: 'acc1' },
    update: {},
    create: { id: 'acc1', name: 'Test', platform: 'test', token: 'tok', ownerId: TEST_OWNER_ID },
  });
  await prisma.bot.upsert({
    where: { id: 'b1' },
    update: { status: 'idle' },
    create: {
      id: 'b1',
      name: 'Bot',
      platform: 'test',
      accountId: 'acc1',
      status: 'idle',
      config: {},
      ownerId: TEST_OWNER_ID,
    },
  });
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
    const resumeSpy = vi.spyOn((a as any).worker, 'resume');
    await a.start();
    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);
    expect(resumeSpy).toHaveBeenCalled();

    await (a as unknown as { ensureLeadershipState(): Promise<void> }).ensureLeadershipState();
    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);
  });

  it('keeps a second instance paused (no duplicate connections)', async () => {
    const a = makeWorker();
    const b = makeWorker();
    const bResumeSpy = vi.spyOn((b as any).worker, 'resume');
    await a.start();
    await b.start();

    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);
    expect((b as unknown as { isLeader: boolean }).isLeader).toBe(false);
    expect(bResumeSpy).not.toHaveBeenCalled();
    expect(a.connects).toHaveLength(0);
  });

  it('transfers leadership when the leader releases the lease', async () => {
    const a = makeWorker();
    const b = makeWorker();
    const bResumeSpy = vi.spyOn((b as any).worker, 'resume');
    await a.start();
    await b.start();
    expect((b as unknown as { isLeader: boolean }).isLeader).toBe(false);

    const redis = await redisClient();
    await redis.del('bothive:leader:test');
    await redis.quit();
    await invoke<void>(b, 'ensureLeadershipState');

    expect((b as unknown as { isLeader: boolean }).isLeader).toBe(true);
    expect(bResumeSpy).toHaveBeenCalled();
  });

  it('steps down when the lease is taken by another instance', async () => {
    const a = makeWorker();
    await a.start();
    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(true);

    const redis = await redisClient();
    await redis.set('bothive:leader:test', 'other-instance', 'PX', 30_000);
    await redis.quit();

    await invoke<void>(a, 'ensureLeadershipState');
    expect((a as unknown as { isLeader: boolean }).isLeader).toBe(false);
  });
});

describe('BaseWorker processJob leadership guard', () => {
  it('executes a rate-limited execute job when leader', async () => {
    const a = makeWorker();
    await a.start();

    await invoke(a, 'processJob', {
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

    await expect(
      invoke(b, 'processJob', {
        id: 'j1',
        data: { type: 'connect', botId: 'b1', data: {} },
      }),
    ).rejects.toThrow(/leader/i);
    expect(a.connects).toHaveLength(0);
    expect(b.connects).toHaveLength(0);
  });
});

describe('BaseWorker lifecycle intent guards', () => {
  class LiveWorker extends TestWorker {
    readonly live = new Set<string>();
    protected hasLiveConnection(botId: string): boolean {
      return this.live.has(botId);
    }
  }

  function processJob(w: TestWorker, data: unknown): Promise<unknown> {
    return invoke(w, 'processJob', { id: 'j1', data });
  }

  it('skips a stale disconnect when the bot should be running again', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.bot.update({ where: { id: 'b1' }, data: { status: 'running' } });

    const w = makeWorker();
    await w.start();
    await processJob(w, { type: 'disconnect', botId: 'b1', data: {} });

    expect(w.disconnects).toHaveLength(0);
  });

  it('skips a stale disconnect while a restart or reconnect is in flight', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.bot.update({ where: { id: 'b1' }, data: { status: 'reconnecting' } });

    const w = makeWorker();
    await w.start();
    await processJob(w, { type: 'disconnect', botId: 'b1', data: {} });

    expect(w.disconnects).toHaveLength(0);
  });

  it('executes a disconnect when the bot is stopped in the DB', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.bot.update({ where: { id: 'b1' }, data: { status: 'idle' } });

    const w = makeWorker();
    await w.start();
    await processJob(w, { type: 'disconnect', botId: 'b1', data: {} });

    expect(w.disconnects).toEqual(['b1']);
  });

  it('executes a disconnect when the bot row no longer exists', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.bot.delete({ where: { id: 'b1' } });

    const w = makeWorker();
    await w.start();
    await processJob(w, { type: 'disconnect', botId: 'b1', data: {} });

    expect(w.disconnects).toEqual(['b1']);
  });

  it('skips a stale connect when the bot was stopped in the meantime', async () => {
    const w = makeWorker();
    await w.start();
    await processJob(w, { type: 'connect', botId: 'b1', data: {} });

    expect(w.connects).toHaveLength(0);
  });

  it('lets a restart connect replace a live connection and clears the pending reconnect timer', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.bot.update({ where: { id: 'b1' }, data: { status: 'reconnecting' } });
    await prisma.account.update({
      where: { id: 'acc1' },
      data: {
        token: 'tok',
        clientId: null,
        secret: null,
        refreshToken: null,
        apiKey: null,
        apiSecret: null,
        apiKeys: Prisma.JsonNull,
      },
    });

    const w = new LiveWorker();
    instances.push(w);
    w.live.add('b1');
    await w.start();

    const state = w as unknown as { reconnectTimers: Map<string, NodeJS.Timeout> };
    state.reconnectTimers.set(
      'b1',
      setTimeout(() => {}, 60_000),
    );

    await processJob(w, { type: 'connect', botId: 'b1', data: {} });

    expect(w.connects).toEqual(['b1']);
    expect(state.reconnectTimers.has('b1')).toBe(false);
  });

  it('sweeps a connected bot whose DB status says it should be stopped', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.bot.update({ where: { id: 'b1' }, data: { status: 'idle' } });

    const w = new LiveWorker();
    instances.push(w);
    w.live.add('b1');

    await w.autoStartBots();

    expect(w.disconnects).toEqual(['b1']);
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
    await prisma.account.update({
      where: { id: 'acc1' },
      data: {
        token: 'enc:token',
        apiKey: 'enc:key',
        apiSecret: 'enc:secret',
        apiKeys: [{ apiKey: 'enc:key2', apiSecret: 'enc:secret2' }],
      },
    });
    await prisma.bot.update({
      where: { id: 'b1' },
      data: {
        status: 'running',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            wallet: { address: `0x${'a'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
      },
    });

    const w = new CapturingWorker();
    instances.push(w);
    await w.start();
    await invoke(w, 'processJob', { id: 'j1', data: { type: 'connect', botId: 'b1', data: {} } });

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
  });

  it('schedules a reconnect when credentials cannot be resolved', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.bot.delete({ where: { id: 'nope' } }).catch(() => {});

    const w = makeWorker();
    await w.start();
    await invoke(w, 'processJob', { id: 'j1', data: { type: 'connect', botId: 'nope', data: {} } });

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
      expect(state.reconnectTimers.has('b1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('probes once after the cooldown and closes the circuit on success', async () => {
    vi.useFakeTimers();
    try {
      const w = makeMarkingWorker();
      const state = w as unknown as WorkerState;
      state.bots.set('b1', { status: 'error', reconnectAttempts: 0 });

      for (let i = 0; i < 5; i++) {
        await state.scheduleReconnect('b1', { botId: 'b1' });
      }
      expect(state.getCircuitBreaker('b1').getState()).toBe('open');
      expect(w.connects).toHaveLength(0);

      // Advance fake time past the circuit cooldown without firing the worker's
      // own (detached) cooldown timer, then await a single probe deterministically.
      vi.setSystemTime(new Date(Date.now() + 61_000));
      await invoke<Promise<void>>(w, 'attemptReconnect', 'b1', { botId: 'b1' });

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

  it('stalls reconnects inside a behavior sleep window (human schedule)', async () => {
    const w = makeWorker();
    const state = w as unknown as WorkerState;
    state.bots.set('b1', { status: 'error', reconnectAttempts: 0 });

    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      // An empty schedule means the bot is "asleep" at every hour.
      const behavior = {
        enabled: true,
        schedule: { activeWindows: {}, timezone: 'UTC', jitterMs: 0 },
      };
      await state.scheduleReconnect('b1', { botId: 'b1', behavior });

      expect(state.bots.get('b1')?.reconnectAttempts).toBe(1);
      expect(state.reconnectTimers.has('b1')).toBe(true);
      // The scheduled reconnect is the 60s+ sleep floor, not the short backoff.
      const sleepDelay = timerSpy.mock.calls.map((c) => Number(c[1])).find((ms) => ms >= 60_000);
      expect(sleepDelay).toBeGreaterThanOrEqual(60_000);
      // No connect fired immediately.
      expect(w.connects).toHaveLength(0);
    } finally {
      timerSpy.mockRestore();
    }
  });

  it('does not stall reconnects when the bot is awake or behavior is disabled', async () => {
    const w = makeWorker();
    const state = w as unknown as WorkerState;
    state.bots.set('b1', { status: 'error', reconnectAttempts: 0 });

    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      // Full-day windows on every day of the week -> always awake.
      const activeWindows = Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((d) => [
          d,
          [{ startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }],
        ]),
      );
      await state.scheduleReconnect('b1', {
        botId: 'b1',
        behavior: { enabled: true, schedule: { activeWindows, timezone: 'UTC', jitterMs: 0 } },
      });
      // The reconnect timer uses the normal short backoff, not the sleep floor.
      const delays = timerSpy.mock.calls.map((c) => Number(c[1]));
      expect(delays.some((ms) => ms > 0 && ms < 60_000)).toBe(true);
      expect(state.bots.get('b1')?.reconnectAttempts).toBe(1);
    } finally {
      timerSpy.mockRestore();
    }

    // Behavior not configured at all -> the gating code path is never entered.
    const w2 = makeWorker();
    const state2 = w2 as unknown as WorkerState;
    state2.bots.set('b2', { status: 'error', reconnectAttempts: 0 });
    const timerSpy2 = vi.spyOn(globalThis, 'setTimeout');
    try {
      await state2.scheduleReconnect('b2', { botId: 'b2' });
      const delays = timerSpy2.mock.calls.map((c) => Number(c[1]));
      expect(delays.some((ms) => ms > 0 && ms < 60_000)).toBe(true);
      expect(state2.bots.get('b2')?.reconnectAttempts).toBe(1);
    } finally {
      timerSpy2.mockRestore();
    }
  });
});
