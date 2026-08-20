import { COINGECKO_ID_BY_SYMBOL } from './coingecko.js';

const SYMBOL_POOL = Object.keys(COINGECKO_ID_BY_SYMBOL).map((base) => `${base}USDT`);

const KLINE_POOL = ['5m', '15m', '1h'];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pickMany<T>(items: readonly T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Builds a varied, schema-valid crypto config for a freshly created bot so a
 * batch of bots behaves differently out of the box (different pairs,
 * strategies, polling cadence and order sizes within safe bounds).
 *
 * Safe defaults: `tradeMode` is always 'dry' and `autoTrade` is off — live
 * trading requires an explicit opt-in on the bot's config.
 */
export function generateCryptoConfig(): Record<string, unknown> {
  const symbols = pickMany(SYMBOL_POOL, randInt(1, 3));
  const coinIds = symbols.map((symbol) => COINGECKO_ID_BY_SYMBOL[symbol.slice(0, -4)]);

  const strategy = pick(['sma', 'sma', 'rsi', 'rsi', 'alert'] as const);
  const source =
    strategy === 'alert'
      ? pick(['binance', 'auto', 'coingecko'] as const)
      : pick(['binance', 'auto'] as const);
  const klineInterval = pick(KLINE_POOL);
  const pollInterval = randInt(15_000, 120_000);
  const maxOrderValueUsdt = randInt(50, 500);
  const autoTradeAmountUsdt = randInt(10, maxOrderValueUsdt);

  const strategyParams: Record<string, unknown> = {
    klineInterval,
    priceEventIntervalMs: randInt(30_000, 120_000),
    autoTrade: false,
    autoTradeAmountUsdt,
  };
  if (strategy === 'sma') {
    const fastPeriod = randInt(5, 20);
    strategyParams.fastPeriod = fastPeriod;
    strategyParams.slowPeriod = randInt(fastPeriod * 3, Math.min(fastPeriod * 6, 200));
  } else if (strategy === 'rsi') {
    strategyParams.period = randInt(7, 21);
    strategyParams.overbought = randInt(65, 80);
    strategyParams.oversold = randInt(20, 35);
  } else if (Math.random() < 0.5) {
    strategyParams.upThreshold = randInt(60_000, 150_000);
    strategyParams.downThreshold = randInt(10_000, 40_000);
  }

  // Exit guards are inert while autoTrade is off, but they make a batch's
  // configs diverse and are ready to trade once live mode is enabled.
  if (Math.random() < 0.5) strategyParams.stopLossPct = randInt(2, 10);
  if (Math.random() < 0.5) strategyParams.takeProfitPct = randInt(5, 20);
  if (Math.random() < 0.25) strategyParams.trailingStopPct = randInt(1, 5);

  return {
    symbols,
    coinIds,
    source,
    strategy,
    strategyParams,
    tradeMode: 'dry',
    pollInterval,
    maxOrderValueUsdt,
  };
}
