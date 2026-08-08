import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';

const T0 = 1_000_000;
const nowMock = { t: T0 };

function makeBreaker(overrides: Parameters<typeof makeClockBreaker>[0] = {}) {
  return makeClockBreaker(overrides);
}

function makeClockBreaker(
  options: { failureThreshold?: number; successThreshold?: number; resetTimeoutMs?: number } = {},
) {
  nowMock.t = T0;
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    successThreshold: 2,
    resetTimeoutMs: 60_000,
    now: () => nowMock.t,
    ...options,
  });
  return breaker;
}

const advance = (ms: number): void => {
  nowMock.t += ms;
};

describe('CircuitBreaker', () => {
  it('starts closed and allows attempts', () => {
    const cb = makeBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.canAttempt()).toBe(true);
  });

  it('trips open after the failure threshold', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 4; i++) {
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
    }
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canAttempt()).toBe(false);
  });

  it('a success in closed state resets the failure streak', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 4; i++) cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
  });

  it('rejects attempts while open and reports the remaining cooldown', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.canAttempt()).toBe(false);
    expect(cb.remainingCooldownMs()).toBe(60_000);

    advance(20_000);
    expect(cb.remainingCooldownMs()).toBe(40_000);
    expect(cb.canAttempt()).toBe(false);
  });

  it('moves to half-open after the cooldown and allows limited probes', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    advance(60_000);

    expect(cb.getState()).toBe('half_open');
    expect(cb.canAttempt()).toBe(true);
    expect(cb.canAttempt()).toBe(true);
    // successThreshold (2) probes are consumed
    expect(cb.canAttempt()).toBe(false);
  });

  it('closes after enough consecutive half-open successes', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    advance(60_000);

    // lazy half-open transition happens on the next state/attempt check
    expect(cb.getState()).toBe('half_open');
    cb.recordSuccess();
    expect(cb.getState()).toBe('half_open');
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.canAttempt()).toBe(true);
  });

  it('reopens with a fresh cooldown when a probe fails', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    advance(60_000);

    cb.canAttempt(); // transition to half-open and consume a probe
    expect(cb.getState()).toBe('half_open');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.remainingCooldownMs()).toBe(60_000);
  });

  it('does not extend the cooldown while already open', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    advance(10_000);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.remainingCooldownMs()).toBe(50_000);
  });

  it('ignores success while open', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getState()).toBe('open');
  });

  it('reset() closes the breaker from any state', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.canAttempt()).toBe(true);
  });

  it('respects custom thresholds', () => {
    const cb = makeBreaker({ failureThreshold: 2, successThreshold: 1, resetTimeoutMs: 1000 });
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    advance(1000);
    expect(cb.canAttempt()).toBe(true);
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });
});
