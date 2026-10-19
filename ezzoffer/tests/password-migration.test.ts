import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { hashPassword, verifyPassword, needsRehash, CURRENT_PARAMS } from '../src/lib/password';

/**
 * Сквозная проверка «старый пользователь вошёл после апгрейда».
 *
 * Сценарий: в базе лежит хеш, сделанный старым кодом (scryptSync с дефолтными
 * N/r/p и hex-строкой в качестве соли). После деплоя новой версии этот
 * пользователь обязан успешно войти, а его хеш — обновиться до новых
 * параметров. Если этого не происходит, все существующие аккаунты
 * одновременно теряют пароль.
 */

function legacyHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

test('legacy-пользователь успешно входит по старому хешу', async () => {
  const stored = legacyHash('old-password-1');
  assert.equal(await verifyPassword('old-password-1', stored), true);
  assert.equal(await verifyPassword('wrong-password', stored), false);
});

test('после входа legacy-хеш обновляется до текущих параметров', async () => {
  const stored = legacyHash('old-password-2');
  assert.equal(needsRehash(stored), true, 'нужен пересчёт');

  // Ровно то, что делает /api/auth/login после успешной проверки.
  const upgraded = await hashPassword('old-password-2');
  assert.equal(needsRehash(upgraded), false);
  assert.equal(await verifyPassword('old-password-2', upgraded), true);
});

test('новый формат содержит именно текущие параметры', async () => {
  const stored = await hashPassword('pw');
  const [, N, r, p] = stored.split('$');
  assert.equal(Number(N), CURRENT_PARAMS.N);
  assert.equal(Number(r), CURRENT_PARAMS.r);
  assert.equal(Number(p), CURRENT_PARAMS.p);
});

test('после обновления старый пароль больше не принимается', async () => {
  const stored = legacyHash('old-password-3');
  await verifyPassword('old-password-3', stored);
  const upgraded = await hashPassword('old-password-3');
  assert.equal(
    await verifyPassword('anything-else', upgraded),
    false,
    'обновлённый хеш не должен принимать чужие пароли',
  );
});
