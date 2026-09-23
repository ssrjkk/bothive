/**
 * The running build's version, for Sentry release tagging and worker heartbeats.
 *
 * `npm_package_version` is only populated when npm launches the process. The
 * production images run `node` directly (npm is not even installed — see the
 * Dockerfile), so relying on it alone meant every deployed service reported
 * itself as `dev`, which silently defeats release tracking in Sentry and makes
 * heartbeat version reporting useless.
 *
 * `SERVICE_VERSION` is the operator-facing override and is what the images set
 * from their build tag. `npm_package_version` is still honoured so `npm run dev`
 * and `npm start` keep working locally.
 */
export function resolveServiceVersion(): string {
  const explicit = process.env.SERVICE_VERSION?.trim();
  if (explicit) return explicit;

  const npmProvided = process.env.npm_package_version?.trim();
  if (npmProvided) return npmProvided;

  return 'dev';
}
