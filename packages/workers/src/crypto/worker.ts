import {
  BinanceClient,
  CoinGeckoClient,
  CryptoError,
  PriceFeed,
  RiskGuard,
  baseOf,
  evaluateStrategy,
  validateStrategyParams,
  type OrderPlan,
  type PlanResult,
  type PricePoint,
  type SignalDirection,
} from '@bothive/core';
import { BaseWorker, createCommandRedis } from '../base-worker.js';
import { BinanceStream, type StreamUpdate } from './stream.js';

/** Prices older than this are re-fetched instead of being reused. */
const PRICE_STALE_MS = 30_000;

// Fail-fast command Redis used for the dry-run position ledger and the daily
// spend counter; a Redis outage degrades those to in-memory/no-op instead of
// blocking trades.
const stateRedis = createCommandRedis('crypto-state');
void stateRedis
  .connect()
  .catch((err) => console.error('[workers] crypto-state Redis connect failed:', err));

const positionsKey = (botId: string): string => `bothive:crypto:positions:${botId}`;
const dailySpendKey = (botId: string, date: string): string =>
  `bothive:crypto:daily:${botId}:${date}`;
const utcDate = (): string => new Date().toISOString().slice(0, 10);
const DAILY_SPEND_TTL_MS = 48 * 3600 * 1000;

/** Binance kline intervals accepted by the strategy backtests. */
const KLINE_INTERVALS = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
]);

interface CryptoRuntimeConfig {
  symbols: string[];
  coinIds: string[] | null;
  source: 'binance' | 'coingecko' | 'auto';
  pollIntervalMs: number;
  strategy: 'sma' | 'rsi' | 'alert';
  strategyParams: Record<string, unknown>;
  tradeMode: 'dry' | 'live';
  maxOrderValueUsdt: number;
  maxDailyOrderValueUsdt: number;
  klineInterval: string;
  priceEventIntervalMs: number;
  autoTrade: boolean;
  autoTradeAmountUsdt: number;
  allowedSymbols: string[];
  wallet: { address: string } | null;
}

interface CryptoRuntime {
  config: CryptoRuntimeConfig;
  feed: CryptoFeed;
  guard: RiskGuard;
  stream: BinanceStream | null;
  timer: NodeJS.Timeout | null;
  pollInFlight: boolean;
  consecutiveFailures: number;
  lastSignals: Map<string, string>;
  lastPrices: Map<string, PricePoint>;
  lastPriceEvents: Map<string, number>;
  closes: Map<string, number[]>;
  lastKlineRefresh: number;
  positions: Map<string, number>;
}

interface CryptoFeed {
  refresh(): Promise<Map<string, PricePoint>>;
  readonly binanceClient: BinanceClient;
  readonly hasBinanceKeys: boolean;
}

function numberParam(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, value));
  }
  return fallback;
}

