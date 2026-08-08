/**
 * Builds ioredis connection options. An optional REDIS_PASSWORD is layered on so
 * deployments with an auth-enabled Redis can supply the credential via
 * environment rather than embedding it in the connection URL.
 */
export function redisConnectionOptions(): { maxRetriesPerRequest: number | null; password?: string } {
  const options: { maxRetriesPerRequest: number | null; password?: string } = {
    maxRetriesPerRequest: null,
  };
  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }
  return options;
}
