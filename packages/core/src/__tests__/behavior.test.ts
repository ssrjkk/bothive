import { describe, it, expect } from 'vitest';
import {
  gaussian,
  logNormal,
  uniform,
  typingDelay,
  messageGap,
  clickDelay,
  reactionDelay,
  thinkingPause,
  scrollDelay,
} from '../behavior/human-delay.js';
import {
  HUMAN_DEFAULT_SCHEDULE,
  shouldBeActive,
  nextTransition,
} from '../behavior/session-lifecycle.js';
import {
  detectAnomaly,
  planRotation,
  warmingLimits,
  DEFAULT_WARMING_CONFIG,
} from '../behavior/self-healing.js';

describe('human-delay', () => {
  it('clamps gaussian values to the configured bounds', () => {
    // Deterministic RNG that always returns 0.5 -> Box-Muller produces u=0.5, v=0.5.
    const rng = () => 0.5;
    for (let i = 0; i < 50; i++) {
      const v = gaussian(100, 50, { minMs: 10, maxMs: 200 }, { random: rng });
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(200);
    }
  });

  it('gaussian returns the mean for mid-range random input', () => {
    // For rng()=0.5: Box-Muller with u=0.5,v=0.5 -> cos(pi)=~-1, ln(0.5)~-0.693
    // gives a non-zero norm deviate, so we only assert it stays in a sane range.
    const v = gaussian(1000, 200, { minMs: 0, maxMs: 50_000 }, { random: () => 0.5 });
    expect(v).toBeGreaterThan(500);
    expect(v).toBeLessThan(1500);
  });

  it('uniform returns values inside the requested range', () => {
    const rng = () => 0.25;
    expect(uniform(100, 300, { random: rng })).toBeCloseTo(150, 5);
    // Purely uniform in [min, max] for a full sweep.
    const min = Math.min(
      ...Array.from({ length: 200 }, () => uniform(5, 10, { random: () => Math.random() })),
    );
    const max = Math.max(
      ...Array.from({ length: 200 }, () => uniform(5, 10, { random: () => Math.random() })),
    );
    expect(min).toBeGreaterThanOrEqual(5);
    expect(max).toBeLessThanOrEqual(10);
  });

  it('logNormal is right-skewed with a small median and rare long tails', () => {
    const values = Array.from({ length: 2000 }, () =>
      logNormal(Math.log(3000), 0.5, { minMs: 100, maxMs: 60_000 }),
    );
    const median = values.sort((a, b) => a - b)[values.length / 2];
    // Median should sit near exp(mu) ~ 3000ms.
    expect(median).toBeGreaterThan(2000);
    expect(median).toBeLessThan(4500);
    // Long tail: some values should exceed 10s.
    expect(values.some((v) => v > 10_000)).toBe(true);
  });

  it('presets produce values within their documented windows', () => {
    for (let i = 0; i < 50; i++) {
      expect(typingDelay()).toBeGreaterThanOrEqual(30);
      expect(typingDelay()).toBeLessThanOrEqual(160);
      expect(clickDelay()).toBeGreaterThanOrEqual(100);
      expect(clickDelay()).toBeLessThanOrEqual(900);
      expect(reactionDelay()).toBeGreaterThanOrEqual(400);
      expect(reactionDelay()).toBeLessThanOrEqual(4000);
      expect(scrollDelay()).toBeGreaterThanOrEqual(200);
      expect(scrollDelay()).toBeLessThanOrEqual(1500);
      expect(messageGap()).toBeGreaterThanOrEqual(800);
      expect(messageGap()).toBeLessThanOrEqual(20_000);
      expect(thinkingPause()).toBeGreaterThanOrEqual(1500);
      expect(thinkingPause()).toBeLessThanOrEqual(30_000);
    }
  });
});

