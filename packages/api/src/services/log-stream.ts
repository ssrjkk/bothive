import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const LOG_CHANNEL = 'bothive:logs';

// A slow/stalled WebSocket client that stops reading will otherwise let the
// underlying send buffer grow without bound and OOM the API process under high
// log volume. We evict any client whose buffered outbound payload exceeds this
// threshold instead of feeding it forever.
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024; // 2 MiB per socket
// Cap on concurrently connected log sockets: every socket costs memory (its
// replay backlog + its outbound buffer) and CPU (one JSON.stringify + send per
// log line), so an authenticated client must not be able to open unbounded
// sockets and multiply the fan-out cost.
const MAX_SOCKETS = 200;

interface HubSocket {
  send: (data: string) => void;
  close: () => void;
  /** Approximate bytes currently buffered for this socket's outbound stream. */
  bufferedAmount: () => number;
  /**
   * Tenant scope for this socket: a socket only receives log entries whose
   * `botId` is in its owned set. Guarantees a user cannot observe another
   * tenant's logs, even though every entry fans out over a shared Redis pub/sub
   * channel. A socket with no owned bots receives nothing.
   */
  filter: (entry: unknown) => boolean;
}

class LogStreamHub {
  private readonly MAX_BACKLOG = 200;
  private sockets = new Set<HubSocket>();
  /** Circular buffer of recent entries: O(1) push/evict under load. */
  private backlog = new Array<unknown>(this.MAX_BACKLOG);
  private backlogHead = 0;
  private backlogCount = 0;

  add(socket: HubSocket): boolean {
    if (this.sockets.size >= MAX_SOCKETS) {
      try {
        socket.send(
          JSON.stringify({ type: 'error', data: { message: 'Too many log connections' } }),
        );
      } catch {
        /* ignore */
      }
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      return false;
    }
    this.sockets.add(socket);
    for (let i = 0; i < this.backlogCount; i++) {
      const entry = this.backlog[(this.backlogHead + i) % this.MAX_BACKLOG]!;
      try {
        if (socket.filter(entry)) {
          socket.send(JSON.stringify({ type: 'log', data: entry }));
        }
      } catch {
        /* ignore */
      }
    }
    this.broadcast({
      type: 'status',
      data: { connected: true, listeners: this.sockets.size },
    });
    return true;
  }

  remove(socket: HubSocket): void {
    this.sockets.delete(socket);
    this.broadcast({
      type: 'status',
      data: { connected: true, listeners: this.sockets.size },
    });
  }

  push(entry: unknown): void {
    const slot = (this.backlogHead + this.backlogCount) % this.MAX_BACKLOG;
    this.backlog[slot] = entry;
    if (this.backlogCount < this.MAX_BACKLOG) this.backlogCount++;
    else this.backlogHead = (this.backlogHead + 1) % this.MAX_BACKLOG;
    this.broadcast({ type: 'log', data: entry });
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    const isLog = (message as { type?: string }).type === 'log';
    const entry = (message as { data?: unknown }).data;
    for (const socket of this.sockets) {
      try {
        if (isLog && entry && !socket.filter(entry)) continue;
        // Evict clients whose send buffer is already overflowing — their
        // `send()` would otherwise keep buffering in memory indefinitely.
        if (socket.bufferedAmount() > MAX_BUFFERED_BYTES) {
          socket.close();
          this.sockets.delete(socket);
          continue;
        }
        socket.send(payload);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}

export const logHub = new LogStreamHub();

let subscribing: Promise<Redis> | null = null;

export function getLogSubscriber(): Promise<Redis> {
  if (!subscribing) {
    subscribing = new Promise<Redis>((resolve) => {
      const sub = new Redis(
        process.env.REDIS_URL ?? 'redis://localhost:6379',
        redisConnectionOptions(),
      );

      sub.on('message', (_channel, message) => {
        try {
          logHub.push(JSON.parse(message));
        } catch {
          logHub.push({ message });
        }
      });

      sub.on('error', (err) => console.error('[log-stream] redis error:', err));

      sub.subscribe(LOG_CHANNEL, (err) => {
        if (err) {
          console.error(`[log-stream] subscribe error: ${err}`);
        } else {
          console.log(`[log-stream] subscribed to "${LOG_CHANNEL}"`);
        }
        resolve(sub);
      });
    });
  }
  return subscribing;
}
