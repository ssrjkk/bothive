import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Постраничная выдача откликов.
 *
 * Ключевой случай — одинаковые sent_at у нескольких откликов (планировщик
 * отправляет пачками). Курсор только по времени пропускал бы записи на
 * границе страниц, поэтому он составной: (sent_at, id).
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
let db: Database;
let listApplicationsPage: typeof import('../src/lib/applications').listApplicationsPage;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db;
  listApplicationsPage = (await import('../src/lib/applications')).listApplicationsPage;
});

function seed(userId: number, count: number, sameTimestamp: boolean) {
  const insert = db.prepare(
    `INSERT INTO applications (user_id, job_slug, status, sent_at) VALUES (?, ?, 'sent', ?)`,
  );
  const base = Date.now();
  for (let i = 0; i < count; i++) {
    // halfSame — первая половина записей получает ОДИНАКОВое время,
    // вторая — уникальное.
    const ts = sameTimestamp && i < count / 2 ? base : base - i * 1000;
    insert.run(userId, `slug-${i}`, ts);
  }
}

function newUser(email: string): number {
  return Number(
    db
      .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?)')
      .run(email, 'h', Date.now()).lastInsertRowid,
  );
}

test('первая страница отдаёт limit записей и курсор', () => {
  const uid = newUser('page1@test.dev');
  seed(uid, 25, false);

  const page = listApplicationsPage(uid, 10);
  assert.equal(page.items.length, 10);
  assert.ok(page.nextCursor, 'курсор должен быть, пока есть ещё записи');
});

test('обход страниц возвращает все записи без пропусков и дублей', () => {
  const uid = newUser('page2@test.dev');
  seed(uid, 25, false);

  const seen = new Set<number>();
  let cursor = null as { sentAt: number; id: number } | null;
  let guard = 0;

  do {
    const page = listApplicationsPage(uid, 10, cursor);
    for (const item of page.items) {
      assert.ok(!seen.has(item.id), `дубликат id=${item.id} между страницами`);
      seen.add(item.id);
    }
    cursor = page.nextCursor;
  } while (cursor && ++guard < 20);

  assert.equal(seen.size, 25, `ожидались 25 записей, получено ${seen.size}`);
});

test('одинаковые sent_at не приводят к пропускам на границе страниц', () => {
  const uid = newUser('page3@test.dev');
  seed(uid, 20, true);

  const seen = new Set<number>();
  let cursor = null as { sentAt: number; id: number } | null;
  let guard = 0;

  do {
    const page = listApplicationsPage(uid, 6, cursor);
    for (const item of page.items) {
      assert.ok(!seen.has(item.id), `дубликат при одинаковом sent_at: id=${item.id}`);
      seen.add(item.id);
    }
    cursor = page.nextCursor;
  } while (cursor && ++guard < 20);

  assert.equal(seen.size, 20, `ожидались 20 записей, получено ${seen.size}`);
});

test('после последней страницы курсор равен null', () => {
  const uid = newUser('page4@test.dev');
  seed(uid, 5, false);

  const page = listApplicationsPage(uid, 50);
  assert.equal(page.items.length, 5);
  assert.equal(page.nextCursor, null);
});

test('пустой результат даёт пустую страницу без курсора', () => {
  const uid = newUser('page5@test.dev');
  const page = listApplicationsPage(uid, 10);
  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
});

test('чужие отклики не попадают в страницу', () => {
  const mine = newUser('mine@test.dev');
  const other = newUser('other@test.dev');
  seed(mine, 3, false);
  seed(other, 10, false);

  const page = listApplicationsPage(mine, 50);
  assert.equal(page.items.length, 3, 'должны видны только свои отклики');
});

test('limit ограничивается сверху и снизу', () => {
  const uid = newUser('page6@test.dev');
  seed(uid, 3, false);
  assert.ok(listApplicationsPage(uid, 0).items.length <= 1);
  assert.ok(listApplicationsPage(uid, 9999).items.length <= 200);
});
