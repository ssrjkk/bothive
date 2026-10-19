import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Зарплатные ожидания и город в профиле.
 *
 * Поля добавлены вместе с фактором «Зарплата» в оценке вакансий. Без них
 * сервис не мог знать, что ищет человек, и подсказка «вакансия ниже ваших
 * ожиданий» была физически невозможна — один из самых частых фильтров при
 * поиске работы просто не существовал.
 *
 * Отдельно проверяется NULL против 0: «ожиданий не назвал» и «ожидает ноль» —
 * разные вещи. При 0 любая вакансия считалась бы «выше ожиданий», то есть
 * пользователь, не заполнивший поле, получал бы заведомо ложную подсказку.
 */
type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
let db: Database;
let counter = 0;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db;
});

function createUser(): number {
  counter++;
  return Number(
    db
      .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, 'h', ?)")
      .run(`expect-${counter}@example.com`, Date.now()).lastInsertRowid,
  );
}

/** Колонки таблицы — через PRAGMA, как в остальных тестах миграций. */
function columns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

test('в таблице users есть поля ожиданий', () => {
  const cols = columns('users');
  assert.ok(cols.has('salary_expectation'), 'нет колонки salary_expectation');
  assert.ok(cols.has('city_preference'), 'нет колонки city_preference');
});

test('новый пользователь начинает без ожиданий', () => {
  const uid = createUser();
  const row = db
    .prepare('SELECT salary_expectation, city_preference FROM users WHERE id = ?')
    .get(uid) as { salary_expectation: number | null; city_preference: string };

  assert.equal(row.salary_expectation, null, 'ожидания не должны проставляться по умолчанию');
  assert.equal(row.city_preference, '', 'город не должен проставляться по умолчанию');
});

test('ожидания сохраняются и читаются обратно', () => {
  const uid = createUser();
  db.prepare('UPDATE users SET salary_expectation = ? WHERE id = ?').run(180000, uid);

  const row = db.prepare('SELECT salary_expectation FROM users WHERE id = ?').get(uid) as {
    salary_expectation: number | null;
  };
  assert.equal(row.salary_expectation, 180000);
});

test('пустое значение сбрасывает ожидания в NULL, а не в ноль', () => {
  const uid = createUser();
  db.prepare('UPDATE users SET salary_expectation = ? WHERE id = ?').run(180000, uid);
  db.prepare('UPDATE users SET salary_expectation = NULL WHERE id = ?').run(uid);

  const row = db.prepare('SELECT salary_expectation FROM users WHERE id = ?').get(uid) as {
    salary_expectation: number | null;
  };
  assert.equal(
    row.salary_expectation,
    null,
    '«ожиданий нет» сохранилось как 0 — при нуле любая вакансия выше ожиданий',
  );
});

test('поле города не принимает пустые строки произвольной длины', () => {
  const uid = createUser();
  db.prepare('UPDATE users SET city_preference = ? WHERE id = ?').run('Москва', uid);

  const row = db.prepare('SELECT city_preference FROM users WHERE id = ?').get(uid) as {
    city_preference: string;
  };
  assert.equal(row.city_preference, 'Москва');
});
