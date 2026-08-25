import { randomUUID } from 'node:crypto';
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
  type OrderResult,
  type PlanResult,
  type PricePoint,
  type SignalDirection,
} from '@bothive/core';
import { BaseWorker, createCommandRedis } from '../base-worker.js';
import { SymbolStreamHub, type HubTick } from './stream-hub.js';
import { TradeLedger, type LedgerSnapshot, type TrackedOrder } from './ledger.js';

/** Prices older than this are re-fetched instead of being reused. */
const PRICE_STALE_MS = 30_000;

/** Minimum gap between strategy evaluations triggered by stream ticks. */
const TICK_EVAL_MIN_MS = 2_000;

// Fail-fast command Redis used for the dry-run position ledger and the daily
// spend counter; a Redis outage degrades those to in-memory/no-op instead of
// blocking trades.
const stateRedis = createCommandRedis('crypto-state');
void stateRedis
  .connect()
  .catch((err) => console.error('[workers] crypto-state Redis connect failed:', err));

const positionsKey = (botId: string): string => `bothive:crypto:positions:${botId}`;
const liveStateKey = (botId: string): string => `bothive:crypto:live:${botId}`;
const dailySpendKey = (botId: string, date: string): string =>
  `bothive:crypto:daily:${botId}:${date}`;
const utcDate = (): string => new Date().toISOString().slice(0, 10);
const DAILY_SPEND_TTL_MS = 48 * 3600 * 1000;

/** Maps a plain object of finite positive numbers into an uppercase-keyed map. */
function toPositiveNumberMap(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!value || typeof value !== 'object') return out;
  for (const [key, num] of Object.entries(value as Record<string, unknown>)) {
    if (typeof num === 'number' && Number.isFinite(num) && num > 0) {
      out.set(key.toUpperCase(), num);
    }
  }
  return out;
}

/** Shared empty closes buffer for strategies that do not use klines. */
const EMPTY_CLOSES: number[] = [];

/** How often the live ledger reconciles against the exchange (positions, fills). */
const RECONCILE_INTERVAL_MS = 60_000;

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
  /** Open limit orders older than this are cancelled (0 = never). */
  orderTtlMs: number;
  /** Percent below the avg entry that closes the position (0 = disabled). */
  stopLossPct: number;
  /** Percent above the avg entry that closes the position (0 = disabled). */
  takeProfitPct: number;
  /** Percent below the running high that closes the position (0 = disabled). */
  trailingStopPct: number;
}

interface CryptoRuntime {
  config: CryptoRuntimeConfig;
  feed: CryptoFeed;
  guard: RiskGuard;
  /** Per-symbol hub subscriptions; disposed on disconnect. */
  streamUnsubs: Array<() => void>;
  timer: NodeJS.Timeout | null;
  pollInFlight: boolean;
  consecutiveFailures: number;
  lastSignals: Map<string, string>;
  lastPrices: Map<string, PricePoint>;
  lastPriceEvents: Map<string, number>;
  lastTickEvals: Map<string, number>;
  closes: Map<string, number[]>;
  lastKlineRefresh: number;
  positions: Map<string, number>;
  avgEntries: Map<string, number>;
  trailingHighs: Map<string, number>;
  ledger: TradeLedger;
  lastReconcile: number;
  /** True when any protective exit guard is armed (hoisted off the hot path). */
  exitEnabled: boolean;
  /** Symbols with a protective exit currently mid-flight (poll/stream dedupe). */
  exitInFlight: Set<string>;
  /** Cached free balances per base asset, refreshed at most once per TTL. */
  balanceCache: Map<string, { free: number; at: number }>;
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
  // 0 disables auto-cancellation entirely; otherwise stale open limit orders
  // are cancelled so capital never stays locked in unfilled orders forever.
  const orderTtlMs = numberParam(strategyParams.orderTtlMs, 86_400_000, 300_000, 30 * 86_400_000);
  // Exit guards are percent-based (0 disables the guard); they only act when
  // autoTrade manages positions, and are safe in both trade modes.
  const stopLossPct = numberParam(strategyParams.stopLossPct, 0, 0, 90);
  const takeProfitPct = numberParam(strategyParams.takeProfitPct, 0, 0, 1000);
  const trailingStopPct = numberParam(strategyParams.trailingStopPct, 0, 0, 90);
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
    orderTtlMs,
    stopLossPct,
    takeProfitPct,
    trailingStopPct,
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
  private readonly symbolHub = new SymbolStreamHub();

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

