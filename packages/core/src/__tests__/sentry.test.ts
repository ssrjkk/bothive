import { describe, it, expect, afterEach } from 'vitest';
import { initSentry, isSentryEnabled, captureError } from '../utils/sentry.js';

describe('sentry helper', () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
    // Reset module state so a DSN set by one test can never leak into others.
    initSentry({ service: 'api' });
  });

  it('is a no-op without SENTRY_DSN (local dev / CI)', () => {
    delete process.env.SENTRY_DSN;
    expect(initSentry({ service: 'api' })).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });

  it('enables only when a DSN is configured', () => {
    process.env.SENTRY_DSN = 'https://1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d@sentry.example.com/12345';
    expect(initSentry({ service: 'workers' })).toBe(true);
    expect(isSentryEnabled()).toBe(true);
  });

  it('captureError does not throw when disabled', () => {
    delete process.env.SENTRY_DSN;
    initSentry({ service: 'api' });
    expect(() =>
      captureError(new Error('boom'), { botId: 'bot-1', action: 'sendMessage' }),
    ).not.toThrow();
  });
});
