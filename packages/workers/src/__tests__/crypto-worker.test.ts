import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { BinanceClient, CryptoError, type PlatformEvent, type PricePoint } from '@bothive/core';
import { CryptoWorker, buildKeyPairs } from '../crypto/worker.js';

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

const redisStore = vi.hoisted(() => ({ data: new Map<string, string>() }));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'ready';
    constructor(_url: string, _opts?: unknown) {}
    async connect(): Promise<void> {}
    async set(key: string, value: string, ...rest: unknown[]): Promise<string | null> {
      if (rest.includes('NX') && redisStore.data.has(key)) return null;
      redisStore.data.set(key, value);
      return value;
    }
    async get(key: string): Promise<string | null> {
      return redisStore.data.get(key) ?? null;
    }
    async pexpire(_key: string, _ms: number): Promise<number> {
      return 1;
    }
    async del(key: string): Promise<number> {
      return redisStore.data.delete(key) ? 1 : 0;
    }
    async incr(key: string): Promise<number> {
      const next = Number(redisStore.data.get(key) ?? '0') + 1;
      redisStore.data.set(key, String(next));
      return next;
    }
    async incrby(key: string, by: number): Promise<number> {
      const next = Number(redisStore.data.get(key) ?? '0') + by;
      redisStore.data.set(key, String(next));
      return next;
    }
    async decrby(key: string, by: number): Promise<number> {
      const next = Number(redisStore.data.get(key) ?? '0') - by;
      redisStore.data.set(key, String(next));
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

function makeFeed(prices: Map<string, PricePoint>, binance: Record<string, unknown> = {}) {
  return {
    refresh: vi.fn(async () => prices),
    binanceClient: Object.assign(new BinanceClient(), binance) as BinanceClient,
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
    ...overrides,
  };
}

const connected: CryptoWorker[] = [];

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  redisStore.data.clear();
});

afterEach(async () => {
  await Promise.all(
    connected.splice(0).map((worker) => worker.disconnect('bot1').catch(() => undefined)),
  );
  FakeWebSocket.instances = [];
  vi.restoreAllMocks();
});