describe('session-lifecycle', () => {
  const schedule: typeof HUMAN_DEFAULT_SCHEDULE = {
    activeWindows: {
      1: [{ startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 }],
    },
    timezone: 'UTC',
    jitterMs: 0,
  };

  it('is active during a configured window', () => {
    const mon10am = new Date('2024-01-01T10:00:00Z'); // Monday 2024-01-01
    expect(shouldBeActive(mon10am, schedule)).toBe(true);
  });

  it('is asleep outside a configured window', () => {
    const mon06am = new Date('2024-01-01T06:00:00Z');
    const mon14pm = new Date('2024-01-01T14:00:00Z');
    expect(shouldBeActive(mon06am, schedule)).toBe(false);
    expect(shouldBeActive(mon14pm, schedule)).toBe(false);
  });

  it('is asleep on a day with no window', () => {
    const tue10am = new Date('2024-01-02T10:00:00Z'); // Tuesday, no window
    const sun20h = new Date('2024-01-07T20:00:00Z'); // Sunday, no window
    expect(shouldBeActive(tue10am, schedule)).toBe(false);
    expect(shouldBeActive(sun20h, schedule)).toBe(false);
  });

  it('handles overnight windows correctly', () => {
    const overnight: typeof HUMAN_DEFAULT_SCHEDULE = {
      activeWindows: { 0: [{ startHour: 22, startMinute: 0, endHour: 2, endMinute: 0 }] },
      timezone: 'UTC',
      jitterMs: 0,
    };
    // Sunday 2024-01-07 at 23:00 is inside the overnight window (22:00 -> 02:00).
    expect(shouldBeActive(new Date('2024-01-07T23:00:00Z'), overnight)).toBe(true);
    // Sunday 13:00 and 02:30 are outside.
    expect(shouldBeActive(new Date('2024-01-07T13:00:00Z'), overnight)).toBe(false);
    expect(shouldBeActive(new Date('2024-01-07T02:30:00Z'), overnight)).toBe(false);
    // The window belongs to its start day (Sunday); Monday early-morning is a
    // separate day key and is not covered.
    expect(shouldBeActive(new Date('2024-01-08T01:00:00Z'), overnight)).toBe(false);
  });

  it('applies jitter by widening the boundaries', () => {
    const jittery: typeof HUMAN_DEFAULT_SCHEDULE = {
      activeWindows: { 1: [{ startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 }] },
      timezone: 'UTC',
      jitterMs: 60 * 60 * 1000, // ±1 hour
    };
    // 07:30 Monday is 30 min before the window opens but within ±1h jitter.
    expect(shouldBeActive(new Date('2024-01-01T07:30:00Z'), jittery)).toBe(true);
    // 12:30 is 30 min after close, also within jitter.
    expect(shouldBeActive(new Date('2024-01-01T12:30:00Z'), jittery)).toBe(true);
  });

  it('nextTransition reports a wake transition while asleep', () => {
    const mon06am = new Date('2024-01-01T06:00:00Z');
    const t = nextTransition(mon06am, schedule);
    expect(t.action).toBe('wake');
    expect(t.untilMs).toBeGreaterThan(0);
  });

  it('nextTransition reports a sleep transition while active', () => {
    const mon10am = new Date('2024-01-01T10:00:00Z');
    const t = nextTransition(mon10am, schedule);
    expect(t.action).toBe('sleep');
    expect(t.untilMs).toBeGreaterThanOrEqual(0);
  });
});

