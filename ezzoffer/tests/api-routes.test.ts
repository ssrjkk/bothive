import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { loginAs, logout, post, write, readJson, useInMemoryDb } from './helpers/route-session';

/**
 * Тесты API-роутов кабинета: авторизация, валидация и — главное — изоляция
 * данных между пользователями (IDOR).
 *
 * Раньше роуты проверялись только косвенно: логика проверки владения
 * ресурсом (WHERE id = ? AND user_id = ?) не имела ни одного теста, хотя именно
 * она защищает резюме, письма и автопоиски от чужих пользователей. Здесь каждый
 * такой случай закрыт явно.
 */

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  useInMemoryDb();
  db = (await import('../src/lib/db')).db;
});

beforeEach(() => {
  for (const table of ['resumes', 'letters', 'searches', 'applications', 'users']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  loginAs();
});

function makeUser(id: number, email: string): void {
  db.prepare(
    'INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified) VALUES (?,?,?,?,?,?,1)',
  ).run(id, email, 'h', 'pro', Date.now() + 86_400_000, Date.now());
}

/** Резюме, принадлежащее userId. */
function makeResume(userId: number, title = 'Резюме'): number {
  return Number(
    db
      .prepare(
        'INSERT INTO resumes (user_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)',
      )
      .run(userId, title, 'Опыт работы\n- React', Date.now(), Date.now()).lastInsertRowid,
  );
}

/** Письмо, принадлежащее userId. */
function makeLetter(userId: number, title = 'Письмо'): number {
  return Number(
    db
      .prepare(
        'INSERT INTO letters (user_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)',
      )
      .run(userId, title, 'Здравствуйте', Date.now(), Date.now()).lastInsertRowid,
  );
}

// ---------------------------------------------------------------- auth guards

test('GET /api/resumes без сессии → 401', async () => {
  logout();
  const { GET } = await import('../src/app/api/resumes/route');
  assert.equal((await GET()).status, 401);
});

/*
 * Регрессия: улучшение резюме не проверяло тариф.
 *
 * Вызов уходит во внешний ИИ за ключ владельца: каждый запрос стоит денег.
 * Без гейта любой зарегистрированный выжигал бы ключ в цикле, а rate-limit
 * лишь растягивал бы это во времени.
 */
test('POST /api/resumes/[id]/improve без тарифа → 402', async () => {
  makeUser(41, 'noplan@example.test');
  db.prepare("UPDATE users SET plan = 'none', plan_expires_at = NULL WHERE id = 41").run();
  const rid = makeResume(41);
  loginAs({ id: 41 });

  const { POST } = await import('../src/app/api/resumes/[id]/improve/route');
  const res = await POST({} as never, { params: Promise.resolve({ id: String(rid) }) });
  assert.equal(
    res.status,
    402,
    `улучшение без тарифа обязано требовать оплату, а не работать: ${res.status}`,
  );
});

test('POST /api/resumes/[id]/improve с тарифом работает', async () => {
  makeUser(42, 'plan@example.test');
  const rid = makeResume(42);
  loginAs({ id: 42 });

  const { POST } = await import('../src/app/api/resumes/[id]/improve/route');
  const res = await POST({} as never, { params: Promise.resolve({ id: String(rid) }) });
  assert.equal(res.status, 200, `улучшение с тарифом: ${res.status}`);
});

test('GET /api/letters без сессии → 401', async () => {
  logout();
  const { GET } = await import('../src/app/api/letters/route');
  assert.equal((await GET()).status, 401);
});

test('GET /api/applications без сессии → 401', async () => {
  logout();
  const { GET } = await import('../src/app/api/applications/route');
  const res = await GET(new Request('http://localhost/api/applications'));
  assert.equal(res.status, 401);
});

test('GET /api/searches без сессии → 401', async () => {
  logout();
  const { GET } = await import('../src/app/api/searches/route');
  assert.equal((await GET()).status, 401);
});

test('GET /api/stats без сессии → 401', async () => {
  logout();
  const { GET } = await import('../src/app/api/stats/route');
  assert.equal((await GET()).status, 401);
});

// ------------------------------------------------------------------- resumes

test('POST /api/resumes сохраняет резюме текущего пользователя', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/resumes/route');
  const res = await POST(post({ title: 'Frontend', content: 'React, TypeScript' }));
  assert.equal(res.status, 201);

  const row = db.prepare('SELECT * FROM resumes').get() as { user_id: number; title: string };
  assert.equal(row.user_id, 1);
  assert.equal(row.title, 'Frontend');
});

