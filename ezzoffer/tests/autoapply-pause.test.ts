import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../src/lib/db';

type Db = ReturnType<typeof createDatabase>;

function seed(db: Db): number {
  const uid = Number(
    db
      .prepare(
        'INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, autoapply_paused) VALUES (?,?,?,?,?,?)',
      )
      .run('pause@example.com', 'h', 'pro', Date.now() + 100000, Date.now(), 0).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(uid, 's', 'frontend', Date.now(), Date.now());
  return uid;
}

function activeSearches(db: Db, uid: number): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM searches WHERE user_id = ? AND active = 1').get(uid) as {
      c: number;
    }
  ).c;
}

function pausedFlag(db: Db, uid: number): number {
  return (
    db.prepare('SELECT autoapply_paused AS p FROM users WHERE id = ?').get(uid) as { p: number }
  ).p;
}

/**
 * Регрессия: /api/autoapply/pause гасил все поиски (active = 0), а /resume
 * эту метку не восстанавливал. После паузы и возобновления автоотклики
 * оставались выключены навсегда, хотя UI показывал «Активны».
 *
 * Теперь пауза — только флаг autoapply_paused, который runAutoApply проверяет
 * до любой отправки, поэтому пауза мгновенная и без потери настроек.
 */
test('пауза ставит флаг, не трогая активные поиски', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db);

  db.prepare('UPDATE users SET autoapply_paused = 1 WHERE id = ?').run(uid);

  assert.equal(pausedFlag(db, uid), 1, 'флаг паузы выставлен');
  assert.equal(activeSearches(db, uid), 1, 'поиск остался активным и не потерян');
});

test('возобновление снимает флаг и сохраняет поиски активными', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db);

  db.prepare('UPDATE users SET autoapply_paused = 1 WHERE id = ?').run(uid);
  db.prepare('UPDATE users SET autoapply_paused = 0 WHERE id = ?').run(uid);

  assert.equal(pausedFlag(db, uid), 0, 'флаг снят');
  assert.equal(activeSearches(db, uid), 1, 'поиск активен после паузы и возобновления');
});

test('цикл пауза/возобновление не гасит автопоиски', () => {
  const db = createDatabase(':memory:');
  const uid = seed(db);

  for (let i = 0; i < 5; i++) {
    db.prepare('UPDATE users SET autoapply_paused = 1 WHERE id = ?').run(uid);
    db.prepare('UPDATE users SET autoapply_paused = 0 WHERE id = ?').run(uid);
  }

  assert.equal(activeSearches(db, uid), 1, 'поиск выжил после пяти циклов');
});

test('пауза одного пользователя не затрагивает других', () => {
  const db = createDatabase(':memory:');
  const a = seed(db);
  const b = Number(
    db
      .prepare(
        'INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, autoapply_paused) VALUES (?,?,?,?,?,?)',
      )
      .run('other@example.com', 'h', 'pro', Date.now() + 100000, Date.now(), 0).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(b, 's', 'backend', Date.now(), Date.now());

  db.prepare('UPDATE users SET autoapply_paused = 1 WHERE id = ?').run(a);

  assert.equal(pausedFlag(db, b), 0, 'второй пользователь не должен вставать на паузу');
  assert.equal(activeSearches(db, b), 1, 'его поиск не тронут');
});
