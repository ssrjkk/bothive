export interface TrackedOrder {
  clientOrderId: string;
  orderId: number | null;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  /** Limit price; null for market orders. */
  price: number | null;
  /** Order quantity in the base asset (0 when only quoteOrderQty was given). */
  quantity: number;
  placedAt: number;
}

export interface LedgerSnapshot {
  positions: Record<string, number>;
  avgEntry: Record<string, number>;
  realizedPnl: number;
  openOrders: Record<string, TrackedOrder>;
  /** Highest price seen since each position's latest entry (trailing stops). */
  trailingHigh?: Record<string, number>;
  updatedAt: number;
}

const EPS = 1e-10;

/**
 * In-memory trade ledger for LIVE crypto bots. The exchange is the source of
 * truth for positions (reconciled from balances), while the ledger keeps the
 * accounting that the exchange does not: weighted average entry prices,
 * realized PnL, and the open orders this bot has placed. Fills are applied
 * either immediately (market-order results) or when a tracked order leaves
 * the exchange's open-orders list (limit orders). Persisted to Redis as a
 * snapshot so a restart keeps the PnL history and open-order tracker.
 */
export class TradeLedger {
  private positions = new Map<string, number>();
  private avgEntry = new Map<string, number>();
  private trailingHigh = new Map<string, number>();
  private realizedPnl = 0;
  private openOrders = new Map<string, TrackedOrder>();

  position(symbol: string): number {
    return this.positions.get(symbol.toUpperCase()) ?? 0;
  }

  avgEntryFor(symbol: string): number {
    return this.avgEntry.get(symbol.toUpperCase()) ?? 0;
  }

  trailingHighFor(symbol: string): number | undefined {
    return this.trailingHigh.get(symbol.toUpperCase());
  }

  setTrailingHigh(symbol: string, price: number): void {
    this.trailingHigh.set(symbol.toUpperCase(), price);
  }

  get pnl(): number {
    return this.realizedPnl;
  }

  get openCount(): number {
    return this.openOrders.size;
  }

  openOrdersList(): TrackedOrder[] {
    return [...this.openOrders.values()];
  }

  recordOrder(order: TrackedOrder): void {
    this.openOrders.set(order.clientOrderId, order);
  }

  removeOrder(clientOrderId: string): TrackedOrder | undefined {
    const order = this.openOrders.get(clientOrderId);
    if (order) this.openOrders.delete(clientOrderId);
    return order;
  }

  /**
   * Applies an executed fill to the ledger (a market-order result or a limit
   * order that filled between reconciliations). Buys raise the weighted
   * average entry; sells realize PnL against it.
   */
  applyFill(symbol: string, side: 'buy' | 'sell', executedQty: number, avgPrice: number): void {
    const s = symbol.toUpperCase();
    // Binance reports quantities and prices as strings; coerce defensively.
    const qty = Number(executedQty);
    const price = Number(avgPrice);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (!Number.isFinite(price) || price <= 0) return;
    if (side === 'buy') {
      const current = this.positions.get(s) ?? 0;
      const cost = current * (this.avgEntry.get(s) ?? 0);
      const next = current + qty;
      this.avgEntry.set(s, (cost + qty * price) / next);
      this.positions.set(s, next);
      // A fresh buy re-arms the trailing stop from the new basis instead of
      // keeping a level that may predate the added quantity.
      this.trailingHigh.delete(s);
    } else {
      const current = this.positions.get(s) ?? 0;
      const entry = this.avgEntry.get(s) ?? 0;
      const sold = Math.min(current, qty);
      // Without an entry price (e.g. bought before the ledger existed) the PnL
      // contribution is unknown; record 0 instead of a bogus figure.
      if (entry > 0 && sold > 0) this.realizedPnl += (price - entry) * sold;
      const remaining = current - sold;
      if (remaining > EPS) this.positions.set(s, remaining);
      else {
        this.positions.delete(s);
        this.avgEntry.delete(s);
        this.trailingHigh.delete(s);
      }
    }
  }

