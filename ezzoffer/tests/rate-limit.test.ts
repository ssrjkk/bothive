import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, rateLimitKey } from '../src/lib/rate-limit';

function makeClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('rateLimit разрешает запросы в пределах лимита', () => {
  const clock = makeClock();
  const state = { buckets: new Map(), now: clock.now };

  for (let i = 0; i < 3; i++) {
    assert.equal(
      rateLimit('k', { windowMs: 1000, max: 3 }, state).allowed,
      true,
      `попытка ${i + 1}`,
    );
  }
  const blocked = rateLimit('k', { windowMs: 1000, max: 3 }, state);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
});

test('rateLimit освобождает ключ после окна', () => {
  const clock = makeClock();
  const state = { buckets: new Map(), now: clock.now };

  for (let i = 0; i < 2; i++) {
    rateLimit('k', { windowMs: 1000, max: 2 }, state);
  }
  assert.equal(rateLimit('k', { windowMs: 1000, max: 2 }, state).allowed, false);
  clock.advance(1001);
  assert.equal(rateLimit('k', { windowMs: 1000, max: 2 }, state).allowed, true);
});

test('разные ключи не блокируют друг друга', () => {
  const clock = makeClock();
  const state = { buckets: new Map(), now: clock.now };

  for (let i = 0; i < 2; i++) {
    rateLimit('a', { windowMs: 1000, max: 1 }, state);
  }
  assert.equal(rateLimit('b', { windowMs: 1000, max: 1 }, state).allowed, true);
});

test('модульный дефолт держит состояние между вызовами (regression: default state)', () => {
  // Раньше дефолтный state создавался в параметре на каждый вызов — лимитер не работал.
  assert.equal(rateLimit('shared', { windowMs: 60000, max: 2 }).allowed, true);
  assert.equal(rateLimit('shared', { windowMs: 60000, max: 2 }).allowed, true);
  const blocked = rateLimit('shared', { windowMs: 60000, max: 2 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

/**
 * Регрессия: proxy.ts использовал `clientIp(request) ?? "unknown"`, а clientIp()
 * возвращает null, если TRUST_PROXY не выставлен (дефолт в .env.example).
 * Все пользователи делили один бакет `api:unknown` с потолком 60 запросов в
 * минуту — на живом трафике сайт отдавал 429 всем подряд.
 */
test('без TRUST_PROXY разные сессии получают разные ключи (regression)', () => {
  delete process.env.TRUST_PROXY;

  const a = rateLimitKey(
    new Request('https://d.ru/api/x', { headers: { cookie: 'ez_session=aaa' } }),
    'api',
  );
  const b = rateLimitKey(
    new Request('https://d.ru/api/x', { headers: { cookie: 'ez_session=bbb' } }),
    'api',
  );
  assert.notEqual(a, b, 'разные сессии не должны делить бакет');
  assert.ok(a.startsWith('api:sess:'));
});

test('одинаковая сессия даёт стабильный ключ между запросами', () => {
  delete process.env.TRUST_PROXY;
  const r1 = new Request('https://d.ru/api/x', { headers: { cookie: 'ez_session=token123' } });
  const r2 = new Request('https://d.ru/api/y', {
    headers: { cookie: 'other=1; ez_session=token123' },
  });
  assert.equal(rateLimitKey(r1, 'api'), rateLimitKey(r2, 'api'));
});

test('ключ не содержит сам токен сессии', () => {
  delete process.env.TRUST_PROXY;
  const key = rateLimitKey(
    new Request('https://d.ru/api/x', { headers: { cookie: 'ez_session=supersecrettoken' } }),
    'api',
  );
  assert.ok(!key.includes('supersecret'), `токен утёк в ключ: ${key}`);
});

test('аноним без IP и сессии попадает в отдельный бакет anon', () => {
  delete process.env.TRUST_PROXY;
  const key = rateLimitKey(new Request('https://d.ru/api/x'), 'api');
  assert.equal(key, 'api:anon');
});

test('с TRUST_PROXY ключ строится по IP', () => {
  process.env.TRUST_PROXY = '1';
  try {
    const key = rateLimitKey(
      new Request('https://d.ru/api/x', {
        headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      }),
      'api',
    );
    assert.equal(key, 'api:ip:203.0.113.7');
  } finally {
    delete process.env.TRUST_PROXY;
  }
});
