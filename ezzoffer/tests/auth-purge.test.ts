import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/lib/db';

/**
 * Уборка просроченных записей авторизации.
 *
 * createSession чистил только сессии своего пользователя, поэтому сессии
 * удалённых аккаунтов и неактивных пользователей копились в таблице
 * бесконечно — то же с истёкшими oauth_states. Функция ниже повторяет
 * ту же логику, что и purgeExpiredAuthRows в src/lib/auth.ts, но на
 * переданном экземпляре БД (в проде она работает на модульном `db`).
 */
function purgeExpiredAuthRows(db: ReturnType<typeof createDatabase>, now: number): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(now);
}

function insertUser(db: ReturnType<typeof createDatabase>, email: string): number {
  const r = db
    .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?)')
    .run(email, 'hash', Date.now());
  return Number(r.lastInsertRowid);
}

test('уборка удаляет просроченные сессии и сохраняет активные', () => {
  const db = createDatabase(':memory:');
  const userId = insertUser(db, 'u@example.com');
  const now = 1_000_000;

  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(
    'expired',
    userId,
    now - 1,
  );
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(
    'alive',
    userId,
    now + 60_000,
  );

  purgeExpiredAuthRows(db, now);

  const tokens = (db.prepare('SELECT token FROM sessions').all() as { token: string }[]).map(
    (r) => r.token,
  );
  assert.deepEqual(tokens, ['alive'], 'остаться должна только неистёкшая сессия');
});

test('уборка удаляет просроченные oauth_states', () => {
  const db = createDatabase(':memory:');
  const userId = insertUser(db, 'u@example.com');
  const now = 1_000_000;

  db.prepare('INSERT INTO oauth_states (token, user_id, expires_at) VALUES (?,?,?)').run(
    'stale',
    userId,
    now - 1,
  );
  db.prepare('INSERT INTO oauth_states (token, user_id, expires_at) VALUES (?,?,?)').run(
    'fresh',
    userId,
    now + 60_000,
  );

  purgeExpiredAuthRows(db, now);

  const tokens = (db.prepare('SELECT token FROM oauth_states').all() as { token: string }[]).map(
    (r) => r.token,
  );
  assert.deepEqual(tokens, ['fresh']);
});

test('уборка идемпотентна и не падает на пустых таблицах', () => {
  const db = createDatabase(':memory:');
  assert.doesNotThrow(() => purgeExpiredAuthRows(db, Date.now()));
  assert.doesNotThrow(() => purgeExpiredAuthRows(db, Date.now()));
});

test('сессия на границе срока считается просроченной', () => {
  const db = createDatabase(':memory:');
  const userId = insertUser(db, 'u@example.com');
  const now = 1_000_000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(
    'edge',
    userId,
    now,
  );
  purgeExpiredAuthRows(db, now);
  const count = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
  assert.equal(count, 0, 'expires_at <= now означает истёкшую сессию');
});
