import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { BinanceClient, type PlatformEvent, type PricePoint } from '@bothive/core';
import { CryptoWorker } from '../crypto/worker.js';
import { flushLogs } from '../log-batcher.js';
import { ensureTestUser, TEST_OWNER_ID } from './helpers/tenancy.js';

/** Real event-loop turns so real Redis/DB chains started by fake-timer callbacks settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const r = await redisClient();
    await r.set('bothive:crypto:settle', '1');
    await r.quit().catch(() => undefined);
  }
}

/** Advances fake timers and then yields real I/O so pending Redis/DB work completes. */
async function advance(ms: number): Promise<void> {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(remaining, 60_000);
    await vi.advanceTimersByTimeAsync(step);
    await settle();
    remaining -= step;
  }
}

const { FakeWebSocket } = vi.hoisted(() => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    handlers: Record<string, (data?: unknown) => void> = {};
    closed = false;
    constructor() {
      FakeWebSocket.instances.push(this);
    }
    on(event: string, cb: (data?: unknown) => void) {
      this.handlers[event] = cb;
      return this;
    }
    emit(event: string, data?: unknown) {
      this.handlers[event]?.(data);
    }
    ping() {}
    close() {
      this.closed = true;
    }
    removeAllListeners() {}
  }
  return { FakeWebSocket };
});

vi.mock('ws', () => ({ default: FakeWebSocket }));
vi.mock('../webhooks.js', () => ({ dispatchWebhooks: vi.fn() }));
vi.mock('@bothive/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bothive/core')>();
  return { ...mod, decryptCredential: vi.fn((value: unknown) => value) };
});

function makeFeed(getPrices: () => Map<string, PricePoint>) {
  return {
    refresh: vi.fn(async () => getPrices()),
    binanceClient: new BinanceClient(),
    hasBinanceKeys: false,
  };
}

function cryptoConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbols: ['BTCUSDT'],
    coinIds: ['bitcoin'],
    source: 'coingecko',
    tradeMode: 'dry',
    strategyParams: {},
    pollInterval: 60_000,
    ...overrides,
  };
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const instances: CryptoWorker[] = [];

/** Constructs a real BullMQ-backed CryptoWorker and tracks it for afterEach teardown. */
function makeWorker(feedFactory?: any): CryptoWorker {
  const w = new CryptoWorker(REDIS_URL, feedFactory);
  instances.push(w);
  return w;
}

async function redisClient() {
  const IORedis = (await import('ioredis')).default;
  return new IORedis(REDIS_URL);
}

const REDIS_PATTERNS = [
  'bothive:leader:*',
  'bothive:outbound:*',
  'bothive:health:*',
  'bothive:crypto*',
];

async function flushRedis(): Promise<void> {
  const redis = await redisClient();
  for (const pattern of REDIS_PATTERNS) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
}

const SCENARIO_BOT_IDS = ['bot1', 'c1', 'c2', 'c3', 'active', 'passive', 'auto-1', 'auto-2'];

beforeEach(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  await flushLogs(); // drain any buffer left over from the previous test into the DB
  await flushRedis();
  const { prisma } = await import('../prisma.js');
  await prisma.log.deleteMany({ where: { botId: { in: SCENARIO_BOT_IDS } } });
  await prisma.bot.deleteMany({ where: { id: { in: SCENARIO_BOT_IDS } } });
  await prisma.account.deleteMany({ where: { platform: 'crypto' } });
  await ensureTestUser();
  await prisma.account.upsert({
    where: { id: 'crypto-acc1' },
    update: {},
    create: {
      id: 'crypto-acc1',
      name: 'Crypto Test Account',
      platform: 'crypto',
      token: 'tok',
      ownerId: TEST_OWNER_ID,
    },
  });
  for (const id of SCENARIO_BOT_IDS) {
    await prisma.bot.upsert({
      where: { id },
      update: { status: 'idle' },
      create: {
        id,
        name: 'Crypto Bot',
        platform: 'crypto',
        accountId: 'crypto-acc1',
        status: 'idle',
        config: {},
        ownerId: TEST_OWNER_ID,
      },
    });
  }
});

afterEach(async () => {
  vi.useRealTimers();
  for (const w of instances) {
    const state = w as unknown as {
      runtimes: Map<string, { timer: NodeJS.Timeout | null }>;
      worker: { close(): Promise<void> };
      queue: { close(): Promise<void> };
      reconnectTimers: Map<string, NodeJS.Timeout>;
      leaderTimer?: NodeJS.Timeout;
      reconcileTimer?: NodeJS.Timeout;
    };
    for (const runtime of state.runtimes.values()) {
      if (runtime.timer) {
        clearInterval(runtime.timer);
        runtime.timer = null;
      }
    }
    if (state.leaderTimer) clearInterval(state.leaderTimer);
    if (state.reconcileTimer) clearInterval(state.reconcileTimer);
    for (const t of state.reconnectTimers.values()) clearTimeout(t);
    state.reconnectTimers.clear();
    await state.worker.close().catch(() => {});
    await state.queue.close().catch(() => {});
  }
  instances.length = 0;
  FakeWebSocket.instances = [];
  await flushRedis();
  vi.restoreAllMocks();
});

