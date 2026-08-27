import { buildApp } from './app.js';
import { redisConnection } from './services/queue.js';
import { startLogCleanup } from './services/log-cleanup.js';
import { prisma } from './services/prisma.js';
import { initSentry, shutdownTracing } from '@bothive/core';

initSentry({ service: 'api' });

const port = parseInt(process.env.API_PORT ?? '3000', 10);
const host = process.env.API_HOST ?? '0.0.0.0';

const app = await buildApp();
const logCleanup = startLogCleanup(prisma);

let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  // SIGTERM/SIGINT can race with each other or with an uncaughtException; never
  // run the teardown twice.
  if (shuttingDown) return;
  shuttingDown = true;
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
  await shutdownTracing();
  // An uncaughtException must exit non-zero so the supervisor (PM2/Docker
  // restart policy) actually sees a crash instead of a clean exit 0.
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  app.log.error(err, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

try {
  await app.listen({ port, host });
  app.log.info(`BotHive API by ssrjkk — running on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
