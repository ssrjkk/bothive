import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { BinanceClient, type PlatformEvent, type PricePoint } from '@bothive/core';
import { CryptoWorker } from '../crypto/worker.js';

const dbBots = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'ready';
    constructor(_url: string, _opts?: unknown) {}
    async connect(): Promise<void> {}
    async set(_key: string, value: string, ..._rest: unknown[]): Promise<string | null> {
      return value;
    }
    async get(_key: string): Promise<string | null> {
      return null;
    }
    async pexpire(_key: string, _ms: number): Promise<number> {
      return 1;
    }
    async del(_key: string): Promise<number> {
      return 1;
    }
    async incr(_key: string): Promise<number> {
      return 1;
    }
    async disconnect(): Promise<void> {}
  }
  return { Redis: FakeRedis };
});

vi.mock('bullmq', () => {
  class FakeWorker {
    processor: (job: unknown) => unknown;
    opts = { concurrency: 1 };
    handlers: Record<string, (job: unknown, ...args: unknown[]) => unknown> = {};
    constructor(_queue: string, processor: (job: unknown) => unknown) {
      this.processor = processor;
    }
    on(event: string, cb: (job: unknown, ...args: unknown[]) => unknown) {
      this.handlers[event] = cb;
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
      findMany: vi.fn(async ({ where }: { where?: { status?: { in?: string[] } } }) => {
        const statuses = where?.status?.in;
        if (statuses) {
          return dbBots.rows.filter((row) => statuses.includes((row as { status: string }).status));
        }
        return dbBots.rows;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          dbBots.rows.find((row) => (row as { id: string }).id === where.id) ?? null,
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    log: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));
vi.mock('../log-publisher.js', () => ({ publishLog: vi.fn() }));
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

const connected: CryptoWorker[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    connected.splice(0).map((worker) => worker.disconnect('bot1').catch(() => undefined)),
  );
  vi.restoreAllMocks();
});

beforeEach(() => {
  dbBots.rows = [];
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
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

    const worker = new CryptoWorker('redis://fake:6379', (config, binance) => {
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
    connected.push(worker);
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
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(() => prices));
    connected.push(worker);
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
    await vi.advanceTimersByTimeAsync(5000);

    const signalOf = (botId: string) =>
      events.filter((e) => e.botId === botId && e.type === 'signal');
    const tradeOf = (botId: string) =>
      events.filter((e) => e.botId === botId && e.type === 'trade');

    expect(signalOf('active')).toHaveLength(1);
    expect(signalOf('passive')).toHaveLength(1);
    expect(tradeOf('active')).toHaveLength(1);
    expect(tradeOf('active')[0].payload).toMatchObject({ side: 'buy', simulated: true });
    expect(tradeOf('passive')).toHaveLength(0);
  });

  it('rotates to the next API key pair after polling fails repeatedly', async () => {
    vi.useFakeTimers();
    const seen: Array<string | null> = [];
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60_000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    let failing = false;
    const worker = new CryptoWorker('redis://fake:6379', (_cfg, binance) => {
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
    connected.push(worker);
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
    dbBots.rows = [
      {
        id: 'bot1',
        platform: 'crypto',
        status: 'running',
        config: { crypto: cryptoConfig({ pollInterval: 5000 }) },
        account: {
          apiKey: null,
          apiSecret: null,
          apiKeys: [
            { apiKey: 'rot-a', apiSecret: 'sa' },
            { apiKey: 'rot-b', apiSecret: 'sb' },
          ],
        },
      },
    ];

    await worker.connect(credentials);
    expect(worker.isConnected('bot1')).toBe(true);
    const firstPair = seen[0];

    failing = true;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(worker.isConnected('bot1')).toBe(false);
    const { prisma } = await import('../prisma.js');
    expect(prisma.bot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bot1' },
        data: expect.objectContaining({ status: 'error' }),
      }),
    );

    failing = false;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(worker.isConnected('bot1')).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(firstPair);
    expect(new Set(seen)).toEqual(new Set(['rot-a', 'rot-b']));
  });

  it('auto-starts crypto bots from the database with their own key pools', async () => {
    dbBots.rows = [
      {
        id: 'auto-1',
        platform: 'crypto',
        status: 'running',
        config: {
          crypto: {
            symbols: ['BTCUSDT'],
            source: 'coingecko',
            strategy: 'alert',
            wallet: { address: `0x${'d'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
        account: {
          apiKey: 'db-key-1',
          apiSecret: 'db-secret-1',
          apiKeys: [{ apiKey: 'db-key-2', apiSecret: 'db-secret-2' }],
        },
      },
      {
        id: 'auto-2',
        platform: 'crypto',
        status: 'connecting',
        config: {
          crypto: {
            symbols: ['ETHUSDT'],
            source: 'coingecko',
            strategy: 'alert',
            wallet: { address: `0x${'e'.repeat(40)}`, privateKey: 'enc:pk' },
          },
        },
        account: { apiKey: null, apiSecret: null, apiKeys: null },
      },
    ];

    const pairs: Array<string | null> = [];
    const worker = new CryptoWorker('redis://fake:6379', (config, binance) => {
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
    connected.push(worker);

    await worker.autoStartBots();

    expect(worker.isConnected('auto-1')).toBe(true);
    expect(worker.isConnected('auto-2')).toBe(true);

    expect(pairs).toHaveLength(2);
    expect(['db-key-1', 'db-key-2']).toContain(pairs[0]);
    expect(pairs[0]).not.toBeNull();
    expect(pairs[1]).toBeNull();

    const wallet = await worker.executeAction('auto-1', { type: 'getWallet', payload: {} });
    expect(wallet).toEqual({ address: `0x${'d'.repeat(40)}`, privateKey: null });
  });
});
