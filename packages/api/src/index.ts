import { buildApp } from './app.js';
import { redisConnection } from './services/queue.js';
import { startLogCleanup } from './services/log-cleanup.js';
import { prisma } from './services/prisma.js';
import { initSentry } from '@bothive/core';

initSentry({ service: 'api' });

const port = parseInt(process.env.API_PORT ?? '3000', 10);
const host = process.env.API_HOST ?? '0.0.0.0';

const app = await buildApp();
const logCleanup = startLogCleanup(prisma);

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down...`);
  logCleanup.stop();
  try {
    await app.close();
  } catch (err) {
    app.log.error(err);
  }
  try {
    redisConnection.disconnect();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  app.log.error(err, 'Uncaught exception');
  void shutdown('uncaughtException');
});

try {
  await app.listen({ port, host });
  app.log.info(`BotHive API by ssrjkk — running on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
