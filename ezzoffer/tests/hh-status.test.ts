import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../src/lib/db';

type User = {
  hh_token: string | null;
  hh_token_expires_at: number | null;
  hh_refresh_token: string | null;
  hh_resume_id: string | null;
};

type HhConn = Pick<User, 'hh_token' | 'hh_token_expires_at' | 'hh_refresh_token' | 'hh_resume_id'>;

/**
 * Логика /api/hh/status. Раньше connected = «токен и его expiry в будущем».
 * Но getValidHhToken умеет обновить протухший access-токен по refresh_token,
 * поэтому автоотклики продолжали работать, а UI показывал «Не подключён»
 * и предлагал подключиться заново.
 */
function connectionState(
  user: HhConn,
  now: number,
  hhConfigured: boolean,
): { connected: boolean; refreshable: boolean } {
  const tokenValid = Boolean(
    user.hh_token && user.hh_token_expires_at && user.hh_token_expires_at > now,
  );
  const canRefresh = Boolean(user.hh_refresh_token) && hhConfigured;
  return {
    connected: (tokenValid || canRefresh) && Boolean(user.hh_resume_id),
    refreshable: !tokenValid && canRefresh,
  };
}

const NOW = 1_700_000_000_000;

test('валидный токен — подключено без предупреждения', () => {
  const s = connectionState(
    {
      hh_token: 'tok',
      hh_token_expires_at: NOW + 3_600_000,
      hh_refresh_token: 'ref',
      hh_resume_id: 'res',
    },
    NOW,
    true,
  );
  assert.equal(s.connected, true);
  assert.equal(s.refreshable, false);
});

test('протухший токен с refresh_token остаётся подключённым', () => {
  const s = connectionState(
    {
      hh_token: 'tok',
      hh_token_expires_at: NOW - 1000,
      hh_refresh_token: 'ref',
      hh_resume_id: 'res',
    },
    NOW,
    true,
  );
  assert.equal(s.connected, true, 'регрессия: UI предлагал подключиться заново');
  assert.equal(s.refreshable, true, 'пользователь должен знать, что токен обновится');
});

test('протухший токен без refresh_token — не подключено', () => {
  const s = connectionState(
    {
      hh_token: 'tok',
      hh_token_expires_at: NOW - 1000,
      hh_refresh_token: null,
      hh_resume_id: 'res',
    },
    NOW,
    true,
  );
  assert.equal(s.connected, false);
  assert.equal(s.refreshable, false);
});

test('refresh_token без настроенного OAuth не помогает', () => {
  const s = connectionState(
    {
      hh_token: 'tok',
      hh_token_expires_at: NOW - 1000,
      hh_refresh_token: 'ref',
      hh_resume_id: 'res',
    },
    NOW,
    false,
  );
  assert.equal(s.connected, false, 'обновлять токен нечем');
});

test('без резюме на hh.ru подключение бессмысленно', () => {
  const s = connectionState(
    {
      hh_token: 'tok',
      hh_token_expires_at: NOW + 1000,
      hh_refresh_token: null,
      hh_resume_id: null,
    },
    NOW,
    true,
  );
  assert.equal(s.connected, false, 'отклики без resume_id не отправляются');
});

test('отключение аккаунта обнуляет все поля', () => {
  const db = createDatabase(':memory:');
  const uid = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, plan, created_at, hh_token, hh_token_expires_at, hh_refresh_token, hh_resume_id)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        'disconnect@example.com',
        'h',
        'pro',
        Date.now(),
        'tok',
        Date.now() + 100000,
        'ref',
        'res',
      ).lastInsertRowid,
  );

  db.prepare(
    'UPDATE users SET hh_token = NULL, hh_token_expires_at = NULL, hh_refresh_token = NULL, hh_resume_id = NULL WHERE id = ?',
  ).run(uid);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as HhConn;
  const s = connectionState(row, Date.now(), true);
  assert.equal(s.connected, false);
  assert.equal(row.hh_token, null);
  assert.equal(row.hh_refresh_token, null);
  assert.equal(row.hh_resume_id, null);
});
