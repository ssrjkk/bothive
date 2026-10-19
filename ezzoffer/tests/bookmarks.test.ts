import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { loginAs, logout, post, useInMemoryDb } from './helpers/route-session';

/**
 * Избранное.
 *
 * Главное здесь — изоляция между пользователями. Закладка привязана к
 * пользователю, и ошибка в условии WHERE была бы самой дорогой в кабинете:
 * человек увидел бы чужой список вакансий, а удаление сняло бы чужую закладку.
 * Все случаи проверены явно, а не «логика выглядит правильно».
 *
 * Второе по важности: исчезновение вакансии. Каталог чистят регулярно, и
 * закрытая вакансия обязана показываться как закрытая, а не как пустая карточка
 * с кнопкой «откликнуться», которая никуда не ведёт.
 */

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  useInMemoryDb();
  db = (await import('../src/lib/db')).db;
});

beforeEach(() => {
  db.exec(
    'DELETE FROM bookmarks; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM vacancies;',
  );
  loginAs();
});

function makeUser(id: number, email: string): void {
  db.prepare(
    'INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified) VALUES (?,?,?,?,?,?,1)',
  ).run(id, email, 'h', 'pro', Date.now() + 86_400_000, Date.now());
}

function makeVacancy(slug: string, title = 'React-разработчик'): void {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, salary_min, salary_max,
       level, format, city, posted, published_at, category, about, responsibilities, requirements, bonus,
       contact_email, contact_phone, fetched_at)
     VALUES (?, 'hh', ?, ?, 'Компания', '200000', 200000, 300000, 'Middle', 'Удалённо', 'Москва',
       'сегодня', ?, 'Разработка', 'React', '[]', '["React"]', '[]', NULL, NULL, ?)`,
  ).run(slug, slug, title, Date.now(), Date.now());
}

// ------------------------------------------------------------------ создание

test('вакансия сохраняется в избранное', async () => {
  makeUser(1, 'me@example.test');
  makeVacancy('hh-1');
  const { POST } = await import('../src/app/api/bookmarks/route');

  const res = await POST(post({ slug: 'hh-1' }));
  assert.equal(res.status, 200);

  const row = db.prepare('SELECT * FROM bookmarks WHERE user_id = 1').get() as { job_slug: string };
  assert.equal(row.job_slug, 'hh-1', 'закладка не сохранилась');
});

test('повторное нажатие не плодит дубли', async () => {
  makeUser(1, 'me@example.test');
  makeVacancy('hh-1');
  const { POST } = await import('../src/app/api/bookmarks/route');

  await POST(post({ slug: 'hh-1' }));
  await POST(post({ slug: 'hh-1' }));
  await POST(post({ slug: 'hh-1' }));

  const c = (
    db.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = 1').get() as { c: number }
  ).c;
  assert.equal(c, 1, `в избранном ${c} записей вместо одной`);
});

test('несуществующую вакансию сохранить нельзя', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/bookmarks/route');

  const res = await POST(post({ slug: 'hh-нет-такой' }));
  assert.equal(res.status, 404, 'в избранное приняли несуществующую вакансию');

  const c = (db.prepare('SELECT COUNT(*) AS c FROM bookmarks').get() as { c: number }).c;
  assert.equal(c, 0, 'в избранном осталась запись о несуществующей вакансии');
});

test('пустой slug отклоняется', async () => {
  makeUser(1, 'me@example.test');
  const { POST } = await import('../src/app/api/bookmarks/route');
  assert.equal((await POST(post({ slug: '   ' }))).status, 400);
  assert.equal((await POST(post({}))).status, 400);
});

// ------------------------------------------------------------------ удаление

test('закладка удаляется', async () => {
  makeUser(1, 'me@example.test');
  makeVacancy('hh-1');
  const { POST, DELETE } = await import('../src/app/api/bookmarks/route');

  await POST(post({ slug: 'hh-1' }));
  const res = await DELETE(post({ slug: 'hh-1' }));
  assert.equal(res.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM bookmarks').get() as { c: number }).c, 0);
});

test('удаление отсутствующей закладки не ошибка', async () => {
  /*
   * Человек мог нажать «удалить» на уже снятой закладке, а интерфейс иногда
   * отправляет DELETE дважды. Ошибка 404 здесь читалась бы как поломка.
   */
  makeUser(1, 'me@example.test');
  const { DELETE } = await import('../src/app/api/bookmarks/route');
  assert.equal((await DELETE(post({ slug: 'hh-нет' }))).status, 200);
});

// ------------------------------------------------------------------ изоляция

/**
 * Чужие закладки не видны и не удаляются.
 *
 * Регрессия самого дорогого вида: `DELETE FROM bookmarks WHERE job_slug = ?`
 * без user_id снёс бы закладку другого человека, а `SELECT ... WHERE user_id`
 * без него показал бы его список. Оба условия проверяются.
 */
test('чужие закладки не попадают в список', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  makeVacancy('hh-1');
  makeVacancy('hh-2');

  const { POST, GET } = await import('../src/app/api/bookmarks/route');
  loginAs({ id: 2 });
  await POST(post({ slug: 'hh-2' }));

  loginAs({ id: 1 });
  await POST(post({ slug: 'hh-1' }));

  const data = (await (await GET()).json()) as { bookmarks: { slug: string }[] };
  const slugs = data.bookmarks.map((b) => b.slug);
  assert.deepEqual(slugs, ['hh-1'], `в списке чужие закладки: ${slugs.join(', ')}`);
});

test('чужую закладку нельзя удалить', async () => {
  makeUser(1, 'me@example.test');
  makeUser(2, 'other@example.test');
  makeVacancy('hh-2');

  const { POST, DELETE } = await import('../src/app/api/bookmarks/route');
  loginAs({ id: 2 });
  await POST(post({ slug: 'hh-2' }));

  loginAs({ id: 1 });
  await DELETE(post({ slug: 'hh-2' }));

  const c = (
    db.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = 2').get() as { c: number }
  ).c;
  assert.equal(c, 1, 'чужую закладку удалили');
});

test('две одинаковые закладки у разных людей не мешают друг другу', async () => {
  /*
   * Уникальный индекс стоит на паре (user_id, job_slug), а не на slug.
   * Индекс по одному slug запретил бы второму человеку сохранить ту же
   * вакансию — то есть ограничил бы функцию для всех, кроме первого.
   */
  makeUser(1, 'a@example.test');
  makeUser(2, 'b@example.test');
  makeVacancy('hh-1');

  const { POST } = await import('../src/app/api/bookmarks/route');
  loginAs({ id: 1 });
  assert.equal((await POST(post({ slug: 'hh-1' }))).status, 200);
  loginAs({ id: 2 });
  assert.equal((await POST(post({ slug: 'hh-1' }))).status, 200);

  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM bookmarks').get() as { c: number }).c, 2);
});

// ------------------------------------------------------------------ доступ

test('без сессии избранное недоступно', async () => {
  const { GET, POST, DELETE } = await import('../src/app/api/bookmarks/route');
  logout();
  assert.equal((await GET()).status, 401);
  assert.equal((await POST(post({ slug: 'hh-1' }))).status, 401);
  assert.equal((await DELETE(post({ slug: 'hh-1' }))).status, 401);
});

// ------------------------------------------------------------------ вывод

/**
 * Исчезнувшая вакансия помечена, а не подменена пустотой.
 *
 * Раньше бы отдались пустые поля, и человек увидел бы карточку без названия с
 * кнопкой «откликнуться». Флаг available говорит прямо, что вакансии больше
 * нет, — и именно это человек должен увидеть, а не тишину.
 */
test('исчезнувшая вакансия помечена как недоступная', async () => {
  makeUser(1, 'me@example.test');
  makeVacancy('hh-исчезнет');

  const { POST, GET } = await import('../src/app/api/bookmarks/route');
  await POST(post({ slug: 'hh-исчезнет' }));

  // Вакансию убрали из каталога — так бывает при плановой очистке.
  db.prepare('DELETE FROM vacancies WHERE slug = ?').run('hh-исчезнет');

  const data = (await (await GET()).json()) as {
    bookmarks: { slug: string; available: boolean; title: string | null }[];
  };
  const b = data.bookmarks[0];
  assert.ok(b, 'закладка исчезла вместе с вакансией');
  assert.equal(b.available, false, 'исчезнувшая вакансия не помечена');
  assert.equal(b.title, null, 'у исчезнувшей вакансии выдуманное название');
});

test('доступная вакансия отдаётся с данными', async () => {
  makeUser(1, 'me@example.test');
  makeVacancy('hh-1', 'Senior React Developer');

  const { POST, GET } = await import('../src/app/api/bookmarks/route');
  await POST(post({ slug: 'hh-1' }));

  const data = (await (await GET()).json()) as {
    bookmarks: { available: boolean; title: string | null; company: string | null }[];
  };
  const b = data.bookmarks[0]!;
  assert.equal(b.available, true);
  assert.equal(b.title, 'Senior React Developer', 'название вакансии не отдано');
  assert.equal(b.company, 'Компания', 'компания не отдана');
});
