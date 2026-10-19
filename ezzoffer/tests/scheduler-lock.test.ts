import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from '../src/lib/db';
import { acquireLock, lockHeldAt, releaseLock } from '../src/lib/scheduler';

const LOCK_TTL_MS = 30 * 60 * 1000;

test('первый захват блокировки проходит, когда метки нет', () => {
  const db = createDatabase(':memory:');
  assert.equal(lockHeldAt(db), 0, 'метки изначально нет');
  assert.equal(acquireLock(db, 1_000_000), true, 'первый запуск не должен блокироваться');
  assert.equal(lockHeldAt(db), 1_000_000, 'метка должна быть записана');
});

test('второй захват до истечения TTL блокируется', () => {
  const db = createDatabase(':memory:');
  const now = 1_000_000;
  assert.equal(acquireLock(db, now), true);
  assert.equal(acquireLock(db, now + 1000), false, 'перекрытие не должно проходить');
});

test('после истечения TTL блокировка снова доступна', () => {
  const db = createDatabase(':memory:');
  const now = 1_000_000;
  acquireLock(db, now);
  assert.equal(acquireLock(db, now + LOCK_TTL_MS + 1), true);
});

test('releaseLock освобождает блокировку для следующего тика', () => {
  const db = createDatabase(':memory:');
  const now = 1_000_000;
  acquireLock(db, now);
  releaseLock(db);
  assert.equal(lockHeldAt(db), 0, 'метка должна быть снята');
  assert.equal(acquireLock(db, now + 1000), true, 'снятая блокировка не должна мешать');
});

test('устаревшая метка не блокирует новый запуск (TTL вместо вечной блокировки)', () => {
  const db = createDatabase(':memory:');
  const now = 1_000_000;
  acquireLock(db, now);
  assert.equal(acquireLock(db, now + LOCK_TTL_MS * 2), true);
});

test('блокировка видна другому процессу через файл БД', () => {
  const dir = join(tmpdir(), `ezoffer-lock-${process.pid}-${Date.now()}`);
  const file = join(dir, 'ezoffer.db');
  try {
    const first = createDatabase(file);
    acquireLock(first, 2_000_000);
    first.close();

    const second = createDatabase(file);
    assert.equal(lockHeldAt(second), 2_000_000, 'метка сохраняется в файле');
    assert.equal(acquireLock(second, 2_000_500), false, 'новый процесс видит чужую блокировку');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('последовательные тики: захват и сброс повторяются без залипания', () => {
  const db = createDatabase(':memory:');
  let now = 5_000_000;
  for (let i = 0; i < 3; i++) {
    assert.equal(acquireLock(db, now), true, `тик ${i} должен захватить блокировку`);
    releaseLock(db);
    assert.equal(lockHeldAt(db), 0, `после тика ${i} метка снята`);
    now += 60_000;
  }
});

/*
 * Регрессия: снятие чужой блокировки.
 *
 * TTL блокировки — 30 минут, а прогон планировщика дольше: обновление каталога
 * по всем площадкам, автоотклики, синхронизация с hh. На медленной сети он
 * уходит за TTL, и метка выглядит свободной — её перехватывает ручной запуск
 * через /api/autoapply/run.
 *
 * Дальше планировщик доходил до конца и вызывал releaseLock(db) безусловно,
 * то есть УДАЛЯЛ МЕТКУ, КОТОРАЯ УЖЕ ПРИНАДЛЕЖАЛА НЕМУ. После этого блокировки
 * не было ни у кого: третий запуск стартовал поверх второго, не дожидаясь
 * ни одного. Три параллельных прогона отправляют отклики поверх друг друга.
 *
 * С меткой снимается только своя блокировка, и лишний прогон просто ждёт
 * следующего окна.
 */
test('releaseLock с чужой меткой не снимает чужую блокировку (regression)', () => {
  const db = createDatabase(':memory:');
  const t0 = 1_000_000;

  // Прогон планировщика начался и затянулся за TTL.
  assert.equal(acquireLock(db, t0), true);

  // TTL истёк, метку перехватил другой запуск.
  const t1 = t0 + LOCK_TTL_MS + 1;
  assert.equal(acquireLock(db, t1), true, 'по истечении TTL блокировку можно взять заново');

  // Первый прогон завершился и снимает блокировку. Его метка — t0, а в базе t1.
  releaseLock(db, t0);
  assert.equal(lockHeldAt(db), t1, 'чужая метка должна остаться на месте');

  // Значит блокировка всё ещё занята — третий запуск не пройдёт.
  assert.equal(acquireLock(db, t1 + 1000), false, 'блокировка должна остаться занятой');

  // Свой прогон снимает свою метку — и только тогда следующий может войти.
  releaseLock(db, t1);
  assert.equal(lockHeldAt(db), 0);
  assert.equal(acquireLock(db, t1 + 2000), true);
});

test('releaseLock без метки сохраняет прежнее поведение', () => {
  const db = createDatabase(':memory:');
  acquireLock(db, 1_000_000);
  releaseLock(db);
  assert.equal(lockHeldAt(db), 0);
});
