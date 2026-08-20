import { Redis } from 'ioredis';
import { redisConnectionOptions } from '@bothive/core';

const SCRIPTS_CHANNEL = 'bothive:scripts';

let subscriber: Redis | null = null;
let watching = false;

export function watchScriptChanges(onChanged: (botIds?: string[]) => Promise<void>): void {
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

  subscriber.on('message', (_channel, message) => {
    // The API tags the publish with the affected bot ids when it knows them,
    // letting us reload just those bots instead of the whole registry (which
    // would also reset every bot's cooldowns/counters).
    let botIds: string[] | undefined;
    try {
      const parsed = JSON.parse(message) as { botIds?: unknown };
      if (Array.isArray(parsed.botIds)) {
        botIds = parsed.botIds.filter((b): b is string => typeof b === 'string');
        if (botIds.length === 0) botIds = undefined;
      }
    } catch {
      botIds = undefined;
    }
    void onChanged(botIds).catch((err) => console.error('[script-sync] reload failed:', err));
  });
}

export async function disconnectScriptSync(): Promise<void> {
  if (subscriber) {
    await subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
  watching = false;
}
