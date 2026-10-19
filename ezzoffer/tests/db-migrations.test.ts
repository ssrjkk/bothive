import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateApplicationsResumeId } from '../src/lib/db-migrations';

/**
 * Пересборка applications при смене типа resume_id.
 *
 * Миграция пересоздаёт таблицу, а это единственное место в проекте, где данные
 * пользователей копируются целиком. Ошибка здесь не «сломалась фича», а
 * «пропали отклики» — поэтому проверяется не только результат, но и то, что
 * миграция не касается остальных полей и повторно не срабатывает.
 */

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL);
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    job_slug TEXT NOT NULL,
    search_id INTEGER,
    resume_id INTEGER,
    letter_id INTEGER,
    status TEXT NOT NULL DEFAULT 'sent',
    response TEXT NOT NULL DEFAULT '',
    response_note TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    external_url TEXT,
    sent_at INTEGER NOT NULL,
    viewed_at INTEGER,
    responded_at INTEGER,
    withdrawn INTEGER NOT NULL DEFAULT 0,
    notified_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
  CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_slug);
  CREATE INDEX IF NOT EXISTS idx_applications_user_sent ON applications(user_id, sent_at);
  CREATE INDEX IF NOT EXISTS idx_applications_user_job ON applications(user_id, job_slug);
`;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.test')").run();
  return db;
}

function addApp(db: Database.Database, resumeId: string | null): number {
  return Number(
    db
      .prepare(
        `INSERT INTO applications (user_id, job_slug, search_id, resume_id, letter_id, status, response,
           response_note, message, external_url, sent_at, viewed_at, responded_at, withdrawn)
         VALUES (1, 'hh-x', 5, ?, 9, 'sent', 'отказ', 'не подошёл опыт', 'письмо', 'https://x.test', 100, 200, 300, 0)`,
      )
      .run(resumeId).lastInsertRowid,
  );
}

test('числовой hh-id перестаёт превращаться в число', () => {
  /*
   * Именно это и ломало поиск резюме. Колонка INTEGER заставляла SQLite
   * привести «7» к 7, а сравнение `hh_id = 7` по строке «7» уже не находило
   * ничего — молча, без ошибки.
   */
  const db = makeDb();
  addApp(db, '7');
  migrateApplicationsResumeId(db);
  const row = db.prepare('SELECT resume_id, typeof(resume_id) AS ty FROM applications').get() as {
    resume_id: unknown;
    ty: string;
  };
  assert.equal(row.ty, 'text', `после миграции тип всё ещё ${row.ty}`);
  assert.equal(String(row.resume_id), '7', 'значение id изменилось');

  // И главное: теперь оно находится так же, как в резюме.
  db.exec('CREATE TABLE resumes (id INTEGER PRIMARY KEY, hh_id TEXT)');
  db.prepare("INSERT INTO resumes (id, hh_id) VALUES (1, '7')").run();
  const found = db.prepare('SELECT id FROM resumes WHERE hh_id = ?').get(row.resume_id);
  assert.ok(found, 'id из applications не находится в resumes.hh_id после миграции');
  db.close();
});

test('остальные поля и строки переживают пересборку', () => {
  const db = makeDb();
  const a = addApp(db, '7');
  const b = addApp(db, 'abc123');
  const c = addApp(db, null);
  migrateApplicationsResumeId(db);

  const rows = db.prepare('SELECT * FROM applications ORDER BY id').all() as Record<
    string,
    unknown
  >[];
  assert.equal(rows.length, 3, `после миграции ${rows.length} строк вместо трёх`);
  /*
   * NULL остаётся NULL, а не превращается в строку "null".
   * Поэтому сравниваем через нормализацию: String(null) дал бы "null", и
   * тест ругался бы на совершенно правильные данные.
   */
  assert.deepEqual(
    rows.map((r) => (r.resume_id === null ? '<null>' : String(r.resume_id))),
    ['7', 'abc123', '<null>'],
    'resume_id искажены',
  );
  const typed = db
    .prepare('SELECT typeof(resume_id) AS ty FROM applications ORDER BY id')
    .all() as { ty: string }[];
  assert.deepEqual(
    typed.map((t) => t.ty),
    ['text', 'text', 'null'],
    'типы значений неверны',
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    [a, b, c],
    'идентификаторы поехали',
  );

  const first = rows[0]!;
  assert.equal(first.user_id, 1);
  assert.equal(first.job_slug, 'hh-x');
  assert.equal(first.search_id, 5);
  assert.equal(first.letter_id, 9);
  assert.equal(first.status, 'sent');
  assert.equal(first.response, 'отказ');
  assert.equal(first.response_note, 'не подошёл опыт');
  assert.equal(first.message, 'письмо');
  assert.equal(first.external_url, 'https://x.test');
  assert.equal(first.sent_at, 100);
  assert.equal(first.viewed_at, 200);
  assert.equal(first.responded_at, 300);
  assert.equal(first.withdrawn, 0);
  db.close();
});

test('миграция не срабатывает повторно', () => {
  const db = makeDb();
  addApp(db, '7');
  migrateApplicationsResumeId(db);
  const first = db.prepare('SELECT * FROM applications').all();

  migrateApplicationsResumeId(db);
  migrateApplicationsResumeId(db);

  const after = db.prepare('SELECT * FROM applications').all();
  assert.deepEqual(after, first, 'повторный запуск миграции изменил данные');
  const type = (
    db.prepare('PRAGMA table_info(applications)').all() as { name: string; type: string }[]
  ).find((c) => c.name === 'resume_id');
  assert.equal(type?.type.toUpperCase(), 'TEXT', `тип снова ${type?.type}`);
  db.close();
});

/**
 * Нумерация откликов продолжается после пересборки.
 *
 * AUTOINCREMENT держит счётчик в sqlite_sequence, а он живёт рядом с таблицей.
 * Если бы пересборка его обнулила, следующий отклик получил бы id 1 — и либо
 * столкнулся бы с существующей строкой, либо затёр её при последующем INSERT.
 * Тихая потеря истории откликов — самый дорогой вид поломки здесь.
 */
test('после пересборки новые отклики не начинают нумерацию заново', () => {
  const db = makeDb();
  const first = addApp(db, '7');
  const second = addApp(db, 'abc');
  migrateApplicationsResumeId(db);

  const nextId = Number(
    db
      .prepare(
        `INSERT INTO applications (user_id, job_slug, resume_id, status, sent_at) VALUES (1, 'hh-new', 'zz', 'sent', 1)`,
      )
      .run().lastInsertRowid,
  );

  assert.ok(
    nextId > second,
    `нумерация началась заново: было ${second}, стало ${nextId} — возможна перезапись истории`,
  );
  assert.notEqual(nextId, first);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM applications').get() as { c: number }).c, 3);
  db.close();
});

test('после миграции остаются все индексы', () => {
  /*
   * Индексы не переживают DROP/CREATE таблицы. Без них выборка откликов
   * пользователя сканировала бы таблицу целиком — и на реальных объёмах
   * кабинет стал бы открываться заметно медленнее, без единой ошибки.
   */
  const db = makeDb();
  addApp(db, '7');
  migrateApplicationsResumeId(db);

  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const expected of [
    'idx_applications_user',
    'idx_applications_job',
    'idx_applications_user_sent',
    'idx_applications_user_job',
  ]) {
    assert.ok(names.includes(expected), `индекс ${expected} не восстановлен после пересборки`);
  }
  db.close();
});

test('пустая таблица переезжает без ошибок', () => {
  const db = makeDb();
  migrateApplicationsResumeId(db);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM applications').get() as { c: number }).c, 0);
  db.close();
});
