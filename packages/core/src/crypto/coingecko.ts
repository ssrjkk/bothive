import { ProxyAgent } from 'undici';
import { CryptoError } from './errors.js';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const LIST_CACHE_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PRICE_CACHE_MS = 10_000;

export const COINGECKO_ID_BY_SYMBOL: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token',
  LINK: 'chainlink',
  LTC: 'litecoin',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  TON: 'the-open-network',
  TRX: 'tron',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
};

export interface CoinGeckoPrice {
  price: number;
  change24h: number | null;
}

interface CoinListEntry {
  id: string;
  symbol: string;
}

interface ListCache {
  expiresAt: number;
  data: CoinListEntry[];
}

interface PriceCache {
  expiresAt: number;
  data: Map<string, CoinGeckoPrice>;
}

export class CoinGeckoClient {
  private listCache: ListCache | null = null;
  private priceCache: PriceCache | null = null;
  private readonly timeoutMs: number;
  private readonly priceCacheMs: number;
  private readonly dispatcher: ProxyAgent | undefined;
  /** The proxy URL this client routes requests through, if any. */
  readonly proxyUrl: string | undefined;

  constructor(opts: { timeoutMs?: number; priceCacheMs?: number; proxyUrl?: string } = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.priceCacheMs = opts.priceCacheMs ?? DEFAULT_PRICE_CACHE_MS;
    this.proxyUrl = opts.proxyUrl;
    if (opts.proxyUrl) {
      if (!/^https?:\/\//i.test(opts.proxyUrl)) {
        throw new CryptoError(
          'Only http(s) proxies are supported for CoinGecko API calls',
          'INVALID_CONFIG',
        );
      }
      this.dispatcher = new ProxyAgent(opts.proxyUrl);
    }
  }

  async getPrices(ids: string[]): Promise<Map<string, CoinGeckoPrice>> {
    if (this.priceCache && this.priceCache.expiresAt > Date.now()) {
      return new Map(this.priceCache.data);
    }
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const qs = new URLSearchParams({
      ids: unique.join(','),
      vs_currencies: 'usd',
      include_24hr_change: 'true',
    });
    const res = await this.fetch(`${COINGECKO_API}/simple/price?${qs.toString()}`);
    if (!res.ok) {
      throw new CryptoError(`CoinGecko API error ${res.status}`, 'COINGECKO_ERROR', res.status);
    }
    const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    const out = new Map<string, CoinGeckoPrice>();
    for (const id of unique) {
      const row = data[id];
      if (row && typeof row.usd === 'number') {
        out.set(id, {
          price: row.usd,
          change24h: row.usd_24h_change === undefined ? null : row.usd_24h_change,
        });
      }
    }
    this.priceCache = { expiresAt: Date.now() + this.priceCacheMs, data: out };
    return out;
  }

  async searchSymbol(symbol: string): Promise<string | null> {
    const target = symbol.toLowerCase();
    const list = await this.getList();
    const found = list.find((entry) => entry.symbol === target);
    return found?.id ?? null;
  }

  private async getList(): Promise<CoinListEntry[]> {
    if (this.listCache && this.listCache.expiresAt > Date.now()) return this.listCache.data;
    const res = await this.fetch(`${COINGECKO_API}/coins/list`);
    if (!res.ok) {
      throw new CryptoError(`CoinGecko API error ${res.status}`, 'COINGECKO_ERROR', res.status);
    }
    const raw = (await res.json()) as { id: string; symbol: string }[];
    const data = raw.map((entry) => ({ id: entry.id, symbol: entry.symbol.toLowerCase() }));
    this.listCache = { expiresAt: Date.now() + LIST_CACHE_MS, data };
    return data;
  }

  private async fetch(url: string): Promise<Response> {
    try {
      return await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(this.dispatcher ? ({ dispatcher: this.dispatcher } as RequestInit) : {}),
      });
    } catch (err) {
      if ((err as Error | null)?.name === 'TimeoutError' || err instanceof DOMException) {
        throw new CryptoError('CoinGecko request timed out', 'TIMEOUT', 0);
      }
      throw err;
    }
  }
}
