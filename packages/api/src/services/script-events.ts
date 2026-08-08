import { redisConnection } from './queue.js';

const SCRIPTS_CHANNEL = 'bothive:scripts';

export function notifyScriptsChanged(): void {
  try {
    redisConnection.publish(
      SCRIPTS_CHANNEL,
      JSON.stringify({ event: 'scripts-changed', at: new Date().toISOString() }),
    );
  } catch {
    // ignore — workers will pick up changes on restart
  }
}