test('POST /api/resumes обрезает слишком длинные поля', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/resumes/route');
  await POST(post({ title: 'T'.repeat(500), content: 'C'.repeat(50_000) }));

  const row = db.prepare('SELECT * FROM resumes').get() as { title: string; content: string };
  assert.equal(row.title.length, 100);
  assert.equal(row.content.length, 20_000);
});

test('POST /api/resumes отклоняет пустое содержимое', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/resumes/route');
  assert.equal((await POST(post({ title: '', content: '' }))).status, 400);
  assert.equal((await POST(post({}))).status, 400);
});

/**
 * Повторный импорт одного резюме с hh обновляет, а не плодит дубли.
 *
 * Уникальный индекс (user_id, hh_id) нужен, чтобы в подборе не появлялись два
 * одинаковых кандидата. Но без обработки дубля API отвечал бы 500 на совершенно
 * обычное действие — человек перезалил резюме на hh и хочет обновить копию у
 * нас. Такой ответ невыносим и выглядит как поломка.
 */
test('повторный импорт с hh обновляет существующее резюме', async () => {
  makeUser(1, 'me@example.test');
  // Токен задаётся в заглушке сессии: requireUser возвращает её, а не строку из БД.
  loginAs({ hh_token: 't', hh_token_expires_at: Date.now() + 3_600_000 });

  const net = stubHhResume('hh-resume-1');
  try {
    const { POST } = await import('../src/app/api/resumes/route');

    const first = await POST(post({ fromHh: 'hh-resume-1' }));
    assert.equal(first.status, 201, `первый импорт не создал резюме: ${first.status}`);

    net.setText('Вторая версия резюме с hh, обновлено');
    const second = await POST(post({ fromHh: 'hh-resume-1' }));

    assert.equal(second.status, 200, `повторный импорт вернул ${second.status} вместо обновления`);
    const rows = db.prepare('SELECT * FROM resumes WHERE user_id = 1').all() as {
      hh_id: string;
      content: string;
    }[];
    assert.equal(rows.length, 1, `повторный импорт создал дубль: ${rows.length} записей`);
    assert.equal(rows[0]!.hh_id, 'hh-resume-1');
    assert.match(rows[0]!.content, /Вторая версия/, 'повторный импорт не обновил содержимое');
  } finally {
    net.restore();
  }
});

test('привязка к hh сохраняется при импорте', async () => {
  makeUser(1, 'me@example.test');
  // Токен задаётся в заглушке сессии: requireUser возвращает её, а не строку из БД.
  loginAs({ hh_token: 't', hh_token_expires_at: Date.now() + 3_600_000 });

  const net = stubHhResume('hh-abc-123');
  try {
    const { POST } = await import('../src/app/api/resumes/route');
    const res = await POST(post({ fromHh: 'hh-abc-123' }));
    assert.equal(res.status, 201);

    const row = db.prepare('SELECT hh_id FROM resumes WHERE user_id = 1').get() as {
      hh_id: string;
    };
    assert.equal(row.hh_id, 'hh-abc-123', 'id резюме hh не сохранён — отклик уйдёт с чужим резюме');
  } finally {
    net.restore();
  }
});

/**
 * Подготовка к собеседованию берёт то резюме, что ушло в отклик.
 *
 * Найденный баг. В applications.resume_id лежит идентификатор резюме на hh —
 * строка, потому что именно она уходит в POST /negotiations. Маршрут искал
 * `SELECT * FROM resumes WHERE id = ?`, то есть по локальному автоинкременту.
 * Для обычного hh-id вроде «a1b2c3» сравнение молча не находит ничего и
 * подготовка строится ни на чём; для числового вроде «123» — находит, и это
 * хуже: вернётся другое резюме той же учётной записи, то есть подготовка к
 * вакансии фронтенда напишется по резюме про бэкенд.
 *
 * Здесь hh-id намеренно числовой — именно этот случай проходит молча.
 */
