import { CryptoError } from './errors.js';

export type TradeMode = 'dry' | 'live';
export type PlanSide = 'buy' | 'sell';

export interface RiskConfig {
  tradeMode: TradeMode;
  maxOrderValueUsdt: number;
  hasKeys: boolean;
  /** Optional uppercase symbol whitelist; when empty, any symbol is allowed. */
  allowedSymbols?: string[];
}

export interface OrderPlan {
  symbol: string;
  side: PlanSide;
  type: 'market' | 'limit';
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  valueUsdt: number;
}

export type PlanResult = { ok: true; plan: OrderPlan } | { ok: false; reason: string };

const DEFAULT_MAX_ORDER_USDT = 100;
const MAX_PRICE = 1_000_000;

function trim8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export class RiskGuard {
  private readonly tradeMode: TradeMode;
  private readonly maxOrderValueUsdt: number;
  /** Whether the account has a live API key pair (readable for scheduling guards). */
  readonly hasKeys: boolean;
  private readonly allowedSymbols: Set<string>;

  constructor(config: RiskConfig) {
    this.tradeMode = config.tradeMode === 'live' ? 'live' : 'dry';
    this.maxOrderValueUsdt =
      Number.isFinite(config.maxOrderValueUsdt) && config.maxOrderValueUsdt > 0
        ? config.maxOrderValueUsdt
        : DEFAULT_MAX_ORDER_USDT;
    this.hasKeys = Boolean(config.hasKeys);
    this.allowedSymbols = new Set(
      (Array.isArray(config.allowedSymbols) ? config.allowedSymbols : [])
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .map((s) => s.toUpperCase()),
    );
  }

  get mode(): TradeMode {
    return this.tradeMode;
  }

  get maxOrderValue(): number {
    return this.maxOrderValueUsdt;
  }

  /** True when the symbol may be traded (whitelist empty or contains it). */
  isAllowed(symbol: string): boolean {
    return this.allowed(symbol);
  }

  private allowed(symbol: string): boolean {
    return this.allowedSymbols.size === 0 || this.allowedSymbols.has(symbol.toUpperCase());
  }

  planMarketBuy(symbol: string, price: number, amountUsdt: number): PlanResult {
    if (!this.allowed(symbol)) {
      return { ok: false, reason: `Symbol ${symbol} is not in the bot's allowed list` };
    }
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      return { ok: false, reason: 'amountUsdt must be a positive number' };
    }
    if (amountUsdt > this.maxOrderValueUsdt) {
      return {
        ok: false,
        reason: `Order value ${amountUsdt} USDT exceeds max ${this.maxOrderValueUsdt} USDT`,
      };
    }
    if (this.tradeMode === 'live' && !this.hasKeys) {
      return {
        ok: false,
        reason: 'Live trading requires Binance API keys (apiKey + secret) on the account',
      };
    }
    return {
      ok: true,
      plan: {
        symbol: symbol.toUpperCase(),
        side: 'buy',
        type: 'market',
        quoteOrderQty: Math.round(amountUsdt * 100) / 100,
        valueUsdt: amountUsdt,
      },
    };
  }

  planMarketSell(symbol: string, price: number, quantity: number): PlanResult {
    if (!this.allowed(symbol)) {
      return { ok: false, reason: `Symbol ${symbol} is not in the bot's allowed list` };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, reason: 'quantity must be a positive number' };
    }
    const value = quantity * price;
    if (value > this.maxOrderValueUsdt) {
      return {
        ok: false,
        reason: `Order value ${value.toFixed(2)} USDT exceeds max ${this.maxOrderValueUsdt} USDT`,
      };
    }
    if (this.tradeMode === 'live' && !this.hasKeys) {
      return {
        ok: false,
        reason: 'Live trading requires Binance API keys (apiKey + secret) on the account',
      };
    }
    return {
      ok: true,
      plan: {
        symbol: symbol.toUpperCase(),
        side: 'sell',
        type: 'market',
        quantity: trim8(quantity),
        valueUsdt: value,
      },
    };
  }

  planLimit(symbol: string, side: PlanSide, price: number, quantity: number): PlanResult {
    if (!this.allowed(symbol)) {
      return { ok: false, reason: `Symbol ${symbol} is not in the bot's allowed list` };
    }
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      return { ok: false, reason: 'price must be a positive number below 1,000,000' };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, reason: 'quantity must be a positive number' };
    }
    const value = price * quantity;
    if (value > this.maxOrderValueUsdt) {
      return {
        ok: false,
        reason: `Order value ${value.toFixed(2)} USDT exceeds max ${this.maxOrderValueUsdt} USDT`,
      };
    }
    if (this.tradeMode === 'live' && !this.hasKeys) {
      return {
        ok: false,
        reason: 'Live trading requires Binance API keys (apiKey + secret) on the account',
      };
    }
    return {
      ok: true,
      plan: {
        symbol: symbol.toUpperCase(),
        side,
        type: 'limit',
        quantity: trim8(quantity),
        price: trim8(price),
        valueUsdt: value,
      },
    };
  }

  requireKeys(): void {
    if (this.tradeMode === 'live' && !this.hasKeys) {
      throw new CryptoError(
        'Live trading requires Binance API keys (apiKey + secret) on the account',
        'UNAUTHORIZED',
      );
    }
  }
}