  /**
   * Applies a fill that is ALREADY reflected in the exchange balance: a
   * tracked order that filled between reconciliations, or one that was
   * partially filled at cancel. The balance is the source of truth for
   * quantity, so only the entry-price basis is updated. A plain applyFill
   * would count the quantity a second time and dilute the average against a
   * reconciled position that carries no known basis (the pre-fill balance
   * already includes the fill, yet avgEntry is still missing).
   */
  applyReconciledFill(
    symbol: string,
    side: 'buy' | 'sell',
    executedQty: number,
    avgPrice: number,
  ): void {
    const s = symbol.toUpperCase();
    const qty = Number(executedQty);
    const price = Number(avgPrice);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (!Number.isFinite(price) || price <= 0) return;
    if (side === 'sell') {
      // The balance fetch already excluded the sold quantity; realize PnL
      // against the entry basis without touching the position again.
      const current = this.positions.get(s) ?? 0;
      const entry = this.avgEntry.get(s) ?? 0;
      const sold = Math.min(current, qty);
      if (entry > 0 && sold > 0) this.realizedPnl += (price - entry) * sold;
      const remaining = current - sold;
      if (remaining > EPS) this.positions.set(s, remaining);
      else {
        this.positions.delete(s);
        this.avgEntry.delete(s);
        this.trailingHigh.delete(s);
      }
      return;
    }
    const current = this.positions.get(s) ?? 0;
    const known = this.avgEntry.get(s);
    if (current <= 0) {
      // Nothing reconciled yet: the fill adds to an empty book.
      this.applyFill(s, side, qty, price);
      return;
    }
    // The reconciled position already includes this fill, so the quantity
    // explained by prior fills is `current - qty` — not `current`, which a
    // plain applyFill would weight against (double-counting the fill).
    const basis = Math.max(0, current - qty);
    if (known === undefined || known <= 0) {
      // No known basis. Only record one when the fill explains the whole
      // position — blending a partial explanation into an unknown remainder
      // would fabricate a misleading average.
      if (qty >= current - EPS) this.avgEntry.set(s, price);
      return;
    }
    const cost = basis * known + qty * price;
    this.avgEntry.set(s, cost / current);
    // A reconciled buy shifts the basis; re-arm the trailing stop from it,
    // mirroring applyFill's reset on a fresh buy.
    this.trailingHigh.delete(s);
  }

  /**
   * Replaces positions from the exchange's balances. Entry prices are kept
   * from the ledger's history — balances alone cannot reconstruct them.
   */
  reconcilePositions(exchange: Record<string, number>): void {
    const kept = new Set<string>();
    for (const [symbol, qty] of Object.entries(exchange)) {
      if (Number.isFinite(qty) && qty > 0) {
        this.positions.set(symbol.toUpperCase(), qty);
        kept.add(symbol.toUpperCase());
      }
    }
    for (const symbol of this.positions.keys()) {
      if (!kept.has(symbol)) this.positions.delete(symbol);
    }
  }

  snapshot(): LedgerSnapshot {
    return {
      positions: Object.fromEntries(this.positions),
      avgEntry: Object.fromEntries(this.avgEntry),
      realizedPnl: this.realizedPnl,
      openOrders: Object.fromEntries(this.openOrders),
      trailingHigh: Object.fromEntries(this.trailingHigh),
      updatedAt: Date.now(),
    };
  }

  static fromSnapshot(snapshot: LedgerSnapshot): TradeLedger {
    const ledger = new TradeLedger();
    if (!snapshot || typeof snapshot !== 'object') return ledger;
    for (const [symbol, qty] of Object.entries(snapshot.positions ?? {})) {
      if (Number.isFinite(qty) && qty > 0) ledger.positions.set(symbol.toUpperCase(), qty);
    }
    for (const [symbol, price] of Object.entries(snapshot.avgEntry ?? {})) {
      if (Number.isFinite(price) && price > 0) ledger.avgEntry.set(symbol.toUpperCase(), price);
    }
    for (const [symbol, price] of Object.entries(snapshot.trailingHigh ?? {})) {
      if (Number.isFinite(price) && price > 0) {
        ledger.trailingHigh.set(symbol.toUpperCase(), price);
      }
    }
    if (Number.isFinite(snapshot.realizedPnl)) ledger.realizedPnl = snapshot.realizedPnl;
    for (const [id, order] of Object.entries(snapshot.openOrders ?? {})) {
      if (order && typeof order.clientOrderId === 'string' && order.clientOrderId.length > 0) {
        ledger.openOrders.set(id, order);
      }
    }
    return ledger;
  }
}
