import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  BinanceClient,
  CoinGeckoClient,
  CryptoError,
  PriceFeed,
  RiskGuard,
  alertSignal,
  baseOf,
  evaluateStrategy,
  rsi,
  sma,
  smaCross,
  validateStrategyParams,
  type StrategyParams,
} from '../crypto/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => respond(String(url), init)),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SECRET = 'test-secret';
const API_KEY = 'test-api-key';

describe('BinanceClient', () => {
  it('signs signed requests with HMAC-SHA256 and sends the API key header', async () => {
    let capturedUrl = '';
    stubFetch((url, init) => {
      capturedUrl = url;
      expect((init?.headers as Record<string, string>)['X-MBX-APIKEY']).toBe(API_KEY);
      return jsonResponse({ balances: [{ asset: 'BTC', free: '0.1', locked: '0' }] });
    });

    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    const balance = await client.balance('BTC');
    expect(balance).toEqual({ asset: 'BTC', free: 0.1, locked: 0 });

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v3/account');
    const query = url.searchParams;
    expect(query.get('timestamp')).toMatch(/^\d+$/);
    expect(query.get('recvWindow')).toBe('10000');

    const signature = query.get('signature');
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      if (key !== 'signature') params.set(key, value);
    }
    const expected = createHmac('sha256', SECRET).update(params.toString()).digest('hex');
    expect(signature).toBe(expected);
  });

  it('throws for signed requests without credentials', async () => {
    const client = new BinanceClient();
    await expect(client.balance('BTC')).rejects.toThrow(/secret is required/);
  });

  it('lists open orders with a signed request', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse([{ orderId: 1, symbol: 'BTCUSDT', status: 'NEW', executedQty: '0' }]);
    });
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    const orders = await client.openOrders();
    expect(orders).toHaveLength(1);
    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v3/openOrders');
    expect(url.searchParams.get('timestamp')).toMatch(/^\d+$/);
    expect(url.searchParams.get('signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fetches an order status by clientOrderId', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ orderId: 1, status: 'FILLED', executedQty: '0.001' });
    });
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    const status = await client.orderStatus('BTCUSDT', 'bh123');
    expect(status.status).toBe('FILLED');
    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v3/order');
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(url.searchParams.get('origClientOrderId')).toBe('bh123');
  });

  it('cancels an order by clientOrderId with a DELETE request', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    stubFetch((url, init) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? 'GET';
      return jsonResponse({ orderId: 1, status: 'CANCELED' });
    });
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    const result = await client.cancelOrder('BTCUSDT', 'bh123');
    expect(result.status).toBe('CANCELED');
    expect(capturedMethod).toBe('DELETE');
    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v3/order');
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(url.searchParams.get('origClientOrderId')).toBe('bh123');
  });

  it('batches tickers by 10 symbols', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      const symbols = JSON.parse(new URL(url).searchParams.get('symbols') ?? '[]') as string[];
      return jsonResponse(
        symbols.map((symbol) => ({
          symbol,
          lastPrice: '100',
          priceChangePercent: '1.5',
          volume: '1000',
          quoteVolume: '100000',
        })),
      );
    });

    const client = new BinanceClient();
    const requested = Array.from({ length: 11 }, (_, i) => `S${i}USDT`);
    const tickers = await client.tickers(requested);
    expect(calls).toHaveLength(2);
    expect(tickers).toHaveLength(11);
    expect(tickers[0].price).toBe(100);
    expect(tickers[0].change24h).toBe(1.5);
  });

  it('maps rate-limit responses to a CryptoError', async () => {
    stubFetch(() => jsonResponse({ code: -1003, msg: 'Way too many requests' }, 429));
    const client = new BinanceClient();
    await expect(client.ticker('BTCUSDT')).rejects.toMatchObject({
      name: 'CryptoError',
      code: 'RATE_LIMITED',
    });
  });

  it('surfaces API errors with the exchange message', async () => {
    stubFetch(() => jsonResponse({ code: -1121, msg: 'Invalid symbol.' }, 400));
    const client = new BinanceClient();
    await expect(client.ticker('NOPE')).rejects.toThrow(/Invalid symbol/);
  });

  it('builds a market buy order with quoteOrderQty', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse({
        orderId: 42,
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        price: '0',
        origQty: '0.001',
        executedQty: '0.001',
        cummulativeQuoteQty: '60',
        status: 'FILLED',
      });
    });

    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    const result = await client.order({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: 60,
    });
    expect(result.orderId).toBe(42);
    const query = new URL(capturedUrl).searchParams;
    expect(query.get('quoteOrderQty')).toBe('60');
    expect(query.get('side')).toBe('BUY');
  });

  it('rejects a market order with no quantity', async () => {
    stubFetch(() => jsonResponse({}));
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await expect(client.order({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET' })).rejects.toThrow(
      /quantity or quoteOrderQty/,
    );
  });

  it('rejects an unsupported kline interval', async () => {
    stubFetch(() => jsonResponse([]));
    const client = new BinanceClient();
    await expect(client.klines('BTCUSDT', '5x')).rejects.toThrow(/Unsupported kline interval/);
  });

  it('pings the public endpoint', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse({});
    });
    const client = new BinanceClient();
    await expect(client.ping()).resolves.toBe(true);
    expect(new URL(capturedUrl).pathname).toBe('/api/v3/ping');
  });

  it('parses a single 24hr ticker', async () => {
    stubFetch(() =>
      jsonResponse({
        symbol: 'BTCUSDT',
        lastPrice: '60000.5',
        priceChangePercent: '-2.5',
        volume: '1000',
        quoteVolume: '60000000',
      }),
    );
    const client = new BinanceClient();
    const ticker = await client.ticker('BTCUSDT');
    expect(ticker).toMatchObject({ symbol: 'BTCUSDT', price: 60000.5, change24h: -2.5 });
  });

  it('maps kline rows and clamps the limit to 500', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse([
        [
          1700000000000,
          '100',
          '101',
          '99',
          '100.5',
          '12.3',
          1700000059999,
          '1230',
          1,
          '5',
          '0',
          '0',
        ],
      ]);
    });
    const client = new BinanceClient();
    const klines = await client.klines('BTCUSDT', '15m', 1000);
    expect(klines).toHaveLength(1);
    expect(klines[0]).toMatchObject({
      openTime: 1700000000000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 12.3,
    });
    expect(new URL(capturedUrl).searchParams.get('limit')).toBe('500');
  });

  it('filters zero balances from the account and falls back to a zeroed balance', async () => {
    stubFetch(() =>
      jsonResponse({
        balances: [
          { asset: 'BTC', free: '0.5', locked: '0' },
          { asset: 'USDT', free: '0', locked: '0' },
        ],
      }),
    );
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    const balances = await client.account();
    expect(balances).toEqual([{ asset: 'BTC', free: 0.5, locked: 0 }]);
    const missing = await client.balance('ETH');
    expect(missing).toEqual({ asset: 'ETH', free: 0, locked: 0 });
  });

  it('builds a limit order with timeInForce and trimmed values', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse({
        orderId: 7,
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'LIMIT',
        price: '59999.12345678',
        origQty: '0.001',
        executedQty: '0',
        cummulativeQuoteQty: '0',
        status: 'NEW',
      });
    });
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    const result = await client.order({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      price: 59999.123456789,
      quantity: 0.00123456789,
    });
    expect(result.orderId).toBe(7);
    const query = new URL(capturedUrl).searchParams;
    expect(query.get('type')).toBe('LIMIT');
    expect(query.get('timeInForce')).toBe('GTC');
    expect(query.get('price')).toBe('59999.12345679');
    expect(query.get('quantity')).toBe('0.00123457');
  });

  it('rejects a limit order without a positive price or quantity', async () => {
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await expect(
      client.order({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: 0, quantity: 1 }),
    ).rejects.toThrow(/positive price/);
    await expect(
      client.order({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: 60000, quantity: -1 }),
    ).rejects.toThrow(/positive quantity/);
  });

  it('builds a market order from a quantity', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse({
        orderId: 9,
        symbol: 'BTCUSDT',
        side: 'SELL',
        type: 'MARKET',
        executedQty: '0.001',
        cummulativeQuoteQty: '60',
        status: 'FILLED',
      });
    });
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await client.order({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 0.001 });
    expect(new URL(capturedUrl).searchParams.get('quantity')).toBe('0.001');
  });

  it('rejects an order without a symbol', async () => {
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await expect(
      client.order({ symbol: '', side: 'BUY', type: 'MARKET', quantity: 1 }),
    ).rejects.toThrow(/requires a symbol/);
  });

  it('exposes the configured key pair and hasKeys flag', () => {
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    expect(client.hasKeys).toBe(true);
    expect(client.keyPair).toEqual({ apiKey: API_KEY, apiSecret: SECRET });
    const bare = new BinanceClient();
    expect(bare.hasKeys).toBe(false);
    expect(bare.keyPair).toEqual({ apiKey: null, apiSecret: null });
  });

  it('maps unauthorized responses to a CryptoError', async () => {
    stubFetch(() => jsonResponse({ code: -2015, msg: 'Invalid API-key' }, 401));
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await expect(client.balance('BTC')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('surfaces errors from non-JSON response bodies', async () => {
    stubFetch(() => new Response('Service Unavailable', { status: 503 }));
    const client = new BinanceClient();
    await expect(client.ticker('BTCUSDT')).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 503,
    });
  });

  it('attaches the Binance error code to API errors (e.g. -2013 unknown order)', async () => {
    stubFetch(() => jsonResponse({ code: -2013, msg: 'Order does not exist' }, 400));
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await expect(client.orderStatus('BTCUSDT', 'bh123456')).rejects.toMatchObject({
      code: 'API_ERROR',
      status: 400,
      binanceCode: -2013,
    });
  });

  it('times out requests that never respond', async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          );
        }),
    );
    const client = new BinanceClient({ timeoutMs: 20 });
    await expect(client.ping()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('retries idempotent endpoints on 429 and 5xx responses', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (calls.length < 3) return jsonResponse({ code: -1003, msg: 'Too many requests' }, 429);
      return jsonResponse({});
    });
    const client = new BinanceClient({ maxRetries: 2 });
    await expect(client.ping()).resolves.toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('honours Retry-After on rate limited responses', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      stubFetch(() => {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ code: -1003 }), {
            status: 429,
            headers: { 'retry-after': '1' },
          });
        }
        return jsonResponse({});
      });
      const client = new BinanceClient({ maxRetries: 1 });
      const promise = client.ping();
      await vi.advanceTimersByTimeAsync(500);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(500);
      await expect(promise).resolves.toBe(true);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying after the budget is exhausted', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return jsonResponse({ code: -1003, msg: 'Too many requests' }, 429);
    });
    const client = new BinanceClient({ maxRetries: 2 });
    await expect(client.ping()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toBe(3);
  });

  it('never auto-retries order placement (idempotency is the caller’s job)', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return jsonResponse({ code: -1001, msg: 'down' }, 500);
    });
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET, maxRetries: 2 });
    await expect(
      client.order({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001 }),
    ).rejects.toMatchObject({ code: 'API_ERROR' });
    expect(calls).toBe(1);
  });

  it('sends newClientOrderId when one is provided', async () => {
    let capturedUrl = '';
    stubFetch((url) => {
      capturedUrl = url;
      return jsonResponse({
        orderId: 7,
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        executedQty: '0.001',
        cummulativeQuoteQty: '60',
        status: 'FILLED',
      });
    });
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await client.order({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.001,
      clientOrderId: 'bothiveabc1231234567890',
    });
    expect(new URL(capturedUrl).searchParams.get('newClientOrderId')).toBe(
      'bothiveabc1231234567890',
    );
  });

  it('rejects a malformed clientOrderId', async () => {
    stubFetch(() => jsonResponse({}));
    const client = new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET });
    await expect(
      client.order({
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.001,
        clientOrderId: 'has spaces and symbols!',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('rejects non-http proxies for the Binance client', () => {
    expect(() => new BinanceClient({ proxyUrl: 'socks5://user:pass@host:1080' })).toThrow(
      /Only http\(s\) proxies/,
    );
  });

  it('exposes the configured proxy url', () => {
    const client = new BinanceClient({ proxyUrl: 'http://user:pass@proxy:3128' });
    expect(client.proxyUrl).toBe('http://user:pass@proxy:3128');
  });
});

describe('PriceFeed', () => {
  it('resolves prices from Binance', async () => {
    stubFetch(() =>
      jsonResponse([
        {
          symbol: 'BTCUSDT',
          lastPrice: '60000',
          priceChangePercent: '2',
          volume: '1',
          quoteVolume: '2',
        },
      ]),
    );
    const feed = new PriceFeed({ source: 'binance', symbols: ['BTCUSDT'] });
    const prices = await feed.refresh();
    expect(prices.get('BTCUSDT')).toMatchObject({ price: 60000, change24h: 2, source: 'binance' });
  });

  it('falls back to CoinGecko when Binance is down (auto source)', async () => {
    const binanceClient = new BinanceClient();
    const binanceFetch = vi.fn(async (_url: string) =>
      jsonResponse({ code: -1001, msg: 'disconnected' }, 500),
    );
    const coingeckoFetch = vi.fn(async (_url: string) =>
      jsonResponse({ bitcoin: { usd: 60000, usd_24h_change: 2.1 } }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        try {
          const parsed = new URL(url);
          if (parsed.hostname === 'api.binance.com') return binanceFetch(url);
        } catch {
          // invalid URL falls through to coingecko
        }
        return coingeckoFetch(url);
      }),
    );

    const feed = new PriceFeed({
      source: 'auto',
      symbols: ['BTCUSDT'],
      binance: binanceClient,
      coingecko: new CoinGeckoClient(),
    });
    const prices = await feed.refresh();
    expect(prices.get('BTCUSDT')).toMatchObject({ price: 60000, source: 'coingecko' });
  });

  it('uses coinIds for the CoinGecko path', async () => {
    stubFetch(() => jsonResponse({ ethereum: { usd: 3000, usd_24h_change: -1 } }));
    const feed = new PriceFeed({
      source: 'coingecko',
      symbols: ['ETHUSDT'],
      coinIds: ['ethereum'],
    });
    const prices = await feed.refresh();
    expect(prices.get('ETHUSDT')).toMatchObject({
      price: 3000,
      change24h: -1,
      source: 'coingecko',
    });
  });

  it('rejects mismatched coinIds', () => {
    expect(
      () =>
        new PriceFeed({
          source: 'coingecko',
          symbols: ['BTCUSDT', 'ETHUSDT'],
          coinIds: ['bitcoin'],
        }),
    ).toThrow(/one-to-one/);
  });

  it('derives the base asset from the quote suffix', () => {
    expect(baseOf('BTCUSDT')).toBe('BTC');
    expect(baseOf('ETHBTC')).toBe('ETH');
    expect(baseOf('DOGE')).toBe('DOGE');
  });

  it('rejects an empty symbol list', () => {
    expect(() => new PriceFeed({ source: 'binance', symbols: [] })).toThrow(/at least one symbol/);
  });

  it('rejects auto mode when every source fails', async () => {
    stubFetch(() => jsonResponse({ code: -1001, msg: 'down' }, 500));
    const feed = new PriceFeed({
      source: 'auto',
      symbols: ['BTCUSDT'],
      binance: new BinanceClient(),
      coingecko: new CoinGeckoClient(),
    });
    await expect(feed.refresh()).rejects.toMatchObject({ code: 'NO_PRICE_SOURCE' });
  });

  it('requires coinIds for symbols CoinGecko does not map', async () => {
    stubFetch(() => jsonResponse({}));
    const feed = new PriceFeed({
      source: 'coingecko',
      symbols: ['ZZZUSDT'],
      coingecko: new CoinGeckoClient(),
    });
    await expect(feed.refresh()).rejects.toThrow(/No CoinGecko id known for ZZZUSDT/);
  });

  it('exposes whether the Binance client has keys', () => {
    expect(new PriceFeed({ source: 'binance', symbols: ['BTCUSDT'] }).hasBinanceKeys).toBe(false);
    expect(
      new PriceFeed({
        source: 'binance',
        symbols: ['BTCUSDT'],
        binance: new BinanceClient({ apiKey: API_KEY, apiSecret: SECRET }),
      }).hasBinanceKeys,
    ).toBe(true);
  });
});