describe('CryptoWorker scenarios', () => {
  it('runs a whole batch of crypto bots on one worker with distinct wallets, risk caps and prices', async () => {
    const batch = [
      {
        id: 'c1',
        symbol: 'BTCUSDT',
        price: 60_000,
        wallet: `0x${'a'.repeat(40)}`,
        maxOrderValueUsdt: 100,
        keys: ['key-1', 'secret-1'],
      },
      {
        id: 'c2',
        symbol: 'ETHUSDT',
        price: 3000,
        wallet: `0x${'b'.repeat(40)}`,
        maxOrderValueUsdt: 500,
        keys: ['key-2', 'secret-2'],
      },
      {
        id: 'c3',
        symbol: 'SOLUSDT',
        price: 150,
        wallet: `0x${'c'.repeat(40)}`,
        maxOrderValueUsdt: 1000,
        keys: ['key-3', 'secret-3'],
      },
    ];

    const worker = makeWorker((config, binance) => {
      const symbol = String(config.symbols[0]);
      const entry = batch.find((b) => b.symbol === symbol)!;
      expect(binance.keyPair.apiKey).toBe(entry.keys[0]);
      return makeFeed(
        () =>
          new Map([
            [
              symbol,
              {
                price: entry.price,
                change24h: 1,
                source: 'coingecko',
                timestamp: Date.now(),
              },
            ],
          ]),
      );
    });
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await Promise.all(
      batch.map((b) =>
        worker.connect({
          botId: b.id,
          apiKey: b.keys[0],
          apiSecret: b.keys[1],
          crypto: cryptoConfig({
            symbols: [b.symbol],
            maxOrderValueUsdt: b.maxOrderValueUsdt,
            wallet: { address: b.wallet, privateKey: 'enc:pk' },
          }),
        }),
      ),
    );

    for (const b of batch) {
      expect(worker.isConnected(b.id)).toBe(true);
      const wallet = await worker.executeAction(b.id, { type: 'getWallet', payload: {} });
      expect(wallet).toEqual({ address: b.wallet, privateKey: null });
      expect(events.some((e) => e.botId === b.id && e.type === 'price')).toBe(true);
    }

    await expect(
      worker.executeAction('c1', {
        type: 'marketBuy',
        payload: { symbol: 'BTCUSDT', amountUsdt: 300 },
      }),
    ).rejects.toThrow(/exceeds max 100/);

    const ok = await worker.executeAction('c2', {
      type: 'marketBuy',
      payload: { symbol: 'ETHUSDT', amountUsdt: 300 },
    });
    expect(ok).toMatchObject({ simulated: true, status: 'SIMULATED' });

    await worker.disconnect('c1');
    expect(worker.isConnected('c1')).toBe(false);
    expect(worker.isConnected('c2')).toBe(true);
    expect(worker.isConnected('c3')).toBe(true);
  });

  it('emits trades only for auto-trading bots and plain signals for passive ones', async () => {
    vi.useFakeTimers();
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 50_000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = makeWorker(() => makeFeed(() => prices));
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    const active = cryptoConfig({
      strategy: 'alert',
      strategyParams: { upThreshold: 55_000, autoTrade: true, autoTradeAmountUsdt: 50 },
      pollInterval: 5000,
    });
    const passive = cryptoConfig({
      strategy: 'alert',
      strategyParams: { upThreshold: 55_000, autoTrade: false },
      pollInterval: 5000,
    });

    await worker.connect({ botId: 'active', crypto: active });
    await worker.connect({ botId: 'passive', crypto: passive });

    prices.set('BTCUSDT', {
      price: 60_000,
      change24h: 1,
      source: 'coingecko',
      timestamp: Date.now(),
    });
    await advance(5000);

    const signalOf = (botId: string) =>
      events.filter((e) => e.botId === botId && e.type === 'signal');
    const tradeOf = (botId: string) =>
      events.filter((e) => e.botId === botId && e.type === 'trade');

    expect(signalOf('active')).toHaveLength(1);
    expect(signalOf('passive')).toHaveLength(1);
    expect(tradeOf('active')).toHaveLength(1);
    expect(tradeOf('active')[0].payload).toMatchObject({ side: 'buy', simulated: true });
    expect(tradeOf('passive')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('rotates to the next API key pair after polling fails repeatedly', async () => {
    vi.useFakeTimers();
    const seen: Array<string | null> = [];
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60_000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    let failing = false;
    const worker = makeWorker((_cfg, binance) => {
      seen.push(binance.keyPair.apiKey);
      return {
        refresh: vi.fn(async () => {
          if (failing) throw new Error('upstream down');
          return prices;
        }),
        binanceClient: new BinanceClient(),
        hasBinanceKeys: false,
      };
    });
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    const credentials = {
      botId: 'bot1',
      crypto: cryptoConfig({ pollInterval: 5000 }),
      apiKeys: [
        { apiKey: 'rot-a', apiSecret: 'sa' },
        { apiKey: 'rot-b', apiSecret: 'sb' },
      ],
    };

    // The reconnect path resolves credentials from the DB, so the bot row and
    // its account must carry the rotation pool (mirrors the mocked rows).
    const { prisma } = await import('../prisma.js');
    await prisma.bot.update({
      where: { id: 'bot1' },
      data: { status: 'running', config: { crypto: cryptoConfig({ pollInterval: 5000 }) } },
    });
    await prisma.account.update({
      where: { id: 'crypto-acc1' },
      data: {
        apiKey: null,
        apiSecret: null,
        apiKeys: [
          { apiKey: 'rot-a', apiSecret: 'sa' },
          { apiKey: 'rot-b', apiSecret: 'sb' },
        ],
      },
    });

    await worker.connect(credentials);
    expect(worker.isConnected('bot1')).toBe(true);
    const firstPair = seen[0];

    failing = true;
    await advance(25_000);
    expect(worker.isConnected('bot1')).toBe(false);
    const errRow = await prisma.bot.findUnique({ where: { id: 'bot1' } });
    expect(errRow?.status).toBe('error');
    expect(errRow?.connectedAt).toBeNull();

    failing = false;
    await advance(120_000);
    expect(worker.isConnected('bot1')).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(firstPair);
    expect(new Set(seen)).toEqual(new Set(['rot-a', 'rot-b']));
    vi.useRealTimers();
  });

  it('auto-starts crypto bots from the database with their own key pools', async () => {
    const { prisma } = await import('../prisma.js');
    await prisma.account.create({
      data: {
        id: 'acc-auto1',
        name: 'Auto 1',
        platform: 'crypto',
        token: 'tok',
        ownerId: TEST_OWNER_ID,
        apiKey: 'db-key-1',
        apiSecret: 'db-secret-1',
        apiKeys: [{ apiKey: 'db-key-2', apiSecret: 'db-secret-2' }],
      },
    });
    await prisma.bot.update({
      where: { id: 'auto-1' },
      data: {
        accountId: 'acc-auto1',
        status: 'running',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            source: 'coingecko',
            strategy: 'alert',
            wallet: { address: `0x${'d'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
      },
    });
    await prisma.account.create({
      data: {
        id: 'acc-auto2',
        name: 'Auto 2',
        platform: 'crypto',
        token: 'tok',
        ownerId: TEST_OWNER_ID,
      },
    });
    await prisma.bot.update({
      where: { id: 'auto-2' },
      data: {
        accountId: 'acc-auto2',
        status: 'connecting',
        config: {
          crypto: {
            symbols: ['ETHUSDT'],
            source: 'coingecko',
            strategy: 'alert',
            wallet: { address: `0x${'e'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
      },
    });

    const pairs: Array<string | null> = [];
    const worker = makeWorker((config, binance) => {
      pairs.push(binance.keyPair.apiKey);
      const symbol = String(config.symbols[0]);
      return makeFeed(
        () =>
          new Map([
            [
              symbol,
              {
                price: 10_000,
                change24h: 0,
                source: 'coingecko',
                timestamp: Date.now(),
              },
            ],
          ]),
      );
    });

    await worker.autoStartBots();
    const auto1Bot = await prisma.bot.findUnique({
      where: { id: 'auto-1' },
      select: { accountId: true, status: true },
    });
    const auto2Bot = await prisma.bot.findUnique({
      where: { id: 'auto-2' },
      select: { accountId: true, status: true },
    });
    const auto2Acc = await prisma.account.findUnique({
      where: { id: 'acc-auto2' },
      select: { apiKey: true, apiKeys: true },
    });
    expect(worker.isConnected('auto-1')).toBe(true);
    expect(worker.isConnected('auto-2')).toBe(true);

    expect(auto1Bot?.accountId).toBe('acc-auto1');
    expect(auto2Bot?.accountId).toBe('acc-auto2');
    expect(auto1Bot?.status).toBe('running');
    expect(auto2Bot?.status).toBe('running');
    // auto-2's own account is keyless, so it must connect without a key.
    expect(auto2Acc?.apiKey).toBeNull();
    expect(auto2Acc?.apiKeys).toBeNull();
    expect(pairs).toHaveLength(2);
    // Both auto-started bots connect concurrently; `pairs` order is the
    // (nondeterministic) connection order. Exactly one connect must carry a
    // key (auto-1, from acc-auto1's pool) and the keyless one must be auto-2.
    const withKey = pairs.filter((p) => p !== null);
    const withoutKey = pairs.filter((p) => p === null);
    expect(withKey).toHaveLength(1);
    expect(['db-key-1', 'db-key-2']).toContain(withKey[0]);
    expect(withoutKey).toHaveLength(1);

    const wallet = await worker.executeAction('auto-1', { type: 'getWallet', payload: {} });
    expect(wallet).toEqual({ address: `0x${'d'.repeat(40)}`, privateKey: null });
  });
});