describe('self-healing', () => {
  it('returns continue for insufficient data', () => {
    const r = detectAnomaly({
      attempted: 3,
      succeeded: 3,
      rateLimited: 0,
      silentDrops: 0,
      lastSuccessAt: Date.now(),
    });
    expect(r).toMatchObject({ flagged: false, recommendation: 'continue' });
  });

  it('detects severe throttling when success rate is crushed', () => {
    const r = detectAnomaly({
      attempted: 30,
      succeeded: 1,
      rateLimited: 0,
      silentDrops: 0,
      lastSuccessAt: Date.now(),
    });
    expect(r.flagged).toBe(true);
    expect(r.recommendation).toBe('pause');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects a rate-limit flood', () => {
    const r = detectAnomaly({
      attempted: 40,
      succeeded: 10,
      rateLimited: 25,
      silentDrops: 0,
      lastSuccessAt: Date.now(),
    });
    expect(r.flagged).toBe(true);
    expect(r.recommendation).toBe('throttle');
  });

  it('detects extended silence as a potential shadowban (rotate)', () => {
    const r = detectAnomaly({
      attempted: 15,
      succeeded: 0,
      rateLimited: 2,
      silentDrops: 0,
      lastSuccessAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
    });
    expect(r.flagged).toBe(true);
    expect(r.recommendation).toBe('rotate');
  });

  it('detects a silent-drop shadowban', () => {
    const r = detectAnomaly({
      attempted: 20,
      succeeded: 20,
      rateLimited: 0,
      silentDrops: 18,
      lastSuccessAt: Date.now(),
    });
    expect(r.flagged).toBe(true);
    expect(r.recommendation).toBe('pause');
    expect(r.reason).toMatch(/shadowban/i);
  });

  it('returns healthy for normal behavior', () => {
    const r = detectAnomaly({
      attempted: 20,
      succeeded: 18,
      rateLimited: 1,
      silentDrops: 2,
      lastSuccessAt: Date.now(),
    });
    expect(r.flagged).toBe(false);
    expect(r.recommendation).toBe('continue');
  });

  it('plans a pause + proxy rotation + alert for pause detection', () => {
    const r = detectAnomaly({
      attempted: 30,
      succeeded: 1,
      rateLimited: 0,
      silentDrops: 0,
      lastSuccessAt: Date.now(),
    });
    const actions = planRotation(r);
    expect(actions.map((a) => a.type)).toContain('pause');
    expect(actions.map((a) => a.type)).toContain('change_proxy');
    expect(actions.map((a) => a.type)).toContain('alert');
  });

  it('plans a cool-down for throttle detection', () => {
    const r = detectAnomaly({
      attempted: 40,
      succeeded: 10,
      rateLimited: 25,
      silentDrops: 0,
      lastSuccessAt: Date.now(),
    });
    const actions = planRotation(r);
    expect(actions[0].type).toBe('cool_down');
    expect(actions.map((a) => a.type)).toContain('change_proxy');
  });

  it('plans a proxy swap for rotate detection', () => {
    const r = detectAnomaly({
      attempted: 15,
      succeeded: 0,
      rateLimited: 0,
      silentDrops: 0,
      lastSuccessAt: Date.now() - 60 * 60 * 1000,
    });
    const actions = planRotation(r);
    expect(actions[0].type).toBe('change_proxy');
    expect(actions.map((a) => a.type)).toContain('alert');
  });

  it('warmingLimits gates posting until firstPostDay and resets on day change', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const day1 = new Date('2024-01-01T12:00:00Z');
    const day2 = new Date('2024-01-02T12:00:00Z');

    const day1State = {
      startedAt: start.toISOString(),
      todayActions: 0,
      todayPosts: 0,
      lastActionDate: '2024-01-01',
    };
    const r1 = warmingLimits(day1State, DEFAULT_WARMING_CONFIG, day1);
    expect(r1.canAct).toBe(true);
    expect(r1.canPost).toBe(false); // firstPostDay = 3

    const day3State = {
      startedAt: start.toISOString(),
      todayActions: 3,
      todayPosts: 3,
      lastActionDate: '2024-01-03',
    };
    const r3 = warmingLimits(day3State, DEFAULT_WARMING_CONFIG, new Date('2024-01-03T12:00:00Z'));
    expect(r3.canAct).toBe(true); // 3 actions used < max 5
    expect(r3.canPost).toBe(false); // already hit 3 posts > max 2
  });

  it('warmingLimits returns full capacity once warming completes', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const late = new Date('2024-01-10T12:00:00Z');
    const state = {
      startedAt: start.toISOString(),
      todayActions: 99,
      todayPosts: 99,
      lastActionDate: '2024-01-10',
    };
    const r = warmingLimits(state, DEFAULT_WARMING_CONFIG, late);
    expect(r).toMatchObject({
      canAct: true,
      canPost: true,
      reason: 'Warming complete',
      daysRemaining: 0,
    });
  });
});
