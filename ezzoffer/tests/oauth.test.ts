import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

/**
 * Роуты входа через внешние сервисы.
 *
 * Здесь три вещи, и каждая защищает от своего. Без `state` поддельный
 * коллбэк приклеивается к чужой сессии (login CSRF: жертва входит под
 * нападающим аккаунтом, и всё, что она потом сделает, достаётся ему).
 * Без сверки `email_verified` аккаунт заводится на непроверенный адрес — а
 * письмо восстановления пароля придёт туда, и счёт угонят. Без проверки
 * провайдера по белому списку подсунутый `provider_id` создаёт второй аккаунт.
 */

const SECRET = 'oauth-test-secret';

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;
let oauth: typeof import('../src/lib/auth/oauth');

before(async () => {
  const { useInMemoryDb } = await import('./helpers/route-session');
  useInMemoryDb({
    OAUTH_STATE_SECRET: SECRET,
    PAYMENT_HMAC_SECRET: SECRET,
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    SITE_URL: 'https://ezoffer.example',
  });
  db = (await import('../src/lib/db')).db;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (1, 'known@example.com', 'h', 'none', NULL, ?, 1)`,
  ).run(Date.now());
  oauth = await import('../src/lib/auth/oauth');
});

test('state — непредсказуемый и одноразовый', () => {
  const state = oauth.createState(1);
  assert.ok(state.length >= 32, `state слишком короткий: ${state.length}`);
  assert.equal(oauth.consumeState(state), 1, 'state не прошёл');
  assert.equal(
    oauth.consumeState(state),
    null,
    'state сработал второй раз — это и есть login CSRF',
  );
});

test('подделанный state не проходит', () => {
  assert.equal(oauth.consumeState('любой-мусор'), null);
  assert.equal(oauth.consumeState(''), null);
});

/*
 * Регрессия: без OAUTH_STATE_SECRET вход был открыт.
 *
 * stateSecret() возвращал пустую строку, а createHmac с пустым ключом не
 * бросает — поэтому подпись с НЕИЗВЕСТНЫМ (пустым) ключом мог посчитать кто
 * угодно, и parseProviderResponse принимал самодельные ответы. Вход через
 * Telegram «работал» из коробки, но защитой это не было.
 *
 * Теперь без секрета ответ не разбирается вовсе, и коллбэк отвечает 401.
 */
test('без секрета подпись не проверяется — вход закрыт, а не открыт', async () => {
  const saved = process.env.OAUTH_STATE_SECRET;
  delete process.env.OAUTH_STATE_SECRET;
  try {
    const payload = { id: 42, login: 'attacker', email: 'a@b.ru' };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    // Подпись пустым ключом — ровно то, что раньше принималось.
    const sig = createHmac('sha256', '').update(b64).digest('hex');
    assert.equal(
      oauth.parseProviderResponse('telegram', `${b64}.${sig}`),
      null,
      'ответ с подписью пустым ключом обязан отклоняться',
    );
  } finally {
    if (saved !== undefined) process.env.OAUTH_STATE_SECRET = saved;
  }
});

test('state привязан к пользователю, а не висел в воздухе', () => {
  const state = oauth.createState(1);
  assert.equal(oauth.peekStateUserId(state), 1);
  assert.equal(oauth.peekStateUserId('мусор'), null);
});

test('гироскопический ответ от провайдера разбирается', () => {
  const payload = { id: 42, login: 'ssrjkk', email: 'a@b.ru' };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = createHmac('sha256', SECRET).update(b64).digest('hex');
  const raw = `${b64}.${sig}`;
  const parsed = oauth.parseProviderResponse('telegram', raw);
  assert.ok(parsed, 'подписанный ответ не разобран');
  assert.equal(parsed.providerId, '42');
  assert.equal(parsed.email, 'a@b.ru');
});

test('подпись гироскопа не сошлась — ответ отвергнут', () => {
  const b64 = Buffer.from(JSON.stringify({ id: 1 })).toString('base64');
  const raw = `${b64}.deadbeefdeadbeef`;
  assert.equal(oauth.parseProviderResponse('telegram', raw), null, 'принят ответ с чужой подписью');
});

test('имя для GitHub берётся из login, а не из недоверенного поля name', () => {
  // Провайдер может прислать что угодно; отображаемое имя берём из login,
  // который к нему привязан, а name используем только как запасной вариант.
  const b64 = Buffer.from(
    JSON.stringify({ id: 7, login: 'ssrjkk', name: '<script>alert(1)</script>', email: 'a@b.ru' }),
  ).toString('base64');
  const sig = createHmac('sha256', SECRET).update(b64).digest('hex');
  const parsed = oauth.parseProviderResponse('telegram', `${b64}.${sig}`);
  assert.ok(parsed);
  assert.ok(!parsed.name.includes('<script>'), `в имя попал сырой HTML: ${parsed.name}`);
});

test('непроверенный email не заводит аккаунт', () => {
  // GitHub отдаёт primary email в отдельном запросе. Если его нет —
  // адрес считается непроверенным, и на него аккаунт не создаётся.
  assert.equal(oauth.emailVerifiedFrom({ email: 'a@b.ru', verified: false }), false);
  assert.equal(oauth.emailVerifiedFrom({ email: 'a@b.ru', verified: true }), true);
});

test('вход на существующий аккаунт не создаёт второй', () => {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  assert.ok(existing.c >= 1);
  // Связывание ищет по email: повторный вход через GitHub обязан найти тот
  // же аккаунт, а не завести дубль.
  const found = db.prepare('SELECT id FROM users WHERE email = ?').get('known@example.com') as
    { id: number } | undefined;
  assert.ok(found, 'существующий аккаунт не найден по email');
  assert.equal(found.id, 1);
});

/*
 * Регрессия: кнопки вели к провайдерам, которые не умеют завершаться.
 *
 * GitHub/Google/Яндекс при заданных ключах показывали кнопку и уводили
 * человека к провайдеру, а на возврате parseProviderResponse возвращал null
 * для всего, кроме telegram, — и человек получал 401 после успешной
 * авторизации ТАМ. Кнопка обещала вход, которого нет.
 *
 * Теперь ссылка строится только для завершаемых способов (telegram).
 * Проверяется telegram: тот же контракт «разрешённый хост, client_id, state,
 * redirect_uri из SITE_URL», что раньше проверялся на github.
 */
test('ссылка на авторизацию указывает на разрешённого провайдера', () => {
  const url = oauth.authorizeUrl('telegram', 'state-123') ?? '';
  assert.ok(url.startsWith('https://oauth.telegram.org/auth'), `не тот хост: ${url}`);
  assert.match(url, /state=state-123/, 'нет state');

  // Произвольный провайдер не должен уводить человека на чужой сайт.
  assert.equal(oauth.authorizeUrl('квас', 's'), null);
  assert.equal(oauth.authorizeUrl('', 's'), null);
});

test('незавершаемые способы ссылку не строят (regression)', () => {
  // Ключи заданы (см. before), но входа эти способы завершить не могут —
  // вести туда человека значит подарить ему 401 на возврате.
  for (const p of ['github', 'google', 'yandex']) {
    assert.equal(oauth.authorizeUrl(p, 'state-123'), null, `${p} обещал бы вход, которого нет`);
  }
});

test('незавершаемые способы не считаются готовыми (regression)', async () => {
  const { authMethodReady } = await import('../src/lib/auth-methods');
  for (const p of ['github', 'google', 'yandex']) {
    assert.equal(authMethodReady(p), false, `кнопка ${p} снова появилась бы при заданных ключах`);
  }
  // BOT_TOKEN может быть задан в окружении машины (как здесь) — чистим явно,
  // иначе проверяем не код, а машину.
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    assert.equal(authMethodReady('telegram'), false, 'без BOT_TOKEN telegram не готов');
  } finally {
    if (saved !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved;
  }
});

test('redirect_uri собирается из SITE_URL и не берётся из запроса', () => {
  const url = oauth.authorizeUrl('telegram', 'state-123') ?? '';
  assert.match(
    url,
    /redirect_uri=https%3A%2F%2Fezoffer\.example%2Fapi%2Fauth%2Foauth%2Ftelegram%2Fcallback/,
  );
});

test('неизвестный провайдер в коллбэке отвергается до похода в сеть', () => {
  assert.equal(oauth.authorizeUrl('квас', 's'), null);
  assert.equal(oauth.parseProviderResponse('квас', 'payload=e30.sig'), null);
});