describe('strategies', () => {
  it('computes the simple moving average', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2, 3], 5)).toBeNull();
  });

  it('detects a golden cross', () => {
    const closes = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15];
    expect(smaCross(closes, 2, 5)).toBe('buy');
  });

  it('detects a death cross', () => {
    const closes = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 10];
    expect(smaCross(closes, 2, 5)).toBe('sell');
  });

  it('returns null when the series is too short', () => {
    expect(smaCross([1, 2, 3], 2, 5)).toBeNull();
  });

  it('flags oversold and overbought RSI states', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i * 4);
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i * 4);
    expect(rsi(falling, 14) ?? 100).toBeLessThanOrEqual(30);
    expect(rsi(rising, 14) ?? 0).toBeGreaterThanOrEqual(70);
  });

  it('detects threshold crossings for alerts', () => {
    expect(alertSignal(61000, 59000, 60000)).toBe('buy');
    expect(alertSignal(59000, 61000, undefined, 60000)).toBe('sell');
    expect(alertSignal(60500, 60100, 60000)).toBeNull();
    expect(alertSignal(59500, 59900, undefined, 60000)).toBeNull();
  });

  it('evaluates the configured strategy with a reason', () => {
    const signal = evaluateStrategy(
      'sma',
      { fastPeriod: 2, slowPeriod: 5 },
      [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
      15,
      10,
    );
    expect(signal).toMatchObject({ direction: 'buy', reason: 'SMA 2/5 cross' });
  });

  it('validates strategy params per kind', () => {
    expect(validateStrategyParams('sma', { fastPeriod: 9, slowPeriod: 21 })).toEqual([]);
    expect(validateStrategyParams('sma', { fastPeriod: 21, slowPeriod: 9 })).toEqual([
      'sma.slowPeriod must be greater than fastPeriod',
    ]);
    expect(validateStrategyParams('sma', { fastPeriod: 0 })).toEqual([
      'sma.fastPeriod must be a positive integer',
    ]);
    expect(validateStrategyParams('rsi', { period: 14, oversold: 30, overbought: 70 })).toEqual([]);
    expect(validateStrategyParams('rsi', { oversold: 80, overbought: 30 })).toEqual([
      'rsi.oversold must be lower than overbought',
    ]);
    expect(validateStrategyParams('rsi', { period: 1 })).toEqual([
      'rsi.period must be an integer of at least 2',
    ]);
    expect(validateStrategyParams('alert', { upThreshold: 70000, downThreshold: 30000 })).toEqual(
      [],
    );
    expect(validateStrategyParams('alert', { upThreshold: 30000, downThreshold: 70000 })).toEqual([
      'alert.upThreshold must be greater than downThreshold',
    ]);
    expect(validateStrategyParams('alert', { upThreshold: -5 })).toEqual([
      'alert.upThreshold must be a positive number',
    ]);
    expect(validateStrategyParams('alert', {})).toEqual([]);
    expect(validateStrategyParams('sma', undefined)).toEqual([]);
  });

  it('validates exit-management params for every strategy kind', () => {
    expect(
      validateStrategyParams('alert', { stopLossPct: 5, takeProfitPct: 10 } as StrategyParams),
    ).toEqual([]);
    expect(validateStrategyParams('sma', { trailingStopPct: 0 } as StrategyParams)).toEqual([]);
    expect(validateStrategyParams('rsi', { stopLossPct: -1 } as StrategyParams)).toEqual([
      'stopLossPct must be a non-negative number',
    ]);
    expect(
      validateStrategyParams('alert', { takeProfitPct: Number.NaN } as StrategyParams),
    ).toEqual(['takeProfitPct must be a non-negative number']);
  });
});

