import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacing, zeroPacing, DEFAULT_PACING } from '../src/lib/anti-ban';

// Фиксированное "время" для детерминизма: понедельник 12:00.
function makeClock() {
  let now = new Date('2026-09-28T12:00:00').getTime();
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('pacing разрешает отклик в рабочее время в пределах лимитов', () => {
  const clock = makeClock();
  const p = createPacing({ minDelayMs: 0, maxDelayMs: 0 }, clock.now);
  const d = p.decide();
  assert.equal(d.allowed, true);
});

test('pacing блокирует ночью', () => {
  const clock = makeClock();
  // 12:00 -> перематываем на 23:00
  clock.advance(11 * 60 * 60 * 1000);
  const p = createPacing({}, clock.now);
  const d = p.decide();
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'night');
  assert.ok(d.retryAfterMs > 0);
});

test('pacing выдерживает паузу между откликами (regression)', () => {
  // Раньше decide() возвращал delayMs, но никто его не применял, и recordSent
  // не ставил cooldown — отклики уходили подряд без всякой паузы.
  const clock = makeClock();
  const p = createPacing(
    { minDelayMs: 60_000, maxDelayMs: 60_000, jitterMinutes: 0, dailyLimit: 10, hourlyLimit: 10 },
    clock.now,
  );

  const first = p.decide();
  assert.equal(first.allowed, true);
  assert.equal(first.allowed && first.delayMs, 60_000, 'delayMs должен соответствовать конфигу');
  p.recordSent();

  const second = p.decide();
  assert.equal(second.allowed, false, 'сразу после отправки пауза обязательна');
  assert.equal(second.allowed === false && second.reason, 'backoff');

  clock.advance(60_001);
  assert.equal(p.decide().allowed, true, 'после паузы отправка снова разрешена');
});

test('pacing не копит cooldown через разные decide() без отправки', () => {
  const clock = makeClock();
  const p = createPacing({ minDelayMs: 30_000, maxDelayMs: 30_000, jitterMinutes: 0 }, clock.now);
  p.decide();
  p.decide();
  p.decide();
  p.recordSent();
  // Cooldown считается от последней отправки, а не суммируется по decide().
  assert.equal(p.decide().allowed, false);
  clock.advance(30_001);
  assert.equal(p.decide().allowed, true);
});

test('pacing.configure меняет лимиты на ходу', () => {
  const clock = makeClock();
  const p = createPacing(
    { dailyLimit: 1, hourlyLimit: 10, minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    clock.now,
  );
  p.decide();
  p.recordSent();
  assert.equal(p.decide().allowed, false, 'при dailyLimit=1 дальше нельзя');

  p.configure({ dailyLimit: 5 });
  assert.equal(p.decide().allowed, true, 'после configure лимит должен вырасти');
});

test('pacing соблюдает суточный лимит', () => {
  const clock = makeClock();
  const p = createPacing(
    { dailyLimit: 2, minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    clock.now,
  );
  assert.equal(p.decide().allowed, true);
  p.recordSent();
  assert.equal(p.decide().allowed, true);
  p.recordSent();
  const d = p.decide();
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'daily');
});

test('pacing соблюдает часовой лимит', () => {
  const clock = makeClock();
  const p = createPacing(
    { hourlyLimit: 3, dailyLimit: 100, minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    clock.now,
  );
  for (let i = 0; i < 3; i++) {
    assert.equal(p.decide().allowed, true);
    p.recordSent();
  }
  const d = p.decide();
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'hourly');
});

test('pacing включает backoff после ошибок платформы', () => {
  const clock = makeClock();
  const p = createPacing({ minDelayMs: 0, maxDelayMs: 0 }, clock.now);
  p.recordFailure('rate_limit');
  const d = p.decide();
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'backoff');
});

test('zeroPacing всегда разрешает без задержки', () => {
  const z = zeroPacing();
  assert.deepEqual(z.decide(), { allowed: true, delayMs: 0 });
});

test('дефолтный конфиг имеет рабочие лимиты', () => {
  assert.ok(DEFAULT_PACING.dailyLimit > 0);
  assert.ok(DEFAULT_PACING.hourlyLimit > 0);
  assert.ok(DEFAULT_PACING.workStartHour < DEFAULT_PACING.workEndHour);
});
