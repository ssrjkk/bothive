import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SymbolStreamHub, type HubTick } from '../crypto/stream-hub.js';

const { FakeWebSocket } = vi.hoisted(() => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    handlers: Record<string, (data?: unknown) => void> = {};
    closed = false;
    constructor() {
      FakeWebSocket.instances.push(this);
    }
    on(event: string, cb: (data?: unknown) => void) {
      this.handlers[event] = cb;
      return this;
    }
    emit(event: string, data?: unknown) {
      this.handlers[event]?.(data);
    }
    ping() {}
    close() {
      this.closed = true;
    }
    removeAllListeners() {}
  }
  return { FakeWebSocket };
});

vi.mock('ws', () => ({ default: FakeWebSocket }));

beforeEach(() => {
  FakeWebSocket.instances = [];
});

function rawFrame(payload: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

describe('SymbolStreamHub', () => {
  it('shares one socket between subscribers of the same symbol', () => {
    const hub = new SymbolStreamHub();
    const a: HubTick[] = [];
    const b: HubTick[] = [];
    const unsubA = hub.subscribe('BTCUSDT', (t) => a.push(t));
    const unsubB = hub.subscribe('btcusdt', (t) => b.push(t));

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(hub.socketCount).toBe(1);

    FakeWebSocket.instances[0].emit(
      'message',
      rawFrame({ s: 'BTCUSDT', c: '61000', P: '1.5', E: 1700000000000 }),
    );
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({ symbol: 'BTCUSDT', price: 61000, change24h: 1.5 });
    expect(a[0].timestamp).toBe(1700000000000);

    unsubA();
    expect(FakeWebSocket.instances[0].closed).toBe(false);
    unsubB();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(hub.socketCount).toBe(0);
  });

  it('opens a separate socket per distinct symbol', () => {
    const hub = new SymbolStreamHub();
    const unsub = [
      hub.subscribe('BTCUSDT', () => {}),
      hub.subscribe('ETHUSDT', () => {}),
      hub.subscribe('BTCUSDT', () => {}),
    ];
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(hub.socketCount).toBe(2);
    for (const fn of unsub) fn();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].closed).toBe(true);
  });

  it('parses frames wrapped in { data } (combined stream format)', () => {
    const hub = new SymbolStreamHub();
    const ticks: HubTick[] = [];
    const unsub = hub.subscribe('BTCUSDT', (t) => ticks.push(t));
    FakeWebSocket.instances[0].emit(
      'message',
      rawFrame({ data: { s: 'BTCUSDT', c: '62000', P: '2', E: 1700000000001 } }),
    );
    expect(ticks).toHaveLength(1);
    expect(ticks[0].price).toBe(62000);
    unsub();
  });

  it('tolerates malformed and unrelated frames', () => {
    const hub = new SymbolStreamHub();
    const ticks: HubTick[] = [];
    const unsub = hub.subscribe('BTCUSDT', (t) => ticks.push(t));
    const ws = FakeWebSocket.instances[0];
    ws.emit('message', rawFrame({ nope: true }));
    ws.emit('message', Buffer.from('not json'));
    ws.emit('message', rawFrame({ data: { s: 'ETHUSDT', c: '3000' } }));
    expect(ticks).toHaveLength(0);
    unsub();
  });

  it('reopens a closed socket when a subscriber returns', () => {
    const hub = new SymbolStreamHub();
    const unsub = hub.subscribe('BTCUSDT', () => {});
    unsub();
    const before = FakeWebSocket.instances.length;
    const unsub2 = hub.subscribe('BTCUSDT', () => {});
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
    expect(FakeWebSocket.instances[before].closed).toBe(false);
    unsub2();
  });
});
