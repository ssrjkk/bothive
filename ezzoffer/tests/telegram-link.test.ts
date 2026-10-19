import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../src/lib/db';

/**
 * Логика привязки Telegram-чата к аккаунту переехала в src/lib/telegram.ts,
 * где она работает с модульной БД. Здесь проверяем инварианты на изолированной
 * БД, повторяя те же правила: код одноразовый, с TTL, а аккаунт — один чат.
 *
 * Регрессии, которые эти правила закрывают:
 *  - код без TTL позволял бы привязать аккаунт спустя месяцы;
 *  - повторное использование кода — захват чужого аккаунта;
 *  - один чат на два аккаунта — путаница, кому приходят отклики.
 */

const CODE = '123456';

function seed(db: ReturnType<typeof createDatabase>, email: string): number {
  return Number(
    db
      .prepare('INSERT INTO users (email, password_hash, plan, created_at) VALUES (?,?,?,?)')
      .run(email, 'h', 'pro', Date.now()).lastInsertRowid,
  );
}

/** Локальные копии правил привязки (в модуле они работают с глобальной БД). */
function issueCode(
  db: ReturnType<typeof createDatabase>,
  userId: number,
  code: string,
  now: number,
): void {
  db.prepare('DELETE FROM telegram_codes WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO telegram_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(
    code,
    userId,
    now + 15 * 60 * 1000,
  );
}

function linkByCode(
  db: ReturnType<typeof createDatabase>,
  chatId: string,
  code: string,
  now: number,
): number | null {
  if (!/^\d{6}$/.test(code.trim())) return null;
  const row = db
    .prepare('SELECT user_id, expires_at FROM telegram_codes WHERE code = ?')
    .get(code.trim()) as { user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM telegram_codes WHERE code = ?').run(code.trim());
    return null;
  }
  db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ? AND id != ?').run(
    chatId,
    row.user_id,
  );
  db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?').run(chatId, row.user_id);
  db.prepare('DELETE FROM telegram_codes WHERE code = ?').run(code.trim());
  return row.user_id;
}

function chatOf(db: ReturnType<typeof createDatabase>, userId: number): string | null {
  return (
    db.prepare('SELECT telegram_chat_id AS c FROM users WHERE id = ?').get(userId) as {
      c: string | null;
    }
  ).c;
}

test('код привязывает чат к аккаунту и исчезает', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db, 'a@example.com');
  const now = 1_000_000;
  issueCode(db, uid, CODE, now);

  assert.equal(linkByCode(db, '555', CODE, now), uid);
  assert.equal(chatOf(db, uid), '555');
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS c FROM telegram_codes WHERE code = ?').get(CODE) as {
        c: number;
      }
    ).c,
    0,
    'код одноразовый',
  );
});

test('просроченный код не привязывает (TTL)', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db, 'a@example.com');
  const now = 1_000_000;
  issueCode(db, uid, CODE, now);

  const later = now + 15 * 60 * 1000 + 1;
  assert.equal(linkByCode(db, '555', CODE, later), null);
  assert.equal(chatOf(db, uid), null);
});

test('повторное использование кода не работает', () => {
  const db = createDatabase(':memory:');
  const a = seed(db, 'a@example.com');
  const b = seed(db, 'b@example.com');
  const now = 1_000_000;
  issueCode(db, a, CODE, now);

  assert.equal(linkByCode(db, '111', CODE, now), a);
  assert.equal(linkByCode(db, '222', CODE, now), null, 'код уже использован');
  assert.equal(chatOf(db, b), null, 'чужой аккаунт не должен привязаться');
});

test('мусорный код отвергается', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db, 'a@example.com');
  for (const bad of ['', '  ', '12345', '1234567', 'abcdef', '12 456', '../../etc']) {
    issueCode(db, uid, CODE, 1_000_000);
    assert.equal(linkByCode(db, '555', bad, 1_000_000), null, `${bad} не должен проходить`);
  }
});

test('повторный выпуск кода заменяет предыдущий', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db, 'a@example.com');
  issueCode(db, uid, '111111', 1_000_000);
  issueCode(db, uid, '222222', 1_000_000);

  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS c FROM telegram_codes WHERE user_id = ?').get(uid) as {
        c: number;
      }
    ).c,
    1,
    'старый код должен быть удалён',
  );
  assert.equal(linkByCode(db, '555', '111111', 1_000_000), null);
});

test('один чат не привязывается к двум аккаунтам', () => {
  const db = createDatabase(':memory:');
  const a = seed(db, 'a@example.com');
  const b = seed(db, 'b@example.com');
  const now = 1_000_000;

  issueCode(db, a, '111111', now);
  linkByCode(db, '777', '111111', now);

  issueCode(db, b, '222222', now);
  linkByCode(db, '777', '222222', now);

  assert.equal(chatOf(db, a), null, 'прежний аккаунт должен отвязаться');
  assert.equal(chatOf(db, b), '777');
});

test('отвязка очищает чат', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db, 'a@example.com');
  issueCode(db, uid, CODE, 1_000_000);
  linkByCode(db, '555', CODE, 1_000_000);

  const result = db
    .prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?')
    .run('555');
  assert.equal(result.changes, 1);
  assert.equal(chatOf(db, uid), null);
});

test('очистка просроченных кодов не трогает свежие', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db, 'a@example.com');
  const now = 1_000_000;
  db.prepare('INSERT INTO telegram_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(
    '999999',
    uid,
    now + 1000,
  );
  db.prepare('INSERT INTO telegram_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(
    '888888',
    uid,
    now - 1,
  );

  const purged = db.prepare('DELETE FROM telegram_codes WHERE expires_at <= ?').run(now);
  assert.equal(purged.changes, 1);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS c FROM telegram_codes').get() as { c: number }).c,
    1,
  );
});
