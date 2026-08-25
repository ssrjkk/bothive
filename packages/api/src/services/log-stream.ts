import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const LOG_CHANNEL = 'bothive:logs';

interface HubSocket {
  send: (data: string) => void;
  close: () => void;
}

class LogStreamHub {
  private readonly MAX_BACKLOG = 200;
  private sockets = new Set<HubSocket>();
  /** Circular buffer of recent entries: O(1) push/evict under load. */
  private backlog = new Array<unknown>(this.MAX_BACKLOG);
  private backlogHead = 0;
  private backlogCount = 0;

  add(socket: HubSocket): void {
    this.sockets.add(socket);
    for (let i = 0; i < this.backlogCount; i++) {
      const entry = this.backlog[(this.backlogHead + i) % this.MAX_BACKLOG]!;
      try {
        socket.send(JSON.stringify({ type: 'log', data: entry }));
      } catch {
        /* ignore */
      }
    }
    this.broadcast({ type: 'status', data: { connected: true, listeners: this.sockets.size } });
  }

  remove(socket: HubSocket): void {
    this.sockets.delete(socket);
    this.broadcast({ type: 'status', data: { connected: true, listeners: this.sockets.size } });
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
    for (const socket of this.sockets) {
      try {
        socket.send(payload);
      } catch {
        /* ignore */
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