test('подготовка к собеседованию берёт отправленное резюме, а не любое', async () => {
  makeUser(1, 'me@example.test');
  const now = Date.now();

  /*
   * Ключевая деталь: hh_id = '7', а локальные id 1 и 2.
   *
   * Если бы hh_id совпадал с каким-нибудь resumes.id, старый запрос вернул бы
   * правильное резюме по счастливому совпадению — и тест прошёл бы при
   * сломанном коде. Здесь номера 7 в таблице нет, поэтому старый запрос
   * `id = '7'` ничего не находит и скатывается на «последнее обновлённое».
   * А последним обновлённым специально сделано БЭКЕНД-резюме.
   */
  db.prepare(
    `INSERT INTO resumes (id, user_id, title, content, years_label, ai_improved, hh_id, created_at, updated_at)
     VALUES (1, 1, 'Frontend', 'React, TypeScript, Next.js, Redux, Vite', '', 0, '7', ?, ?)`,
  ).run(now - 60_000, now - 60_000);
  db.prepare(
    `INSERT INTO resumes (id, user_id, title, content, years_label, ai_improved, hh_id, created_at, updated_at)
     VALUES (2, 1, 'Backend', 'Python, Django, PostgreSQL, микросервисы, Redis', '', 0, NULL, ?, ?)`,
  ).run(now, now);

  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, salary_min, salary_max,
       level, format, city, posted, published_at, category, about, responsibilities, requirements, bonus,
       contact_email, contact_phone, fetched_at)
     VALUES ('hh-itv', 'hh', 'itv', 'React-разработчик', 'Тест', '', NULL, NULL,
       'Middle', 'Удалённо', 'Москва', 'сегодня', ?, 'Разработка', 'Требуются: React, TypeScript, Next.js',
       '[]', '["React","TypeScript","Next.js"]', '[]', NULL, NULL, ?)`,
  ).run(now - 3_600_000, now);

  const appId = Number(
    db
      .prepare(
        `INSERT INTO applications (user_id, job_slug, resume_id, status, sent_at) VALUES (1, 'hh-itv', '7', 'sent', ?)`,
      )
      .run(now).lastInsertRowid,
  );

  const { GET } = await import('../src/app/api/applications/[id]/interview/route');
  const res = await GET({} as never, { params: Promise.resolve({ id: String(appId) }) });
  assert.equal(res.status, 200, `маршрут вернул ${res.status}`);

  const data = (await res.json()) as { brief: { matched: string[]; missing: string[] } };
  /*
   * Проверяется brief, а не questions.
   *
   * Вопросы prepareInterview строятся вокруг самой вакансии и от резюме почти
   * не зависят, поэтому различать два резюме по ним бесполезно. А brief — это
   * разбор «ваше резюме против этой вакансии», и он обязан отличаться: с чужим
   * резюме в matched пусто, а весь перечень навыков уезжает в missing.
   */
  assert.ok(
    data.brief.matched.includes('React'),
    `подготовка построена не по отправленному резюме: matched=${JSON.stringify(data.brief.matched)}`,
  );
  assert.deepEqual(
    data.brief.missing,
    [],
    `в пробелы ушли навыки вакансии, то есть резюме чужое: ${JSON.stringify(data.brief.missing)}`,
  );
});

/**
 * Заглушка чтения резюме с hh через перехват сети.
 *
 * Пробовать подменить экспорт модуля бесполезно: ESM-модуль отдаёт свойства
 * только через геттеры, и присваивание падает. Поэтому перехватывается fetch —
 * это та же точка, где в остальных тестах.
 */
function stubHhResume(id: string): { setText: (t: string) => void; restore: () => void } {
  const saved = globalThis.fetch;
  let text = 'Первая версия резюме с hh';
  const json = (value: unknown) =>
    ({ ok: true, status: 200, json: async () => value }) as unknown as Response;

  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    /*
     * Именно json, а не text: hh-resumes читает res.json(), в отличие от
     * httpFetch в остальных тестах. Заглушка с одним text проходила мимо этой
     * ветки и давала 502 на нормальный импорт.
     */
    if (u.includes('/token')) return json({ access_token: 't', expires_in: 3600 });
    if (u.includes(`/resumes/${id}`)) {
      return json({
        id,
        title: 'Из hh',
        blocks: [{ name: 'О себе', paragraphs: [{ text }] }],
      });
    }
    return json({});
  }) as typeof globalThis.fetch;

  return {
    setText: (t: string) => {
      text = t;
    },
    restore: () => {
      globalThis.fetch = saved;
    },
  };
}

test('чужое резюме нельзя изменить (IDOR)', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  const foreignId = makeResume(2, 'Чужое резюме');

  const { PUT, DELETE } = await import('../src/app/api/resumes/[id]/route');
  const ctx = { params: Promise.resolve({ id: String(foreignId) }) };

  assert.equal((await PUT(post({ title: 'Взлом', content: 'Взлом' }), ctx)).status, 404);
  assert.equal((await DELETE(new Request('http://x'), ctx)).status, 404);

  // Запись не изменилась и не удалена.
  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(foreignId) as { title: string };
  assert.equal(row.title, 'Чужое резюме');
});

test('своё резюме можно изменить и удалить', async () => {
  makeUser(1, 'me@example.test');
  const ownId = makeResume(1, 'Моё');

  const { PUT, DELETE } = await import('../src/app/api/resumes/[id]/route');
  const ctx = { params: Promise.resolve({ id: String(ownId) }) };

  assert.equal((await PUT(post({ title: 'Новое', content: 'Новый текст' }), ctx)).status, 200);
  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(ownId) as { title: string };
  assert.equal(row.title, 'Новое');

  assert.equal((await DELETE(new Request('http://x'), ctx)).status, 200);
  assert.equal(
    (db.prepare('SELECT COUNT(*) c FROM resumes WHERE id = ?').get(ownId) as { c: number }).c,
    0,
  );
});

test('некорректный id резюме отклоняется до обращения к БД', async () => {
  const { PUT } = await import('../src/app/api/resumes/[id]/route');
  for (const bad of ['abc', '0', '-1', '1.5', '']) {
    const ctx = { params: Promise.resolve({ id: bad }) };
    assert.equal((await PUT(post({ title: 'x', content: 'y' }), ctx)).status, 400, `id=${bad}`);
  }
});

test('GET /api/resumes показывает только свои резюме', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  makeResume(1, 'Моё');
  makeResume(2, 'Чужое');

  const { GET } = await import('../src/app/api/resumes/route');
  const body = (await (await GET()).json()) as { resumes: { user_id: number }[] };
  assert.equal(body.resumes.length, 1);
  assert.equal(body.resumes[0]?.user_id, 1);
});

// ------------------------------------------------------------------- letters

test('чужое письмо нельзя изменить (IDOR)', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  const foreignId = makeLetter(2, 'Чужое письмо');

  const { PUT, DELETE } = await import('../src/app/api/letters/[id]/route');
  const ctx = { params: Promise.resolve({ id: String(foreignId) }) };

  assert.equal((await PUT(post({ title: 'Взлом', content: 'Взлом' }), ctx)).status, 404);
  assert.equal((await DELETE(new Request('http://x'), ctx)).status, 404);

  const row = db.prepare('SELECT * FROM letters WHERE id = ?').get(foreignId) as { title: string };
  assert.equal(row.title, 'Чужое письмо');
});

test('POST /api/letters обрезает и проверяет поля', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/letters/route');
  assert.equal((await POST(post({ title: '', content: 'x' }))).status, 400);

  await POST(post({ title: 'T'.repeat(300), content: 'C'.repeat(30_000) }));
  const row = db.prepare('SELECT * FROM letters').get() as { title: string; content: string };
  assert.equal(row.title.length, 100);
  assert.equal(row.content.length, 20_000);
});

// ------------------------------------------------------------------ searches

test('чужой автопоиск нельзя изменить (IDOR)', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  const foreignId = Number(
    db
      .prepare(
        'INSERT INTO searches (user_id, title, keywords, active, created_at) VALUES (?,?,?,0,?)',
      )
      .run(2, 'Чужой поиск', 'react', Date.now()).lastInsertRowid,
  );

  const { PUT, DELETE } = await import('../src/app/api/searches/[id]/route');
  const ctx = { params: Promise.resolve({ id: String(foreignId) }) };

  assert.equal((await PUT(write('PUT', { active: true }), ctx)).status, 404);
  assert.equal((await DELETE(new Request('http://x'), ctx)).status, 404);

  const row = db.prepare('SELECT * FROM searches WHERE id = ?').get(foreignId) as {
    active: number;
  };
  assert.equal(row.active, 0, 'чужой поиск не должен активироваться');
});

test('POST /api/searches проверяет диапазон зарплаты', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/searches/route');
  const bad = await POST(post({ title: 'S', salary_min: 300_000, salary_max: 100_000 }));
  assert.equal(bad.status, 400);
  assert.match((await readJson(bad)).error ?? '', /зарплат/i);

  assert.equal(
    (await POST(post({ title: 'S', salary_min: 100_000, salary_max: 300_000 }))).status,
    201,
  );
});

test('POST /api/searches обрезает длинные строки', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/searches/route');
  await POST(post({ title: 'T'.repeat(300), keywords: 'K'.repeat(1000), city: 'C'.repeat(200) }));
  const row = db.prepare('SELECT * FROM searches').get() as {
    title: string;
    keywords: string;
    city: string;
  };
  assert.equal(row.title.length, 100);
  assert.equal(row.keywords.length, 400);
  assert.equal(row.city.length, 60);
});

// --------------------------------------------------------------- applications

test('PATCH /api/applications не меняет чужой отклик (IDOR)', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  const foreignId = Number(
    db
      .prepare('INSERT INTO applications (user_id, job_slug, status, sent_at) VALUES (?,?,?,?)')
      .run(2, 'slug-1', 'sent', Date.now()).lastInsertRowid,
  );

  const { PATCH } = await import('../src/app/api/applications/[id]/route');
  const ctx = { params: Promise.resolve({ id: String(foreignId) }) };
  const res = await PATCH(write('PATCH', { externalUrl: 'https://evil.example' }), ctx);
  assert.equal(res.status, 404);

  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(foreignId) as {
    external_url: string | null;
  };
  assert.equal(row.external_url, null);
});

test('PATCH /api/applications отклоняет не-http ссылку', async () => {
  makeUser(1, 'me@example.test');
  const ownId = Number(
    db
      .prepare('INSERT INTO applications (user_id, job_slug, status, sent_at) VALUES (?,?,?,?)')
      .run(1, 'slug-2', 'sent', Date.now()).lastInsertRowid,
  );

  const { PATCH } = await import('../src/app/api/applications/[id]/route');
  const ctx = { params: Promise.resolve({ id: String(ownId) }) };

  // javascript: попал бы в БД как href и выполнился бы по клику.
  const res = await PATCH(write('PATCH', { externalUrl: 'javascript:alert(1)' }), ctx);
  assert.equal(res.status, 400);

  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(ownId) as {
    external_url: string | null;
  };
  assert.equal(row.external_url, null);
});

test('DELETE /api/applications помечает отозванным, а не удаляет', async () => {
  makeUser(1, 'me@example.test');
  const ownId = Number(
    db
      .prepare('INSERT INTO applications (user_id, job_slug, status, sent_at) VALUES (?,?,?,?)')
      .run(1, 'slug-3', 'sent', Date.now()).lastInsertRowid,
  );

  const { DELETE } = await import('../src/app/api/applications/[id]/route');
  const ctx = { params: Promise.resolve({ id: String(ownId) }) };
  assert.equal((await DELETE(new Request('http://x'), ctx)).status, 200);

  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(ownId) as {
    withdrawn: number;
  };
  assert.equal(row.withdrawn, 1, 'строка должна сохраниться для статистики');
});

test('GET /api/applications уважает limit и не отдаёт чужие', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  for (let i = 0; i < 5; i++) {
    db.prepare(
      'INSERT INTO applications (user_id, job_slug, status, sent_at) VALUES (?,?,?,?)',
    ).run(1, `mine-${i}`, 'sent', Date.now() - i * 1000);
    db.prepare(
      'INSERT INTO applications (user_id, job_slug, status, sent_at) VALUES (?,?,?,?)',
    ).run(2, `theirs-${i}`, 'sent', Date.now() - i * 1000);
  }

  const { GET } = await import('../src/app/api/applications/route');
  const res = await GET(new Request('http://localhost/api/applications?limit=3'));
  const body = (await res.json()) as { applications: { job_slug: string }[] };

  assert.equal(body.applications.length, 3, 'limit должен применяться');
  assert.ok(
    body.applications.every((a) => a.job_slug.startsWith('mine-')),
    'чужие отклики не должны попадать в выдачу',
  );
});

// ------------------------------------------------------------------ plan/trial

test('POST /api/plan отклоняет неизвестный тариф и период', async () => {
  const { POST } = await import('../src/app/api/plan/route');
  assert.equal((await POST(post({ planId: 'gold', period: 14 }))).status, 400);
  assert.equal((await POST(post({ planId: 'pro', period: 999 }))).status, 400);
});

/**
 * Регрессия: `/api/plan` выдавал платный тариф бесплатно и безусловно.
 *
 * Роут проверял только `planId ∈ {start,pro,expert}` и `period ∈ {7,14,30}`,
 * после чего делал UPDATE `WHERE id = ?` без всякой оплаты. Любой
 * зарегистрировавшийся получал Expert (4 990 ₽/мес) и мог повторять запрос
 * каждые 30 дней. Тот же UPDATE сбрасывал срок действующего оплаченного
 * тарифа и понижал его до «Старта».
 */
test('POST /api/plan не выдаёт тариф без явного флага (regression)', async () => {
  const saved = process.env.DEMO_MODE_PLAN;
  delete process.env.DEMO_MODE_PLAN;
  try {
    makeUser(1, 'me@example.test');
    // makeUser ставит активный «pro» — нужен человек без тарифа, иначе проверка
    // уперлась бы в защиту действующего плана, а не в флаг.
    db.prepare("UPDATE users SET plan = 'none', plan_expires_at = NULL WHERE id = 1").run();
    loginAs({ id: 1, plan: 'none', plan_expires_at: null });
    const { POST } = await import('../src/app/api/plan/route');
    const res = await POST(post({ planId: 'expert', period: 30 }));
    assert.equal(res.status, 403, `без флага тариф выдан: ${await res.text()}`);
    const row = db.prepare('SELECT plan, plan_expires_at FROM users WHERE id = 1').get() as {
      plan: string;
      plan_expires_at: number | null;
    };
    assert.equal(row.plan, 'none', 'тариф записан вопреки отказу');
    assert.ok(!row.plan_expires_at, 'срок записан вопреки отказу');
  } finally {
    if (saved === undefined) delete process.env.DEMO_MODE_PLAN;
    else process.env.DEMO_MODE_PLAN = saved;
  }
});

test('POST /api/plan не сбрасывает действующий тариф даже во флаге (regression)', async () => {
  const saved = process.env.DEMO_MODE_PLAN;
  process.env.DEMO_MODE_PLAN = '1';
  try {
    const until = Date.now() + 20 * 86_400_000;
    makeUser(1, 'me@example.test');
    db.prepare("UPDATE users SET plan = 'expert', plan_expires_at = ? WHERE id = 1").run(until);
    loginAs({ id: 1, plan: 'expert', plan_expires_at: until });

    const { POST } = await import('../src/app/api/plan/route');
    // Понижение до «Старта» поверх оплаченного «Эксперта».
    const res = await POST(post({ planId: 'start', period: 30 }));
    assert.equal(res.status, 409, `действующий тариф должен быть защищён: ${await res.text()}`);

    const row = db.prepare('SELECT plan, plan_expires_at FROM users WHERE id = 1').get() as {
      plan: string;
      plan_expires_at: number | null;
    };
    assert.equal(row.plan, 'expert', 'оплаченный тариф понижен');
    assert.equal(row.plan_expires_at, until, 'срок оплаченного тарифа сдвинут');
  } finally {
    if (saved === undefined) delete process.env.DEMO_MODE_PLAN;
    else process.env.DEMO_MODE_PLAN = saved;
  }
});

test('POST /api/trial не выдаётся дважды', async () => {
  // Пробный период положен только тем, у кого нет платного тарифа.
  // Строка пользователя в БД обязательна: роут перечитывает её после записи,
  // а активность тарифа проверяет по БД, а не по снимку сессии.
  makeUser(1, 'me@example.test');
  db.prepare("UPDATE users SET plan = 'none', plan_expires_at = NULL WHERE id = 1").run();
  loginAs({ plan: 'none', trial_started_at: null });

  const { POST } = await import('../src/app/api/trial/route');
  const first = await POST();
  assert.equal(first.status, 200);

  // Второй раз — уже использованный пробный период.
  loginAs({ plan: 'none', trial_started_at: Date.now() });
  const second = await POST();
  assert.equal(second.status, 409);
});

test('POST /api/trial недоступен при активном платном тарифе', async () => {
  makeUser(1, 'me@example.test');
  loginAs({ plan: 'pro', trial_started_at: null });
  const { POST } = await import('../src/app/api/trial/route');
  const res = await POST();
  assert.equal(res.status, 409);
  assert.match((await readJson(res)).error ?? '', /тариф/i);
});

/**
 * Регрессия: роут брал строку пользователя как `as User` и сразу обращался
 * к полям. Если строки нет (аккаунт удалён или БД восстановлена из бэкапа
 * между проверкой сессии и записью), `updated.plan` кидал TypeError, и
 * клиент получал 500. Теперь это корректный 401 — сессия недействительна.
 */
test('исчезновение строки пользователя даёт 401, а не 500', async () => {
  loginAs({ plan: 'none', trial_started_at: null, id: 999 });
  db.prepare('DELETE FROM users WHERE id = 999').run();

  const { POST } = await import('../src/app/api/trial/route');
  const res = await POST();
  assert.equal(res.status, 401, `ожидался 401, получено ${res.status}`);
});

test('аналогично для /api/plan и /api/hh/status', async () => {
  loginAs({ id: 998 });
  db.prepare('DELETE FROM users WHERE id = 998').run();

  const plan = await import('../src/app/api/plan/route');
  const planRes = await plan.POST(post({ planId: 'pro', period: 14 }));
  assert.equal(planRes.status, 401);

  loginAs({ id: 998 });
  const hh = await import('../src/app/api/hh/status/route');
  const hhRes = await hh.GET();
  assert.equal(hhRes.status, 401);
});

// -------------------------------------------------------------------- profile

test('POST /api/plan требует авторизации', async () => {
  logout();
  const { POST } = await import('../src/app/api/plan/route');
  assert.equal((await POST(post({ planId: 'pro', period: 14 }))).status, 401);
});

test('PUT /api/profile требует текущий пароль для смены email', async () => {
  makeUser(1, 'me@example.test');
  const { PUT } = await import('../src/app/api/profile/route');

  // Без пароля — отказ.
  const noPass = await PUT(write('PUT', { email: 'new@example.test' }));
  assert.equal(noPass.status, 403);

  // С паролем — email занят другим аккаунтом.
  makeUser(2, 'taken@example.test');
  const taken = await PUT(write('PUT', { email: 'taken@example.test', currentPassword: 'old' }));
  assert.equal(taken.status, 409);

  // С валидным паролем и свободным email — успех.
  const ok = await PUT(write('PUT', { email: 'fresh@example.test', currentPassword: 'old' }));
  assert.equal(ok.status, 200);
});
