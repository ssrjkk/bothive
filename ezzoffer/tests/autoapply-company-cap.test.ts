import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Потолок на компанию за день.
 *
 * Без него бывает так: активный поиск по фронтенду, у компании двадцать
 * подходящих вакансий — и двадцать откликов в неё за день. Работодатель видит
 * это в ленте, площадка считает аномалией, и под удар попадает аккаунт
 * человека, а не абстрактный бот.
 *
 * Первая версия читала колонку `company` прямо из `applications`, которой там
 * нет. `tsc` ошибку не видел: это запрос к базе, а не тип, он падал бы в
 * рантайме на первом же прогоне. Компания берётся join'ом с каталогом.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let autoapply: typeof import('../src/lib/autoapply');
let resetCatalogCache: () => void;
let resetPacing: () => void;

const FAST_PACING = {
  pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
  now: () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  },
};

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  process.env.AUTOAPPLY_WORK_START = '0';
  process.env.AUTOAPPLY_WORK_END = '24';
  db = (await import('../src/lib/db')).db;
  autoapply = await import('../src/lib/autoapply');
  resetCatalogCache = (await import('../src/lib/vacancies')).resetCatalogCache;
  resetPacing = (await import('../src/lib/autoapply')).resetPacing;

  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'user-token', expires_in: 3600 }),
      } as unknown as Response;
    }
    if (u.includes('/negotiations')) {
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
});

beforeEach(() => {
  db.exec(
    'DELETE FROM bookmarks; DELETE FROM applications; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM vacancies;',
  );
  resetCatalogCache();
  resetPacing();
});

function seedUser(): void {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, hh_token,
       hh_resume_id, telegram_chat_id, autoapply_paused, autoapply_blocked_until, autoapply_block_reason, mode)
     VALUES (1, 'u@example.test', 'h', 'pro', ?, ?, 'user-token', 'res123', '777', 0, 0, '', 'live')`,
  ).run(Date.now() + 100_000, Date.now());
  db.prepare(
    `INSERT INTO resumes (user_id, title, content, hh_id, created_at, updated_at)
     VALUES (1, 'Frontend', 'React', 'hh-front', ?, ?)`,
  ).run(Date.now(), Date.now());
  db.prepare(
    "INSERT INTO searches (user_id, title, keywords, active, started_at, created_at) VALUES (1, 's', 'react', 1, ?, ?)",
  ).run(Date.now(), Date.now());
}

function seedVacancy(slug: string, title: string, company: string): void {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
       posted, published_at, category, about, requirements, fetched_at)
     VALUES (?, 'hh', ?, ?, ?, '200000', 'Middle', 'Удалённо', 'Москва',
       'сегодня', ?, 'Разработка', 'Требуются: React', '["React"]', ?)`,
  ).run(slug, slug, title, company, Date.now(), Date.now());
}

test('в одну компанию уходит не больше потолка за день', async () => {
  seedUser();
  for (let i = 0; i < 9; i++) seedVacancy(`hh-mono-${i}`, `React-разработчик ${i}`, 'Авито');
  seedVacancy('hh-other', 'React-разработчик в другой', 'Яндекс');

  const saved = process.env.AUTOAPPLY_PER_COMPANY;
  process.env.AUTOAPPLY_PER_COMPANY = '2';
  let run: Awaited<ReturnType<typeof autoapply.runAutoApply>> | null = null;
  try {
    run = await autoapply.runAutoApply(FAST_PACING);
  } finally {
    if (saved === undefined) delete process.env.AUTOAPPLY_PER_COMPANY;
    else process.env.AUTOAPPLY_PER_COMPANY = saved;
  }

  const rows = db.prepare('SELECT job_slug FROM applications WHERE user_id = 1').all() as {
    job_slug: string;
  }[];
  const avito = rows.filter((r) => r.job_slug.startsWith('hh-mono')).length;
  const other = rows.filter((r) => r.job_slug === 'hh-other').length;

  assert.equal(avito, 2, `в Авито ушло ${avito} откликов при потолке 2`);
  assert.equal(other, 1, 'вакансия другой компании пропущена вместе с ограничением по первой');
  assert.ok((run?.applied ?? 0) >= 2, `прогон ничего не отправил: ${JSON.stringify(run)}`);
});

test('потолок настраивается, а ноль означает «не ограничивать»', async () => {
  seedUser();
  /*
   * Семь вакансий, а не три: потолок по умолчанию четыре, и при трёх вакансиях
   * «потолок выключен» и «потолок четыре» дают одинаковый результат. Проверка
   * проходила и с неработающим разбором нуля.
   */
  for (let i = 0; i < 7; i++) seedVacancy(`hh-free-${i}`, `React-разработчик ${i}`, 'Авито');

  const saved = process.env.AUTOAPPLY_PER_COMPANY;
  process.env.AUTOAPPLY_PER_COMPANY = '0';
  try {
    await autoapply.runAutoApply(FAST_PACING);
  } finally {
    if (saved === undefined) delete process.env.AUTOAPPLY_PER_COMPANY;
    else process.env.AUTOAPPLY_PER_COMPANY = saved;
  }

  const n = (
    db.prepare('SELECT COUNT(*) AS c FROM applications WHERE user_id = 1').get() as { c: number }
  ).c;
  assert.equal(
    n,
    7,
    `при выключенном потолке ушло ${n} откликов из 7 — ноль трактуется как «не ограничивать»`,
  );
});

test('мусор в потолке не ломает прогон', async () => {
  seedUser();
  seedVacancy('hh-junk', 'React-разработчик', 'Авито');

  const saved = process.env.AUTOAPPLY_PER_COMPANY;
  for (const junk of ['', '  ', 'abc', '-3']) {
    process.env.AUTOAPPLY_PER_COMPANY = junk;
    const result = await autoapply.runAutoApply(FAST_PACING);
    assert.ok(result.ran, `при значении «${junk}» прогон не пошёл`);
  }

  if (saved === undefined) delete process.env.AUTOAPPLY_PER_COMPANY;
  else process.env.AUTOAPPLY_PER_COMPANY = saved;
});
