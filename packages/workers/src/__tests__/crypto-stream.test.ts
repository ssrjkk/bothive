import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BinanceStream, type StreamUpdate } from '../crypto/stream.js';

const { MockWebSocket } = vi.hoisted(() => {
  class MockWebSocket {
    static instances: MockWebSocket[] = [];
    static throwOnConstruct = false;
    url: string;
    handlers: Record<string, (data?: unknown) => void> = {};
    closed = false;
    pingCalls = 0;
    constructor(url: string) {
      if (MockWebSocket.throwOnConstruct) throw new Error('connect refused');
      this.url = url;
      MockWebSocket.instances.push(this);
    }
    on(event: string, cb: (data?: unknown) => void) {
      this.handlers[event] = cb;
      return this;
    }
    emit(event: string, data?: unknown) {
      this.handlers[event]?.(data);
    }
    ping() {
      this.pingCalls += 1;
    }
    close() {
      this.closed = true;
    }
    removeAllListeners() {}
  }
  return { MockWebSocket };
});

vi.mock('ws', () => ({ default: MockWebSocket }));

const activeStreams: BinanceStream[] = [];

function openStream(symbols: string[], onUpdate: (u: StreamUpdate) => void): BinanceStream {
  const stream = new BinanceStream(symbols, onUpdate);
  activeStreams.push(stream);
  return stream;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  MockWebSocket.throwOnConstruct = false;
});

afterEach(() => {
  vi.useRealTimers();
  for (const stream of activeStreams.splice(0)) stream.close();
});

describe('BinanceStream', () => {
  it('opens a socket for the composed stream URL', () => {
    const stream = openStream(['BTCUSDT', 'ETHUSDT'], () => {});
    stream.start();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe(
      'wss://stream.binance.com:9443/stream?streams=btcusdt@miniTicker/ethusdt@miniTicker',
    );
  });

  it('pushes parsed miniTicker updates and ignores malformed frames', () => {
    const updates: StreamUpdate[] = [];
    const stream = openStream(['BTCUSDT'], (update) => updates.push(update));
    stream.start();
    const ws = MockWebSocket.instances[0];

    ws.emit(
      'message',
      Buffer.from(JSON.stringify({ data: { s: 'BTCUSDT', c: '60000.5', P: '2.5', E: 123 } })),
    );
    ws.emit('message', Buffer.from(JSON.stringify({ data: { s: 'BTCUSDT' } })));
    ws.emit('message', Buffer.from(JSON.stringify({ nonsense: true })));
    ws.emit('message', Buffer.from('not json at all'));

    expect(updates).toEqual([
      { symbol: 'BTCUSDT', price: 60000.5, change24h: 2.5, timestamp: 123 },
    ]);
  });

  it('tolerates a missing 24h change in the frame', () => {
    const updates: StreamUpdate[] = [];
    const stream = openStream(['BTCUSDT'], (update) => updates.push(update));
    stream.start();
    MockWebSocket.instances[0].emit(
      'message',
      Buffer.from(JSON.stringify({ data: { s: 'BTCUSDT', c: '10', E: 1 } })),
    );
    expect(updates[0]).toMatchObject({
      symbol: 'BTCUSDT',
      price: 10,
      change24h: null,
      timestamp: 1,
    });
  });

  it('reconnects with capped exponential backoff and resets on open', async () => {
    vi.useFakeTimers();
    const stream = openStream(['BTCUSDT'], () => {});
    stream.start();
    expect(MockWebSocket.instances).toHaveLength(1);

    for (let i = 0; i < 6; i += 1) {
      const ws = MockWebSocket.instances[i];
      ws.emit('close');
      const expected = Math.min(30_000, 1000 * 2 ** Math.min(i, 5));
      await vi.advanceTimersByTimeAsync(expected);
    }
    expect(MockWebSocket.instances).toHaveLength(7);

    const latest = MockWebSocket.instances[6];
    latest.emit('open');
    latest.emit('close');
    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(8);
  });

  it('does not reconnect after close() and clears the pending timer', async () => {
    vi.useFakeTimers();
    const stream = openStream(['BTCUSDT'], () => {});
    stream.start();
    const ws = MockWebSocket.instances[0];

    ws.emit('close');
    stream.close();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(MockWebSocket.instances).toHaveLength(1);

    const second = openStream(['ETHUSDT'], () => {});
    second.start();
    const secondWs = MockWebSocket.instances[1];
    second.close();
    expect(secondWs.closed).toBe(true);
  });

  it('schedules a reconnect when the socket constructor throws', async () => {
    vi.useFakeTimers();
    MockWebSocket.throwOnConstruct = true;
    const stream = openStream(['BTCUSDT'], () => {});
    stream.start();
    expect(MockWebSocket.instances).toHaveLength(0);

    MockWebSocket.throwOnConstruct = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('pings the socket on every heartbeat while it is healthy', async () => {
    vi.useFakeTimers();
    const stream = openStream(['BTCUSDT'], () => {});
    stream.start();
    const ws = MockWebSocket.instances[0];
    ws.emit('open');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(ws.pingCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ws.pingCalls).toBe(2);

    ws.emit('message', Buffer.from(JSON.stringify({ data: { s: 'BTCUSDT', c: '10', E: 1 } })));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ws.pingCalls).toBe(3);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('reconnects when the socket goes stale without messages', async () => {
    vi.useFakeTimers();
    const stream = openStream(['BTCUSDT'], () => {});
    stream.start();
    const ws = MockWebSocket.instances[0];
    ws.emit('open');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(ws.pingCalls).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(ws.closed).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1].closed).toBe(false);
  });
});
