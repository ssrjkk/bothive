import WebSocket from 'ws';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';
const MAX_RECONNECT_MS = 30_000;
const HEARTBEAT_MS = 30_000;
const STALE_SOCKET_MS = 90_000;

export interface HubTick {
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

interface SymbolSocket {
  ws: WebSocket | null;
  refs: Set<(tick: HubTick) => void>;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  lastMessageAt: number;
}

/**
 * Multiplexes Binance miniTicker sockets across every bot connected to this
 * worker: one WebSocket per watched symbol, refcounted by subscribers, closed
 * as soon as the last subscriber goes away. Binance allows ~300 concurrent
 * sockets per IP, so the socket count must scale with distinct symbols, not
 * with bots (the old per-bot stream did the latter). Reconnects use capped
 * exponential backoff; a dropped socket can never stall the price feed
 * because REST polling remains as the safety net.
 */
export class SymbolStreamHub {
  private readonly sockets = new Map<string, SymbolSocket>();

  /** Registers a listener for a symbol's ticks; returns the unsubscribe fn. */
  subscribe(symbol: string, onTick: (tick: HubTick) => void): () => void {
    const key = symbol.toUpperCase();
    let entry = this.sockets.get(key);
    if (!entry) {
      entry = this.createSocket(key);
      this.sockets.set(key, entry);
    }
    entry.refs.add(onTick);
    return () => {
      const current = this.sockets.get(key);
      if (!current) return;
      current.refs.delete(onTick);
      if (current.refs.size === 0) this.closeSocket(key, current);
    };
  }

  get socketCount(): number {
    return this.sockets.size;
  }

  private createSocket(symbol: string): SymbolSocket {
    const entry: SymbolSocket = {
      ws: null,
      refs: new Set(),
      reconnectTimer: null,
      heartbeatTimer: null,
      reconnectAttempts: 0,
      lastMessageAt: 0,
    };
    this.open(entry, symbol);
    // Keeps the TCP connection alive through NATs and proxies, and forces a
    // reconnect when the remote stops sending without closing the socket.
    entry.heartbeatTimer = setInterval(() => {
      const ws = entry.ws;
      if (!ws) return;
      if (Date.now() - entry.lastMessageAt > STALE_SOCKET_MS) {
        entry.ws = null;
        ws.removeAllListeners('close');
        try {
          ws.close();
        } catch {
          // Socket may already be dead.
        }
        this.scheduleReconnect(symbol, entry);
      } else {
        try {
          ws.ping();
        } catch {
          // Socket is dead; its close handler schedules the reconnect.
        }
      }
    }, HEARTBEAT_MS);
    return entry;
  }

  private open(entry: SymbolSocket, symbol: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${BINANCE_WS_URL}/${symbol.toLowerCase()}@miniTicker`);
    } catch {
      this.scheduleReconnect(symbol, entry);
      return;
    }
    entry.ws = ws;
    entry.lastMessageAt = Date.now();
    ws.on('open', () => {
      entry.reconnectAttempts = 0;
      entry.lastMessageAt = Date.now();
    });
    ws.on('message', (data) => {
      entry.lastMessageAt = Date.now();
      this.handleMessage(entry, symbol, data);
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (entry.ws === ws) entry.ws = null;
      this.scheduleReconnect(symbol, entry);
    });
  }

  private handleMessage(entry: SymbolSocket, symbol: string, data: WebSocket.RawData): void {
    try {
      // Single-symbol streams deliver the miniTicker object directly; the
      // combined /stream endpoint wraps it in { data }. Accept both.
      const frame = JSON.parse(data.toString()) as { data?: MiniTickerData } & MiniTickerData;
      const d = frame.data ?? frame;
      if (!d?.s || d.c === undefined) return;
      if (d.s.toUpperCase() !== symbol) return;
      const tick: HubTick = {
        symbol: d.s,
        price: Number(d.c),
        change24h: d.P === undefined ? null : Number(d.P),
        timestamp: d.E ?? Date.now(),
      };
      for (const onTick of entry.refs) onTick(tick);
    } catch {
      // Ignore malformed frames; the REST poll keeps prices fresh regardless.
    }
  }

  private scheduleReconnect(symbol: string, entry: SymbolSocket): void {
    if (entry.refs.size === 0 || entry.reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** Math.min(entry.reconnectAttempts, 5));
    entry.reconnectAttempts += 1;
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      this.open(entry, symbol);
    }, delay);
  }

  private closeSocket(symbol: string, entry: SymbolSocket): void {
    this.sockets.delete(symbol);
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    if (entry.heartbeatTimer) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }
    const ws = entry.ws;
    entry.ws = null;
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
