import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loginAs } from './helpers/route-session';

/**
 * Шифрование токенов hh на диске (Фаза 1, риск бэкапа).
 *
 * Токены лежали открытым текстом, и бэкап базы был равен списку чужих
 * аккаунтов hh.ru. Теперь — AES-256-GCM, ключ из окружения.
 *
 * Главная опасность в этой задаче — НЕ утечка, а обратная проблема: если
 * ключ сменился или потерялся, токены перестают читаться, и автоотклики
 * молча перестают работать. Человек узнаёт об этом через неделю, когда
 * отклики не приходят. Поэтому проверяется именно это: чужой ключ обязан
 * давать явную ошибку, а не пустую строку.
 */

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  const { useInMemoryDb: setup } = await import('./helpers/route-session');
  setup({
    EZOFFER_TOKEN_KEY: KEY,
    SITE_URL: 'http://localhost:3000',
    HH_CLIENT_ID: 'id',
    HH_CLIENT_SECRET: 'secret',
  });
  db = (await import('../src/lib/db')).db;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (1, 'tok@test', 'h', 'none', NULL, ?, 1)`,
  ).run(Date.now());
  loginAs();
});

test('токен шифруется и на диске его нет в открытом виде', async () => {
  const { encryptSecret, decryptSecret } = await import('../src/lib/secrets');

  const sealed = encryptSecret('secret-token-abc123') ?? '';
  assert.notEqual(sealed, 'secret-token-abc123', 'токен остался открытым');
  assert.ok(!sealed.includes('secret-token-abc123'), 'токен виден в зашифрованном виде');
  assert.equal(decryptSecret(sealed), 'secret-token-abc123', 'шифрование не обратимо');
});

test('два шифрования одного значения дают разный текст', async () => {
  const { encryptSecret } = await import('../src/lib/secrets');
  // Разный IV на каждое значение. Одинаковые шифротексты выдали бы факт
  // совпадения токенов между пользователями.
  const a = encryptSecret('одинаковое');
  const b = encryptSecret('одинаковое');
  assert.notEqual(a, b, 'IV не меняется: одинаковые токены дают одинаковый шифротекст');
});

test('чужой ключ даёт явную ошибку, а не пустое значение', async () => {
  const { encryptSecret, decryptSecret } = await import('../src/lib/secrets');
  const sealed = encryptSecret('токен') ?? '';

  const saved = process.env.EZOFFER_TOKEN_KEY;
  process.env.EZOFFER_TOKEN_KEY =
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  try {
    let thrown: unknown = null;
    try {
      decryptSecret(sealed);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'чужой ключ дал тихую потерю токена вместо ошибки');
    assert.match(String(thrown), /ключ|EZOFFER_TOKEN_KEY/i, 'ошибка не объясняет причину');
  } finally {
    process.env.EZOFFER_TOKEN_KEY = saved;
  }
});

/**
 * Регрессия: `getValidHhToken` писал обновлённый access-токен открытым текстом.
 *
 * `saveHhConnection` шифровал, а обновление по refresh_token — нет. Итог:
 * шифрование работало ровно до первого часа жизни сессии, после чего бэкап базы
 * снова становился списком аккаунтов с готовыми к применению токенами. Проверять
 * это на `encryptSecret`/`decryptSecret` бесполезно — они работали верно;
 * виноват был вызывающий код, поэтому проверяется он.
 */
test('обновление токена пишет в базу шифротекст, а не открытый текст (regression)', async () => {
  const { getValidHhToken } = await import('../src/lib/hh-oauth');
  const { decryptSecret } = await import('../src/lib/secrets');

  /*
   * Пользователь с просроченным токеном и refresh_token.
   *
   * Значения берутся из encryptSecret, а не пишутся строкой вида "v1:old":
   * `decryptSecret` на таком значении честно бросает «повреждённое значение»
   * (неверное число частей), и тест падал бы не на том, что проверяет.
   */
  const { encryptSecret } = await import('../src/lib/secrets');
  db.prepare(
    'UPDATE users SET hh_token = ?, hh_token_expires_at = ?, hh_refresh_token = ? WHERE id = 1',
  ).run(encryptSecret('OLD-ACCESS'), 1, encryptSecret('OLD-REFRESH'));

  /*
   * Подмена fetch вместо реального обмена: важна запись в базу, а не ответ hh.
   * Ответ обязан быть валидным, чтобы дойти до UPDATE.
   */
  const realFetch = globalThis.fetch;
  /*
   * Обмен возможен только при полностью настроенном OAuth. `hhConfigured()`
   * требует все три переменные, а не две: без HH_REDIRECT_URI функция честно
   * возвращает «настроить нечем» и `getValidHhToken` отдаёт старый токен —
   * то есть тест проверял бы не запись в базу, а отказ обновляться.
   */
  const savedRedirect = process.env.HH_REDIRECT_URI;
  process.env.HH_REDIRECT_URI = 'http://localhost:3000/api/hh/callback';
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        access_token: 'NEW-ACCESS-TOKEN',
        refresh_token: 'NEW-REFRESH',
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = 1').get() as never;
    const got = await getValidHhToken(user as never);
    assert.equal(got?.token, 'NEW-ACCESS-TOKEN', 'обновление не отдало новый токен');

    const row = db.prepare('SELECT hh_token, hh_refresh_token FROM users WHERE id = 1').get() as {
      hh_token: string;
      hh_refresh_token: string;
    };

    assert.ok(
      !row.hh_token.includes('NEW-ACCESS-TOKEN'),
      'access-токен записан в базу открытым текстом — бэкап снова список аккаунтов',
    );
    assert.ok(
      !row.hh_refresh_token.includes('NEW-REFRESH'),
      'refresh-токен записан в базу открытым текстом',
    );
    assert.ok(
      row.hh_token.startsWith('v1:') && row.hh_refresh_token.startsWith('v1:'),
      `колонки ожидают шифротекст, получено: ${row.hh_token.slice(0, 8)}… / ${row.hh_refresh_token.slice(0, 8)}…`,
    );
    // И при этом значение остаётся читаемым: шифрование не должно ломать работу.
    assert.equal(
      decryptSecret(row.hh_token),
      'NEW-ACCESS-TOKEN',
      'зашифрованный токен не читается',
    );
    assert.equal(decryptSecret(row.hh_refresh_token), 'NEW-REFRESH', 'refresh не читается');
  } finally {
    globalThis.fetch = realFetch;
    if (savedRedirect === undefined) delete process.env.HH_REDIRECT_URI;
    else process.env.HH_REDIRECT_URI = savedRedirect;
    db.prepare(
      'UPDATE users SET hh_token = NULL, hh_token_expires_at = NULL, hh_refresh_token = NULL WHERE id = 1',
    ).run();
  }
});

test('подделка шифротекста обнаруживается', async () => {
  const { encryptSecret, decryptSecret } = await import('../src/lib/secrets');
  const sealed = encryptSecret('токен') ?? '';
  const tampered = `${sealed.slice(0, -4)}AAAA`;
  assert.throws(() => decryptSecret(tampered), 'подделанный шифротекст принят как настоящий');
});

test('без ключа шифрование выключено и это заметно', async () => {
  const { encryptSecret, encryptionEnabled, decryptSecret } = await import('../src/lib/secrets');
  const saved = process.env.EZOFFER_TOKEN_KEY;
  delete process.env.EZOFFER_TOKEN_KEY;
  try {
    assert.equal(encryptionEnabled(), false, 'без ключа шифрование заявило себя включённым');
    const plain = encryptSecret('открытый');
    assert.equal(plain, 'открытый', 'без ключа значение должно проходить как есть');
    assert.equal(decryptSecret('открытый'), 'открытый', 'чтение открытого значения сломано');
  } finally {
    process.env.EZOFFER_TOKEN_KEY = saved;
  }
});

test('пустое и null остаются пустым, а не шифруются в мусор', async () => {
  const { encryptSecret, decryptSecret } = await import('../src/lib/secrets');
  assert.equal(encryptSecret(null), null);
  assert.equal(encryptSecret(''), '');
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(''), '');
});

test('миграция перешифровывает открытые токены и идемпотентна', async () => {
  const { migrateSecretColumns } = await import('../src/lib/db-migrations');

  // Кладём открытое значение, как было до миграции.
  db.prepare('UPDATE users SET hh_token = ?, hh_refresh_token = ? WHERE id = 1').run(
    'plain-access',
    'plain-refresh',
  );

  migrateSecretColumns(db as never);

  const after = db.prepare('SELECT hh_token, hh_refresh_token FROM users WHERE id = 1').get() as {
    hh_token: string;
    hh_refresh_token: string;
  };

  assert.ok(after.hh_token && !after.hh_token.includes('plain-access'), 'токен остался открытым');
  assert.ok(
    after.hh_refresh_token && !after.hh_refresh_token.includes('plain-refresh'),
    'refresh-токен остался открытым',
  );

  // Второй прогон обязан быть безопасен: повторно шифровать уже
  // зашифрованное — значит испортить его.
  const snapshot = { ...after };
  migrateSecretColumns(db as never);
  const twice = db.prepare('SELECT hh_token, hh_refresh_token FROM users WHERE id = 1').get() as {
    hh_token: string;
    hh_refresh_token: string;
  };
  assert.deepEqual(twice, snapshot, 'повторная миграция испортила токены');

  const { decryptSecret } = await import('../src/lib/secrets');
  assert.equal(decryptSecret(after.hh_token), 'plain-access', 'миграция испортила значение');
});
