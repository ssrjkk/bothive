import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const SCRIPTS_CHANNEL = 'bothive:scripts';

let subscriber: Redis | null = null;
let watching = false;

export function watchScriptChanges(onChanged: () => Promise<void>): void {
  if (watching) return;
  watching = true;

  subscriber = new Redis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    redisConnectionOptions(),
  );
  subscriber.on('error', (err) => console.error('[script-sync] redis error:', err));

  subscriber.subscribe(SCRIPTS_CHANNEL, (err) => {
    if (err) console.error('[script-sync] subscribe failed:', err);
  });

  subscriber.on('message', (_channel, _message) => {
    void onChanged().catch((err) => console.error('[script-sync] reload failed:', err));
  });
}

export async function disconnectScriptSync(): Promise<void> {
  if (subscriber) {
    await subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
  watching = false;
}
