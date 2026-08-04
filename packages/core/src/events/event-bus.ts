type EventHandler<E> = (event: E) => Promise<void>;
type EventName = string;

const HISTORY_LIMIT = 100;

export class EventBus {
  private handlers = new Map<EventName, Set<EventHandler<any>>>();
  private history = new Map<EventName, unknown[]>();

  on<E>(eventName: EventName, handler: EventHandler<E>): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    this.handlers.get(eventName)!.add(handler);
  }

  off<E>(eventName: EventName, handler: EventHandler<E>): void {
    this.handlers.get(eventName)?.delete(handler);
  }

  async emit<E>(eventName: EventName, event: E): Promise<void> {
    if (!this.history.has(eventName)) {
      this.history.set(eventName, []);
    }
    const history = this.history.get(eventName)!;
    history.push(event);
    if (history.length > HISTORY_LIMIT) {
      history.splice(0, history.length - HISTORY_LIMIT);
    }

    const handlers = this.handlers.get(eventName);
    if (!handlers) return;

    const promises: Promise<void>[] = [];
    for (const handler of handlers) {
      promises.push(handler(event).catch((err) => {
        console.error(`[EventBus] Error in handler for "${eventName}":`, err);
      }));
    }
    await Promise.all(promises);
  }

  getHistory<E>(eventName: EventName, limit: number = 50): E[] {
    const events = this.history.get(eventName) ?? [];
    const n = Math.max(0, Math.floor(limit));
    if (n === 0) return [];
    return events.slice(-n) as E[];
  }

  clearHistory(eventName?: EventName): void {
    if (eventName) {
      this.history.delete(eventName);
    } else {
      this.history.clear();
    }
  }

  listenerCount(eventName: EventName): number {
    return this.handlers.get(eventName)?.size ?? 0;
  }
}

export const bus = new EventBus();

export const Events = {
  BotConnected: 'bot.connected',
  BotDisconnected: 'bot.disconnected',
  BotError: 'bot.error',
  BotReconnecting: 'bot.reconnecting',
  BotEvent: 'bot.event',
  ScriptTriggered: 'script.triggered',
  ScriptError: 'script.error',
  QueueJobCompleted: 'queue.job.completed',
  QueueJobFailed: 'queue.job.failed',
} as const;
