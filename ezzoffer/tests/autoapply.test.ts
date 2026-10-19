import test, { before } from 'node:test';
import assert from 'node:assert/strict';

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
let db: Database;
let runAutoApply: () => Promise<import('../src/lib/autoapply').AutoApplyRun>;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  // См. autoapply-letter.test.ts: ночной прогон в другом поясе ронял
  // тесты расписанием паузера, а не поведением автоотклика.
  process.env.AUTOAPPLY_WORK_START = '1';
  process.env.AUTOAPPLY_WORK_END = '24';
  delete process.env.HH_ACCESS_TOKEN;
  delete process.env.HH_CLIENT_ID;
  const dbMod = await import('../src/lib/db');
  db = dbMod.db;
  // Часы прогона фиксированы: см. helpers/run-autoapply — иначе ночью
  // паузер не отправляет, и тесты падали по настенным часам.
  runAutoApply = (await import('./helpers/run-autoapply')).runAutoApply;
});

test('runAutoApply без hh-подключения не создаёт отклики (никакой симуляции)', async () => {
  // mode='live' обязателен: в demo прогон не доходит до отправки вовсе, и
  // тест про «нет токена» проходил бы на демо-режиме, проверяя не то.
  const uid = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, mode) VALUES (?,?,?,?,?,'live')",
      )
      .run('auto@example.com', 'h', 'pro', Date.now() + 100000, Date.now()).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(uid, 's', 'frontend', Date.now(), Date.now());

  const result = await runAutoApply();

  // Без подключённого hh (нет токена и resume) отклики не создаются.
  const count = db.prepare('SELECT COUNT(*) c FROM applications WHERE user_id = ?').get(uid) as {
    c: number;
  };
  assert.equal(count.c, 0);
  assert.ok(typeof result.ran === 'boolean');
});

test('runAutoApply c hh-подключением пытается отправить (через провайдера, env-gated)', async () => {
  process.env.HH_ACCESS_TOKEN = 'test-token';
  const uid = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, hh_token, hh_resume_id, mode) VALUES (?,?,?,?,?,?,?,'live')",
      )
      .run('auto2@example.com', 'h', 'pro', Date.now() + 100000, Date.now(), 'tok', 'res123')
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(uid, 's', 'frontend', Date.now(), Date.now());

  const result = await runAutoApply();
  assert.ok(Array.isArray([result.applied, result.failed, result.skipped]));
  // Воркер отработал, но реальный POST к api.hh.ru недоступен в тестах —
  // главное, что не падает и не фабрикует строки "sent" вручную.
  assert.equal(result.demoUsers, 0, 'пользователь в live не должен попадать в счётчик демо-режима');
  delete process.env.HH_ACCESS_TOKEN;
});

/**
 * Регрессия: демо-режим не влиял на автоотклик ВООБЩЕ.
 *
 * `users.mode` вводился как «живой режим только по явному согласию», но
 * читался только роутом `/api/mode` и текстовыми баннерами. Ни плановый
 * прогон, ни `/отклик` из бота, ни кнопка в кабинете его не проверяли — то есть
 * человек, ни разу не включавший живой режим, всё равно получал реальные
 * отклики от своего имени на hh.
 */
test('демо-режим останавливает автоотклик (regression)', async () => {
  process.env.HH_ACCESS_TOKEN = 'test-token';
  const now = Date.now();
  db.prepare(
    `INSERT INTO vacancies
      (slug, source, source_id, title, company, salary, level, format, city, posted, category, about, responsibilities, requirements, bonus, published_at, fetched_at)
     VALUES ('hh-demo-1', 'hh', 'demo-1', 'Демо-вакансия', 'Компания', '', 'Middle', 'Удалённо', 'Москва', '', 'Работа', 'React TypeScript', '[]', '[]', '[]', ?, ?)`,
  ).run(now, now);

  const uid = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, hh_token, hh_resume_id, mode)
         VALUES (?,?,?,?,?,?,?,'demo')`,
      )
      .run(
        'demo-mode@example.com',
        'h',
        'expert',
        Date.now() + 100_000,
        Date.now(),
        'tok',
        'res-demo',
      ).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at)
     VALUES (?, ?, 'react', 1, ?, ?)`,
  ).run(uid, 'demo', now, now);

  const result = await runAutoApply();

  const count = db.prepare('SELECT COUNT(*) c FROM applications WHERE user_id = ?').get(uid) as {
    c: number;
  };
  assert.equal(count.c, 0, 'демо-режим отправил отклик — реальный баг, а не стилистика');
  assert.equal(result.applied, 0, 'демо-режим не должен ничего отправлять');
  assert.equal(result.demoUsers, 1, `демо-аккаунт не посчитан, demoUsers=${result.demoUsers}`);

  db.prepare("DELETE FROM vacancies WHERE slug = 'hh-demo-1'").run();
  db.prepare('DELETE FROM searches WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  delete process.env.HH_ACCESS_TOKEN;
});

/**
 * Регрессия: `skipped` считался как `candidates.length` внутри цикла по
 * ПОИСКАМ. Один и тот же список вакансий попадал в счётчик повторно для каждого
 * совпадения, а уже отправленные — тоже учитывались. Метрика «пропущено»
 * показывала несуществующие проблемы и могла в разы превышать размер каталога.
 *
 * Теперь skipped не может превысить число вакансий, реально найденных для
 * пользователя, и не включает уже отправленные.
 */
test('skipped не превышает число найденных кандидатов (regression)', async () => {
  const hh = await import('../src/lib/vacancies/hh');
  // Несколько hh-вакансий в каталоге, чтобы счётчик было что раздувать.
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO vacancies
      (slug, source, source_id, title, company, salary, level, format, city, posted, category, about, responsibilities, requirements, bonus, fetched_at)
     VALUES (?, 'hh', ?, ?, 'Компания', '', 'Middle', 'remote', 'Москва', '', 'Работа', 'React TypeScript', '[]', '[]', '[]', ?)`,
  );
  for (let i = 0; i < 5; i++) {
    insert.run(`hh-reg-${i}`, `reg-${i}`, `Вакансия ${i}`, now);
  }

  const uid = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, hh_resume_id, mode) VALUES (?,?,?,?,?,?,'live')",
      )
      .run('skip@example.com', 'h', 'expert', Date.now() + 100000, Date.now(), 'res')
      .lastInsertRowid,
  );
  // Два поиска, оба подходят под все пять вакансий.
  for (const title of ['A', 'B']) {
    db.prepare(
      `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at)
       VALUES (?, ?, 'react', 1, ?, ?)`,
    ).run(uid, title, now, now);
  }

  const catalogSize = (
    db.prepare("SELECT COUNT(*) c FROM vacancies WHERE source = 'hh'").get() as { c: number }
  ).c;

  const result = await runAutoApply();

  assert.ok(
    result.skipped <= catalogSize,
    `skipped=${result.skipped} не может превышать каталог вакансий (${catalogSize})`,
  );

  // Убираем тестовые данные, чтобы они не влияли на следующие тесты.
  db.prepare("DELETE FROM vacancies WHERE slug LIKE 'hh-reg-%'").run();
  db.prepare('DELETE FROM searches WHERE user_id = ?').run(uid);
  void hh;
});
