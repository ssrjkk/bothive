import { describe, it, expect, vi } from 'vitest';

const store = vi.hoisted(() => ({
  data: new Map<string, string>(),
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'ready';
    handlers: Record<string, (err?: Error) => void> = {};
    constructor(_url: string, _opts?: unknown) {}
    on(event: string, cb: (err?: Error) => void) {
      this.handlers[event] = cb;
      return this;
    }
    async get(key: string): Promise<string | null> {
      return store.data.get(key) ?? null;
    }
    async mget(...keys: string[]): Promise<Array<string | null>> {
      return keys.map((k) => store.data.get(k) ?? null);
    }
    async scan(
      cursor: string,
      _match: string,
      pattern: string,
      _count: string,
    ): Promise<[string, string[]]> {
      if (cursor !== '0') return ['0', []];
      const prefix = pattern.replace(/\*$/, '');
      const found = [...store.data.keys()].filter((k) => k.startsWith(prefix));
      return ['0', found];
    }
    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const k of keys) n += store.data.delete(k) ? 1 : 0;
      return n;
    }
    async quit(): Promise<void> {}
  }
  return { Redis: FakeRedis };
});

import { getCryptoState, deleteBotRuntimeState } from '../services/memory.js';

const LIVE_KEY = 'bothive:crypto:live:bot1';
const POSITIONS_KEY = 'bothive:crypto:positions:bot1';
const DAILY_KEY = 'bothive:crypto:daily:bot1:2026-08-19';

beforeEach(() => {
  store.data.clear();
});

describe('getCryptoState', () => {
  it('reads the live ledger snapshot with entries, PnL and open orders', async () => {
    store.data.set(
      LIVE_KEY,
      JSON.stringify({
        positions: { BTCUSDT: 0.001, ETHUSDT: 2 },
        avgEntry: { BTCUSDT: 60000, ETHUSDT: 3100 },
        realizedPnl: 6.5,
        openOrders: {
          bh2: {
            clientOrderId: 'bh2',
            symbol: 'ETHUSDT',
            side: 'sell',
            type: 'limit',
            price: 3400,
            quantity: 1,
            placedAt: 1700000000200,
          },
          bh1: {
            clientOrderId: 'bh1',
            symbol: 'BTCUSDT',
            side: 'buy',
            type: 'limit',
            price: 59000,
            quantity: 0.001,
            placedAt: 1700000000100,
          },
        },
        updatedAt: 1787097600000,
      }),
    );
    store.data.set(DAILY_KEY, '5900');
    store.data.set('bothive:crypto:daily:bot1:2026-08-18', '1000');

    const state = await getCryptoState('bot1');
    expect(state.tradeMode).toBe('live');
    expect(state.positions).toEqual([
      { symbol: 'BTCUSDT', quantity: 0.001, avgEntry: 60000 },
      { symbol: 'ETHUSDT', quantity: 2, avgEntry: 3100 },
    ]);
    expect(state.realizedPnl).toBe(6.5);
    expect(state.openOrders.map((o) => o.clientOrderId)).toEqual(['bh1', 'bh2']);
    expect(state.dailySpendUsdt).toBeCloseTo(69);
    expect(state.updatedAt).toBe('2026-08-19T00:00:00.000Z');
  });

  it('sanitizes malformed snapshot content', async () => {
    store.data.set(
      LIVE_KEY,
      JSON.stringify({
        positions: { BTCUSDT: -1, ETHUSDT: 'lots', SOLUSDT: 0.5 },
        avgEntry: { SOLUSDT: 'bad' },
        realizedPnl: 'NaN',
        openOrders: {
          bad: { clientOrderId: '', symbol: 'BTCUSDT' },
          ok: {
            clientOrderId: 'bh9',
            symbol: 'BTCUSDT',
            side: 'nope',
            type: 'weird',
            price: -1,
            quantity: 0,
            placedAt: 'later',
          },
        },
        updatedAt: 'not-a-number',
      }),
    );

    const state = await getCryptoState('bot1');
    expect(state.positions).toEqual([{ symbol: 'SOLUSDT', quantity: 0.5, avgEntry: null }]);
    expect(state.realizedPnl).toBe(0);
    expect(state.openOrders).toEqual([
      {
        clientOrderId: 'bh9',
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'market',
        price: null,
        quantity: 0,
        placedAt: 0,
      },
    ]);
    expect(state.updatedAt).toBeNull();
  });

  it('falls back to dry-run positions without entries', async () => {
    store.data.set(POSITIONS_KEY, JSON.stringify({ BTCUSDT: 0.25, ETHUSDT: -3 }));
    const state = await getCryptoState('bot1');
    expect(state.tradeMode).toBe('dry');
    expect(state.positions).toEqual([{ symbol: 'BTCUSDT', quantity: 0.25, avgEntry: null }]);
    expect(state.realizedPnl).toBeNull();
    expect(state.openOrders).toEqual([]);
  });

  it('returns an empty state when nothing is stored', async () => {
    const state = await getCryptoState('bot1');
    expect(state).toEqual({
      tradeMode: 'none',
      positions: [],
      realizedPnl: null,
      openOrders: [],
      dailySpendUsdt: 0,
      updatedAt: null,
    });
  });

  it('degrades to an empty state when the snapshot is unreadable', async () => {
    store.data.set(LIVE_KEY, '{not json');
    const state = await getCryptoState('bot1');
    expect(state.tradeMode).toBe('none');
    expect(state.positions).toEqual([]);
  });

  it('cleans up both crypto state keys on bot deletion', async () => {
    store.data.set(LIVE_KEY, JSON.stringify({ positions: { BTCUSDT: 1 } }));
    store.data.set(POSITIONS_KEY, JSON.stringify({ BTCUSDT: 1 }));
    store.data.set(DAILY_KEY, '100');
    const deleted = await deleteBotRuntimeState('bot1');
    expect(deleted).toBe(3);
    expect(store.data.has(LIVE_KEY)).toBe(false);
    expect(store.data.has(POSITIONS_KEY)).toBe(false);
    expect(store.data.has(DAILY_KEY)).toBe(false);
  });
});
