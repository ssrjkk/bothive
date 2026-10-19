import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFetch, parseJson } from '../src/lib/http-client';

/**
 * Регрессия: каждый провайдер вакансий делал голый fetch с таймаутом. При
 * первом же сетевом сбое источник выпадал из каталога до следующего полного
 * обновления — то есть на 6 часов. При этом refreshProviders дёргает все
 * источники параллельно, и одна транзиентная ошибка портила результат.
 *
 * Здесь фиксируется контракт повторов: они есть на сетевых ошибках и 5xx/429,
 * но НЕ на клиентских 4xx, и клиент никогда не бросает исключений.
 */

function stubFetch(responses: Array<{ status: number; body?: string; throws?: boolean }>) {
  const original = globalThis.fetch;
  let call = 0;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    urls.push(String(input));
    const spec = responses[Math.min(call, responses.length - 1)];
    call++;
    if (spec.throws) throw new TypeError('fetch failed');
    return new Response(spec.body ?? '', { status: spec.status });
  }) as typeof fetch;
  return {
    urls,
    calls: () => call,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const fast = { retryBaseMs: 1, retryMaxMs: 2, timeoutMs: 1000 };

test('успешный ответ не вызывает повторов', async () => {
  const stub = stubFetch([{ status: 200, body: '{"ok":true}' }]);
  try {
    const res = await httpFetch('https://example.com/a', fast);
    assert.equal(res.ok, true);
    assert.equal(res.attempts, 1);
    assert.equal(stub.calls(), 1);
  } finally {
    stub.restore();
  }
});

test('сетевая ошибка повторяется и затем восстанавливается', async () => {
  const stub = stubFetch([
    { status: 0, throws: true },
    { status: 200, body: 'ok' },
  ]);
  try {
    const res = await httpFetch('https://example.com/a', fast);
    assert.equal(res.ok, true, 'должен восстановиться после сетевого сбоя');
    assert.equal(res.attempts, 2);
  } finally {
    stub.restore();
  }
});

test('5xx повторяется', async () => {
  const stub = stubFetch([{ status: 503 }, { status: 200, body: 'ok' }]);
  try {
    const res = await httpFetch('https://example.com/a', fast);
    assert.equal(res.ok, true);
    assert.equal(res.attempts, 2);
  } finally {
    stub.restore();
  }
});

test('429 повторяется', async () => {
  const stub = stubFetch([{ status: 429 }, { status: 200, body: 'ok' }]);
  try {
    const res = await httpFetch('https://example.com/a', fast);
    assert.equal(res.ok, true);
    assert.equal(res.attempts, 2);
  } finally {
    stub.restore();
  }
});

test('4xx НЕ повторяется (клиентская ошибка не лечится повтором)', async () => {
  const stub = stubFetch([{ status: 404, body: 'not found' }]);
  try {
    const res = await httpFetch('https://example.com/a', fast);
    assert.equal(res.ok, false);
    assert.equal(res.attempts, 1, '404 обязан отдаваться сразу, без повторов');
    assert.equal(stub.calls(), 1);
    assert.equal(res.status, 404);
  } finally {
    stub.restore();
  }
});

test('после исчерпания попыток возвращается ошибка, а не исключение', async () => {
  const stub = stubFetch([{ status: 500 }]);
  try {
    const res = await httpFetch('https://example.com/a', { ...fast, attempts: 3 });
    assert.equal(res.ok, false);
    assert.equal(res.attempts, 3);
    assert.equal(stub.calls(), 3);
    assert.match(res.error ?? '', /500/);
  } finally {
    stub.restore();
  }
});

test('персистентная сетевая ошибка не пробрасывается наружу', async () => {
  const stub = stubFetch([{ status: 0, throws: true }]);
  try {
    const res = await httpFetch('https://example.com/a', fast);
    assert.equal(res.ok, false, 'исключение не должно вылетать из httpFetch');
    assert.ok(res.error, 'причина ошибки должна быть возвращена');
  } finally {
    stub.restore();
  }
});

test('attempts=1 отключает повторы полностью', async () => {
  const stub = stubFetch([{ status: 500 }, { status: 200, body: 'ok' }]);
  try {
    const res = await httpFetch('https://example.com/a', { ...fast, attempts: 1 });
    assert.equal(res.ok, false);
    assert.equal(stub.calls(), 1);
  } finally {
    stub.restore();
  }
});

test('тело успешного ответа сохраняется как текст', async () => {
  const stub = stubFetch([{ status: 200, body: '<rss><item/></rss>' }]);
  try {
    const res = await httpFetch('https://example.com/feed', fast);
    assert.equal(res.body, '<rss><item/></rss>');
  } finally {
    stub.restore();
  }
});

test('тело ошибочного ответа доступно для диагностики', async () => {
  const stub = stubFetch([{ status: 400, body: 'bad request details' }]);
  try {
    const res = await httpFetch('https://example.com/a', fast);
    assert.equal(res.body, 'bad request details', 'детали ответа нужны в сообщении об ошибке');
  } finally {
    stub.restore();
  }
});

test('parseJson не бросает на мусорном ответе', () => {
  assert.deepEqual(parseJson<{ a: number }>('{"a":1}'), { a: 1 });
  assert.equal(parseJson('не json'), null);
  assert.equal(parseJson(''), null);
});

test('свой shouldRetry переопределяет умолчание', async () => {
  const stub = stubFetch([{ status: 404 }, { status: 200, body: 'ok' }]);
  try {
    const res = await httpFetch('https://example.com/a', { ...fast, shouldRetry: () => true });
    assert.equal(res.ok, true, 'свой предикат разрешает повтор даже на 404');
    assert.equal(res.attempts, 2);
  } finally {
    stub.restore();
  }
});
