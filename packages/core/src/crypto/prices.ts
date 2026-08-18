import { BinanceClient } from './binance.js';
import { CoinGeckoClient, COINGECKO_ID_BY_SYMBOL } from './coingecko.js';
import { CryptoError } from './errors.js';

export type PriceSource = 'binance' | 'coingecko' | 'auto';

export interface PricePoint {
  price: number;
  change24h: number | null;
  source: 'binance' | 'coingecko';
  timestamp: number;
}

export interface PriceFeedOptions {
  source: PriceSource;
  symbols: string[];
  coinIds?: string[];
  binance?: BinanceClient;
  coingecko?: CoinGeckoClient;
}

const QUOTE_CURRENCIES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'EUR', 'BTC', 'ETH'];

export function baseOf(symbol: string): string {
  const upper = symbol.toUpperCase();
  for (const quote of QUOTE_CURRENCIES) {
    if (upper.length > quote.length && upper.endsWith(quote)) return upper.slice(0, -quote.length);
  }
  return upper;
}

export class PriceFeed {
  private readonly source: PriceSource;
  private readonly symbols: string[];
  private readonly coinIds: string[] | null;
  private readonly binance: BinanceClient;
  private readonly coingecko: CoinGeckoClient;

  constructor(opts: PriceFeedOptions) {
    if (!opts.symbols || opts.symbols.length === 0) {
      throw new CryptoError('crypto.symbols must contain at least one symbol', 'INVALID_CONFIG');
    }
    if (opts.coinIds && opts.coinIds.length !== opts.symbols.length) {
      throw new CryptoError(
        'crypto.coinIds must match crypto.symbols one-to-one',
        'INVALID_CONFIG',
      );
    }
    this.source = opts.source;
    this.symbols = [...new Set(opts.symbols.map((s) => s.toUpperCase()))];
    this.coinIds = opts.coinIds ? [...opts.coinIds] : null;
    this.binance = opts.binance ?? new BinanceClient();
    this.coingecko = opts.coingecko ?? new CoinGeckoClient();
  }

  get hasBinanceKeys(): boolean {
    return this.binance.hasKeys;
  }

  get binanceClient(): BinanceClient {
    return this.binance;
  }

  async refresh(): Promise<Map<string, PricePoint>> {
    if (this.source === 'binance') return this.fromBinance();
    if (this.source === 'coingecko') return this.fromCoinGecko();
    try {
      return await this.fromBinance();
    } catch {
      try {
        return await this.fromCoinGecko();
      } catch {
        throw new CryptoError('All crypto price sources failed', 'NO_PRICE_SOURCE');
      }
    }
  }

  private async fromBinance(): Promise<Map<string, PricePoint>> {
    const tickers = await this.binance.tickers(this.symbols);
    const out = new Map<string, PricePoint>();
    for (const ticker of tickers) {
      out.set(ticker.symbol, {
        price: ticker.price,
        change24h: ticker.change24h,
        source: 'binance',
        timestamp: Date.now(),
      });
    }
    return out;
  }

  private async fromCoinGecko(): Promise<Map<string, PricePoint>> {
    const ids =
      this.coinIds ??
      this.symbols.map((symbol) => {
        const id = COINGECKO_ID_BY_SYMBOL[baseOf(symbol)];
        if (!id) {
          throw new CryptoError(
            `No CoinGecko id known for ${symbol}; set crypto.coinIds to map symbols to ids`,
            'INVALID_CONFIG',
          );
        }
        return id;
      });
    const prices = await this.coingecko.getPrices(ids);
    const out = new Map<string, PricePoint>();
    this.symbols.forEach((symbol, index) => {
      const point = prices.get(ids[index]);
      if (point) {
        out.set(symbol, { ...point, source: 'coingecko', timestamp: Date.now() });
      }
    });
    return out;
  }
}
