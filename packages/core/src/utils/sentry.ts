import * as Sentry from '@sentry/node';

export interface SentryInitOptions {
  /**
   * Which service is reporting, so events can be filtered server-side
   * (`server_name`). Expected values: `api` | `workers`.
   */
  service: 'api' | 'workers';
}

let enabled = false;

/**
 * Initializes Sentry for the current process. Deliberately a no-op when
 * `SENTRY_DSN` is unset, so local development and the test suite run with zero
 * telemetry and zero network traffic. Idempotent — safe to call from both the
 * entry point and tests.
 */
export function initSentry(options: SentryInitOptions): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    enabled = false;
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
    release: `bothive@${process.env.npm_package_version ?? 'dev'}`,
    serverName: options.service,
    // Tracing is opt-in per service and off by default: it adds overhead to
    // every request/job, so keep the sample rate low when enabled.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0') || 0,
    ...(process.env.SENTRY_SAMPLE_RATE
      ? { sampleRate: parseFloat(process.env.SENTRY_SAMPLE_RATE) }
      : {}),
  });
  enabled = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Captures an exception, attaching service-specific context (botId, action,
 * request route, ...). No-op when Sentry is not enabled. Each capture runs in
 * a fresh scope so context from one error can never leak into the next.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context && Object.keys(context).length > 0) {
      scope.setContext('bothive', context);
    }
    Sentry.captureException(error);
  });
}
