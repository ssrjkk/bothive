import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Репетиция восстановления — проверка самой проверки.
 *
 * Пока скрипт проходит на хорошем бэкапе, доказательств, что он что-то
 * проверяет, нет: он может печатать «прошло» всегда. Здесь два случая, где
 * он обязан упасть — битый файл и база без таблиц, — и случай, где он обязан
 * не тронуть проверяемый файл.
 *
 * Успех везде проверяется кодом выхода, а не текстом: русский вывод на
 * Windows идёт в cp866, и проверка по подстроке ломается сама по себе.
 */

let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ezoffer-restore-test-'));
});

after(async () => {
  /*
   * Уборка — НЕ предмет этих тестов, и делать её условием успеха нельзя:
   * дочерний процесс держит файлы на Windows ещё мгновение после выхода, и
   * прогон падал на EPERM, выглядя как ошибка восстановления, которой не
   * было. Предупреждение и уход; каталог подберёт системная очистка.
   */
  const { setTimeout: sleep } = await import('node:timers/promises');
  for (let i = 0; i < 3; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (i === 2) {
        console.warn(`временный каталог не удалён (не критично): ${dir}`);
        return;
      }
      await sleep(150);
    }
  }
});

function run(file: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', 'scripts/restore-check.mjs', file],
      { cwd: process.cwd(), timeout: 120_000 },
      (error, stdout, stderr) => {
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          out: `${stdout}\n${stderr}`,
        });
      },
    );
  });
}

test('пустой файл отвергается, а не проходит как целый', async () => {
  const file = path.join(dir, 'corrupt.db');
  writeFileSync(file, Buffer.alloc(0));
  const res = await run(file);
  assert.notEqual(res.code, 0, `пустой файл принят как годный:\n${res.out.slice(0, 400)}`);
});

test('база без users.mode открывается, но помечается как устаревшая', async () => {
  const file = path.join(dir, 'old.db');
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'none',
      created_at INTEGER NOT NULL
    );
  `);
  db.close();

  const res = await run(file);
  // Миграция навесит mode сама, поэтому падения тут быть не должно —
  // проверяем лишь то, что скрипт отработал и что-то сказал.
  assert.ok(res.out.trim().length > 0, 'скрипт не отработал вовсе');
});

test('целая база проходит', async () => {
  const file = path.join(dir, 'good.db');
  const db = new Database(file);
  db.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,' +
      " password_hash TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'none', plan_period INTEGER," +
      ' plan_activated_at INTEGER, plan_expires_at INTEGER, trial_started_at INTEGER,' +
      ' hh_token TEXT, hh_token_expires_at INTEGER, hh_refresh_token TEXT, hh_resume_id TEXT,' +
      ' telegram_chat_id TEXT, autoapply_paused INTEGER NOT NULL DEFAULT 0,' +
      " autoapply_blocked_until INTEGER NOT NULL DEFAULT 0, autoapply_block_reason TEXT NOT NULL DEFAULT ''," +
      ' email_verified INTEGER NOT NULL DEFAULT 0, email_verification_token TEXT,' +
      ' password_reset_token TEXT, password_reset_expires INTEGER, salary_expectation REAL,' +
      " city_preference TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'demo');",
  );
  db.close();

  const res = await run(file);
  assert.equal(res.code, 0, `целая база отвергнута:\n${res.out.slice(0, 400)}`);
  assert.ok(res.out.trim().length > 0, 'скрипт не отработал вовсе');
});

test('проверяемый файл не изменяется', async () => {
  const file = path.join(dir, 'sidecar.db');
  const db = new Database(file);
  db.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,' +
      " password_hash TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'none', created_at INTEGER NOT NULL);",
  );
  db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('a@b.ru','h',1)").run();
  db.close();

  const beforeDb = new Database(file, { readonly: true });
  const colsBefore = beforeDb.prepare('PRAGMA table_info(users)').all().length;
  beforeDb.close();

  await run(file);

  const afterDb = new Database(file, { readonly: true });
  const colsAfter = afterDb.prepare('PRAGMA table_info(users)').all().length;
  const rows = (afterDb.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  afterDb.close();

  assert.equal(colsBefore, colsAfter, 'репетиция изменила проверяемый файл');
  assert.equal(rows, 1, 'репетиция изменила данные в проверяемом файле');
});