describe('CryptoWorker', () => {
  it('connects, emits a price event and executes dry-run market orders', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });

    expect(worker.isConnected('bot1')).toBe(true);
    expect(events.some((e) => e.type === 'price' && e.payload.symbol === 'BTCUSDT')).toBe(true);

    const buy = await worker.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 50 },
    });
    expect(buy).toMatchObject({ simulated: true, status: 'SIMULATED' });
    expect(
      events.some(
        (e) => e.type === 'trade' && e.payload.side === 'buy' && e.payload.simulated === true,
      ),
    ).toBe(true);

    const price = await worker.executeAction('bot1', {
      type: 'getPrice',
      payload: { symbol: 'BTCUSDT' },
    });
    expect(price).toMatchObject({ symbol: 'BTCUSDT', price: 60000 });

    await worker.disconnect('bot1');
    expect(worker.isConnected('bot1')).toBe(false);
  });

  it('executes a dry-run market sell for the requested quantity', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    const sell = await worker.executeAction('bot1', {
      type: 'marketSell',
      payload: { symbol: 'BTCUSDT', quantity: 0.001 },
    });
    expect(sell).toMatchObject({ simulated: true, status: 'SIMULATED' });
    expect(
      events.some(
        (e) => e.type === 'trade' && e.payload.side === 'sell' && e.payload.quantity === 0.001,
      ),
    ).toBe(true);
  });

  it('blocks a live buy once the daily spend cap is reached and refunds failed orders', async () => {
    const order = vi.fn(async () => ({
      orderId: 42,
      status: 'FILLED',
      executedQty: 0.001,
      cummulativeQuoteQty: 50,
      price: 50_000,
    }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 50_000, change24h: 1, source: 'binance', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        apiKey: 'k',
        apiSecret: 's',
        order,
        balance: vi.fn(async () => ({ asset: 'BTC', free: 1, locked: 0 })),
        account: vi.fn(async () => [{ asset: 'BTC', free: 1, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live', maxDailyOrderValueUsdt: 10 }),
      apiKeys: [{ apiKey: 'k', apiSecret: 's' }],
    });

    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = `bothive:crypto:daily:bot1:${today}`;
    redisStore.data.set(dailyKey, '800'); // 8.00 USDT already spent

    const blocked = await worker.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 5 },
    });
    expect(blocked).toMatchObject({ blocked: true });
    expect(order).not.toHaveBeenCalled();
    expect(redisStore.data.get(dailyKey)).toBe('800');

    const allowed = await worker.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 1 },
    });
    expect(allowed).toMatchObject({ orderId: 42, status: 'FILLED' });
    expect(order).toHaveBeenCalledTimes(1);
    expect(redisStore.data.get(dailyKey)).toBe('900');

    order.mockRejectedValueOnce(new Error('binance down'));
    await expect(
      worker.executeAction('bot1', {
        type: 'marketBuy',
        payload: { symbol: 'BTCUSDT', amountUsdt: 1 },
      }),
    ).rejects.toThrow('binance down');
    expect(redisStore.data.get(dailyKey)).toBe('900');
    expect(redisStore.data.has('bothive:crypto:positions:bot1')).toBe(false);
  });

  it('persists dry-run positions to Redis and restores them on reconnect', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 50_000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const makeWorker = () => {
      const w = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
      connected.push(w);
      return w;
    };
    const credentials = { botId: 'bot1', crypto: cryptoConfig() };

    const worker = makeWorker();
    await worker.connect(credentials);
    await worker.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 50 },
    });
    let stored = JSON.parse(redisStore.data.get('bothive:crypto:positions:bot1') ?? '{}');
    expect(Math.abs(stored.BTCUSDT - 0.001)).toBeLessThan(1e-9);

    await worker.disconnect('bot1');

    const worker2 = makeWorker();
    await worker2.connect(credentials);
    await worker2.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 25 },
    });
    stored = JSON.parse(redisStore.data.get('bothive:crypto:positions:bot1') ?? '{}');
    expect(Math.abs(stored.BTCUSDT - 0.0015)).toBeLessThan(1e-9);

    await worker2.executeAction('bot1', {
      type: 'marketSell',
      payload: { symbol: 'BTCUSDT', quantity: 0.0015 },
    });
    stored = JSON.parse(redisStore.data.get('bothive:crypto:positions:bot1') ?? '{}');
    expect(stored.BTCUSDT).toBeUndefined();
  });

  it('dedupes API key pairs so rotation never reuses an identical key', () => {
    const pairs = buildKeyPairs({
      apiKey: 'k1',
      apiSecret: 's1',
      apiKeys: [
        { apiKey: 'k1', apiSecret: 's1' },
        { apiKey: 'k2', apiSecret: 's2' },
        { apiKey: 'k2', apiSecret: 's2' },
        { apiKey: 'k3', apiSecret: 's3' },
      ],
    });
    expect(pairs).toEqual([
      { apiKey: 'k1', apiSecret: 's1' },
      { apiKey: 'k2', apiSecret: 's2' },
      { apiKey: 'k3', apiSecret: 's3' },
    ]);
  });

  it('rejects orders for symbols outside the configured whitelist', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60_000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ allowedSymbols: ['BTCUSDT'] }),
    });

    await expect(
      worker.executeAction('bot1', {
        type: 'marketBuy',
        payload: { symbol: 'ETHUSDT', amountUsdt: 50 },
      }),
    ).rejects.toThrow(/not in the bot's allowed list/);

    const buy = await worker.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 50 },
    });
    expect(buy).toMatchObject({ simulated: true, status: 'SIMULATED' });
  });

  it('rejects an invalid klineInterval at connect time', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60_000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await expect(
      worker.connect({
        botId: 'bot1',
        crypto: cryptoConfig({ strategy: 'sma', strategyParams: { klineInterval: 'banana' } }),
      }),
    ).rejects.toThrow(/Invalid klineInterval/);
  });

  it('clamps getCandles limit and rejects unknown intervals', async () => {
    const klines = vi.fn(async () => []);
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60_000, change24h: 1, source: 'binance', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices, { klines }));
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ source: 'binance' }),
    });

    const res = (await worker.executeAction('bot1', {
      type: 'getCandles',
      payload: { symbol: 'BTCUSDT', limit: 99_999 },
    })) as { klines: unknown[] };
    expect(klines).toHaveBeenCalledWith('BTCUSDT', '15m', 1000);
    expect(res.klines).toEqual([]);

    await expect(
      worker.executeAction('bot1', {
        type: 'getCandles',
        payload: { symbol: 'BTCUSDT', interval: 'banana' },
      }),
    ).rejects.toThrow(/Invalid interval/);
  });

  it('rejects orders above the configured risk cap', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ maxOrderValueUsdt: 100 }),
    });
    await expect(
      worker.executeAction('bot1', {
        type: 'marketBuy',
        payload: { symbol: 'BTCUSDT', amountUsdt: 500 },
      }),
    ).rejects.toThrow(/exceeds max 100/);
  });

  it('refuses live orders when the account has no Binance keys', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live' }),
    });
    await expect(
      worker.executeAction('bot1', {
        type: 'marketBuy',
        payload: { symbol: 'BTCUSDT', amountUsdt: 50 },
      }),
    ).rejects.toThrow(/requires Binance API keys/);
  });

  it('rejects connect without symbols', async () => {
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(new Map()));
    await expect(worker.connect({ botId: 'bot1', crypto: {} })).rejects.toThrow(/symbols/);
  });

  it('rejects sma/rsi strategies with a CoinGecko-only source', async () => {
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(new Map()));
    await expect(
      worker.connect({
        botId: 'bot1',
        crypto: cryptoConfig({ source: 'coingecko', strategy: 'sma' }),
      }),
    ).rejects.toThrow(/require Binance/);
  });

  it('throws for unknown actions on a connected bot', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    await expect(worker.executeAction('bot1', { type: 'nope', payload: {} })).rejects.toThrow(
      /Unknown action/,
    );
  });

  it('rotates Binance key pairs across reconnects', async () => {
    const seen: Array<string | null> = [];
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', (_cfg, binance) => {
      seen.push(binance.keyPair.apiKey);
      return makeFeed(prices);
    });
    connected.push(worker);

    const credentials = {
      botId: 'bot1',
      crypto: cryptoConfig(),
      apiKeys: [
        { apiKey: 'pair-a', apiSecret: 'sa' },
        { apiKey: 'pair-b', apiSecret: 'sb' },
      ],
    };
    await worker.connect(credentials);
    await worker.disconnect('bot1');
    await worker.connect(credentials);

    expect(seen).toHaveLength(2);
    expect(new Set(seen)).toEqual(new Set(['pair-a', 'pair-b']));
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('falls back to the single apiKey/apiSecret pair', async () => {
    const seen: Array<string | null> = [];
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', (_cfg, binance) => {
      seen.push(binance.keyPair.apiKey);
      return makeFeed(prices);
    });
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig(),
      apiKey: 'single-key',
      apiSecret: 'single-secret',
    });
    expect(seen).toEqual(['single-key']);
  });

  it('returns the EVM wallet address and never the private key', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        wallet: { address: `0x${'a'.repeat(40)}`, privateKey: 'enc:secret-blob' },
      }),
    });
    const wallet = await worker.executeAction('bot1', { type: 'getWallet', payload: {} });
    expect(wallet).toEqual({ address: `0x${'a'.repeat(40)}`, privateKey: null });
  });

  it('throws when no EVM wallet is configured', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    await expect(worker.executeAction('bot1', { type: 'getWallet', payload: {} })).rejects.toThrow(
      /No EVM wallet/,
    );
  });

  it('throws when acting on a bot that is not connected', async () => {
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(new Map()));
    await expect(
      worker.executeAction('bot1', { type: 'getPrice', payload: { symbol: 'BTCUSDT' } }),
    ).rejects.toThrow(/not connected/);
  });

  it('returns klines via getCandles', async () => {
    const klines = vi.fn(async () => [
      { openTime: 1700000000000, open: 100, high: 101, low: 99, close: 100.5, volume: 1 },
    ]);
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices, { klines }));
    connected.push(worker);

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    const result = await worker.executeAction('bot1', {
      type: 'getCandles',
      payload: { symbol: 'BTCUSDT', interval: '1h', limit: 50 },
    });
    expect(klines).toHaveBeenCalledWith('BTCUSDT', '1h', 50);
    expect(result).toMatchObject({
      symbol: 'BTCUSDT',
      interval: '1h',
      klines: [{ time: 1700000000000, open: 100, close: 100.5 }],
    });
  });

  it('requires a symbol for getCandles', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    await expect(worker.executeAction('bot1', { type: 'getCandles', payload: {} })).rejects.toThrow(
      /getCandles requires symbol/,
    );
  });

  it('simulates balances in dry mode and queries them in live mode', async () => {
    const balance = vi.fn(async () => ({ asset: 'BTC', free: 1.5, locked: 0.2 }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        balance,
        account: vi.fn(async () => [{ asset: 'BTC', free: 1.5, locked: 0.2 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live' }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });
    const live = await worker.executeAction('bot1', {
      type: 'getBalance',
      payload: { asset: 'BTC' },
    });
    expect(live).toEqual({ asset: 'BTC', free: 1.5, locked: 0.2 });
    expect(balance).toHaveBeenCalledWith('BTC');
    await expect(worker.executeAction('bot1', { type: 'getBalance', payload: {} })).rejects.toThrow(
      /getBalance requires asset/,
    );

    await worker.disconnect('bot1');
    const dryPrices = new Map<string, PricePoint>([
      ['ETHUSDT', { price: 3000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const dryWorker = new CryptoWorker('redis://fake:6379', () => makeFeed(dryPrices));
    connected.push(dryWorker);
    await dryWorker.connect({ botId: 'bot2', crypto: cryptoConfig() });
    const dry = await dryWorker.executeAction('bot2', {
      type: 'getBalance',
      payload: { asset: 'ETH' },
    });
    expect(dry).toMatchObject({ asset: 'ETH', free: 0, locked: 0, simulated: true });

    // Dry-run getBalance must reflect simulated paper positions, not a zero.
    await dryWorker.executeAction('bot2', {
      type: 'marketBuy',
      payload: { symbol: 'ETHUSDT', quantity: 0.02 },
    });
    const held = await dryWorker.executeAction('bot2', {
      type: 'getBalance',
      payload: { asset: 'ETH' },
    });
    expect(held).toMatchObject({ asset: 'ETH', free: 0.02, simulated: true });
  });

  it('places dry-run limit orders', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    const buy = await worker.executeAction('bot1', {
      type: 'limitBuy',
      payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0.001 },
    });
    expect(buy).toMatchObject({ simulated: true, status: 'SIMULATED' });
    expect(
      events.some(
        (e) =>
          e.type === 'trade' &&
          e.payload.side === 'buy' &&
          e.payload.type === 'limit' &&
          e.payload.price === 59000,
      ),
    ).toBe(true);

    const sell = await worker.executeAction('bot1', {
      type: 'limitSell',
      payload: { symbol: 'BTCUSDT', price: 61000, quantity: 0.0005 },
    });
    expect(sell).toMatchObject({ simulated: true, status: 'SIMULATED' });
  });

  it('rejects limit orders with invalid quantity or price', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    await expect(
      worker.executeAction('bot1', {
        type: 'limitBuy',
        payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0 },
      }),
    ).rejects.toThrow(/positive quantity/);
    await expect(
      worker.executeAction('bot1', {
        type: 'limitBuy',
        payload: { symbol: 'BTCUSDT', price: 1_500_000, quantity: 0.001 },
      }),
    ).rejects.toThrow(/price must be a positive number below 1,000,000/);
  });

  it('rejects a market sell without a quantity', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    await expect(
      worker.executeAction('bot1', { type: 'marketSell', payload: { symbol: 'BTCUSDT' } }),
    ).rejects.toThrow(/marketSell requires a positive quantity/);
  });

  it('requires a symbol and a known price for getPrice', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    await expect(worker.executeAction('bot1', { type: 'getPrice', payload: {} })).rejects.toThrow(
      /getPrice requires symbol/,
    );
    await expect(
      worker.executeAction('bot1', { type: 'getPrice', payload: { symbol: 'DOGEUSDT' } }),
    ).rejects.toThrow(/No price available for DOGEUSDT/);
  });

  it('re-fetches stale prices instead of serving them from the cache', async () => {
    const stale = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: 0 }],
    ]);
    const fresh = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60001, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const feed = makeFeed(stale);
    const worker = new CryptoWorker('redis://fake:6379', () => feed);
    connected.push(worker);
    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });

    feed.refresh.mockResolvedValue(fresh);
    const before = feed.refresh.mock.calls.length;
    const price = await worker.executeAction('bot1', {
      type: 'getPrice',
      payload: { symbol: 'BTCUSDT' },
    });
    expect(price).toMatchObject({ price: 60001 });
    expect(feed.refresh.mock.calls.length).toBeGreaterThan(before);
  });

  it('serves fresh prices from the cache without re-fetching', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const feed = makeFeed(prices);
    const worker = new CryptoWorker('redis://fake:6379', () => feed);
    connected.push(worker);
    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });

    const before = feed.refresh.mock.calls.length;
    const price = await worker.executeAction('bot1', {
      type: 'getPrice',
      payload: { symbol: 'BTCUSDT' },
    });
    expect(price).toMatchObject({ price: 60000 });
    expect(feed.refresh.mock.calls.length).toBe(before);
  });

  it('rejects connect with inverted strategy params', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    await expect(
      worker.connect({
        botId: 'bot1',
        crypto: cryptoConfig({
          strategy: 'sma',
          strategyParams: { fastPeriod: 21, slowPeriod: 9 },
        }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('rejects connect with out-of-range RSI params', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    await expect(
      worker.connect({
        botId: 'bot1',
        crypto: cryptoConfig({ strategy: 'rsi', strategyParams: { oversold: 80, overbought: 30 } }),
      }),
    ).rejects.toThrow(/oversold must be lower than overbought/);
  });

  it('routes crypto API calls through the configured proxy', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    let seenProxy: string | undefined;
    const worker = new CryptoWorker('redis://fake:6379', (_config, binance) => {
      seenProxy = binance.proxyUrl;
      return makeFeed(prices);
    });
    connected.push(worker);
    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig(),
      proxy: 'http://user:pass@proxy:3128',
    });
    expect(seenProxy).toBe('http://user:pass@proxy:3128');
  });

  it('omits the proxy when credentials have none', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    let seenProxy: string | undefined;
    const worker = new CryptoWorker('redis://fake:6379', (_config, binance) => {
      seenProxy = binance.proxyUrl;
      return makeFeed(prices);
    });
    connected.push(worker);
    await worker.connect({ botId: 'bot1', crypto: cryptoConfig() });
    expect(seenProxy).toBeUndefined();
  });

  it('places a live order through the Binance client and emits a live trade', async () => {
    const order = vi.fn(async () => ({
      orderId: 101,
      status: 'FILLED',
      executedQty: '0.001',
      cummulativeQuoteQty: '60',
      price: '60000',
    }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live' }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });
    const result = await worker.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 50 },
    });
    expect(order).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET' }),
    );
    expect(result).toMatchObject({ orderId: 101, status: 'FILLED' });
    expect(
      events.some(
        (e) =>
          e.type === 'trade' && e.payload.tradeMode === 'live' && e.payload.simulated === false,
      ),
    ).toBe(true);
  });

  it('auto-trades live sells using the Binance balance', async () => {
    vi.useFakeTimers();
    const order = vi.fn(async () => ({
      orderId: 7,
      status: 'FILLED',
      executedQty: '0.001',
      cummulativeQuoteQty: '50',
      price: '50000',
    }));
    const balance = vi.fn(async () => ({ asset: 'BTC', free: 0.001, locked: 0 }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        balance,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0.001, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        strategy: 'alert',
        strategyParams: { downThreshold: 55000, autoTrade: true, autoTradeAmountUsdt: 50 },
        pollInterval: 5000,
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    prices.set('BTCUSDT', {
      price: 50000,
      change24h: -1,
      source: 'coingecko',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(balance).toHaveBeenCalledWith('BTC');
    expect(order).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'SELL',
        type: 'MARKET',
        quantity: 0.001,
      }),
    );
    expect(
      events.some(
        (e) =>
          e.type === 'trade' &&
          e.payload.side === 'sell' &&
          e.payload.tradeMode === 'live' &&
          e.payload.simulated === false &&
          e.payload.origin === 'auto-signal',
      ),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('skips live auto-sells when the balance fetch fails', async () => {
    vi.useFakeTimers();
    const balance = vi.fn(async () => {
      throw new Error('balance endpoint down');
    });
    const order = vi.fn();
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        balance,
        order,
        account: vi.fn(async () => []),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        strategy: 'alert',
        strategyParams: { downThreshold: 55000, autoTrade: true },
        pollInterval: 5000,
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    prices.set('BTCUSDT', {
      price: 50000,
      change24h: -1,
      source: 'coingecko',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(order).not.toHaveBeenCalled();
    const { prisma } = await import('../prisma.js');
    const logCalls = vi.mocked(prisma.log.create).mock.calls;
    expect(
      logCalls.some(
        (call) =>
          call[0].data.level === 'error' &&
          String(call[0].data.message).includes('Balance fetch failed for sell'),
      ),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('skips live auto-sells when there is nothing to sell', async () => {
    vi.useFakeTimers();
    const balance = vi.fn(async () => ({ asset: 'BTC', free: 0, locked: 0 }));
    const order = vi.fn();
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        balance,
        order,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        strategy: 'alert',
        strategyParams: { downThreshold: 55000, autoTrade: true },
        pollInterval: 5000,
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    prices.set('BTCUSDT', {
      price: 50000,
      change24h: -1,
      source: 'coingecko',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(order).not.toHaveBeenCalled();
    const { prisma } = await import('../prisma.js');
    const logCalls = vi.mocked(prisma.log.create).mock.calls;
    expect(
      logCalls.some(
        (call) =>
          call[0].data.level === 'warn' && String(call[0].data.message).includes('no BTC to sell'),
      ),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('blocks auto-buys above the risk cap and auto-sells above it', async () => {
    vi.useFakeTimers();
    const order = vi.fn();
    const balance = vi.fn(async () => ({ asset: 'BTC', free: 5, locked: 0 }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 54000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        balance,
        account: vi.fn(async () => [{ asset: 'BTC', free: 5, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        maxOrderValueUsdt: 100,
        strategy: 'alert',
        strategyParams: {
          upThreshold: 55000,
          downThreshold: 54000,
          autoTrade: true,
          autoTradeAmountUsdt: 500,
        },
        pollInterval: 5000,
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    prices.set('BTCUSDT', {
      price: 60001,
      change24h: 1,
      source: 'coingecko',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(order).not.toHaveBeenCalled();

    prices.set('BTCUSDT', {
      price: 40000,
      change24h: -1,
      source: 'coingecko',
      timestamp: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(order).not.toHaveBeenCalled();

    const { prisma } = await import('../prisma.js');
    const logCalls = vi.mocked(prisma.log.create).mock.calls;
    expect(
      logCalls.some(
        (call) =>
          call[0].data.level === 'warn' &&
          String(call[0].data.message).includes('Auto-trade buy blocked'),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (call) =>
          call[0].data.level === 'warn' &&
          String(call[0].data.message).includes('Auto-trade sell blocked'),
      ),
    ).toBe(true);
    vi.useRealTimers();
  });

  it('applies Binance stream updates to the price feed', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'binance', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig({ source: 'binance' }) });
    const ws = FakeWebSocket.instances[0];
    ws.emit(
      'message',
      Buffer.from(JSON.stringify({ data: { s: 'BTCUSDT', c: '61000', P: '1.5', E: Date.now() } })),
    );

    const price = await worker.executeAction('bot1', {
      type: 'getPrice',
      payload: { symbol: 'BTCUSDT' },
    });
    expect(price).toMatchObject({ price: 61000, change24h: 1.5 });
  });

  it('closes the Binance stream when the bot disconnects', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'binance', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig({ source: 'binance' }) });
    const ws = FakeWebSocket.instances[0];
    await worker.disconnect('bot1');
    expect(ws.closed).toBe(true);
    expect(worker.isConnected('bot1')).toBe(false);
  });

  it('logs a warning when the kline refresh fails and throttles repeats', async () => {
    vi.useFakeTimers();
    const klines = vi.fn(async () => {
      throw new Error('kline endpoint down');
    });
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'binance', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices, { klines }));
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        source: 'binance',
        strategy: 'sma',
        strategyParams: { fastPeriod: 2, slowPeriod: 5 },
        pollInterval: 5000,
      }),
    });
    expect(klines).toHaveBeenCalledTimes(1);

    const { prisma } = await import('../prisma.js');
    const logCalls = vi.mocked(prisma.log.create).mock.calls;
    expect(
      logCalls.some(
        (call) =>
          call[0].data.level === 'warn' &&
          String(call[0].data.message).includes('Kline fetch failed for BTCUSDT'),
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(klines).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('spreads poll cadence with jitter around the configured interval', async () => {
    vi.useFakeTimers();
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const events: PlatformEvent[] = [];
    const collect = (event: PlatformEvent) => {
      events.push(event);
      return Promise.resolve();
    };
    const priceEventsOf = (botId: string) =>
      events.filter((e) => e.botId === botId && e.type === 'price').length;

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fast = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(fast);
    fast.onEvent(collect);
    await fast.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        pollInterval: 5000,
        strategyParams: { priceEventIntervalMs: 1000 },
      }),
    });
    expect(priceEventsOf('bot1')).toBe(1);
    await vi.advanceTimersByTimeAsync(3999);
    expect(priceEventsOf('bot1')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(priceEventsOf('bot1')).toBe(2);

    await fast.disconnect('bot1');
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const slow = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(slow);
    slow.onEvent(collect);
    await slow.connect({
      botId: 'bot2',
      crypto: cryptoConfig({
        pollInterval: 5000,
        strategyParams: { priceEventIntervalMs: 1000 },
      }),
    });
    expect(priceEventsOf('bot2')).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(priceEventsOf('bot2')).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(priceEventsOf('bot2')).toBe(2);
    vi.useRealTimers();
  });

  it('updates the live ledger on a filled market buy and persists the snapshot', async () => {
    const order = vi.fn(async () => ({
      orderId: 101,
      status: 'FILLED',
      executedQty: '0.001',
      cummulativeQuoteQty: '60',
      price: '60000',
    }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live' }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });
    await worker.executeAction('bot1', {
      type: 'marketBuy',
      payload: { symbol: 'BTCUSDT', amountUsdt: 50 },
    });

    const clientOrderId = order.mock.calls[0][0].clientOrderId as string;
    expect(clientOrderId).toMatch(/^bh\d{13}[a-z0-9]{0,6}$/);
    expect(order.mock.calls[0][0]).toMatchObject({ clientOrderId });

    const raw = redisStore.data.get('bothive:crypto:live:bot1');
    expect(raw).toBeTruthy();
    const snapshot = JSON.parse(raw!) as {
      positions: Record<string, number>;
      openOrders: Record<string, unknown>;
      avgEntry: Record<string, number>;
    };
    expect(snapshot.positions.BTCUSDT).toBeCloseTo(0.001);
    expect(snapshot.avgEntry.BTCUSDT).toBeCloseTo(60000);
    expect(Object.keys(snapshot.openOrders)).toHaveLength(0);
  });

  it('reconciles live positions from exchange balances on the poll cadence', async () => {
    vi.useFakeTimers();
    const account = vi.fn(async () => [{ asset: 'BTC', free: 0.2, locked: 0 }]);
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, { account, openOrders: vi.fn(async () => []) }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live', pollInterval: 5000 }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    account.mockResolvedValue([{ asset: 'BTC', free: 0.35, locked: 0 }]);
    await vi.advanceTimersByTimeAsync(60_000);

    const snapshot = JSON.parse(redisStore.data.get('bothive:crypto:live:bot1')!) as {
      positions: Record<string, number>;
    };
    expect(snapshot.positions.BTCUSDT).toBeCloseTo(0.35);
    vi.useRealTimers();
  });

  it('resolves a tracked limit order that filled between reconciliations', async () => {
    vi.useFakeTimers();
    const order = vi.fn(async () => ({
      orderId: 7,
      status: 'NEW',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const orderStatus = vi.fn(async () => ({
      orderId: 7,
      status: 'FILLED',
      executedQty: '0.001',
      cummulativeQuoteQty: '59',
      price: '59000',
    }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        orderStatus,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live', pollInterval: 5000 }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });
    await worker.executeAction('bot1', {
      type: 'limitBuy',
      payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0.001 },
    });
    const clientOrderId = order.mock.calls[0][0].clientOrderId as string;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(orderStatus).toHaveBeenCalledWith('BTCUSDT', clientOrderId);
    const snapshot = JSON.parse(redisStore.data.get('bothive:crypto:live:bot1')!) as {
      positions: Record<string, number>;
      openOrders: Record<string, unknown>;
      avgEntry: Record<string, number>;
    };
    expect(snapshot.positions.BTCUSDT).toBeCloseTo(0.001);
    expect(snapshot.avgEntry.BTCUSDT).toBeCloseTo(59000);
    expect(Object.keys(snapshot.openOrders)).toHaveLength(0);
    vi.useRealTimers();
  });

  it('cancels stale limit orders and refunds their daily-spend claim', async () => {
    vi.useFakeTimers();
    const order = vi.fn(async () => ({
      orderId: 9,
      status: 'NEW',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const cancelOrder = vi.fn(async () => ({
      orderId: 9,
      status: 'CANCELED',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const openOrders = vi.fn(async () => []);
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        cancelOrder,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0, locked: 0 }]),
        openOrders,
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        pollInterval: 5000,
        maxDailyOrderValueUsdt: 1000,
        strategyParams: { orderTtlMs: 300_000 },
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = `bothive:crypto:daily:bot1:${today}`;
    redisStore.data.set(dailyKey, '1000'); // 10.00 USDT already spent

    await worker.executeAction('bot1', {
      type: 'limitBuy',
      payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0.001 },
    });
    const clientOrderId = order.mock.calls[0][0].clientOrderId as string;
    expect(redisStore.data.get(dailyKey)).toBe('6900'); // 59 USDT claimed

    // Keep the order open through the first reconcile so only TTL cancels it.
    openOrders.mockResolvedValue([{ clientOrderId, symbol: 'BTCUSDT', status: 'NEW' }]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(redisStore.data.get(dailyKey)).toBe('6900');

    // Reconciles tick every 60s; the first one past the 300s TTL cancels.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(cancelOrder).toHaveBeenCalledWith('BTCUSDT', clientOrderId);
    expect(redisStore.data.get(dailyKey)).toBe('1000');

    const snapshot = JSON.parse(redisStore.data.get('bothive:crypto:live:bot1')!) as {
      openOrders: Record<string, unknown>;
    };
    expect(Object.keys(snapshot.openOrders)).toHaveLength(0);
    vi.useRealTimers();
  });

  it('releases the daily-spend claim for the unfilled portion of a partially filled order', async () => {
    vi.useFakeTimers();
    const order = vi.fn(async () => ({
      orderId: 21,
      status: 'NEW',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const orderStatus = vi.fn(async () => ({
      orderId: 21,
      status: 'PARTIALLY_FILLED',
      executedQty: '0.0004',
      cummulativeQuoteQty: '23.6',
      price: '59000',
    }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        orderStatus,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0.0004, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        pollInterval: 5000,
        maxDailyOrderValueUsdt: 1000,
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = `bothive:crypto:daily:bot1:${today}`;
    redisStore.data.set(dailyKey, '1000'); // 10.00 USDT already spent

    await worker.executeAction('bot1', {
      type: 'limitBuy',
      payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0.001 },
    });
    const clientOrderId = order.mock.calls[0][0].clientOrderId as string;
    expect(redisStore.data.get(dailyKey)).toBe('6900'); // 59 USDT claimed

    // The order leaves the open-orders list partially filled; the claim must
    // shrink to what actually spent (59 - 35.4 = 23.6).
    await vi.advanceTimersByTimeAsync(60_000);
    expect(orderStatus).toHaveBeenCalledWith('BTCUSDT', clientOrderId);
    expect(redisStore.data.get(dailyKey)).toBe('3360');

    const snapshot = JSON.parse(redisStore.data.get('bothive:crypto:live:bot1')!) as {
      positions: Record<string, number>;
      openOrders: Record<string, unknown>;
    };
    expect(snapshot.positions.BTCUSDT).toBeCloseTo(0.0004);
    expect(Object.keys(snapshot.openOrders)).toHaveLength(0);
    vi.useRealTimers();
  });

  it('refunds only the unfilled portion when a stale order was partially filled at cancel', async () => {
    vi.useFakeTimers();
    const order = vi.fn(async () => ({
      orderId: 22,
      status: 'NEW',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const cancelOrder = vi.fn(async () => ({
      orderId: 22,
      status: 'CANCELED',
      executedQty: '0.0005',
      cummulativeQuoteQty: '29.5',
      price: '59000',
    }));
    const openOrders = vi.fn(async () => []);
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        cancelOrder,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0.0005, locked: 0 }]),
        openOrders,
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        pollInterval: 5000,
        maxDailyOrderValueUsdt: 1000,
        maxOrderValueUsdt: 1000,
        strategyParams: { orderTtlMs: 300_000 },
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = `bothive:crypto:daily:bot1:${today}`;
    redisStore.data.set(dailyKey, '1000'); // 10.00 USDT already spent

    await worker.executeAction('bot1', {
      type: 'limitBuy',
      payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0.002 },
    });
    const clientOrderId = order.mock.calls[0][0].clientOrderId as string;
    expect(redisStore.data.get(dailyKey)).toBe('12800'); // 118 USDT claimed

    openOrders.mockResolvedValue([{ clientOrderId, symbol: 'BTCUSDT', status: 'NEW' }]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(redisStore.data.get(dailyKey)).toBe('12800');

    // Cancel after TTL: 0.0005 filled at cancel → refund (0.002-0.0005)*59000.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(cancelOrder).toHaveBeenCalledWith('BTCUSDT', clientOrderId);
    expect(redisStore.data.get(dailyKey)).toBe('3950');

    // The filled portion must land in the ledger accounting too (entry price),
    // not just in the exchange-balance position.
    const snapshot = JSON.parse(redisStore.data.get('bothive:crypto:live:bot1')!) as {
      positions: Record<string, number>;
      avgEntry: Record<string, number>;
    };
    expect(snapshot.positions.BTCUSDT).toBeCloseTo(0.0005);
    expect(snapshot.avgEntry.BTCUSDT).toBeCloseTo(59000);
    vi.useRealTimers();
  });

  it('drops a tracked order that vanished from the exchange and refunds its claim', async () => {
    vi.useFakeTimers();
    const order = vi.fn(async () => ({
      orderId: 23,
      status: 'NEW',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const orderStatus = vi.fn(async () => {
      throw new CryptoError('Order does not exist', 'API_ERROR', 400, -2013);
    });
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        orderStatus,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        pollInterval: 5000,
        maxDailyOrderValueUsdt: 1000,
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = `bothive:crypto:daily:bot1:${today}`;
    redisStore.data.set(dailyKey, '1000');

    await worker.executeAction('bot1', {
      type: 'limitBuy',
      payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0.001 },
    });
    const clientOrderId = order.mock.calls[0][0].clientOrderId as string;
    expect(redisStore.data.get(dailyKey)).toBe('6900');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(orderStatus).toHaveBeenCalledWith('BTCUSDT', clientOrderId);
    expect(redisStore.data.get(dailyKey)).toBe('1000');

    const snapshot = JSON.parse(redisStore.data.get('bothive:crypto:live:bot1')!) as {
      openOrders: Record<string, unknown>;
    };
    expect(Object.keys(snapshot.openOrders)).toHaveLength(0);
    vi.useRealTimers();
  });

  it('never leaves a negative daily-spend counter after a refund', async () => {
    vi.useFakeTimers();
    const order = vi.fn(async () => ({
      orderId: 24,
      status: 'NEW',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const cancelOrder = vi.fn(async () => ({
      orderId: 24,
      status: 'CANCELED',
      executedQty: '0',
      cummulativeQuoteQty: '0',
      price: '59000',
    }));
    const openOrders = vi.fn(async () => []);
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 1, source: 'coingecko', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        cancelOrder,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0, locked: 0 }]),
        openOrders,
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        tradeMode: 'live',
        pollInterval: 5000,
        maxDailyOrderValueUsdt: 1000,
        strategyParams: { orderTtlMs: 300_000 },
      }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });

    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = `bothive:crypto:daily:bot1:${today}`;

    await worker.executeAction('bot1', {
      type: 'limitBuy',
      payload: { symbol: 'BTCUSDT', price: 59000, quantity: 0.001 },
    });
    const clientOrderId = order.mock.calls[0][0].clientOrderId as string;
    expect(redisStore.data.get(dailyKey)).toBe('5900');

    openOrders.mockResolvedValue([{ clientOrderId, symbol: 'BTCUSDT', status: 'NEW' }]);
    await vi.advanceTimersByTimeAsync(60_000);

    // The claim key can expire (48h TTL) while the order is still open (order
    // TTL up to 30d). The refund must not resurrect a negative counter that
    // would mask future spend.
    redisStore.data.delete(dailyKey);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(cancelOrder).toHaveBeenCalled();
    expect(redisStore.data.has(dailyKey)).toBe(false);
    vi.useRealTimers();
  });

  it('hydrates the live ledger from Redis and realizes PnL on sells', async () => {
    const order = vi.fn(async () => ({
      orderId: 11,
      status: 'FILLED',
      executedQty: '0.001',
      cummulativeQuoteQty: '66',
      price: '66000',
    }));
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 66000, change24h: 2.5, source: 'coingecko', timestamp: Date.now() }],
    ]);
    redisStore.data.set(
      'bothive:crypto:live:bot1',
      JSON.stringify({
        positions: { BTCUSDT: 0.001 },
        avgEntry: { BTCUSDT: 60000 },
        realizedPnl: 0,
        openOrders: {},
        updatedAt: Date.now(),
      }),
    );
    const worker = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(prices, {
        order,
        account: vi.fn(async () => [{ asset: 'BTC', free: 0.001, locked: 0 }]),
        openOrders: vi.fn(async () => []),
      }),
    );
    connected.push(worker);

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({ tradeMode: 'live' }),
      apiKey: 'live-key',
      apiSecret: 'live-secret',
    });
    await worker.executeAction('bot1', {
      type: 'marketSell',
      payload: { symbol: 'BTCUSDT', quantity: 0.001 },
    });

    const snapshot = JSON.parse(redisStore.data.get('bothive:crypto:live:bot1')!) as {
      positions: Record<string, number>;
      realizedPnl: number;
    };
    expect(snapshot.realizedPnl).toBeCloseTo(6);
    expect(snapshot.positions.BTCUSDT ?? 0).toBeCloseTo(0);
  });

  it('multiplexes one stream socket across bots watching the same symbol', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'binance', timestamp: Date.now() }],
    ]);
    const start = FakeWebSocket.instances.length;
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);

    await worker.connect({ botId: 'bot1', crypto: cryptoConfig({ source: 'binance' }) });
    await worker.connect({ botId: 'bot2', crypto: cryptoConfig({ source: 'binance' }) });
    expect(FakeWebSocket.instances).toHaveLength(start + 1);

    const worker2 = new CryptoWorker('redis://fake:6379', () =>
      makeFeed(
        new Map<string, PricePoint>([
          ['ETHUSDT', { price: 3000, change24h: 1, source: 'binance', timestamp: Date.now() }],
        ]),
      ),
    );
    connected.push(worker2);
    await worker2.connect({
      botId: 'bot3',
      crypto: cryptoConfig({ source: 'binance', symbols: ['ETHUSDT'] }),
    });
    expect(FakeWebSocket.instances).toHaveLength(start + 2);

    await worker.disconnect('bot1');
    expect(FakeWebSocket.instances[start].closed).toBe(false);
    await worker.disconnect('bot2');
    expect(FakeWebSocket.instances[start].closed).toBe(true);
    expect(FakeWebSocket.instances[start + 1].closed).toBe(false);
    await worker2.disconnect('bot3');
    expect(FakeWebSocket.instances[start + 1].closed).toBe(true);
  });

  it('triggers realtime signals and auto-trades from stream ticks', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'binance', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        source: 'binance',
        strategy: 'alert',
        strategyParams: { upThreshold: 62000, autoTrade: true, autoTradeAmountUsdt: 50 },
      }),
    });

    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    ws.emit(
      'message',
      Buffer.from(JSON.stringify({ data: { s: 'BTCUSDT', c: '63000', P: '3', E: Date.now() } })),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const signals = events.filter((e) => e.type === 'signal' && e.botId === 'bot1');
    expect(signals).toHaveLength(1);
    expect(signals[0].payload).toMatchObject({ symbol: 'BTCUSDT', direction: 'buy' });

    const positions = JSON.parse(redisStore.data.get('bothive:crypto:positions:bot1')!) as Record<
      string,
      number
    >;
    expect(positions.BTCUSDT).toBeGreaterThan(0);
  });

  it('throttles strategy evaluation on ticks but stays responsive', async () => {
    const prices = new Map<string, PricePoint>([
      ['BTCUSDT', { price: 60000, change24h: 2.5, source: 'binance', timestamp: Date.now() }],
    ]);
    const worker = new CryptoWorker('redis://fake:6379', () => makeFeed(prices));
    connected.push(worker);
    const events: PlatformEvent[] = [];
    worker.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    await worker.connect({
      botId: 'bot1',
      crypto: cryptoConfig({
        source: 'binance',
        strategy: 'alert',
        strategyParams: { upThreshold: 62000, downThreshold: 55000, autoTrade: true },
      }),
    });

    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    const tick = (c: string) =>
      ws.emit(
        'message',
        Buffer.from(JSON.stringify({ data: { s: 'BTCUSDT', c, P: '1', E: Date.now() } })),
      );
    const signals = () => events.filter((e) => e.type === 'signal' && e.botId === 'bot1');

    tick('63000'); // above upThreshold -> buy signal
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signals()).toHaveLength(1);

    tick('56000'); // no threshold crossed, but would be evaluated if not throttled
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signals()).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 2100)); // past the 2s window
    tick('53000'); // crosses down through downThreshold -> sell signal
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signals()).toHaveLength(2);
    expect(signals()[1].payload).toMatchObject({ direction: 'sell' });
  });
});
