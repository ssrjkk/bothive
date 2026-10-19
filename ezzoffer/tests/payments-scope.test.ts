import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migratePayments } from '../src/lib/db-migrations';

/**
 * Миграция payments: UNIQUE(external_id) → UNIQUE(provider, external_id).
 *
 * Первая версия схемы держала глобальную уникальность внешнего номера, а
 * формат paymentId задаёт внешняя сторона. Два разных способа оплаты вправе
 * выдать одинаковый номер — и второй легитимный платёж отклонялся как дубль.
 */

// Старая схема: голый UNIQUE на external_id.
function makeOldDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL);
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      external_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      amount_rub INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE entitlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      plan_id TEXT NOT NULL,
      source_payment_id INTEGER REFERENCES payments(id),
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.test')").run();
  db.prepare(
    "INSERT INTO payments (id, user_id, external_id, provider, plan_id, amount_rub, created_at) VALUES (7, 1, 'no-1', 'card', 'pro', 2490, 1000)",
  ).run();
  db.prepare(
    "INSERT INTO entitlements (user_id, plan_id, source_payment_id, expires_at, created_at) VALUES (1, 'pro', 7, 2000, 1000)",
  ).run();
  return db;
}

test('миграция переносит данные и сохраняет id (ссылки из entitlements живы)', () => {
  const db = makeOldDb();
  migratePayments(db);

  const pay = db.prepare('SELECT * FROM payments').all() as Record<string, unknown>[];
  assert.equal(pay.length, 1);
  assert.equal(pay[0].id, 7, 'id платежа обязан сохраниться — на него ссылаются права');
  assert.equal(pay[0].external_id, 'no-1');

  const ent = db.prepare('SELECT source_payment_id FROM entitlements').get() as {
    source_payment_id: number;
  };
  assert.equal(ent.source_payment_id, 7);
});

test('после миграции одинаковый номер у разных провайдеров допустим', () => {
  const db = makeOldDb();
  migratePayments(db);

  db.prepare(
    "INSERT INTO payments (user_id, external_id, provider, plan_id, amount_rub, created_at) VALUES (1, 'no-1', 'sbp', 'pro', 2490, 1001)",
  ).run();
  const rows = db
    .prepare("SELECT COUNT(*) AS c FROM payments WHERE external_id = 'no-1'")
    .get() as {
    c: number;
  };
  assert.equal(rows.c, 2);
});

test('после миграции дубль того же провайдера по-прежнему невозможен', () => {
  const db = makeOldDb();
  migratePayments(db);

  assert.throws(() => {
    db.prepare(
      "INSERT INTO payments (user_id, external_id, provider, plan_id, amount_rub, created_at) VALUES (1, 'no-1', 'card', 'pro', 2490, 1002)",
    ).run();
  }, /UNIQUE/i);
});

test('повторный прогон миграции идемпотентен', () => {
  const db = makeOldDb();
  migratePayments(db);
  migratePayments(db);
  const rows = db.prepare('SELECT COUNT(*) AS c FROM payments').get() as { c: number };
  assert.equal(rows.c, 1);
});