function parseCryptoConfig(input: unknown): CryptoRuntimeConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const symbols = Array.isArray(raw.symbols)
    ? raw.symbols
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .map((s) => s.toUpperCase())
    : [];
  if (symbols.length === 0) {
    throw new CryptoError('crypto.symbols must contain at least one symbol', 'INVALID_CONFIG');
  }
  const coinIds = Array.isArray(raw.coinIds)
    ? raw.coinIds.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : null;
  const source =
    raw.source === 'binance' || raw.source === 'coingecko' || raw.source === 'auto'
      ? raw.source
      : 'auto';
  const strategy = raw.strategy === 'sma' || raw.strategy === 'rsi' ? raw.strategy : 'alert';
  const strategyParams = (
    raw.strategyParams && typeof raw.strategyParams === 'object' ? raw.strategyParams : {}
  ) as Record<string, unknown>;
  const strategyProblems = validateStrategyParams(strategy, strategyParams);
  if (strategyProblems.length > 0) {
    throw new CryptoError(
      `Invalid strategy params for ${strategy}: ${strategyProblems.join('; ')}`,
      'INVALID_CONFIG',
    );
  }
  const pollIntervalMs = numberParam(raw.pollInterval, 60_000, 5000, 3_600_000);
  const tradeMode = raw.tradeMode === 'live' ? 'live' : 'dry';
  const envMax = Number(process.env.CRYPTO_MAX_ORDER_USDT);
  const maxOrderValueUsdt = numberParam(
    raw.maxOrderValueUsdt,
    Number.isFinite(envMax) && envMax > 0 ? envMax : 100,
    1,
    1_000_000,
  );
  // 0 (default) disables the cap entirely; otherwise live BUY orders are
  // counted against a rolling per-bot daily USDT spend window (UTC).
  const maxDailyOrderValueUsdt = numberParam(raw.maxDailyOrderValueUsdt, 0, 0, 100_000_000);
  const klineInterval =
    typeof strategyParams.klineInterval === 'string' && strategyParams.klineInterval.length > 0
      ? strategyParams.klineInterval
      : '15m';
  if (!KLINE_INTERVALS.has(klineInterval)) {
    throw new CryptoError(
      `Invalid klineInterval: ${klineInterval} (expected one of ${[...KLINE_INTERVALS].join(', ')})`,
      'INVALID_CONFIG',
    );
  }
  const priceEventIntervalMs = numberParam(
    strategyParams.priceEventIntervalMs,
    60_000,
    1000,
    3_600_000,
  );
  const autoTrade = strategyParams.autoTrade === true;
  const autoTradeAmountUsdt = numberParam(
    strategyParams.autoTradeAmountUsdt,
    maxOrderValueUsdt,
    1,
    1_000_000,
  );
  // Optional instrument whitelist; empty means the bot may trade any symbol.
  const allowedSymbols = Array.isArray(raw.allowedSymbols)
    ? [
        ...new Set(
          raw.allowedSymbols
            .filter((s): s is string => typeof s === 'string' && s.length > 0)
            .map((s) => s.toUpperCase()),
        ),
      ]
    : [];
  const wallet =
    raw.wallet &&
    typeof raw.wallet === 'object' &&
    typeof (raw.wallet as { address?: unknown }).address === 'string'
      ? { address: (raw.wallet as { address: string }).address }
      : null;
  return {
    symbols,
    coinIds,
    source,
    strategy,
    strategyParams,
    tradeMode,
    maxOrderValueUsdt,
    maxDailyOrderValueUsdt,
    pollIntervalMs,
    klineInterval,
    priceEventIntervalMs,
    autoTrade,
    autoTradeAmountUsdt,
    allowedSymbols,
    wallet,
  };
}

interface ApiKeyPair {
  apiKey: string;
  apiSecret: string;
}

/**
 * Collects the account's Binance key pairs: the `apiKeys` rotation pool first,
 * then the single apiKey/apiSecret (or apiSecret fallback to clientSecret).
 * Duplicates (the same key appearing in both the pool and the single fields,
 * or repeated inside the pool) are dropped so rotation never reuses an
 * identical pair and burns a failure on a key that already failed.
 */
export function buildKeyPairs(credentials: Record<string, unknown>): ApiKeyPair[] {
  const pairs: ApiKeyPair[] = [];
  const seen = new Set<string>();
  const push = (pair: ApiKeyPair): void => {
    const id = `${pair.apiKey}:${pair.apiSecret}`;
    if (!seen.has(id)) {
      seen.add(id);
      pairs.push(pair);
    }
  };
  const extra = Array.isArray(credentials.apiKeys) ? credentials.apiKeys : [];
  for (const pair of extra) {
    if (
      pair &&
      typeof pair === 'object' &&
      typeof (pair as { apiKey?: unknown }).apiKey === 'string' &&
      (pair as { apiKey: string }).apiKey.length > 0 &&
      typeof (pair as { apiSecret?: unknown }).apiSecret === 'string' &&
      (pair as { apiSecret: string }).apiSecret.length > 0
    ) {
      push({
        apiKey: (pair as { apiKey: string }).apiKey,
        apiSecret: (pair as { apiSecret: string }).apiSecret,
      });
    }
  }
  const singleKey = credentials.apiKey as string | undefined;
  const singleSecret =
    (credentials.apiSecret as string | undefined) ??
    (credentials.clientSecret as string | undefined);
  if (singleKey && singleSecret) push({ apiKey: singleKey, apiSecret: singleSecret });
  return pairs;
}

/**
 * Spreads poll cadence ±20% around the configured interval so bots that share
 * an account (and its Binance API keys) do not hit the API in synchronized
 * bursts, which triggers rate limits and rotates keys unnecessarily.
 */