describe('RiskGuard', () => {
  it('plans a market buy under the cap in dry mode', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    const result = guard.planMarketBuy('BTCUSDT', 60000, 50);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan).toMatchObject({ side: 'buy', type: 'market', quoteOrderQty: 50 });
    }
  });

  it('refuses orders above the cap', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    const result = guard.planMarketBuy('BTCUSDT', 60000, 500);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('exceeds max 100') });
  });

  it('refuses live trading without API keys', () => {
    const guard = new RiskGuard({ tradeMode: 'live', maxOrderValueUsdt: 100, hasKeys: false });
    const result = guard.planMarketSell('BTCUSDT', 60000, 0.001);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/requires Binance API keys/);
  });

  it('allows live orders when keys are present and value is within the cap', () => {
    const guard = new RiskGuard({ tradeMode: 'live', maxOrderValueUsdt: 100, hasKeys: true });
    const result = guard.planMarketSell('BTCUSDT', 60000, 0.001);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.plan).toMatchObject({ side: 'sell', type: 'market', quantity: 0.001 });
  });

  it('plans limit orders with a price and quantity', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 1000, hasKeys: false });
    const result = guard.planLimit('ETHUSDT', 'buy', 3000, 0.1);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.plan).toMatchObject({ side: 'buy', type: 'limit', price: 3000, quantity: 0.1 });
  });

  it('rejects a market buy with a non-positive amount', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    expect(guard.planMarketBuy('BTCUSDT', 60000, 0)).toEqual({
      ok: false,
      reason: 'amountUsdt must be a positive number',
    });
  });

  it('rejects a market sell whose value exceeds the cap', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    const result = guard.planMarketSell('BTCUSDT', 60000, 0.01);
    expect(result).toEqual({
      ok: false,
      reason: 'Order value 600.00 USDT exceeds max 100 USDT',
    });
  });

  it('lets an exit (stop-loss/take-profit) sell bypass the per-order cap', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    const blocked = guard.planMarketSell('BTCUSDT', 60000, 0.01);
    expect(blocked.ok).toBe(false);
    const exit = guard.planMarketSell('BTCUSDT', 60000, 0.01, { exit: true });
    expect(exit.ok).toBe(true);
    if (exit.ok) expect(exit.plan).toMatchObject({ side: 'sell', type: 'market', quantity: 0.01 });
  });

  it('keeps the remaining sell guards on exit orders', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    expect(guard.planMarketSell('BTCUSDT', 60000, 0.01, { exit: true }).ok).toBe(true);
    expect(guard.planMarketSell('BTCUSDT', 0, 0.01, { exit: true })).toEqual({
      ok: false,
      reason: 'price must be a positive number',
    });
    expect(guard.planMarketSell('BTCUSDT', 60000, 0, { exit: true })).toEqual({
      ok: false,
      reason: 'quantity must be a positive number',
    });
    const live = new RiskGuard({ tradeMode: 'live', maxOrderValueUsdt: 100, hasKeys: false });
    expect(live.planMarketSell('BTCUSDT', 60000, 0.01, { exit: true }).ok).toBe(false);
  });

  it('rejects a market sell with a non-positive or non-finite price', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 1000, hasKeys: false });
    expect(guard.planMarketSell('BTCUSDT', 0, 0.1)).toEqual({
      ok: false,
      reason: 'price must be a positive number',
    });
    expect(guard.planMarketSell('BTCUSDT', NaN, 0.1)).toEqual({
      ok: false,
      reason: 'price must be a positive number',
    });
    expect(guard.planMarketSell('BTCUSDT', 60000, 0.01).ok).toBe(true);
  });

  it('rejects limit orders with an invalid price', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 1000, hasKeys: false });
    expect(guard.planLimit('ETHUSDT', 'buy', 0, 0.1)).toEqual({
      ok: false,
      reason: 'price must be a positive number below 1,000,000',
    });
    expect(guard.planLimit('ETHUSDT', 'buy', 1_500_000, 0.1)).toEqual({
      ok: false,
      reason: 'price must be a positive number below 1,000,000',
    });
  });

  it('rejects limit orders above the cap and without keys in live mode', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    expect(guard.planLimit('ETHUSDT', 'buy', 3000, 1)).toEqual({
      ok: false,
      reason: 'Order value 3000.00 USDT exceeds max 100 USDT',
    });
    const live = new RiskGuard({ tradeMode: 'live', maxOrderValueUsdt: 100, hasKeys: false });
    const blocked = live.planLimit('ETHUSDT', 'buy', 50, 0.1);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toMatch(/requires Binance API keys/);
  });

  it('requires keys via requireKeys in live mode', () => {
    const noKeys = new RiskGuard({ tradeMode: 'live', maxOrderValueUsdt: 100, hasKeys: false });
    expect(noKeys.hasKeys).toBe(false);
    expect(() => noKeys.requireKeys()).toThrow(/requires Binance API keys/);
    const withKeys = new RiskGuard({ tradeMode: 'live', maxOrderValueUsdt: 100, hasKeys: true });
    expect(withKeys.hasKeys).toBe(true);
    expect(() => withKeys.requireKeys()).not.toThrow();
  });

  it('falls back to a default cap when the configured cap is invalid', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: -5, hasKeys: false });
    expect(guard.maxOrderValue).toBe(100);
  });

  it('enforces the symbol whitelist on every plan type', () => {
    const guard = new RiskGuard({
      tradeMode: 'dry',
      maxOrderValueUsdt: 100,
      hasKeys: false,
      allowedSymbols: ['BTCUSDT', 'ethusdt'],
    });
    expect(guard.planMarketBuy('BTCUSDT', 60000, 50).ok).toBe(true);
    expect(guard.planMarketBuy('ETHUSDT', 3000, 50).ok).toBe(true);
    expect(guard.planMarketSell('BTCUSDT', 60000, 0.0001).ok).toBe(true);

    const buy = guard.planMarketBuy('SOLUSDT', 100, 50);
    expect(buy.ok).toBe(false);
    if (!buy.ok) expect(buy.reason).toMatch(/not in the bot's allowed list/);
    const sell = guard.planMarketSell('SOLUSDT', 100, 0.1);
    expect(sell.ok).toBe(false);
    const limit = guard.planLimit('SOLUSDT', 'buy', 100, 0.1);
    expect(limit.ok).toBe(false);
  });

  it('allows any symbol when the whitelist is empty', () => {
    const guard = new RiskGuard({ tradeMode: 'dry', maxOrderValueUsdt: 100, hasKeys: false });
    expect(guard.planMarketBuy('DOGECOIN', 0.1, 50).ok).toBe(true);
  });
});

