import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const LOG_CHANNEL = 'bothive:logs';

let publisher: Redis | null = null;

export function getLogPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', redisConnectionOptions());
    publisher.on('error', (err) => console.error('[log-publisher] redis error:', err));
  }
  return publisher;
}

export function publishLog(entry: unknown): void {
  try {
    getLogPublisher().publish(LOG_CHANNEL, JSON.stringify(entry));
  } catch (err) {
    console.error('[log-publisher] failed to publish:', err);
  }
}

export async function disconnectLogPublisher(): Promise<void> {
  if (publisher) {
    await publisher.quit().catch(() => undefined);
    publisher = null;
  }
}
