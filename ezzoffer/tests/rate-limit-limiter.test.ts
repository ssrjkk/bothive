import test from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from '../src/lib/rate-limit';

test('createRateLimiter изолирует состояние от модульного дефолта', () => {
  const a = createRateLimiter();
  const b = createRateLimiter();

  for (let i = 0; i < 3; i++) {
    assert.equal(a.check('shared', { windowMs: 60_000, max: 3 }).allowed, true, `шаг ${i}`);
  }
  assert.equal(a.check('shared', { windowMs: 60_000, max: 3 }).allowed, false);

  assert.equal(
    b.check('shared', { windowMs: 60_000, max: 3 }).allowed,
    true,
    'второй лимитер не должен делить состояние с первым',
  );
});

test('отказ по лимиту не расходует окно повторно', () => {
  const limiter = createRateLimiter();
  assert.equal(limiter.check('k', { windowMs: 60_000, max: 1 }).allowed, true);

  const denied = limiter.check('k', { windowMs: 60_000, max: 1 });
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSeconds > 0, 'отказ должен сообщать Retry-After');
  assert.equal(limiter.check('k', { windowMs: 60_000, max: 1 }).allowed, false);
});

test('cleanup вытесняет самые старые бакеты при переполнении карты', () => {
  const limiter = createRateLimiter();
  // MAX_BUCKETS = 10_000, EVICT_BATCH = 500 — после переполнения самые старые
  // ключи вытесняются, и лимит для них снова свободен.
  for (let i = 0; i < 10_500; i++) {
    limiter.check(`key-${i}`, { windowMs: 60_000, max: 1 });
  }
  assert.equal(
    limiter.check('key-0', { windowMs: 60_000, max: 1 }).allowed,
    true,
    'вытесненный ключ должен освободиться',
  );
});
