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

  it('records the entry basis for a fill already in the reconciled balance', () => {
    const ledger = new TradeLedger();
    ledger.reconcilePositions({ BTCUSDT: 0.0005 });
    ledger.applyReconciledFill('BTCUSDT', 'buy', 0.0005, 59000);
    // Quantity must not be double-counted; the fill explains the position.
    expect(ledger.position('BTCUSDT')).toBeCloseTo(0.0005);
    expect(ledger.snapshot().avgEntry.BTCUSDT).toBeCloseTo(59000);
  });

  it('leaves the basis unknown when a reconciled fill only explains part of the position', () => {
    const ledger = new TradeLedger();
    ledger.reconcilePositions({ BTCUSDT: 0.0015 });
    ledger.applyReconciledFill('BTCUSDT', 'buy', 0.0005, 59000);
    expect(ledger.position('BTCUSDT')).toBeCloseTo(0.0015);
    expect(ledger.snapshot().avgEntry.BTCUSDT).toBeUndefined();
  });

  it('weights a reconciled fill into an existing known basis without double-counting', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.reconcilePositions({ BTCUSDT: 0.0015 });
    ledger.applyReconciledFill('BTCUSDT', 'buy', 0.0005, 58000);
    expect(ledger.position('BTCUSDT')).toBeCloseTo(0.0015);
    expect(ledger.snapshot().avgEntry.BTCUSDT).toBeCloseTo(59333.3333);
  });

  it('realizes PnL for a reconciled sell without double-removing the position', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.reconcilePositions({ BTCUSDT: 0.0005 });
    ledger.applyReconciledFill('BTCUSDT', 'sell', 0.0005, 66000);
    expect(ledger.pnl).toBeCloseTo(3);
    expect(ledger.position('BTCUSDT')).toBeCloseTo(0.0005);
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

  it('tracks a trailing high and clears it on a full exit', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.setTrailingHigh('BTCUSDT', 64000);
    expect(ledger.trailingHighFor('BTCUSDT')).toBe(64000);
    expect(ledger.trailingHighFor('btcusdt')).toBe(64000);
    ledger.applyFill('BTCUSDT', 'sell', 0.001, 59000);
    expect(ledger.trailingHighFor('BTCUSDT')).toBeUndefined();
    expect(ledger.position('BTCUSDT')).toBe(0);
  });

  it('keeps the trailing high across a partial sell and re-arms on a new buy', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.002, 60000);
    ledger.setTrailingHigh('BTCUSDT', 64000);
    ledger.applyFill('BTCUSDT', 'sell', 0.001, 65000);
    expect(ledger.trailingHighFor('BTCUSDT')).toBe(64000);
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 66000);
    expect(ledger.trailingHighFor('BTCUSDT')).toBeUndefined();
  });

  it('round-trips the trailing high through a snapshot', () => {
    const ledger = new TradeLedger();
    ledger.applyFill('BTCUSDT', 'buy', 0.001, 60000);
    ledger.setTrailingHigh('BTCUSDT', 64500);
    const restored = TradeLedger.fromSnapshot(ledger.snapshot());
    expect(restored.trailingHighFor('BTCUSDT')).toBe(64500);
    expect(restored.avgEntryFor('BTCUSDT')).toBeCloseTo(60000);
    // Legacy snapshots without the field restore cleanly.
    const legacy = TradeLedger.fromSnapshot({
      positions: { BTCUSDT: 0.001 },
      avgEntry: { BTCUSDT: 60000 },
      realizedPnl: 0,
      openOrders: {},
      updatedAt: 0,
    });
    expect(legacy.trailingHighFor('BTCUSDT')).toBeUndefined();
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
