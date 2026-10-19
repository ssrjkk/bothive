import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateApplicationsOrigin, migrateApplicationsResumeId } from '../src/lib/db-migrations';

/**
 * Фаза 1, задача 1: происхождение отклика.
 *
 * Каждый отклик обязан нести origin: real — отправлен через API площадки,
 * user — человек зафиксировал вручную (кнопка «На сайте» / «По email»),
 * simulated — демо-симуляция, ai — сгенерировано моделью.
 * Безопасное значение по умолчанию — 'user': забытый INSERT нигде не соврёт
 * про внешнюю отправку. Backfill: строки по hh-вакансиям — 'real', остальные
 * остаются 'user'. Таблица events создаётся сразу с origin-CHECK (Фаза 3),
 * чтобы позже не пересобирать её ради колонки.
 */

const ORIGINS = ['real', 'simulated', 'user', 'ai'] as const;

function makeOldDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL);
    CREATE TABLE vacancies (
      slug TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
      title TEXT NOT NULL, company TEXT NOT NULL, salary TEXT NOT NULL,
      level TEXT NOT NULL, format TEXT NOT NULL, city TEXT NOT NULL,
      posted TEXT NOT NULL, category TEXT NOT NULL, about TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
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
  `);
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.test')").run();
  const vac = db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city, posted, category, about, fetched_at)
     VALUES (?, ?, ?, 'T', 'C', '', 'Middle', '', '', '', 'Работа', 'A', ?)`,
  );
  vac.run('hh-1', 'hh', '1', 1);
  vac.run('local-1', 'local', '2', 1);
  const app = db.prepare(
    `INSERT INTO applications (user_id, job_slug, resume_id, status, sent_at) VALUES (1, ?, '7', 'sent', ?)`,
  );
  app.run('hh-1', 100);
  app.run('local-1', 101);
  app.run('gone-slug', 102);
  return db;
}

test('миграция добавляет origin с безопасным дефолтом и backfill hh→real', () => {
  const db = makeOldDb();
  migrateApplicationsOrigin(db);

  const cols = db.prepare('PRAGMA table_info(applications)').all() as { name: string }[];
  assert.ok(
    cols.some((c) => c.name === 'origin'),
    'колонки origin нет после миграции',
  );

  const rows = db.prepare('SELECT job_slug, origin FROM applications ORDER BY sent_at').all() as {
    job_slug: string;
    origin: string;
  }[];
  assert.deepEqual(
    rows.map((r) => r.origin),
    ['real', 'user', 'user'],
    `backfill неверный: ${JSON.stringify(rows)} — hh-строка обязана стать real, остальные user`,
  );
  db.close();
});

test('CHECK принимает только четыре значения, дефолт — user', () => {
  const db = makeOldDb();
  migrateApplicationsOrigin(db);

  for (const origin of ORIGINS) {
    db.prepare(
      "INSERT INTO applications (user_id, job_slug, status, sent_at, origin) VALUES (1, 'hh-1', 'sent', 1, ?)",
    ).run(origin);
  }
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO applications (user_id, job_slug, status, sent_at, origin) VALUES (1, 'hh-1', 'sent', 1, 'fake')",
        )
        .run(),
    'мусорный origin записался без ошибки',
  );
  const def = db
    .prepare("SELECT origin FROM applications WHERE origin = 'user' AND job_slug = 'gone-slug'")
    .get() as { origin: string };
  assert.equal(def.origin, 'user');
  db.close();
});

test('миграция идемпотентна на заполненной базе', () => {
  const db = makeOldDb();
  migrateApplicationsOrigin(db);
  const first = db.prepare('SELECT * FROM applications ORDER BY id').all();
  migrateApplicationsOrigin(db);
  migrateApplicationsOrigin(db);
  const after = db.prepare('SELECT * FROM applications ORDER BY id').all();
  assert.deepEqual(after, first, 'повторный запуск изменил данные');
  // Явно выставленный origin backfill не затирает.
  db.prepare("UPDATE applications SET origin = 'simulated' WHERE job_slug = 'local-1'").run();
  migrateApplicationsOrigin(db);
  const kept = db.prepare("SELECT origin FROM applications WHERE job_slug = 'local-1'").get() as {
    origin: string;
  };
  assert.equal(kept.origin, 'simulated', 'backfill затёр явный origin');
  db.close();
});

test('пересборка resume_id не теряет origin', () => {
  const db = makeOldDb();
  migrateApplicationsOrigin(db);
  db.prepare("UPDATE applications SET origin = 'simulated' WHERE job_slug = 'hh-1'").run();
  migrateApplicationsResumeId(db);

  const row = db
    .prepare(
      "SELECT origin, resume_id, typeof(resume_id) AS ty FROM applications WHERE job_slug = 'hh-1'",
    )
    .get() as {
    origin: string;
    ty: string;
  };
  assert.equal(row.origin, 'simulated', 'пересборка потеряла origin');
  assert.equal(row.ty, 'text', 'пересборка не сменила тип resume_id');
  db.close();
});

