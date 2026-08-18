import { createHmac } from 'node:crypto';
import { ProxyAgent } from 'undici';
import { CryptoError } from './errors.js';

const BINANCE_API = 'https://api.binance.com';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BACKOFF_BASE_MS = 250;
const RETRYABLE_STATUSES = new Set([429, 418, 500, 502, 503, 504]);

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

export interface TickerInfo {
  symbol: string;
  price: number;
  change24h: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface BalanceInfo {
  asset: string;
  free: number;
  locked: number;
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  /**
   * Client-generated order id (max 36 alphanumeric chars). Binance rejects
   * duplicate newClientOrderId values within 24h, so retries and re-attempts
   * can reuse it to stay idempotent.
   */
  clientOrderId?: string;
}

export interface OrderResult {
  orderId: number;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  origQty: number;
  executedQty: number;
  cummulativeQuoteQty: number;
  status: string;
}

interface BinanceTickerRaw {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  volume?: string;
  quoteVolume?: string;
}

interface BinanceBalanceRaw {
  asset: string;
  free: string;
  locked: string;
}

function parseTicker(data: BinanceTickerRaw): TickerInfo {
  return {
    symbol: data.symbol ?? '',
    price: Number(data.lastPrice ?? '0'),
    change24h: data.priceChangePercent === undefined ? null : Number(data.priceChangePercent),
    volume24h: data.volume === undefined ? null : Number(data.volume),
    quoteVolume24h: data.quoteVolume === undefined ? null : Number(data.quoteVolume),
  };
}

function trim8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export class BinanceClient {
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly dispatcher: ProxyAgent | undefined;
  /** The proxy URL this client routes requests through, if any. */
  readonly proxyUrl: string | undefined;

  constructor(
    opts: {
      apiKey?: string | null;
      apiSecret?: string | null;
      timeoutMs?: number;
      maxRetries?: number;
      proxyUrl?: string;
    } = {},
  ) {
    this.apiKey = opts.apiKey || null;
    this.apiSecret = opts.apiSecret || null;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.proxyUrl = opts.proxyUrl;
    if (opts.proxyUrl) {
      if (!/^https?:\/\//i.test(opts.proxyUrl)) {
        throw new CryptoError(
          'Only http(s) proxies are supported for Binance API calls',
          'INVALID_CONFIG',
        );
      }
      this.dispatcher = new ProxyAgent(opts.proxyUrl);
    }
  }

  get hasKeys(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  get keyPair(): { apiKey: string | null; apiSecret: string | null } {
    return { apiKey: this.apiKey, apiSecret: this.apiSecret };
  }

  private async request<T>(
    path: string,
    query = '',
    signed = false,
    retryable = false,
  ): Promise<T> {
    const url = query ? `${BINANCE_API}${path}?${query}` : `${BINANCE_API}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signed) {
      if (!this.apiKey || !this.apiSecret) {
        throw new CryptoError('Binance API key and secret are required', 'UNAUTHORIZED');
      }
      headers['X-MBX-APIKEY'] = this.apiKey;
    }

    const attempts = this.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const signal = AbortSignal.timeout(this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          headers,
          signal,
          ...(this.dispatcher ? ({ dispatcher: this.dispatcher } as RequestInit) : {}),
        });
      } catch (err) {
        if ((err as Error | null)?.name === 'TimeoutError' || err instanceof DOMException) {
          throw new CryptoError('Binance request timed out', 'TIMEOUT', 0);
        }
        throw err;
      }
      const text = await res.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (res.ok) return data as T;

      const code = (data as { code?: number } | null)?.code;
      const msg = (data as { msg?: string } | null)?.msg;
      const retryableNow = retryable && RETRYABLE_STATUSES.has(res.status) && attempt < attempts;
      if (retryableNow) {
        const retryAfterSec = Number(res.headers.get('retry-after'));
        const delay = Math.max(
          RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1),
          Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 0,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (res.status === 429 || res.status === 418) {
        throw new CryptoError(msg ?? 'Rate limited by Binance', 'RATE_LIMITED', res.status);
      }
      if (res.status === 401 || res.status === 403) {
        throw new CryptoError(msg ?? 'Unauthorized by Binance', 'UNAUTHORIZED', res.status);
      }
      throw new CryptoError(
        msg ?? `Binance API error ${res.status}${code !== undefined ? ` (code ${code})` : ''}`,
        'API_ERROR',
        res.status,
      );
    }
    throw new CryptoError(`Binance API error ${url}`, 'API_ERROR', 0);
  }

  private signedQuery(params: Record<string, string | number>): string {
    if (!this.apiSecret) {
      throw new CryptoError('Binance API secret is required for signed requests', 'UNAUTHORIZED');
    }
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    qs.set('timestamp', String(Date.now()));
    qs.set('recvWindow', '10000');
    const signature = createHmac('sha256', this.apiSecret).update(qs.toString()).digest('hex');
    return `${qs.toString()}&signature=${signature}`;
  }

  async ping(): Promise<boolean> {
    await this.request<Record<string, never>>('/api/v3/ping', '', false, true);
    return true;
  }

  async ticker(symbol: string): Promise<TickerInfo> {
    const data = await this.request<BinanceTickerRaw>(
      '/api/v3/ticker/24hr',
      `symbol=${encodeURIComponent(symbol)}`,
      false,
      true,
    );
    return parseTicker(data);
  }

  async tickers(symbols: string[]): Promise<TickerInfo[]> {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const out: TickerInfo[] = [];
    for (let i = 0; i < unique.length; i += 10) {
      const part = unique.slice(i, i + 10);
      const query = `symbols=${encodeURIComponent(JSON.stringify(part))}`;
      const data = await this.request<BinanceTickerRaw[] | BinanceTickerRaw>(
        '/api/v3/ticker/24hr',
        query,
        false,
        true,
      );
      const list = Array.isArray(data) ? data : [data];
      for (const row of list) out.push(parseTicker(row));
    }
    return out;
  }

  async klines(symbol: string, interval = '15m', limit = 100): Promise<Kline[]> {
    if (!KLINE_INTERVALS.has(interval)) {
      throw new CryptoError(`Unsupported kline interval "${interval}"`, 'INVALID_PARAMS');
    }
    const clamped = Math.max(1, Math.min(500, Math.floor(limit)));
    const query = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${clamped}`;
    const data = await this.request<unknown[]>('/api/v3/klines', query, false, true);
    return data.map((row) => {
      const r = row as (number | string)[];
      return {
        openTime: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        closeTime: Number(r[6]),
      };
    });
  }

  async account(): Promise<BalanceInfo[]> {
    const data = await this.request<{ balances: BinanceBalanceRaw[] }>(
      '/api/v3/account',
      this.signedQuery({}),
      true,
      true,
    );
    return data.balances
      .filter((b) => Number(b.free) > 0 || Number(b.locked) > 0)
      .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }));
  }

  async balance(asset: string): Promise<BalanceInfo> {
    const balances = await this.account();
    return balances.find((b) => b.asset === asset) ?? { asset, free: 0, locked: 0 };
  }

  async order(req: OrderRequest): Promise<OrderResult> {
    if (!req.symbol) throw new CryptoError('Order requires a symbol', 'INVALID_PARAMS');
    const params: Record<string, string | number> = {
      symbol: req.symbol.toUpperCase(),
      side: req.side,
      type: req.type,
    };
    if (req.type === 'LIMIT') {
      const price = req.price;
      const quantity = req.quantity;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        throw new CryptoError('Limit order requires a positive price', 'INVALID_PARAMS');
      }
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
        throw new CryptoError('Limit order requires a positive quantity', 'INVALID_PARAMS');
      }
      params.timeInForce = 'GTC';
      params.price = trim8(price);
      params.quantity = trim8(quantity);
    } else if (typeof req.quantity === 'number' && req.quantity > 0) {
      params.quantity = trim8(req.quantity);
    } else if (typeof req.quoteOrderQty === 'number' && req.quoteOrderQty > 0) {
      params.quoteOrderQty = Math.round(req.quoteOrderQty * 100) / 100;
    } else {
      throw new CryptoError('Market order requires quantity or quoteOrderQty', 'INVALID_PARAMS');
    }
    if (req.clientOrderId) {
      const clientOrderId = req.clientOrderId.trim();
      if (!/^[a-zA-Z0-9_]{1,36}$/.test(clientOrderId)) {
        throw new CryptoError(
          'clientOrderId must be 1-36 alphanumeric characters',
          'INVALID_PARAMS',
        );
      }
      params.newClientOrderId = clientOrderId;
    }
    const data = await this.request<OrderResult>('/api/v3/order', this.signedQuery(params), true);
    return data;
  }
}