describe('CoinGeckoClient', () => {
  it('resolves a symbol to a CoinGecko id via the cached list', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.includes('/coins/list')) {
        return jsonResponse([
          { id: 'bitcoin', symbol: 'btc' },
          { id: 'ethereum', symbol: 'eth' },
        ]);
      }
      return jsonResponse({});
    });
    const client = new CoinGeckoClient();
    await expect(client.searchSymbol('BTC')).resolves.toBe('bitcoin');
    await expect(client.searchSymbol('ETH')).resolves.toBe('ethereum');
    expect(calls.filter((c) => c.includes('/coins/list'))).toHaveLength(1);
  });

  it('throws CryptoError on a CoinGecko failure', async () => {
    stubFetch(() => jsonResponse({}, 429));
    const client = new CoinGeckoClient();
    await expect(client.getPrices(['bitcoin'])).rejects.toBeInstanceOf(CryptoError);
  });

  it('maps usd prices and tolerates a missing 24h change', async () => {
    stubFetch(() =>
      jsonResponse({ bitcoin: { usd: 60000 }, ethereum: { usd: 3000, usd_24h_change: 1 } }),
    );
    const client = new CoinGeckoClient();
    const prices = await client.getPrices(['bitcoin', 'ethereum']);
    expect(prices.get('bitcoin')).toEqual({ price: 60000, change24h: null });
    expect(prices.get('ethereum')).toEqual({ price: 3000, change24h: 1 });
  });

  it('throws CryptoError when the coin list fails to load', async () => {
    stubFetch(() => jsonResponse({ error: 'down' }, 500));
    const client = new CoinGeckoClient();
    await expect(client.searchSymbol('BTC')).rejects.toMatchObject({ code: 'COINGECKO_ERROR' });
  });

  it('caches prices for the configured TTL to protect the free tier', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return jsonResponse({ bitcoin: { usd: 60000 } });
    });
    const client = new CoinGeckoClient({ priceCacheMs: 60_000 });
    const first = await client.getPrices(['bitcoin']);
    const second = await client.getPrices(['bitcoin']);
    expect(first.get('bitcoin')).toEqual({ price: 60000, change24h: null });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it('refreshes prices after the cache TTL expires', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return jsonResponse({ bitcoin: { usd: 60000 + calls } });
    });
    const client = new CoinGeckoClient({ priceCacheMs: 5 });
    await client.getPrices(['bitcoin']);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.getPrices(['bitcoin']);
    expect(calls).toBe(2);
  });

  it('does not cache when the TTL is disabled', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return jsonResponse({ bitcoin: { usd: 60000 } });
    });
    const client = new CoinGeckoClient({ priceCacheMs: 0 });
    await client.getPrices(['bitcoin']);
    await client.getPrices(['bitcoin']);
    expect(calls).toBe(2);
  });

  it('times out requests that never respond', async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          );
        }),
    );
    const client = new CoinGeckoClient({ timeoutMs: 20 });
    await expect(client.getPrices(['bitcoin'])).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('rejects non-http proxies for the CoinGecko client', () => {
    expect(() => new CoinGeckoClient({ proxyUrl: 'socks5://host:1080' })).toThrow(
      /Only http\(s\) proxies/,
    );
  });
});