function jitter(ms: number): number {
  return Math.round(ms * (1 + (Math.random() - 0.5) * 0.4));
}

export class CryptoWorker extends BaseWorker {
  readonly platformName = 'crypto';
  private readonly runtimes = new Map<string, CryptoRuntime>();
  private readonly keypairIndexes = new Map<string, number>();
  private readonly maxConsecutiveFailures = 5;
  private readonly feedFactory:
    ((config: CryptoRuntimeConfig, binance: BinanceClient) => CryptoFeed) | null;

  constructor(
    redisUrl: string,
    feedFactory?: (config: CryptoRuntimeConfig, binance: BinanceClient) => CryptoFeed,
  ) {
    super('crypto-queue', redisUrl, 10);
    this.feedFactory = feedFactory ?? null;
  }

  private static stringHash(value: string): number {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  /** Picks a key pair per bot, rotating on every connect (reconnect swaps keys). */
  private nextKeypairIndex(botId: string, count: number): number {
    if (count <= 1) return 0;
    const next = (this.keypairIndexes.get(botId) ?? CryptoWorker.stringHash(botId)) % count;
    this.keypairIndexes.set(botId, next + 1);
    return next;
  }

  async connect(credentials: Record<string, unknown>): Promise<void> {
    const botId = credentials.botId as string;
    if (!botId) throw new Error('Missing botId');

    const config = parseCryptoConfig(credentials.crypto ?? credentials.config);

    this.prepareConnect(botId);

    const previous = this.runtimes.get(botId);
    if (previous) {
      this.stopRuntime(previous);
      this.runtimes.delete(botId);
    }

    const pairs = buildKeyPairs(credentials);
    const pairIndex = this.nextKeypairIndex(botId, pairs.length);
    const pair = pairs.length > 0 ? pairs[pairIndex] : null;
    const proxyUrl =
      typeof credentials.proxy === 'string' && credentials.proxy.length > 0
        ? credentials.proxy
        : undefined;
    const binance = pair
      ? new BinanceClient({ apiKey: pair.apiKey, apiSecret: pair.apiSecret, proxyUrl })
      : new BinanceClient({ proxyUrl });
    const feed: CryptoFeed = this.feedFactory
      ? this.feedFactory(config, binance)
      : new PriceFeed({
          source: config.source,
          symbols: config.symbols,
          coinIds: config.coinIds ?? undefined,
          binance,
          coingecko: new CoinGeckoClient({ proxyUrl }),
        });
    const guard = new RiskGuard({
      tradeMode: config.tradeMode,
      maxOrderValueUsdt: config.maxOrderValueUsdt,
      hasKeys: binance.hasKeys,
      allowedSymbols: config.allowedSymbols,
    });

    if ((config.strategy === 'sma' || config.strategy === 'rsi') && config.source === 'coingecko') {
      throw new Error('sma/rsi strategies require Binance as the price source');
    }

    const initial = await feed.refresh();
    if (initial.size === 0) {
      throw new Error('No prices returned by the configured price source');
    }

    const runtime: CryptoRuntime = {
      config,
      feed,
      guard,
      stream: null,
      timer: null,
      pollInFlight: false,
      consecutiveFailures: 0,
      lastSignals: new Map(),
      lastPrices: new Map(initial),
      lastPriceEvents: new Map(),
      closes: new Map(),
      lastKlineRefresh: 0,
      positions: config.tradeMode === 'dry' ? await this.loadPositions(botId) : new Map(),
    };

    if (config.source !== 'coingecko') {
      const stream = new BinanceStream(config.symbols, (update) =>
        this.onStreamUpdate(botId, update),
      );
      runtime.stream = stream;
      stream.start();
    }

    runtime.timer = setInterval(() => {
      void this.poll(botId, runtime, credentials);
    }, jitter(config.pollIntervalMs));

    this.runtimes.set(botId, runtime);

    try {
      await this.pollOnce(botId, runtime);
    } catch (err) {
      this.stopRuntime(runtime);
      this.runtimes.delete(botId);
      await this.markDisconnected(botId, `Initial poll failed: ${err}`);
      throw err;
    }

    await this.markConnected(botId);
  }

  private onStreamUpdate(botId: string, update: StreamUpdate): void {
    const runtime = this.runtimes.get(botId);
    if (!runtime) return;
    const symbol = update.symbol.toUpperCase();
    const current = runtime.lastPrices.get(symbol);
    if (current) {
      runtime.lastPrices.set(symbol, {
        ...current,
        price: update.price,
        change24h: update.change24h ?? current.change24h,
        timestamp: update.timestamp,
      });
    }
  }

  private async poll(
    botId: string,
    runtime: CryptoRuntime,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    if (runtime.pollInFlight) return;
    runtime.pollInFlight = true;
    try {
      await this.pollOnce(botId, runtime);
      runtime.consecutiveFailures = 0;
    } catch (err) {
      runtime.consecutiveFailures += 1;
      console.error(`[crypto] Poll error for ${botId}:`, err);
      void this.writeLog(botId, 'error', `Crypto polling error: ${(err as Error)?.message ?? err}`);
      if (runtime.consecutiveFailures >= this.maxConsecutiveFailures) {
        await this.markDisconnected(
          botId,
          `Polling failed ${runtime.consecutiveFailures} times in a row`,
        );
        this.stopRuntime(runtime);
        this.runtimes.delete(botId);
        await this.scheduleReconnect(botId, credentials);
      }
    } finally {
      runtime.pollInFlight = false;
    }
  }

  private async pollOnce(botId: string, runtime: CryptoRuntime): Promise<void> {
    const config = runtime.config;
    const prices = await runtime.feed.refresh();

    if (config.strategy === 'sma' || config.strategy === 'rsi') {
      await this.refreshKlines(botId, runtime);
    }

    for (const symbol of config.symbols) {
      const point = prices.get(symbol);
      if (!point) continue;
      const previous = runtime.lastPrices.get(symbol);
      const previousPrice = previous ? previous.price : point.price;

      const signal = evaluateStrategy(
        config.strategy,
        config.strategyParams,
        runtime.closes.get(symbol) ?? [],
        point.price,
        previousPrice,
      );
      if (signal) {
        const lastDirection = runtime.lastSignals.get(symbol);
        if (lastDirection !== signal.direction) {
          runtime.lastSignals.set(symbol, signal.direction);
          await this.emit({
            botId,
            platform: 'crypto',
            type: 'signal',
            payload: {
              symbol,
              direction: signal.direction,
              price: signal.price,
              reason: signal.reason,
              source: point.source,
              change24h: point.change24h,
            },
            timestamp: new Date(),
          });
          if (config.autoTrade) {
            await this.autoTrade(botId, runtime, symbol, signal.direction, point.price);
          }
        }
      }

      const now = Date.now();
      const lastEmit = runtime.lastPriceEvents.get(symbol) ?? 0;
      if (now - lastEmit >= config.priceEventIntervalMs) {
        runtime.lastPriceEvents.set(symbol, now);
        await this.emit({
          botId,
          platform: 'crypto',
          type: 'price',
          payload: {
            symbol,
            price: point.price,
            change24h: point.change24h,
            source: point.source,
          },
          timestamp: new Date(),
        });
      }

      runtime.lastPrices.set(symbol, point);
    }
  }

  private async refreshKlines(botId: string, runtime: CryptoRuntime): Promise<void> {
    const now = Date.now();
    const throttleMs = Math.max(runtime.config.pollIntervalMs, 60_000);
    if (now - runtime.lastKlineRefresh < throttleMs) return;
    runtime.lastKlineRefresh = now;
    const results = await Promise.allSettled(
      runtime.config.symbols.map(async (symbol) => {
        try {
          const klines = await runtime.feed.binanceClient.klines(
            symbol,
            runtime.config.klineInterval,
            100,
          );
          return { symbol, closes: klines.map((k) => k.close) };
        } catch (err) {
          const wrapped = new Error(`${symbol}: ${(err as Error)?.message ?? err}`);
          (wrapped as Error & { symbol?: string }).symbol = symbol;
          throw wrapped;
        }
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        runtime.closes.set(result.value.symbol, result.value.closes);
      } else {
        const symbol = (result.reason as Error & { symbol?: string })?.symbol ?? '';
        void this.writeLog(
          botId,
          'warn',
          `Kline fetch failed for ${symbol}: ${(result.reason as Error)?.message ?? String(result.reason)}`,
        );
      }
    }
  }

  private async autoTrade(
    botId: string,
    runtime: CryptoRuntime,
    symbol: string,
    direction: SignalDirection,
    price: number,
  ): Promise<void> {
    if (direction === 'buy') {
      const plan = runtime.guard.planMarketBuy(symbol, price, runtime.config.autoTradeAmountUsdt);
      if (!plan.ok) {
        void this.writeLog(botId, 'warn', `Auto-trade buy blocked: ${plan.reason}`);
        return;
      }
      await this.placeOrder(botId, runtime, symbol, plan.plan, price, 'auto-signal');
      return;
    }

    let quantity: number;
    if (runtime.config.tradeMode === 'live') {
      try {
        const balance = await runtime.feed.binanceClient.balance(baseOf(symbol));
        quantity = balance.free;
      } catch (err) {
        void this.writeLog(
          botId,
          'error',
          `Balance fetch failed for sell: ${(err as Error)?.message ?? err}`,
        );
        return;
      }
    } else {
      quantity = runtime.positions.get(symbol.toUpperCase()) ?? 0;
    }
    if (quantity <= 0) {
      void this.writeLog(botId, 'warn', `Auto-trade sell skipped: no ${baseOf(symbol)} to sell`);
      return;
    }
    const plan = runtime.guard.planMarketSell(symbol, price, quantity);
    if (!plan.ok) {
      void this.writeLog(botId, 'warn', `Auto-trade sell blocked: ${plan.reason}`);
      return;
    }
    await this.placeOrder(botId, runtime, symbol, plan.plan, price, 'auto-signal');
  }

  private async placeOrder(
    botId: string,
    runtime: CryptoRuntime,
    symbol: string,
    plan: OrderPlan,
    price: number,
    origin: string,
  ): Promise<Record<string, unknown>> {
    const isLive = runtime.config.tradeMode === 'live';
    let executed: Record<string, unknown>;
    if (isLive) {
      if (plan.side === 'buy' && !(await this.claimDailySpend(botId, plan.valueUsdt))) {
        return { blocked: true, reason: 'daily spend limit reached', simulated: false };
      }
      try {
        const res = await runtime.feed.binanceClient.order({
          symbol: plan.symbol,
          side: plan.side === 'buy' ? 'BUY' : 'SELL',
          type: plan.type === 'limit' ? 'LIMIT' : 'MARKET',
          quantity: plan.quantity,
          quoteOrderQty: plan.quoteOrderQty,
          price: plan.price,
        });
        executed = {
          orderId: res.orderId,
          status: res.status,
          executedQty: res.executedQty,
          cummulativeQuoteQty: res.cummulativeQuoteQty,
          price: res.price,
        };
      } catch (err) {
        if (plan.side === 'buy') await this.refundDailySpend(botId, plan.valueUsdt);
        throw err;
      }
    } else {
      executed = {
        simulated: true,
        orderId: `dry-${Date.now()}`,
        status: 'SIMULATED',
        executedQty: plan.quantity ?? 0,
        price: plan.price ?? price,
      };
    }

    if (plan.side === 'buy') {
      const qty = plan.quantity ?? (plan.quoteOrderQty ? plan.quoteOrderQty / price : 0);
      runtime.positions.set(plan.symbol, (runtime.positions.get(plan.symbol) ?? 0) + qty);
    } else if (plan.quantity) {
      const remaining = (runtime.positions.get(plan.symbol) ?? 0) - plan.quantity;
      if (remaining > 1e-10) runtime.positions.set(plan.symbol, remaining);
      else runtime.positions.delete(plan.symbol);
    }
    if (!isLive) await this.savePositions(botId, runtime.positions);

    const executedPrice =
      typeof executed.price === 'number' && executed.price > 0 ? executed.price : price;
    await this.emit({
      botId,
      platform: 'crypto',
      type: 'trade',
      payload: {
        symbol: plan.symbol,
        side: plan.side,
        type: plan.type,
        quantity: plan.quantity,
        quoteOrderQty: plan.quoteOrderQty,
        price: plan.price ?? executedPrice,
        valueUsdt: plan.valueUsdt,
        tradeMode: isLive ? 'live' : 'dry',
        simulated: !isLive,
        origin,
        ...executed,
      },
      timestamp: new Date(),
    });
    void this.writeLog(
      botId,
      'info',
      `Trade ${origin}: ${plan.side} ${plan.type} ${plan.symbol} qty=${plan.quantity ?? plan.quoteOrderQty} price=${plan.price ?? price} (${isLive ? 'live' : 'dry-run'})`,
    );
    return executed;
  }

  private async loadPositions(botId: string): Promise<Map<string, number>> {
    try {
      const raw = await stateRedis.get(positionsKey(botId));
      if (!raw) return new Map();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const positions = new Map<string, number>();
      for (const [symbol, qty] of Object.entries(parsed)) {
        if (typeof qty === 'number' && qty > 0) positions.set(symbol.toUpperCase(), qty);
      }
      return positions;
    } catch (err) {
      console.error(`[crypto] Failed to load dry-run positions for ${botId}:`, err);
      return new Map();
    }
  }

  private async savePositions(botId: string, positions: Map<string, number>): Promise<void> {
    try {
      await stateRedis.set(positionsKey(botId), JSON.stringify(Object.fromEntries(positions)));
    } catch (err) {
      console.error(`[crypto] Failed to save dry-run positions for ${botId}:`, err);
    }
  }

  /**
   * Atomically claims the order's USDT value against the bot's daily spend
   * window (UTC, per bot). Returns false when the cap would be exceeded; the
   * claim is refunded in that case. Fail-open when Redis is unavailable.
   */
  private async claimDailySpend(botId: string, valueUsdt: number): Promise<boolean> {
    const capUsdt = this.runtimes.get(botId)?.config.maxDailyOrderValueUsdt ?? 0;
    if (capUsdt <= 0 || !Number.isFinite(valueUsdt) || valueUsdt <= 0) return true;
    const key = dailySpendKey(botId, utcDate());
    const cents = Math.max(1, Math.round(valueUsdt * 100));
    try {
      const totalCents = await stateRedis.incrby(key, cents);
      if (totalCents > Math.round(capUsdt * 100)) {
        await stateRedis.decrby(key, cents);
        void this.writeLog(
          botId,
          'warn',
          `Buy blocked: daily spend limit ${capUsdt} USDT already reached`,
        );
        return false;
      }
      await stateRedis.pexpire(key, DAILY_SPEND_TTL_MS);
      return true;
    } catch (err) {
      console.error(`[crypto] Daily spend check failed for ${botId}:`, err);
      return true;
    }
  }

  private async refundDailySpend(botId: string, valueUsdt: number): Promise<void> {
    if (!Number.isFinite(valueUsdt) || valueUsdt <= 0) return;
    try {
      await stateRedis.decrby(
        dailySpendKey(botId, utcDate()),
        Math.max(1, Math.round(valueUsdt * 100)),
      );
    } catch (err) {
      console.error(`[crypto] Daily spend refund failed for ${botId}:`, err);
    }
  }

  private async orderFromAction(
    botId: string,
    runtime: CryptoRuntime,
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const symbol = String(payload.symbol ?? '').toUpperCase();
    if (!symbol) throw new Error(`${type}${side === 'buy' ? 'Buy' : 'Sell'} requires symbol`);
    if (!runtime.guard.isAllowed(symbol)) {
      throw new Error(`Symbol ${symbol} is not in the bot's allowed list`);
    }
    const price = await this.currentPrice(runtime, symbol);

    let plan: PlanResult;
    if (type === 'limit') {
      const limitPrice = Number(payload.price);
      const quantity = Number(payload.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('limit order requires a positive quantity');
      }
      plan = runtime.guard.planLimit(symbol, side, limitPrice, quantity);
    } else if (side === 'buy') {
      const amount = Number(payload.amountUsdt ?? runtime.config.maxOrderValueUsdt);
      plan = runtime.guard.planMarketBuy(symbol, price, amount);
    } else {
      const quantity = Number(payload.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('marketSell requires a positive quantity');
      }
      plan = runtime.guard.planMarketSell(symbol, price, quantity);
    }

    if (!plan.ok) throw new Error(plan.reason);
    return this.placeOrder(botId, runtime, symbol, plan.plan, price, 'script');
  }

  private async fetchPrice(
    runtime: CryptoRuntime,
    symbol: string,
  ): Promise<PricePoint | undefined> {
    const prices = await runtime.feed.refresh();
    const point = prices.get(symbol);
    if (point) runtime.lastPrices.set(symbol, point);
    return point;
  }

  private async currentPrice(runtime: CryptoRuntime, symbol: string): Promise<number> {
    const cached = runtime.lastPrices.get(symbol);
    if (cached && Date.now() - cached.timestamp <= PRICE_STALE_MS) return cached.price;
    const point = await this.fetchPrice(runtime, symbol);
    if (!point) throw new Error(`No price available for ${symbol}`);
    return point.price;
  }

  async executeAction(
    botId: string,
    action: { type: string; payload: Record<string, unknown> },
  ): Promise<unknown> {
    const runtime = this.runtimes.get(botId);
    if (!runtime) throw new Error(`Bot ${botId} not connected`);
    const payload = action.payload ?? {};

    switch (action.type) {
      case 'getPrice': {
        const symbol = String(payload.symbol ?? '').toUpperCase();
        if (!symbol) throw new Error('getPrice requires symbol');
        const cached = runtime.lastPrices.get(symbol);
        const point =
          cached && Date.now() - cached.timestamp <= PRICE_STALE_MS
            ? cached
            : await this.fetchPrice(runtime, symbol);
        if (!point) throw new Error(`No price available for ${symbol}`);
        return {
          symbol,
          price: point.price,
          change24h: point.change24h,
          source: point.source,
          timestamp: new Date(point.timestamp).toISOString(),
        };
      }
      case 'getCandles': {
        const symbol = String(payload.symbol ?? '').toUpperCase();
        if (!symbol) throw new Error('getCandles requires symbol');
        const interval =
          typeof payload.interval === 'string' && payload.interval.length > 0
            ? payload.interval
            : runtime.config.klineInterval;
        if (!KLINE_INTERVALS.has(interval)) {
          throw new Error(`Invalid interval: ${interval}`);
        }
        const limit =
          typeof payload.limit === 'number' && Number.isFinite(payload.limit)
            ? Math.min(1000, Math.max(1, Math.trunc(payload.limit)))
            : 100;
        const klines = await runtime.feed.binanceClient.klines(symbol, interval, limit);
        return {
          symbol,
          interval,
          klines: klines.map((k) => ({
            time: k.openTime,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
          })),
        };
      }
      case 'getBalance': {
        const asset = String(payload.asset ?? '').toUpperCase();
        if (runtime.config.tradeMode === 'live') {
          if (!asset) throw new Error('getBalance requires asset');
          return runtime.feed.binanceClient.balance(asset);
        }
        return {
          asset: asset || 'USDT',
          free: 0,
          locked: 0,
          simulated: true,
          note: 'dry-run: balances are not queried',
        };
      }
      case 'getWallet': {
        const wallet = runtime.config.wallet;
        if (!wallet) throw new Error('No EVM wallet configured for this bot');
        // The private key stays encrypted at rest and is never exposed to
        // scripts; only the address is returned.
        return { address: wallet.address, privateKey: null };
      }
      case 'marketBuy':
        return this.orderFromAction(botId, runtime, 'buy', 'market', payload);
      case 'marketSell':
        return this.orderFromAction(botId, runtime, 'sell', 'market', payload);
      case 'limitBuy':
        return this.orderFromAction(botId, runtime, 'buy', 'limit', payload);
      case 'limitSell':
        return this.orderFromAction(botId, runtime, 'sell', 'limit', payload);
      default:
        throw new Error(`Unknown action: ${action.type}`);
    }
  }

  async disconnect(botId: string): Promise<void> {
    const runtime = this.runtimes.get(botId);
    if (runtime) {
      this.stopRuntime(runtime);
      this.runtimes.delete(botId);
    }
    const reconnectTimer = this.reconnectTimers.get(botId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(botId);
    }
    this.bots.delete(botId);
    await this.markDisconnected(botId);
  }

  private stopRuntime(runtime: CryptoRuntime): void {
    if (runtime.timer) {
      clearInterval(runtime.timer);
      runtime.timer = null;
    }
    if (runtime.stream) {
      runtime.stream.close();
      runtime.stream = null;
    }
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.runtimes.has(botId);
  }
}
