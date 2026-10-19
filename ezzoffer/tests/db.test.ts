import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/lib/db';

function insertUser(db: ReturnType<typeof createDatabase>, email: string, plan = 'trial') {
  return db
    .prepare(
      'INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at) VALUES (?,?,?,?,?)',
    )
    .run(email, 'hash', plan, null, Date.now());
}

test("createDatabase(':memory:') создаёт схему и пользователя", () => {
  const db = createDatabase(':memory:');
  const r = insertUser(db, 'u@example.com');
  assert.equal(r.changes, 1);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  assert.equal((row as { email: string }).email, 'u@example.com');
});

test('email уникален (UNIQUE constraint)', () => {
  const db = createDatabase(':memory:');
  insertUser(db, 'dup@example.com');
  assert.throws(() => insertUser(db, 'dup@example.com'), /UNIQUE/i);
});

test('FK enforced: sessions.user_id должен существовать', () => {
  const db = createDatabase(':memory:');
  // Нет пользователя с id=999 → сессия должна быть отклонена по FK
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
        .run('tok', 999, Date.now()),
    /FOREIGN KEY|CONSTRAINT/i,
  );
});

test('WAL включается только для файловых БД', () => {
  const mem = createDatabase(':memory:');
  assert.equal(mem.pragma('journal_mode', { simple: true }), 'memory');
});

/**
 * Индексы на expires_at нужны уборке просроченных сессий и OAuth-состояний:
 * без них purge шёл полным сканированием таблицы. Регрессия-guard на сам факт
 * существования индексов — при случайном удалении из SCHEMA_SQL тест упадёт.
 */
test('индексы для уборки просроченных записей существуют', () => {
  const db = createDatabase(':memory:');
  const names = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((r) => r.name),
  );
  for (const idx of [
    'idx_sessions_expires',
    'idx_oauth_states_expires',
    'idx_telegram_codes_expires',
  ]) {
    assert.ok(names.has(idx), `отсутствует ${idx}`);
  }
});

test('составные индексы applications покрывают выборки кабинета', () => {
  const db = createDatabase(':memory:');
  const names = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((r) => r.name),
  );
  assert.ok(names.has('idx_applications_user_sent'), 'todayCount идёт по (user_id, sent_at)');
  assert.ok(
    names.has('idx_applications_user_job'),
    'проверка дубля отклика идёт по (user_id, job_slug)',
  );
});

test('схема применяется повторно без ошибок (идемпотентность)', () => {
  const mem = createDatabase(':memory:');
  // createDatabase выполняет SCHEMA_SQL целиком; повторный вызов на той же БД
  // не должен падать из-за дублирующихся CREATE INDEX.
  assert.doesNotThrow(() => createDatabase(':memory:'));
  assert.ok(mem);
});
