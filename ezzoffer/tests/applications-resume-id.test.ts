import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Что именно попадает в applications.resume_id.
 *
 * Колонка объявлена как идентификатор резюме НА hh (`resume_id TEXT`, миграция
 * `migrateApplicationsResumeId` переводила INTEGER → TEXT именно из-за этого).
 * Автоотклик писал туда hh-id. А ручной отклик из кабинета писал ЛОКАЛЬНЫЙ
 * `resumes.id` — число.
 *
 * Итог был не косметическим. Потребители колонки ищут по ней резюме так:
 *
 *     api/applications/[id]/interview : WHERE user_id = ? AND hh_id = ?
 *     lib/resume-variants             : JOIN resumes r ON r.hh_id = a.resume_id
 *
 * То есть они ждали hh-id, а ручные отклики клали туда номер. Сравнение
 * `hh_id = '7'` со строкой не находит ничего, и подготовка к собеседованию
 * молча уходила на «последнее обновлённое резюме». А `hh_id = 7` — хуже:
 * сравнение строки с числом в SQLite приводит число к строке, и если у человека
 * есть резюме с числовым hh-id, совпавшим с чужим локальным номером,
 * подготовка строилась по ЧУЖОМУ резюме.
 *
 * Проверяется поведение, а не вид исходника: роут вызывается по-настоящему,
 * подменяется только сессия.
 */

let appDb: import('better-sqlite3').Database;
let loginAs: (o?: Partial<import('../src/lib/db').User>) => import('../src/lib/db').User;

before(async () => {
  const { useInMemoryDb, loginAs: la } = await import('./helpers/route-session');
  useInMemoryDb();
  loginAs = la as typeof loginAs;
  appDb = (await import('../src/lib/db')).db;
});

function seedUser(over: Partial<import('../src/lib/db').User> = {}): number {
  // Сначала чистим зависимые таблицы: SQLite с включёнными внешними ключами
  // не даст удалить пользователя, на которого ссылаются резюме и отклики.
  for (const t of [
    'applications',
    'resumes',
    'letters',
    'searches',
    'bookmarks',
    'consultations',
    'sessions',
    'oauth_states',
    'telegram_codes',
  ]) {
    try {
      appDb.prepare(`DELETE FROM ${t}`).run();
    } catch {
      // Таблицы может не быть на старой схеме — чистить тогда нечего.
    }
  }
  try {
    appDb.prepare('DELETE FROM users').run();
  } catch {
    // Нечего чистить.
  }
  const base = {
    email: `r${Math.random().toString(36).slice(2, 8)}@test.test`,
    password_hash: 'h',
    plan: 'pro',
    plan_expires_at: Date.now() + 86_400_000,
    created_at: Date.now(),
    email_verified: 1,
    mode: 'live',
    ...over,
  };
  const cols = Object.keys(base).join(', ');
  const marks = Object.keys(base)
    .map(() => '?')
    .join(', ');
  return Number(
    appDb.prepare(`INSERT INTO users (${cols}) VALUES (${marks})`).run(...Object.values(base))
      .lastInsertRowid,
  );
}

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

function seedResume(userId: number, title: string, hhId: string | null, updatedAt: number): number {
  return Number(
    appDb
      .prepare(
        `INSERT INTO resumes (user_id, title, content, years_label, ai_improved, hh_id, created_at, updated_at)
         VALUES (?, ?, 'Содержание резюме', '', 0, ?, ?, ?)`,
      )
      .run(userId, title, hhId, updatedAt, updatedAt).lastInsertRowid,
  );
}

function lastApplication(): { resume_id: string | null } {
  return appDb.prepare('SELECT resume_id FROM applications ORDER BY id DESC LIMIT 1').get() as {
    resume_id: string | null;
  };
}

test('выбранное резюме пишется его hh-идентификатором, а не локальным номером', async () => {
  const userId = seedUser();
  // Два резюме: выбранное — первое, у него hh-id "555".
  seedResume(userId, 'Первое', '555', 1_000);
  seedResume(userId, 'Второе', '666', 2_000);
  seedVacancy('hh-resume-id-1', 'trudvsem');
  loginAs({ id: userId });

  const { POST } = await import('../src/app/api/applications/route');
  const { post } = await import('./helpers/route-session');
  const res = await POST(post({ jobSlug: 'hh-resume-id-1', resumeId: 1 }));
  assert.equal(res.status, 201, `ожидался 201: ${await res.text()}`);

  const row = lastApplication();
  /*
   * Раньше здесь записывался `resumeRow.id`. Проверка именно на строку "555",
   * а не на "не число": колонка TEXT, и локальный номер 1 внешне выглядел бы
   * как нечто осмысленное — пока сравнение с hh_id не нашло бы нужную строку.
   */
  assert.equal(
    row.resume_id,
    '555',
    'в applications.resume_id должен лежать hh-id выбранного резюме',
  );
});

test('выбранное резюме без привязки к hh даёт общее подключение аккаунта', async () => {
  /*
   * Откат на общее подключение живёт только в hh-ветке маршрута: отправить
   * можно лишь идентификатор hh, а для внешних площадок отправки нет вообще.
   * Поэтому здесь настоящая hh-вакансия и перехват сети по образцу
   * account-blocked.test.ts: httpFetch читает res.text(), а не res.json().
   */
  const userId = seedUser({
    hh_token: 'tok',
    hh_token_expires_at: Date.now() + 3_600_000,
    hh_resume_id: 'acc-777',
  });
  seedResume(userId, 'Ручное', null, 1_000);
  seedVacancy('hh-1001', 'hh');
  loginAs({ id: userId });

  const saved = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/negotiations')) {
      return { ok: true, status: 201, text: async () => '' } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  try {
    const { POST } = await import('../src/app/api/applications/route');
    const { post } = await import('./helpers/route-session');
    const res = await POST(post({ jobSlug: 'hh-1001' }));
    assert.equal(res.status, 201, `ожидался 201: ${await res.text()}`);
  } finally {
    globalThis.fetch = saved;
  }

  assert.equal(
    lastApplication().resume_id,
    'acc-777',
    'без привязки резюме должен использоваться общий hh_resume_id аккаунта',
  );
});

test('без резюме и без общего подключения в записи остаётся пусто', async () => {
  const userId = seedUser({ hh_resume_id: null });
  seedVacancy('hh-resume-id-3', 'trudvsem');
  loginAs({ id: userId });

  const { POST } = await import('../src/app/api/applications/route');
  const { post } = await import('./helpers/route-session');
  const res = await POST(post({ jobSlug: 'hh-resume-id-3' }));
  assert.equal(res.status, 201, `ожидался 201: ${await res.text()}`);

  assert.equal(
    lastApplication().resume_id,
    null,
    'выдумывать идентификатор резюме нельзя — в истории должно быть пусто',
  );
});
