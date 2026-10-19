import test, { before } from 'node:test';
import assert from 'node:assert/strict';

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
let db: Database;
let getStats: (userId: number) => import('../src/lib/stats').Stats;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  const dbMod = await import('../src/lib/db');
  db = dbMod.db;
  const statsMod = await import('../src/lib/stats');
  getStats = statsMod.getStats;
});

function insertUser(email: string) {
  return Number(
    db
      .prepare(
        'INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at) VALUES (?,?,?,?,?)',
      )
      .run(email, 'h', 'pro', Date.now() + 100000, Date.now()).lastInsertRowid,
  );
}

test('getStats считает реальные отклики из БД (без симуляции)', () => {
  const uid = insertUser('stats@example.com');
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO applications (user_id, job_slug, status, response, sent_at, viewed_at, responded_at, withdrawn)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  );
  ins.run(uid, 'a', 'sent', '', now - 1000, null, null);
  ins.run(uid, 'b', 'viewed', '', now - 2000, now - 1000, null);
  ins.run(uid, 'c', 'responded', 'interview', now - 3000, now - 2000, now - 1000);
  ins.run(uid, 'd', 'responded', 'decline', now - 4000, now - 3000, now - 2000);
  ins.run(uid, 'e', 'sent', '', now - 5000, null, null);
  db.prepare("UPDATE applications SET withdrawn = 1 WHERE job_slug = 'e'").run();

  const s = getStats(uid);
  assert.equal(s.sent, 4);
  assert.equal(s.viewed, 3);
  assert.equal(s.responded, 2);
  assert.equal(s.invited, 1);
  assert.equal(s.declined, 1);
  assert.equal(s.questions, 0);
  assert.equal(s.withdrawn, 1);
  assert.equal(s.today, 4);
  assert.equal(s.todayLimit, 100);
  assert.equal(s.series.length, 7);
  assert.equal(s.series[6].sent, 4);
});

test('getStats без откликов возвращает нули и подсказку', () => {
  const uid = insertUser('stats2@example.com');
  const s = getStats(uid);
  assert.equal(s.sent, 0);
  assert.equal(s.viewRate, 0);
  assert.ok(s.hint);
});
