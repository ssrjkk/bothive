import test from 'node:test';
import assert from 'node:assert/strict';

import { isHttpsRequest } from '../src/lib/auth';
import { proxy } from '../src/proxy';

/**
 * proxy.ts ротировал сессионную cookie и выставлял secure через точное сравнение
 * `x-forwarded-proto === "https"`. В цепочке прокси (nginx + CDN) заголовок
 * приходит списком ("https, http"), и флаг Secure снимался — cookie уходила
 * по HTTP. isHttpsRequest берёт первый элемент списка, как в login/register.
 *
 * Заголовку верят только за доверенным прокси (TRUST_PROXY=1): без него его
 * может прислать сам клиент. Поэтому тесты ниже выставляют переменную явно.
 */
function req(headers: Record<string, string>, url = 'http://localhost:3000/dashboard'): Request {
  return new Request(url, { headers });
}

function withProxy(fn: () => void): void {
  const saved = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
  }
}

test('прямое сравнение ломало бы на списке прокси (regression)', () => {
  withProxy(() => {
    const list = req({ 'x-forwarded-proto': 'https, http' });
    assert.equal(
      list.headers.get('x-forwarded-proto') === 'https',
      false,
      'старая проверка сняла бы Secure',
    );
    assert.equal(isHttpsRequest(list), true, 'новая корректно распознаёт https');
  });
});

test('https в заголовке распознаётся', () => {
  withProxy(() => {
    assert.equal(isHttpsRequest(req({ 'x-forwarded-proto': 'https' })), true);
  });
});

test('http в заголовке не считается https', () => {
  withProxy(() => {
    assert.equal(isHttpsRequest(req({ 'x-forwarded-proto': 'http' })), false);
  });
});

test('https берётся из URL, когда заголовка нет', () => {
  assert.equal(isHttpsRequest(req({}, 'https://ezoffer.ru/dashboard')), true);
  assert.equal(isHttpsRequest(req({}, 'http://localhost:3000/dashboard')), false);
});

test('http-URL с https-заголовком считается https', () => {
  withProxy(() => {
    // Типичный случай: приложение за TLS-терминацией, но внутри Next видит http.
    assert.equal(
      isHttpsRequest(req({ 'x-forwarded-proto': 'https' }, 'http://internal:3000/')),
      true,
    );
  });
});

test('http-URL с http-заголовком остаётся http', () => {
  withProxy(() => {
    assert.equal(
      isHttpsRequest(req({ 'x-forwarded-proto': 'http' }, 'http://internal:3000/')),
      false,
    );
  });
});

test('отсутствие заголовков не считается https', () => {
  assert.equal(isHttpsRequest(req({})), false);
});

/*
 * Регрессия: заголовку верили безусловно.
 *
 * `x-forwarded-proto` ставит кто угодно — при прямом соединении без прокси
 * клиент сам себе «включал» secure-флаг на сессионной cookie, и браузер
 * переставал отдавать её по HTTP. Человек «вошёл», а следующий запрос уже
 * без сессии: вход выглядел сломанным без единой ошибки.
 *
 * Дефолт в .env.example — TRUST_PROXY=0, то есть заголовку верить нельзя.
 */
test('без TRUST_PROXY заголовок x-forwarded-proto игнорируется (regression)', () => {
  const saved = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  try {
    assert.equal(
      isHttpsRequest(req({ 'x-forwarded-proto': 'https' }, 'http://internal:3000/')),
      false,
      'чужому заголовку без доверенного прокси верить нельзя',
    );
  } finally {
    if (saved !== undefined) process.env.TRUST_PROXY = saved;
  }
});

/**
 * Регрессия: вебхук оплаты не проходил прокси.
 *
 * `proxy` требует заголовок `Origin` у любого не-GET запроса к `/api`, кроме
 * путей из SERVER_TO_SERVER. В списке были `/api/telegram/webhook` и
 * `/api/autoapply/run`, а `/api/payments/webhook` — нет. Провайдеры оплаты
 * `Origin` не присылают, поэтому КАЖДЫЙ вебхук отвергался с 403
 * «отсутствует Origin» — до того, как роут успел проверить HMAC-подпись.
 *
 * Проверяется сам прокси, а не роут: `tests/payments.test.ts` вызывает
 * обработчик напрямую и прокси не трогает, поэтому в CI эта поломка была
 * невидима — а на сервере оплата просто не работала.
 */
/**
 * Минимальный NextRequest для прямого вызова `proxy`.
 *
 * `method` обязателен: без него прокси падал бы на `request.method.toUpperCase()`
 * раньше, чем проверит что-либо, и тест измерял бы не то.
 * Заголовки в ASCII: домены в Origin — punycode, кириллица в Header недопустима.
 */
function nextReq(
  pathname: string,
  headers: Record<string, string>,
  method = 'POST',
): Parameters<typeof proxy>[0] {
  return {
    method,
    nextUrl: { pathname },
    cookies: { get: () => undefined },
    headers: new Headers({ host: 'localhost:3000', ...headers }),
  } as unknown as Parameters<typeof proxy>[0];
}

/**
 * Остановил ли прокси запрос.
 *
 * `NextResponse.next()` — это пропуск, и у него тоже есть status 200, поэтому
 * сравнивать «статус не равен статусу» нельзя. Отказ всегда выглядит как 403
 * (проверка Origin) либо 429 (лимитер), и ничего другого прокси не отдаёт.
 */
function blocked(res: unknown): number | null {
  const status = (res as { status?: number }).status;
  return status === 403 || status === 429 ? status : null;
}

test('вебхук оплаты не отвергается проверкой Origin (regression)', () => {
  const status = blocked(proxy(nextReq('/api/payments/webhook/card', {})));
  assert.equal(
    status,
    null,
    `вебхук оплаты отвергнут прокси (status=${status}) — оплата не работает`,
  );
});

test('обычный POST без Origin по-прежнему отвергается', () => {
  assert.equal(
    blocked(proxy(nextReq('/api/applications', {}))),
    403,
    'CSRF-защита ослаблена для браузерных путей',
  );
});

test('чужой Origin отвергается', () => {
  assert.equal(
    blocked(proxy(nextReq('/api/applications', { origin: 'https://evil.example' }))),
    403,
    'чужой Origin принят',
  );
});

test('свой Origin проходит', () => {
  assert.equal(
    blocked(proxy(nextReq('/api/applications', { origin: 'http://localhost:3000' }))),
    null,
    'свой Origin отвергнут',
  );
});
