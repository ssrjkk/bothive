import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { loginAs, logout, post, useInMemoryDb } from './helpers/route-session';

/**
 * Привязка Telegram-чата.
 *
 * Регрессия: код выдавался в GET, то есть на каждый вызов. Это ломало три
 * вещи: GET с побочным эффектом (краулер/предзагрузка писали в БД), два
 * открытых таба показывали разные коды, и — главное — proxy.ts ограничивает
 * rate-limit только для не-GET, поэтому этот эндпоинт был единственным, кто
 * писал в БД без ограничения.
 *
 * Теперь GET читает состояние, а код выдаёт POST с лимитом.
 */

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  useInMemoryDb({
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  });
  db = (await import('../src/lib/db')).db;
});

beforeEach(() => {
  db.prepare('DELETE FROM telegram_codes').run();
  db.prepare("DELETE FROM meta WHERE key LIKE 'tg:link-attempts:%'").run();
  db.prepare('DELETE FROM users').run();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified) VALUES (?,?,?,?,?,?,1)',
  ).run(1, 'me@example.test', 'h', 'pro', Date.now() + 86_400_000, Date.now());
  loginAs({ id: 1 });
});

test('GET не выдаёт код и не пишет в telegram_codes', async () => {
  const { GET } = await import('../src/app/api/telegram/link/route');
  const res = await GET();

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    code: string | null;
    botConfigured: boolean;
    linked: boolean;
  };
  assert.equal(body.code, null, 'GET не должен выдавать код');
  assert.equal(body.botConfigured, true);
  assert.equal(body.linked, false);

  const count = (db.prepare('SELECT COUNT(*) c FROM telegram_codes').get() as { c: number }).c;
  assert.equal(count, 0, 'GET обязан быть без побочных эффектов');
});

test('POST выдаёт шестизначный код', async () => {
  const { POST } = await import('../src/app/api/telegram/link/route');
  const res = await POST();

  assert.equal(res.status, 201);
  const body = (await res.json()) as { code: string };
  assert.match(body.code, /^\d{6}$/);

  const row = db.prepare('SELECT * FROM telegram_codes').get() as { user_id: number };
  assert.equal(row.user_id, 1);
});

test('повторный GET не инвалидирует уже выданный код', async () => {
  const { POST, GET } = await import('../src/app/api/telegram/link/route');
  const issued = (await (await POST()).json()) as { code: string };

  // Раньше GET перевыпускал код, и номер, который пользователь уже продиктовал
  // боту, переставал работать.
  await GET();
  await GET();

  const row = db.prepare('SELECT code FROM telegram_codes').get() as { code: string };
  assert.equal(row.code, issued.code, 'код не должен меняться при чтении состояния');
});

test('POST без сессии → 401', async () => {
  logout();
  const { POST } = await import('../src/app/api/telegram/link/route');
  assert.equal((await POST()).status, 401);
});

test('POST без настроенного бота → 503 с понятным текстом', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const { POST } = await import('../src/app/api/telegram/link/route');
    const res = await POST();
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /TELEGRAM_BOT_TOKEN/);
  } finally {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  }
});

test('выдача кода ограничена по частоте', async () => {
  const { POST } = await import('../src/app/api/telegram/link/route');
  let blocked = 0;

  for (let i = 0; i < 14; i++) {
    const res = await POST();
    if (res.status === 429) blocked++;
  }

  assert.ok(blocked > 0, 'повторные запросы кода должны блокироваться');
});

test('DELETE отвязывает чат и не падает без привязки', async () => {
  const { DELETE } = await import('../src/app/api/telegram/link/route');

  // Привязки ещё нет — операция должна быть безопасной идемпотентной.
  const first = await DELETE();
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { removed: boolean }).removed, false);

  db.prepare("UPDATE users SET telegram_chat_id = '12345' WHERE id = 1").run();
  const second = await DELETE();
  assert.equal(second.status, 200);
  assert.equal(((await second.json()) as { removed: boolean }).removed, true);

  const row = db.prepare('SELECT telegram_chat_id FROM users WHERE id = 1').get() as {
    telegram_chat_id: string | null;
  };
  assert.equal(row.telegram_chat_id, null);
});

test('DELETE без сессии → 401', async () => {
  logout();
  const { DELETE } = await import('../src/app/api/telegram/link/route');
  assert.equal((await DELETE()).status, 401);
  void post;
});

/*
 * Регрессия: код из чата можно было перебирать без ограничений.
 *
 * Код — 6 цифр (миллион вариантов), живёт 15 минут. linkChatByCode вызывался
 * на каждое сообщение боту безо всякого лимита: чужой чат слал коды, пока не
 * угадает. Угаданный код привязывает чужой чат к аккаунту жертвы — дальше
 * подбор, статистика и управление паузами оказываются у атакующего.
 *
 * Теперь 10 неверных попыток в час с одного чата — и ввод блокируется, а
 * удачный ввод счётчик обнуляет.
 */
test('перебор кода из чата останавливается лимитом попыток (regression)', async () => {
  const { issueLinkCode, linkChatByCode } = await import('../src/lib/telegram');

  const code = issueLinkCode(1);
  // 10 неверных попыток — все отклонены, код при этом цел.
  for (let i = 0; i < 10; i++) {
    assert.equal(
      linkChatByCode('chat-attacker', '000000'),
      null,
      `попытка ${i} должна отклоняться`,
    );
  }
  // 11-я — уже лимит, и даже верный код больше не принимается с этого чата.
  assert.equal(
    linkChatByCode('chat-attacker', code),
    null,
    'после исчерпания попыток верный код с того же чата отклоняется',
  );

  // А с другого чата тот же код работает: лимит — на чат, а не на код.
  const linked = linkChatByCode('chat-owner', code);
  assert.ok(linked, 'с другого чата верный код обязан приниматься');
  assert.equal(linked.id, 1);
});

test('удачный ввод обнуляет счётчик попыток чата', async () => {
  const { issueLinkCode, linkChatByCode } = await import('../src/lib/telegram');

  // 9 опечаток, потом удача — счётчик сброшен.
  const first = issueLinkCode(1);
  for (let i = 0; i < 9; i++) {
    assert.equal(linkChatByCode('chat-retry', '000000'), null);
  }
  assert.ok(linkChatByCode('chat-retry', first), 'верный код после опечаток принимается');

  // Отвязались и взяли новый код: старые 9 попыток не должны висеть.
  db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE id = 1').run();
  const second = issueLinkCode(1);
  for (let i = 0; i < 9; i++) {
    assert.equal(
      linkChatByCode('chat-retry', '000000'),
      null,
      `повторная попытка ${i} отклоняется как обычно`,
    );
  }
  assert.ok(linkChatByCode('chat-retry', second), 'после сброса 9 опечаток снова терпимы');
});
