import WebSocket from 'ws';

const BINANCE_STREAM_URL = 'wss://stream.binance.com:9443/stream';
const MAX_RECONNECT_MS = 30_000;
const HEARTBEAT_MS = 30_000;
const STALE_SOCKET_MS = 90_000;

export interface StreamUpdate {
  symbol: string;
  price: number;
  change24h: number | null;
  timestamp: number;
}

interface MiniTickerData {
  s?: string;
  c?: string;
  P?: string;
  E?: number;
}

/**
 * Best-effort Binance miniTicker stream. Every update is pushed to onUpdate;
 * the worker treats it as an accelerator on top of REST polling, so a dropped
 * or flapping socket can never stall the price feed. Reconnects use capped
 * exponential backoff and stop as soon as close() is called.
 */
export class BinanceStream {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private closed = false;
  private reconnectAttempts = 0;

  constructor(
    private readonly symbols: string[],
    private readonly onUpdate: (update: StreamUpdate) => void,
  ) {}

  start(): void {
    this.closed = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.open();
    // Keeps the TCP connection alive through NATs and proxies, and forces a
    // reconnect when the remote stops sending without closing the socket
    // (Binance terminates idle connections but the socket can die silently).
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      if (Date.now() - this.lastMessageAt > STALE_SOCKET_MS) {
        this.ws = null;
        ws.removeAllListeners('close');
        try {
          ws.close();
        } catch {
          // Socket may already be dead.
        }
        this.scheduleReconnect();
      } else {
        try {
          ws.ping();
        } catch {
          // Socket is dead; its close handler will schedule the reconnect.
        }
      }
    }, HEARTBEAT_MS);
  }

  private open(): void {
    if (this.closed || this.symbols.length === 0) return;
    const streams = this.symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${BINANCE_STREAM_URL}?streams=${streams}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.lastMessageAt = Date.now();
    ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
    });
    ws.on('message', (data) => {
      this.lastMessageAt = Date.now();
      this.handleMessage(data);
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const frame = JSON.parse(data.toString()) as { data?: MiniTickerData };
      const d = frame.data;
      if (d?.s && d.c !== undefined) {
        this.onUpdate({
          symbol: d.s,
          price: Number(d.c),
          change24h: d.P === undefined ? null : Number(d.P),
          timestamp: d.E ?? Date.now(),
        });
      }
    } catch {
      // Ignore malformed frames; the REST poll keeps prices fresh regardless.
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeAllListeners('close');
      try {
        ws.close();
      } catch {
        // Socket may already be closed.
      }
    }
  }
}