test('свежая база: origin в схеме, events с origin-CHECK', async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  const { createDatabase } = await import('../src/lib/db');
  const db = createDatabase(':memory:');
  try {
    const cols = db.prepare('PRAGMA table_info(applications)').all() as {
      name: string;
      dflt_value: string | null;
    }[];
    const origin = cols.find((c) => c.name === 'origin');
    assert.ok(origin, 'в свежей схеме нет applications.origin');
    assert.match(
      origin.dflt_value ?? '',
      /user/,
      `дефолт обязан быть user, а не ${origin.dflt_value}`,
    );

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    assert.ok(tables.includes('events'), 'таблицы events нет в свежей схеме');

    db.prepare(
      `INSERT INTO events (user_id, kind, origin, payload, created_at) VALUES (1, 'invite', 'real', '{}', 1)`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO events (user_id, kind, origin, payload, created_at) VALUES (1, 'x', 'fake', '{}', 1)`,
          )
          .run(),
      'events принял мусорный origin',
    );
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------- поведение: запись

let appDb: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  process.env.AUTOAPPLY_WORK_START = '1';
  process.env.AUTOAPPLY_WORK_END = '24';
  delete process.env.AI_API_KEY;
  const { loginAs, useInMemoryDb } = await import('./helpers/route-session');
  useInMemoryDb();
  appDb = (await import('../src/lib/db')).db;
  loginAs();
});

function seedVacancy(slug: string, source: string): void {
  appDb.prepare('DELETE FROM vacancies WHERE slug = ?').run(slug);
  appDb
    .prepare(
      `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city, posted, published_at,
       category, about, responsibilities, requirements, bonus, contact_email, contact_phone, fetched_at)
     VALUES (?, ?, 'sid', 'Разработчик', 'Компания', '', 'Middle', 'Удалённо', 'Москва', 'сегодня', ?, 'Разработка',
       'Текст', '[]', '[]', '[]', NULL, NULL, ?)`,
    )
    .run(slug, source, Date.now() - 3_600_000, Date.now());
}

test('POST /api/applications по не-hh вакансии пишет origin=user', async () => {
  const { post } = await import('./helpers/route-session');
  appDb.prepare('DELETE FROM applications').run();
  appDb.prepare('DELETE FROM users WHERE id = 1').run();
  appDb
    .prepare(
      "INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified) VALUES (1,'o@test','h','pro',?, ?,1)",
    )
    .run(Date.now() + 86_400_000, Date.now());
  seedVacancy('local-origin-1', 'trudvsem');

  const { POST } = await import('../src/app/api/applications/route');
  const res = await POST(post({ jobSlug: 'local-origin-1' }));
  assert.equal(res.status, 201, `ожидался 201, получен ${res.status}: ${await res.text()}`);

  const row = appDb
    .prepare("SELECT origin FROM applications WHERE job_slug = 'local-origin-1'")
    .get() as {
    origin: string;
  };
  assert.equal(row.origin, 'user', 'ручной учёт по внешней площадке обязан быть user, а не real');
});

test('applyToVacancy через hh API пишет origin=real', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 201,
      text: async () => '',
      headers: { get: () => null },
    }) as unknown as Response) as typeof fetch;
  try {
    appDb.prepare('DELETE FROM applications').run();
    appDb.prepare('DELETE FROM users WHERE id = 1').run();
    const uid = Number(
      appDb
        .prepare(
          // mode='live' обязателен: applyToVacancy не отправляет отклик в демо-режиме.
          "INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, email_verified, hh_token, hh_token_expires_at, hh_resume_id, mode) VALUES ('r@test','h','pro',?, ?,1,'tok',?, 'res123','live')",
        )
        .run(Date.now() + 86_400_000, Date.now(), Date.now() + 3_600_000).lastInsertRowid,
    );
    seedVacancy('hh-origin-1', 'hh');
    const { resetPacing } = await import('../src/lib/autoapply');
    resetPacing();
    const { applyToVacancy } = await import('../src/lib/autoapply');
    const { getUserById } = await import('../src/lib/db');
    const { getVacancyBySlug } = await import('../src/lib/vacancies');
    const user = getUserById(uid);
    assert.ok(user);
    const vacancy = getVacancyBySlug('hh-origin-1');
    assert.ok(vacancy);
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const out = await applyToVacancy(user, vacancy, { now: () => noon.getTime() });
    assert.equal(out.ok, true, `отклик не ушёл: ${JSON.stringify(out)}`);

    const row = appDb
      .prepare("SELECT origin FROM applications WHERE job_slug = 'hh-origin-1'")
      .get() as {
      origin: string;
    };
    assert.equal(row.origin, 'real', 'отклик через API площадки обязан быть real');
  } finally {
    globalThis.fetch = saved;
  }
});
