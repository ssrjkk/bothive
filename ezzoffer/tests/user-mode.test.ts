import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { loginAs, logout, post, useInMemoryDb } from './helpers/route-session';

/**
 * Фаза 1, задача 2: режим пользователя demo|live.
 *
 * live означает «человек подключил hh и явно согласился на реальные
 * автоотклики». Подключение hh само по себе live не включает (иначе
 * OAuth-колбэк молча менял бы смысл всех цифр в кабинете). Отключение hh
 * гасит live обратно: без площадки «живого» режима быть не может.
 * Безопасный дефолт — demo.
 */

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  useInMemoryDb();
  db = (await import('../src/lib/db')).db;
  loginAs();
});

function freshMode(id: number): string {
  return (db.prepare('SELECT mode FROM users WHERE id = ?').get(id) as { mode: string }).mode;
}

function makeUser(id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (?, 'm@test', 'h', 'pro', ?, ?, 1)`,
  ).run(id, Date.now() + 86_400_000, Date.now());
}

test('свежая схема: mode с дефолтом demo и CHECK', () => {
  const cols = db.prepare('PRAGMA table_info(users)').all() as {
    name: string;
    dflt_value: string | null;
  }[];
  const mode = cols.find((c) => c.name === 'mode');
  assert.ok(mode, 'в users нет колонки mode');
  assert.match(mode.dflt_value ?? '', /demo/, `дефолт обязан быть demo, а не ${mode.dflt_value}`);
});

test('CHECK отвергает мусорный режим', () => {
  makeUser(1);
  assert.throws(
    () => db.prepare("UPDATE users SET mode = 'turbo' WHERE id = 1").run(),
    'мусорный mode записался без ошибки',
  );
  db.prepare('DELETE FROM users WHERE id = 1').run();
});

test('миграция идемпотентна и не трогает явный live', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { setTimeout: sleep } = await import('node:timers/promises');
  const { createDatabase } = await import('../src/lib/db');
  const dir = mkdtempSync(join(tmpdir(), 'ezoffer-mode-'));
  const cleanup = async () => {
    // Windows держит файл БД мгновение после close — одна повторная попытка.
    for (let i = 0; i < 3; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        return;
      } catch {
        if (i === 2) throw new Error(`не удаляется временный каталог ${dir}`);
      }
      if (i < 2) await sleep(100);
    }
  };
  try {
    const file = join(dir, 'ezoffer.db');
    const first = createDatabase(file);
    first
      .prepare(
        "INSERT INTO users (email, password_hash, plan, created_at, mode) VALUES ('a','h','pro',1,'live')",
      )
      .run();
    first.close();
    // Второе открытие той же файловой базы прогоняет миграции заново.
    const second = createDatabase(file);
    const rows = second.prepare('SELECT mode FROM users').all();
    second.close();
    const third = createDatabase(file);
    const again = third.prepare('SELECT mode FROM users').all();
    third.close();
    assert.deepEqual(rows, [{ mode: 'live' }], 'повторная миграция изменила явный live');
    assert.deepEqual(again, [{ mode: 'live' }]);
  } finally {
    await cleanup();
  }
});

test('GET /api/mode без сессии → 401', async () => {
  logout();
  const { GET } = await import('../src/app/api/mode/route');
  assert.equal((await GET()).status, 401);
  loginAs();
});

test('POST /api/mode без сессии → 401', async () => {
  logout();
  const { POST } = await import('../src/app/api/mode/route');
  assert.equal((await POST(post({ mode: 'live' }))).status, 401);
  loginAs();
});

test('live без подключённого hh отклоняется', async () => {
  makeUser(1);
  const { POST } = await import('../src/app/api/mode/route');
  const res = await POST(post({ mode: 'live' }));
  assert.equal(res.status, 400, `live без hh обязан отклоняться, получен ${res.status}`);
  assert.equal(freshMode(1), 'demo', 'отклонённый переход не должен менять режим');
});

test('live с подключённым hh включается, мусор отклоняется', async () => {
  makeUser(1);
  db.prepare(
    'UPDATE users SET hh_token = ?, hh_token_expires_at = ?, hh_resume_id = ? WHERE id = 1',
  ).run('tok', Date.now() + 3_600_000, 'res1');
  const { POST, GET } = await import('../src/app/api/mode/route');
  const res = await POST(post({ mode: 'live' }));
  assert.equal(res.status, 200, `live с hh обязан включаться: ${await res.text()}`);
  assert.equal(freshMode(1), 'live');

  const bad = await POST(post({ mode: 'turbo' }));
  assert.equal(bad.status, 400);
  assert.equal(freshMode(1), 'live', 'мусорный переход не должен менять режим');

  const get = await GET();
  assert.equal(get.status, 200);
  assert.deepEqual(((await get.json()) as { mode?: string }).mode, 'live');
});

test('возврат в demo всегда разрешён, даже без hh', async () => {
  db.prepare(
    "UPDATE users SET hh_token = NULL, hh_resume_id = NULL, mode = 'live' WHERE id = 1",
  ).run();
  const { POST } = await import('../src/app/api/mode/route');
  const res = await POST(post({ mode: 'demo' }));
  assert.equal(res.status, 200);
  assert.equal(freshMode(1), 'demo');
});

test('отключение hh гасит live обратно в demo', async () => {
  db.prepare(
    "UPDATE users SET hh_token = 't', hh_resume_id = 'r', mode = 'live' WHERE id = 1",
  ).run();
  const { POST } = await import('../src/app/api/hh/disconnect/route');
  const res = await POST();
  assert.equal(res.status, 200);
  assert.equal(freshMode(1), 'demo', 'после отключения hh режим обязан стать demo');
});

test('само подключение hh live не включает', async () => {
  db.prepare(
    "UPDATE users SET hh_token = NULL, hh_resume_id = NULL, mode = 'demo' WHERE id = 1",
  ).run();
  const { saveHhConnection } = await import('../src/lib/hh-oauth');
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get() as never;
  saveHhConnection(user as never, 'tok', 'refresh', 3600, 'res1');
  assert.equal(freshMode(1), 'demo', 'подключение hh без явного согласия включило live');
  db.prepare('DELETE FROM users WHERE id = 1').run();
});

test('старая база без mode мигрирует в demo', () => {
  const old = new Database(':memory:');
  try {
    old.exec(
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, password_hash TEXT NOT NULL);',
    );
    old.prepare("INSERT INTO users (email, password_hash) VALUES ('o@ld','h')").run();
    const cols = old.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    assert.ok(!cols.some((c) => c.name === 'mode'), 'предусловие: колонки mode нет');
    old.exec(
      "ALTER TABLE users ADD COLUMN mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo','live'))",
    );
    const row = old.prepare('SELECT mode FROM users').get() as { mode: string };
    assert.equal(row.mode, 'demo', 'старые строки обязаны стать demo, а не live');
  } finally {
    old.close();
  }
});
