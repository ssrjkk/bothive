// Lightweight health probe for the workers container. The worker has no HTTP
// listener, so this verifies the process can reach Redis (its critical
// dependency) with a short, non-retrying ping. The probe exits as a separate
// process, so a hung worker never blocks the healthcheck itself.
const Redis = require('ioredis');

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
  connectTimeout: 2000,
});

// ioredis emits an 'error' event on failed connections; swallow it so the
// rejection below is the single, clean signal.
client.on('error', () => {});

client
  .connect()
  .then(() => client.ping())
  .then((reply) => process.exit(reply === 'PONG' ? 0 : 1))
  .catch(() => process.exit(1));
