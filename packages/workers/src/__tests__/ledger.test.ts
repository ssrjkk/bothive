import { describe, it, expect } from 'vitest';
import { TradeLedger, type TrackedOrder } from '../crypto/ledger.js';

function trackedOrder(overrides: Partial<TrackedOrder> = {}): TrackedOrder {
  return {
    clientOrderId: 'bh1',
    orderId: 42,
    symbol: 'BTCUSDT',
    side: 'buy',
    type: 'limit',
    price: 59000,
    quantity: 0.01,
    placedAt: 1700000000000,
    ...overrides,
  };
}

describe('TradeLedger', () => {
  it('tracks a weighted average entry price across buys', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 64000);
    expect(ledger.position('BTCUSDT')).toBeCloseTo(0.002);
    expect(ledger.position('btcusdt')).toBeCloseTo(0.002);
    expect(ledger.position('ETHUSDT')).toBe(0);
  });

  it('realizes PnL on sells against the entry price', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.applyFill('BTCUSDT', 'sell', 0.0005, 66000);
    expect(ledger.pnl).toBeCloseTo(3);
    expect(ledger.position('BTCUSDT')).toBeCloseTo(0.0005);
  });

  it('clears the position and entry when fully sold', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.applyFill('BTCUSDT', 'sell', 0.001, 62000);
    expect(ledger.pnl).toBeCloseTo(2);
    expect(ledger.position('BTCUSDT')).toBe(0);
  });

  it('records no PnL when selling without an entry price', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'sell', 0.001, 62000);
    expect(ledger.pnl).toBe(0);
    expect(ledger.position('BTCUSDT')).toBe(0);
  });

  it('reconciles positions from exchange balances', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.005, 60000);
    ledger.reconcilePositions({ BTCUSDT: 0.123, ETHUSDT: 1.5 });
    expect(ledger.position('BTCUSDT')).toBeCloseTo(0.123);
    expect(ledger.position('ETHUSDT')).toBeCloseTo(1.5);
    expect(ledger.pnl).toBe(0);
  });

  it('tracks and removes open orders', () => {
    const ledger = new TradeLedger();
    ledger.recordOrder(trackedOrder());
    expect(ledger.openCount).toBe(1);
    const removed = ledger.removeOrder('bh1');
    expect(removed?.symbol).toBe('BTCUSDT');
    expect(ledger.openCount).toBe(0);
    expect(ledger.removeOrder('missing')).toBeUndefined();
  });

  it('round-trips a snapshot through fromSnapshot', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.applyFill('BTCUSDT', 'sell', 0.0005, 66000);
    ledger.recordOrder(trackedOrder({ clientOrderId: 'bh9', side: 'sell', price: 68000 }));

    const restored = TradeLedger.fromSnapshot(ledger.snapshot());
    expect(restored.position('BTCUSDT')).toBeCloseTo(0.0005);
    expect(restored.pnl).toBeCloseTo(3);
    expect(restored.openCount).toBe(1);
    expect(restored.openOrdersList()[0].clientOrderId).toBe('bh9');
  });

  it('ignores malformed snapshot entries', () => {
    const restored = TradeLedger.fromSnapshot({
      positions: { BTCUSDT: -1, ETHUSDT: 2 },
      avgEntry: { BTCUSDT: 0 },
      realizedPnl: Number.NaN,
      openOrders: { x: null as unknown as TrackedOrder },
      updatedAt: 0,
    });
    expect(restored.position('BTCUSDT')).toBe(0);
    expect(restored.position('ETHUSDT')).toBe(2);
    expect(restored.pnl).toBe(0);
    expect(restored.openCount).toBe(0);
  });
});
