import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Подтверждение почты и сброс лимита входа.
 *
 * Две связанные поломки входа:
 *
 * 1. Регистрация ставила `email_verified = 1` сразу, без проверки владения
 *    ящиком. Это открывало account pre-takeover: чужой адрес регистрировали
 *    со своим паролем, и аккаунт был полноценным с рождения. Теперь аккаунт
 *    рождается неподтверждённым, письмо уходит при настроенном SMTP, а вход
 *    до подтверждения закрыт (проверка в login была всегда, но была мёртвой —
 *    дойти до неё не мог никто).
 *
 * 2. Бакет `login-account:${email}` только рос: верный пароль его не сбрасывал.
 *    Владелец с перевходами набирал 10 входов за 15 минут и получал 429 на
 *    собственном аккаунте. Теперь успешный вход счётчик обнуляет.
 */

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  const { useInMemoryDb } = await import('./helpers/route-session');
  /*
   * SMTP «настроен», чтобы регистрация шла по пути с подтверждением.
   * Адрес — localhost с закрытым портом: соединение отваливается мгновенно
   * (ECONNREFUSED), а не висит. Проверяется не доставка письма, а контракт:
   * токен выпущен, сессии нет, вход закрыт до подтверждения.
   */
  useInMemoryDb({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '9',
    SITE_URL: 'https://ezoffer.example',
  });
  db = (await import('../src/lib/db')).db;
});

function clean(): void {
  for (const t of ['sessions', 'users']) {
    try {
      db.prepare(`DELETE FROM ${t}`).run();
    } catch {
      // Нечего чистить.
    }
  }
}

function userRow(email: string): {
  id: number;
  email_verified: number;
  email_verification_token: string | null;
} {
  return db
    .prepare('SELECT id, email_verified, email_verification_token FROM users WHERE email = ?')
    .get(email) as {
    id: number;
    email_verified: number;
    email_verification_token: string | null;
  };
}

test('регистрация создаёт неподтверждённый аккаунт с токеном', async () => {
  clean();
  const { post } = await import('./helpers/route-session');
  const { POST } = await import('../src/app/api/auth/register/route');

  const res = await POST(
    post({ name: 'Новый', email: 'fresh@example.test', password: 'secret-1' }),
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { user: null; needsVerification: boolean };
  assert.equal(body.needsVerification, true, 'клиент должен показать экран «проверьте почту»');
  assert.equal(body.user, null, 'сессии до подтверждения быть не должно');

  const row = userRow('fresh@example.test');
  assert.equal(row.email_verified, 0, 'флаг ставится только письмом, а не регистрацией');
  assert.match(row.email_verification_token ?? '', /^[0-9a-f]{64}$/, 'токен обязан быть');
});

test('вход до подтверждения закрыт', async () => {
  const { post } = await import('./helpers/route-session');
  const { POST } = await import('../src/app/api/auth/login/route');

  const res = await POST(post({ email: 'fresh@example.test', password: 'secret-1' }));
  assert.equal(res.status, 403, 'неподтверждённый вход — 403, а не 401');
});

test('ссылка из письма подтверждает и пускает', async () => {
  const { post } = await import('./helpers/route-session');
  const token = userRow('fresh@example.test').email_verification_token!;

  const { GET } = await import('../src/app/api/auth/verify/route');
  const confirm = await GET(new Request(`http://localhost/api/auth/verify?token=${token}`));
  assert.equal(confirm.status, 303, 'подтверждение уводит на вход');
  assert.match(
    confirm.headers.get('location') ?? '',
    /verified=1/,
    'флаг успеха едет в query входа',
  );
  assert.equal(userRow('fresh@example.test').email_verified, 1);

  // Токен одноразовый: повторный проход уже не подтверждает.
  const replay = await GET(new Request(`http://localhost/api/auth/verify?token=${token}`));
  assert.match(replay.headers.get('location') ?? '', /verified=0/);

  const { POST } = await import('../src/app/api/auth/login/route');
  const login = await POST(post({ email: 'fresh@example.test', password: 'secret-1' }));
  assert.equal(login.status, 200, `вход после подтверждения: ${await login.text()}`);
});

test('повторная регистрация неподтверждённого адреса неотличима от новой', async () => {
  clean();
  const { post } = await import('./helpers/route-session');
  const { POST } = await import('../src/app/api/auth/register/route');

  await POST(post({ name: 'Первый', email: 'retry@example.test', password: 'secret-2' }));
  const again = await POST(
    post({ name: 'Второй', email: 'retry@example.test', password: 'secret-3' }),
  );
  assert.equal(again.status, 201);
  const body = (await again.json()) as { needsVerification: boolean };
  assert.equal(body.needsVerification, true, 'ответ как на новую регистрацию — адрес не раскрыт');
});

test('повторная регистрация подтверждённого адреса — 409', async () => {
  const { post } = await import('./helpers/route-session');
  const { POST } = await import('../src/app/api/auth/register/route');

  // Подтверждаем напрямую, чтобы не зависеть от порядка тестов.
  const row = userRow('retry@example.test');
  const { GET } = await import('../src/app/api/auth/verify/route');
  await GET(new Request(`http://localhost/api/auth/verify?token=${row.email_verification_token}`));

  const taken = await POST(
    post({ name: 'Третий', email: 'retry@example.test', password: 'secret-4' }),
  );
  assert.equal(taken.status, 409);
});

test('успешный вход обнуляет счётчик попыток (regression)', async () => {
  /*
   * Тонкость этого файла: route-session подменяет verifyPassword моком,
   * который всегда возвращает true. Поэтому «неверный пароль» здесь
   * смоделировать нельзя — любая попытка со существующим email успешна.
   * Но для проверки сброса это даже удобнее: 12 успешных входов подряд.
   *
   * На старом коде 11-й вход отклонялся с 429: бакет `login-account:${email}`
   * (max 10) только рос, и верный пароль его не сбрасывал. Владелец с
   * перевходами получал блокировку на собственном аккаунте.
   */
  clean();
  const { post } = await import('./helpers/route-session');
  const { POST } = await import('../src/app/api/auth/login/route');

  // Подтверждённый пользователь напрямую в базу: путь регистрации уже проверен.
  const { hashPassword } = await import('../src/lib/password');
  const now = Date.now();
  db.prepare(
    'INSERT INTO users (email, name, password_hash, email_verified, created_at) VALUES (?,?,?,?,?)',
  ).run('lock@example.test', 'В', await hashPassword('right-pass'), 1, now);

  for (let i = 0; i < 12; i++) {
    const r = await POST(post({ email: 'lock@example.test', password: 'right-pass' }));
    assert.equal(r.status, 200, `вход ${i + 1}: успешный вход обязан сбрасывать лимит`);
  }
});

test('сброс бакета работает на уровне лимитера', async () => {
  // Модульный rateLimit на общем состоянии: ключ уникальный, соседним тестам
  // не мешает. Изолированный createRateLimiter здесь не годится: resetRateLimit
  // по умолчанию чистит то же общее состояние, что и модульный rateLimit.
  const { rateLimit, resetRateLimit } = await import('../src/lib/rate-limit');
  const key = `probe-bucket-${process.pid}`;
  const opts = { windowMs: 60_000, max: 10 };
  for (let i = 0; i < 10; i++) {
    assert.equal(rateLimit(key, opts).allowed, true);
  }
  assert.equal(rateLimit(key, opts).allowed, false, 'бакет полон');
  resetRateLimit(key);
  assert.equal(rateLimit(key, opts).allowed, true, 'после сброса вход снова разрешён');
});
