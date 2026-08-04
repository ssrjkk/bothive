import { Redis } from 'ioredis';

const LOG_CHANNEL = 'bothive:logs';

interface HubSocket {
  send: (data: string) => void;
  close: () => void;
}

class LogStreamHub {
  private sockets = new Set<HubSocket>();
  private backlog: unknown[] = [];
  private readonly MAX_BACKLOG = 200;

  add(socket: HubSocket): void {
    this.sockets.add(socket);
    for (const entry of this.backlog) {
      try { socket.send(JSON.stringify({ type: 'log', data: entry })); } catch { /* ignore */ }
    }
    this.broadcast({ type: 'status', data: { connected: true, listeners: this.sockets.size } });
  }

  remove(socket: HubSocket): void {
    this.sockets.delete(socket);
    this.broadcast({ type: 'status', data: { connected: true, listeners: this.sockets.size } });
  }

  push(entry: unknown): void {
    this.backlog.push(entry);
    if (this.backlog.length > this.MAX_BACKLOG) this.backlog.shift();
    this.broadcast({ type: 'log', data: entry });
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      try { socket.send(payload); } catch { /* ignore */ }
    }
  }
}

export const logHub = new LogStreamHub();

let subscriber: Redis | null = null;
let subscribing: Promise<Redis> | null = null;

export function getLogSubscriber(): Promise<Redis> {
  if (!subscribing) {
    subscribing = new Promise<Redis>((resolve) => {
      const sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      });

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
        subscriber = sub;
        resolve(sub);
      });
    });
  }
  return subscribing;
}
