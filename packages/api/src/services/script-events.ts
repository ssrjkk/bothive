import { redisConnection } from './queue.js';

const SCRIPTS_CHANNEL = 'bothive:scripts';

/**
 * Notifies workers that scripts changed. `botIds` narrows the reload to the
 * affected bots (scripts routes know the bot; bulk/delete paths collect them);
 * without it workers fall back to a full reload. The notification is
 * best-effort — a missed publish only delays the change until the next
 * scripts-changed event or a worker restart.
 */
export function notifyScriptsChanged(botIds?: string[]): void {
  try {
    redisConnection.publish(
      SCRIPTS_CHANNEL,
      JSON.stringify({
        event: 'scripts-changed',
        at: new Date().toISOString(),
        ...(botIds && botIds.length > 0 ? { botIds } : {}),
      }),
    );
  } catch {
    // ignore — workers will pick up changes on restart
  }
}