    const dryState = config.tradeMode === 'dry' ? await this.loadDryState(botId) : null;

    const runtime: CryptoRuntime = {
      config,
      feed,
      guard,
      streamUnsubs: [],
      timer: null,
      pollInFlight: false,
      consecutiveFailures: 0,
      lastSignals: new Map(),
      lastPrices: new Map(initial),
      lastPriceEvents: new Map(),
      lastTickEvals: new Map(),
      closes: new Map(),
      lastKlineRefresh: 0,
      positions: dryState ? dryState.positions : new Map(),
      avgEntries: dryState ? dryState.avgEntry : new Map(),
      trailingHighs: dryState ? dryState.trailingHigh : new Map(),
      ledger: config.tradeMode === 'live' ? await this.loadLedger(botId) : new TradeLedger(),
      lastReconcile: 0,
      exitEnabled:
        config.autoTrade &&
        (config.stopLossPct > 0 || config.takeProfitPct > 0 || config.trailingStopPct > 0),
      exitInFlight: new Set(),
      balanceCache: new Map(),
    };

    if (config.source !== 'coingecko') {
      // One socket per symbol, shared across every bot on this worker — the
      // socket count grows with distinct symbols, never with bots.
      runtime.streamUnsubs = config.symbols.map((symbol) =>
        this.symbolHub.subscribe(symbol, (tick) => this.onStreamTick(botId, tick)),
      );
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

  private onStreamTick(botId: string, tick: HubTick): void {
    const runtime = this.runtimes.get(botId);
    if (!runtime) return;
    const symbol = tick.symbol.toUpperCase();
    const current = runtime.lastPrices.get(symbol);
    if (!current) return;
    const point: PricePoint = {
      ...current,
      price: tick.price,
      change24h: tick.change24h ?? current.change24h,
      timestamp: tick.timestamp,
    };

    // Ticks are far denser than the REST poll; evaluate the strategy at most
    // every TICK_EVAL_MIN_MS per symbol so signals and auto-trades stay
    // responsive without thrashing on every single tick. evaluateSymbol
    // stores the point itself (so its "previous" read sees the old price);
    // throttled ticks only refresh the cached price.
    const now = Date.now();
    const last = runtime.lastTickEvals.get(symbol) ?? 0;
    if (now - last >= TICK_EVAL_MIN_MS) {
      runtime.lastTickEvals.set(symbol, now);
      void this.evaluateSymbol(botId, runtime, symbol, point).catch((err) => {
        void this.writeLog(
          botId,
          'error',
          `Stream evaluation failed: ${(err as Error)?.message ?? err}`,
        );
      });
    } else {
      runtime.lastPrices.set(symbol, point);
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
    if (config.tradeMode === 'live') {
      const now = Date.now();
      if (now - runtime.lastReconcile >= RECONCILE_INTERVAL_MS) {
        runtime.lastReconcile = now;
        await this.reconcileLedger(botId, runtime);
      }
    }
    const prices = await runtime.feed.refresh();

    if (config.strategy === 'sma' || config.strategy === 'rsi') {
      await this.refreshKlines(botId, runtime);
    }

    for (const symbol of config.symbols) {
      const point = prices.get(symbol);
      if (!point) continue;
      await this.evaluateSymbol(botId, runtime, symbol, point);
    }
  }

  /**
   * Runs a symbol's point through the strategy pipeline: signal detection
   * (deduplicated by direction) with optional auto-trade, throttled price
   * events, and a final refresh of the cached price. Shared by the REST poll
   * and the realtime stream path.
   */
  private async evaluateSymbol(
    botId: string,
    runtime: CryptoRuntime,
    symbol: string,
    point: PricePoint,
  ): Promise<void> {
    const config = runtime.config;

    // A protective exit mid-flight (poll and stream share the symbol) must not
    // be joined by a second evaluation: both paths would read the same
    // pre-fill position and sell twice.
    if (runtime.exitInFlight.has(symbol)) return;

    // Protective exits run BEFORE the strategy signal so a stop-loss/take-
    // profit tick can never be overridden by what the strategy says. The
    // hoisted gate keeps the no-guards path fully synchronous.
    if (runtime.exitEnabled) {
      const exited = await this.checkExits(botId, runtime, symbol, point.price);
      if (exited) {
        runtime.lastPrices.set(symbol, point);
        return;
      }
    }

    const previous = runtime.lastPrices.get(symbol);
    const previousPrice = previous ? previous.price : point.price;

    const signal = evaluateStrategy(
      config.strategy,
      config.strategyParams,
      runtime.closes.get(symbol) ?? EMPTY_CLOSES,
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

  /**
   * Protective exits (stop-loss / take-profit / trailing stop) for auto-traded
   * positions. The live quantity is cross-checked against the exchange balance
   * (the ledger can lag the exchange between reconciliations); dry quantity
   * comes from the simulated position. Closing marks the strategy dedupe so a
   * stale sell signal cannot fire while the position is flat. Returns true
   * when the position was closed on this tick.
   */
  private async checkExits(
    botId: string,
    runtime: CryptoRuntime,
    symbol: string,
    price: number,
  ): Promise<boolean> {
    if (!runtime.exitEnabled) return false;
    // Re-entrancy guard: the REST poll and the stream path may evaluate the
    // same symbol concurrently; a second exit would sell a position whose
    // fill has not been applied yet.
    if (runtime.exitInFlight.has(symbol)) return false;
    runtime.exitInFlight.add(symbol);
    try {
      return await this.checkExitsInner(botId, runtime, symbol, price);
    } finally {
      runtime.exitInFlight.delete(symbol);
    }
  }

  private async checkExitsInner(
    botId: string,
    runtime: CryptoRuntime,
    symbol: string,
    price: number,
  ): Promise<boolean> {
    const config = runtime.config;
    const { stopLossPct, takeProfitPct, trailingStopPct } = config;

    const isLive = config.tradeMode === 'live';
    let quantity = isLive ? runtime.ledger.position(symbol) : (runtime.positions.get(symbol) ?? 0);
    // Flat positions skip the balance round-trip entirely.
    if (quantity <= 0) return false;
    if (isLive) {
      try {
        quantity = Math.min(quantity, await this.liveFreeBalance(runtime, baseOf(symbol)));
      } catch (err) {
        void this.writeLog(
          botId,
          'error',
          `Balance fetch failed for exit: ${(err as Error)?.message ?? err}`,
        );
        return false;
      }
    }
    if (quantity <= 0) return false;

    const entry = isLive
      ? runtime.ledger.avgEntryFor(symbol)
      : (runtime.avgEntries.get(symbol) ?? 0);
    if (!Number.isFinite(entry) || entry <= 0) return false;

    let reason: 'stop_loss' | 'take_profit' | 'trailing_stop' | null = null;

    if (takeProfitPct > 0 && price >= entry * (1 + takeProfitPct / 100)) {
      reason = 'take_profit';
    } else {
      let trailHigh: number | undefined;
      let trailStop: number | null = null;
      if (trailingStopPct > 0) {
        trailHigh = isLive
          ? runtime.ledger.trailingHighFor(symbol)
          : runtime.trailingHighs.get(symbol);
        // Ratchet the high on every tick; the stop may only ever rise. Only
        // write the map when the high actually moved so steady-state ticks
        // stay allocation-free.
        const high = Math.max(trailHigh ?? entry, price);
        if (trailHigh === undefined || high > trailHigh) {
          if (isLive) runtime.ledger.setTrailingHigh(symbol, high);
          else runtime.trailingHighs.set(symbol, high);
        }
        trailStop = high * (1 - trailingStopPct / 100);
      }
      const fixedStop = stopLossPct > 0 ? entry * (1 - stopLossPct / 100) : null;
      const stop =
        fixedStop !== null && trailStop !== null
          ? Math.max(fixedStop, trailStop)
          : (fixedStop ?? trailStop);
      if (stop !== null && price <= stop) {
        reason =
          trailStop !== null && trailHigh !== undefined && trailHigh > entry
            ? 'trailing_stop'
            : 'stop_loss';
      }
    }

    if (!reason) return false;

    // Exits are always risk-reducing: the position may exceed the per-order
    // cap after several buys, so the guard must not block the close.
    const plan = runtime.guard.planMarketSell(symbol, price, quantity, { exit: true });
    if (!plan.ok) {
      void this.writeLog(botId, 'warn', `${reason} exit blocked: ${plan.reason}`);
      return false;
    }
    await this.placeOrder(botId, runtime, symbol, plan.plan, price, reason);
    runtime.lastSignals.set(symbol, 'sell');
    return true;
  }

  /**
   * Free balance of a base asset, cached for two poll intervals (min 10s) so
   * live exit checks do not hit the REST API on every tick. The cache is
   * refreshed by the periodic reconcile (which fetches every balance anyway)
   * and invalidated after every sell fill. A stale entry is returned as a
   * last-known fallback when the fetch fails, so a transient API hiccup never
   * blocks a protective exit.
   */
  private async liveFreeBalance(runtime: CryptoRuntime, base: string): Promise<number> {
    const cached = runtime.balanceCache.get(base);
    const ttl = Math.max(runtime.config.pollIntervalMs * 2, 10_000);
    if (cached && Date.now() - cached.at < ttl) return cached.free;
    try {
      const balance = await runtime.feed.binanceClient.balance(base);
      runtime.balanceCache.set(base, { free: balance.free, at: Date.now() });
      return balance.free;
    } catch (err) {
      // A stale entry is still better than aborting the exit outright.
      if (cached) return cached.free;
      throw err;
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
        quantity = await this.liveFreeBalance(runtime, baseOf(symbol));
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
      // Stable per-order id so reconciliation and cancellation can reference
      // the order without ambiguity (also Binance's idempotency key).
      // randomUUID provides 128-bit randomness — collision probability < 10^-18
      // even at 10^9 orders. Date.now().toString(36) prefix preserves recency
      // for debugging while staying within Binance's 36-char limit.
      const clientOrderId = `bh${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      try {
        const res = await runtime.feed.binanceClient.order({
          symbol: plan.symbol,
          side: plan.side === 'buy' ? 'BUY' : 'SELL',
          type: plan.type === 'limit' ? 'LIMIT' : 'MARKET',
          quantity: plan.quantity,
          quoteOrderQty: plan.quoteOrderQty,
          price: plan.price,
          clientOrderId,
        });
        executed = {
          orderId: res.orderId,
          clientOrderId,
          status: res.status,
          executedQty: res.executedQty,
          cummulativeQuoteQty: res.cummulativeQuoteQty,
          price: res.price,
        };
        if (res.executedQty > 0 && (res.status === 'FILLED' || res.status === 'PARTIALLY_FILLED')) {
          const avgPrice = res.executedQty > 0 ? res.cummulativeQuoteQty / res.executedQty : price;
          runtime.ledger.applyFill(plan.symbol, plan.side, res.executedQty, avgPrice);
          // The sell removed base from the exchange; the cached free balance
          // would otherwise over-state it on the very next exit check.
          if (plan.side === 'sell') runtime.balanceCache.delete(baseOf(plan.symbol));
        } else {
          // Open limit order: the ledger tracks it until the exchange reports
          // a fill (reconciliation) or it is cancelled as stale.
          runtime.ledger.recordOrder({
            clientOrderId,
            orderId: res.orderId,
            symbol: plan.symbol,
            side: plan.side,
            type: plan.type,
            // Market orders carry no limit price; fall back to the reference
            // price so a later refund of an un-filled remainder (edge case:
            // a market order left open) stays computable.
            price: plan.price ?? price,
            quantity: plan.quantity ?? (plan.quoteOrderQty ? plan.quoteOrderQty / price : 0),
            placedAt: Date.now(),
          });
        }
        await this.saveLedger(botId, runtime);
      } catch (err) {
        if (plan.side === 'buy') await this.refundDailySpend(botId, plan.valueUsdt);
        // A failed order means the cached balance may no longer be sellable
        // (e.g. a rejected sell after an external withdrawal); drop it so the
        // next check re-fetches instead of retrying a doomed order.
        runtime.balanceCache.clear();
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

    // Dry-run positions are simulated locally; live positions live in the
    // ledger (fed by fills and balance reconciliation), never both.
    if (!isLive) {
      if (plan.side === 'buy') {
        const qty = plan.quantity ?? (plan.quoteOrderQty ? plan.quoteOrderQty / price : 0);
        const current = runtime.positions.get(plan.symbol) ?? 0;
        const known = runtime.avgEntries.get(plan.symbol) ?? 0;
        const next = current + qty;
        runtime.avgEntries.set(
          plan.symbol,
          // Rebase on the buy price when the existing basis is unknown (e.g.
          // a legacy flat state that predates entry tracking).
          known > 0 ? (current * known + qty * price) / next : price,
        );
        runtime.positions.set(plan.symbol, next);
        runtime.trailingHighs.delete(plan.symbol);
      } else if (plan.quantity) {
        // trim8 rounds the sold quantity to 8 decimals, leaving a sub-cent
        // residue on a full close; treat it as fully closed.
        const remaining = (runtime.positions.get(plan.symbol) ?? 0) - plan.quantity;
        if (remaining > 1e-8) runtime.positions.set(plan.symbol, remaining);
        else {
          runtime.positions.delete(plan.symbol);
          runtime.avgEntries.delete(plan.symbol);
          runtime.trailingHighs.delete(plan.symbol);
        }
      }
      await this.saveDryState(botId, {
        positions: runtime.positions,
        avgEntry: runtime.avgEntries,
        trailingHigh: runtime.trailingHighs,
      });
    }

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

  private async loadDryState(botId: string): Promise<{
    positions: Map<string, number>;
    avgEntry: Map<string, number>;
    trailingHigh: Map<string, number>;
  }> {
    const empty = {
      positions: new Map<string, number>(),
      avgEntry: new Map<string, number>(),
      trailingHigh: new Map<string, number>(),
    };
    try {
      const raw = await stateRedis.get(positionsKey(botId));
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.positions === 'object' &&
        parsed.positions !== null
      ) {
        // Versioned shape: { positions, avgEntry, trailingHigh }.
        return {
          positions: toPositiveNumberMap(parsed.positions),
          avgEntry: toPositiveNumberMap(parsed.avgEntry),
          trailingHigh: toPositiveNumberMap(parsed.trailingHigh),
        };
      }
      // Legacy shape: a plain symbol -> quantity record.
      return { ...empty, positions: toPositiveNumberMap(parsed) };
    } catch (err) {
      console.error(`[crypto] Failed to load dry-run state for ${botId}:`, err);
      return empty;
    }
  }

  private async saveDryState(
    botId: string,
    state: {
      positions: Map<string, number>;
      avgEntry: Map<string, number>;
      trailingHigh: Map<string, number>;
    },
  ): Promise<void> {
    try {
      await stateRedis.set(
        positionsKey(botId),
        JSON.stringify({
          positions: Object.fromEntries(state.positions),
          avgEntry: Object.fromEntries(state.avgEntry),
          trailingHigh: Object.fromEntries(state.trailingHigh),
        }),
      );
    } catch (err) {
      console.error(`[crypto] Failed to save dry-run state for ${botId}:`, err);
    }
  }

  private async loadLedger(botId: string): Promise<TradeLedger> {
    try {
      const raw = await stateRedis.get(liveStateKey(botId));
      if (!raw) return new TradeLedger();
      return TradeLedger.fromSnapshot(JSON.parse(raw) as LedgerSnapshot);
    } catch (err) {
      console.error(`[crypto] Failed to load live ledger for ${botId}:`, err);
      return new TradeLedger();
    }
  }

  private async saveLedger(botId: string, runtime: CryptoRuntime): Promise<void> {
    if (runtime.config.tradeMode !== 'live') return;
    try {
      await stateRedis.set(liveStateKey(botId), JSON.stringify(runtime.ledger.snapshot()));
    } catch (err) {
      console.error(`[crypto] Failed to save live ledger for ${botId}:`, err);
    }
  }

  /**
   * Reconciles the live ledger against the exchange: positions from account
   * balances, and tracked limit orders that left the open-orders list are
   * resolved via their order status (fills update the ledger; cancelled or
   * expired buy orders release their daily-spend claim). Fail-soft: an
   * exchange hiccup degrades to a warn log, never a dropped connection.
   */
  private async reconcileLedger(botId: string, runtime: CryptoRuntime): Promise<void> {
    if (runtime.config.tradeMode !== 'live' || !runtime.guard.hasKeys) return;
    try {
      await this.cancelStaleOrders(botId, runtime);

      const [balances, openOrders] = await Promise.all([
        runtime.feed.binanceClient.account(),
        runtime.feed.binanceClient.openOrders(),
      ]);

      const positions: Record<string, number> = {};
      for (const symbol of runtime.config.symbols) {
        const asset = baseOf(symbol);
        const found = balances.find((b) => b.asset === asset);
        if (found) positions[symbol] = found.free;
      }
      runtime.ledger.reconcilePositions(positions);
      // The account fetch is a fresh snapshot of every balance: warm the
      // per-symbol cache from it instead of leaving stale entries behind.
      const now = Date.now();
      for (const b of balances) runtime.balanceCache.set(b.asset, { free: b.free, at: now });

      const openIds = new Set(openOrders.map((o) => o.clientOrderId).filter(Boolean));
      for (const order of runtime.ledger.openOrdersList()) {
        if (openIds.has(order.clientOrderId)) continue;
        let status: OrderResult;
        try {
          status = await runtime.feed.binanceClient.orderStatus(order.symbol, order.clientOrderId);
        } catch (err) {
          // The order vanished from the exchange (cancelled externally or
          // expired): drop it and release its spend claim instead of tracking
          // it forever. Other errors keep the order tracked and retry next
          // cycle — the 60s cadence absorbs transient failures.
          if (err instanceof CryptoError && err.binanceCode === -2013) {
            runtime.ledger.removeOrder(order.clientOrderId);
            this.refundUnfilled(botId, order, 0);
            void this.writeLog(
              botId,
              'warn',
              `Order ${order.clientOrderId} no longer exists on the exchange; released`,
            );
          }
          continue;
        }
        runtime.ledger.removeOrder(order.clientOrderId);
        if (status.status === 'FILLED' || status.status === 'PARTIALLY_FILLED') {
          const qty = Number(status.executedQty) || 0;
          const avg = qty > 0 ? Number(status.cummulativeQuoteQty) / qty : Number(status.price);
          // The balance already includes this fill, so only the entry basis is
          // updated (a plain applyFill would double-count the quantity).
          runtime.ledger.applyReconciledFill(order.symbol, order.side, qty, avg);
          // Only the filled portion counts towards the daily spend: release
          // the claim for whatever never filled (partial fills happen when an
          // order is cancelled/expired mid-fill or splits across orders).
          this.refundUnfilled(botId, order, qty);
          void this.writeLog(
            botId,
            'info',
            `Order ${order.clientOrderId} filled: ${order.side} ${qty} ${order.symbol} @ ${avg}`,
          );
        } else if (order.side === 'buy' && order.price) {
          // Cancelled or expired without a fill — release the spend claim.
          this.refundUnfilled(botId, order, 0);
        }
      }

      await this.saveLedger(botId, runtime);
    } catch (err) {
      void this.writeLog(
        botId,
        'warn',
        `Ledger reconciliation failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Cancels tracked limit orders older than the configured TTL so capital is
   * never locked in unfilled orders indefinitely. Cancelled buy orders refund
   * their daily-spend claim.
   */
  private async cancelStaleOrders(botId: string, runtime: CryptoRuntime): Promise<void> {
    const ttl = runtime.config.orderTtlMs;
    if (ttl <= 0) return;
    const now = Date.now();
    for (const order of runtime.ledger.openOrdersList()) {
      if (now - order.placedAt <= ttl) continue;
      try {
        const res = await runtime.feed.binanceClient.cancelOrder(order.symbol, order.clientOrderId);
        // The cancel response carries the fill so far: apply the executed
        // portion to the ledger (entry prices / PnL accounting) and refund
        // only what never filled.
        const filledQty = Number(res.executedQty) || 0;
        if (filledQty > 0) {
          const avg =
            filledQty > 0 ? Number(res.cummulativeQuoteQty) / filledQty : Number(res.price);
          // The filled portion is already in the exchange balance — record the
          // entry basis without double-counting the quantity.
          runtime.ledger.applyReconciledFill(order.symbol, order.side, filledQty, avg);
        }
        runtime.ledger.removeOrder(order.clientOrderId);
        this.refundUnfilled(botId, order, filledQty);
        void this.writeLog(
          botId,
          'warn',
          `Cancelled stale order ${order.clientOrderId} (${order.side} ${order.symbol})`,
        );
      } catch (err) {
        // If the order was genuinely removed (404 / -2013), it will be
        // cleaned up on the next reconcile. Any other error (network, rate
        // limit) stays tracked and is retried at the next 60s cadence.
        if (!(err instanceof CryptoError && err.binanceCode === -2013)) {
          void this.writeLog(
            botId,
            'warn',
            `Cancel stale ${order.clientOrderId} failed: ${(err as Error)?.message ?? err}`,
          );
        }
      }
    }
  }

  /**
   * Atomically claims the order's USDT value against the bot's daily spend
   * window (UTC, per bot). Returns false when the cap would be exceeded.
   * A Lua script makes the incr→check→rollback atomic so two concurrent buys
   * cannot both pass the cap check. Fail-open when Redis is unavailable.
   */
  private async claimDailySpend(botId: string, valueUsdt: number): Promise<boolean> {
    const capUsdt = this.runtimes.get(botId)?.config.maxDailyOrderValueUsdt ?? 0;
    if (capUsdt <= 0 || !Number.isFinite(valueUsdt) || valueUsdt <= 0) return true;
    const key = dailySpendKey(botId, utcDate());
    const cents = Math.max(1, Math.round(valueUsdt * 100));
    const capCents = Math.round(capUsdt * 100);
    try {
      // Lua: INCR → check cap → rollback if exceeded → PEXPIRE.
      const result = await stateRedis.eval(
        'local c = redis.call("INCRBY", KEYS[1], ARGV[1])' +
          '; if c > tonumber(ARGV[2]) then redis.call("DECRBY", KEYS[1], ARGV[1]); return 0 end' +
          '; redis.call("PEXPIRE", KEYS[1], ARGV[3]); return 1',
        1,
        key,
        cents,
        capCents,
        DAILY_SPEND_TTL_MS,
      );
      if (result === 0) {
        void this.writeLog(
          botId,
          'warn',
          `Buy blocked: daily spend limit ${capUsdt} USDT already reached`,
        );
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[crypto] Daily spend check failed for ${botId}:`, err);
      return true;
    }
  }

  private async refundDailySpend(botId: string, valueUsdt: number): Promise<void> {
    if (!Number.isFinite(valueUsdt) || valueUsdt <= 0) return;
    try {
      const key = dailySpendKey(botId, utcDate());
      // Lua: atomic decrby + clamp to 0. Using SET 0 (not DEL) avoids a race
      // where a concurrent INCRBY is silently erased by the DEL.
      await stateRedis.eval(
        'local after = redis.call("DECRBY", KEYS[1], ARGV[1])' +
          '; if after < 0 then redis.call("SET", KEYS[1], 0); redis.call("PEXPIRE", KEYS[1], ARGV[2]) end',
        1,
        key,
        Math.max(1, Math.round(valueUsdt * 100)),
        DAILY_SPEND_TTL_MS,
      );
    } catch (err) {
      console.error(`[crypto] Daily spend refund failed for ${botId}:`, err);
    }
  }

  /**
   * Releases the daily-spend claim for the portion of a buy order that never
   * filled. Claims are made for the full order value at placement; fills can
   * be partial (an order cancelled mid-fill, or resolved as PARTIALLY_FILLED
   * between reconciliations), so the un-filled remainder must be refunded or
   * the bot's daily budget silently shrinks. Sub-cent remainders (floating
   * point residue of a full fill) are ignored.
   */
  private refundUnfilled(botId: string, order: TrackedOrder, filledQty: number): void {
    if (order.side !== 'buy' || !order.price) return;
    const remainder = Math.max(0, order.quantity - filledQty);
    if (remainder <= 0) return;
    if (Math.round(remainder * order.price * 100) < 1) return;
    this.refundDailySpend(botId, remainder * order.price);
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
      // Respect an explicit quantity (value = qty × price) and fall back to
      // an amount in USDT; the guard still caps by maxOrderValueUsdt.
      const quantity = Number(payload.quantity);
      const amount =
        Number.isFinite(quantity) && quantity > 0
          ? quantity * price
          : Number(payload.amountUsdt ?? runtime.config.maxOrderValueUsdt);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('marketBuy requires a positive quantity or amountUsdt');
      }
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
        // Dry-run: report simulated holdings from the ledger instead of a
        // hardcoded zero so scripts can reason about paper positions.
        const symbol = [...runtime.positions.keys()].find((s) => baseOf(s) === asset);
        return {
          asset: asset || 'USDT',
          free: symbol ? (runtime.positions.get(symbol) ?? 0) : 0,
          locked: 0,
          simulated: true,
          note: 'dry-run: balances are simulated from the paper ledger',
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
    for (const unsubscribe of runtime.streamUnsubs) unsubscribe();
    runtime.streamUnsubs = [];
  }

  protected hasLiveConnection(botId: string): boolean {
    return this.runtimes.has(botId);
  }
}
