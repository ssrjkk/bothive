import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase, resolveDbPath } from '../src/lib/db';

/**
 * Регрессия: `process.env.EZOFFER_DB_PATH ?? default` не срабатывает на пустой
 * строке. После копирования .env.example (где переменная объявлена пустой)
 * путь становился "", better-sqlite3 открывал временную БД в памяти, и все
 * данные пользователей исчезали при каждом рестарте.
 */

test('пустой EZOFFER_DB_PATH не превращается в путь к временной БД', () => {
  const resolved = resolveDbPath({ EZOFFER_DB_PATH: '' }, '/app');
  assert.equal(resolved, join('/app', 'data', 'ezoffer.db'));
  assert.notEqual(resolved, '', 'пустой путь открыл бы эфемерную БД в памяти');
});

test('EZOFFER_DB_PATH из пробелов также откатывается на дефолт', () => {
  assert.equal(
    resolveDbPath({ EZOFFER_DB_PATH: '   ' }, '/app'),
    join('/app', 'data', 'ezoffer.db'),
  );
});

test('непустой EZOFFER_DB_PATH уважается', () => {
  assert.equal(resolveDbPath({ EZOFFER_DB_PATH: '/data/custom.db' }, '/app'), '/data/custom.db');
});

test('отсутствующая переменная даёт дефолтный путь', () => {
  assert.equal(resolveDbPath({}, '/app'), join('/app', 'data', 'ezoffer.db'));
});

test('БД на диске переживает переоткрытие (не эфемерная)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ezoffer-dbpath-'));
  try {
    const file = join(dir, 'ezoffer.db');
    const first = createDatabase(file);
    first
      .prepare('INSERT INTO users (email, password_hash, plan, created_at) VALUES (?,?,?,?)')
      .run('persist@example.com', 'hash', 'trial', Date.now());
    first.close();

    const second = createDatabase(file);
    const row = second
      .prepare('SELECT email FROM users WHERE email = ?')
      .get('persist@example.com');
    assert.ok(row, 'данные должны пережить переоткрытие того же файла');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
