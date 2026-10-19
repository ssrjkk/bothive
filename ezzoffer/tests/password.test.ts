import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, needsRehash } from '../src/lib/password';

test('hashPassword/verifyPassword: корректный пароль проходит', async () => {
  const stored = await hashPassword('secret123');
  // Формат: scrypt$N$r$p$<salt-hex>$<hash-hex>
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('secret123', stored), true);
});

test('hashPassword/verifyPassword: неверный пароль отклоняется', async () => {
  const stored = await hashPassword('secret123');
  assert.equal(await verifyPassword('wrong', stored), false);
});

test('verifyPassword: некорректный формат хранимого значения', async () => {
  assert.equal(await verifyPassword('secret123', 'not-a-hash'), false);
  assert.equal(await verifyPassword('secret123', ''), false);
  assert.equal(await verifyPassword('secret123', 'scrypt$1$2$3'), false);
});

test('hashPassword даёт разные соли', async () => {
  assert.notEqual(await hashPassword('secret123'), await hashPassword('secret123'));
});

/**
 * Регрессия: старый формат `salt:hash` писался синхронным scryptSync без
 * явных N/r/p (дефолт Node — N=16384). После перехода на версионированный
 * формат с N=65536 такие хеши обязаны продолжать проверяться, иначе все
 * существующие пользователи потеряли бы пароль при первом же входе.
 */
test('legacy-формат salt:hash продолжает проверяться (regression)', async () => {
  const { scryptSync, randomBytes } = await import('node:crypto');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync('legacy-pass', salt, 64).toString('hex');

  assert.equal(await verifyPassword('legacy-pass', `${salt}:${hash}`), true);
  assert.equal(await verifyPassword('wrong-pass', `${salt}:${hash}`), false);
});

test('legacy-хеш помечается на пересчёт, новый — нет', async () => {
  const { scryptSync, randomBytes } = await import('node:crypto');
  const salt = randomBytes(16).toString('hex');
  const legacy = `${salt}:${scryptSync('legacy-pass', salt, 64).toString('hex')}`;

  assert.equal(needsRehash(legacy), true, 'дешёвые параметры требуют обновления');
  assert.equal(needsRehash(await hashPassword('secret123')), false);
});

test('новый хеш хранит параметры стоимости', async () => {
  const stored = await hashPassword('secret123');
  const [, N, r, p] = stored.split('$');
  // N=65536 заметно дороже прежних 16384 — именно ради этого параметр
  // и сериализуется в хеш.
  assert.equal(Number(N), 65536);
  assert.equal(Number(r), 8);
  assert.equal(Number(p), 1);
});

test('unicode-пароль хешируется стабильно', async () => {
  const stored = await hashPassword('пароль123');
  assert.equal(await verifyPassword('пароль123', stored), true);
  assert.equal(await verifyPassword('пароль124', stored), false);
});

/**
 * Хеш с абсурдными параметрами не должен приводиться в исполнение: злоумышленник,
 * получивший доступ к записи в БД, иначе заставил бы процесс выделить
 * гигабайты памяти на каждой проверке пароля.
 */
test('подделанные параметры стоимости отбрасываются', async () => {
  const huge = `scrypt$999999999$32$16$${'0'.repeat(32)}${'0'.repeat(128)}`;
  assert.equal(await verifyPassword('x', huge), false);
  const malformed = `scrypt$abc$8$1$${'0'.repeat(32)}${'0'.repeat(128)}`;
  assert.equal(await verifyPassword('x', malformed), false);
});

test('нулевая соль в подделанном хеше не проходит', async () => {
  const bad = `scrypt$65536$8$1$${'f'.repeat(128)}`;
  assert.equal(await verifyPassword('x', bad), false);
});
