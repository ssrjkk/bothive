import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { loginAs, logout, post, useInMemoryDb } from './helpers/route-session';

/**
 * A/B-варианты одного резюме (Фаза 7 карты, легальная часть совета из ролика
 * про ATS: гипотезы надо тестировать на нескольких версиях).
 *
 * НЕ то же самое, что десять аккаунтов. Один человек, одно резюме в нескольких
 * редакциях, честный счёт, какая редакция откликнулась. Разница принципиальная:
 * рекрутер видит одного кандидата, а не десять одинаковых.
 *
 * Схема уже умеет: в applications есть resume_id, то есть каким резюме ушёл
 * отклик, записывается. Не хватало группировки вариантов и честного сравнения.
 *
 * Главное здесь — правило малой выборки. Карта запрещает «статистику и выводы
 * на малой выборке», поэтому сравнение обязано признавать, что данных мало, а
 * не называть победителя. Тест на это и охотится.
 */

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  useInMemoryDb();
  db = (await import('../src/lib/db')).db;
  loginAs();
  // resumes.user_id → users.id, поэтому пользователей надо завести настоящих:
  // сессия в route-session подменена, а ограничение внешнего ключа — нет.
  for (const id of [1, 2]) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
       VALUES (?, ?, 'h', 'pro', ?, ?, 1)`,
    ).run(id, `variants${id}@test`, Date.now() + 86_400_000, Date.now());
  }
});

/** Создаёт резюме и возвращает его id. */
function makeResume(
  userId: number,
  title: string,
  content = 'Опыт 5 лет. React, TypeScript, Node.js',
): number {
  const now = Date.now();
  const r = db
    .prepare(
      `INSERT INTO resumes (user_id, title, content, years_label, ai_improved, created_at, updated_at)
       VALUES (?, ?, ?, '', 0, ?, ?)`,
    )
    .run(userId, title, content, now, now);
  return Number(r.lastInsertRowid);
}

/**
 * Выдаёт резюме идентификатор на hh — тем самым «загружает» его на площадку.
 *
 * Именно по нему отклики связываются с резюме: applications.resume_id — это
 * строка, уходящая в POST /negotiations, то есть hh_id, а не наш id строки.
 * Без этого сравнение не найдёт ничего, и тест зеленел бы вхолостую.
 */
function uploadToHh(rowId: number, hhId: string): void {
  db.prepare('UPDATE resumes SET hh_id = ? WHERE id = ?').run(hhId, rowId);
}

/** Отклик, отправленный резюме с этим hh_id. */
function addApplication(userId: number, hhId: string, slug: string, responded: boolean): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO applications (user_id, job_slug, resume_id, status, origin, sent_at, responded_at)
     VALUES (?, ?, ?, 'sent', 'real', ?, ?)`,
  ).run(userId, slug, hhId, now, responded ? now : null);
}

/** Id варианта по метке. Именно по метке: исходное резюме само становится «A». */
function variantId(label: string): number {
  const row = db
    .prepare('SELECT id FROM resumes WHERE variant_label = ? ORDER BY id LIMIT 1')
    .get(label) as { id: number } | undefined;
  assert.ok(row, `вариант «${label}» не создан`);
  return row.id;
}

function groupOf(resumeId: number): string {
  return (
    db.prepare('SELECT variant_group FROM resumes WHERE id = ?').get(resumeId) as {
      variant_group: string;
    }
  ).variant_group;
}

// Каждый тест начинается с чистых таблиц: без этого варианты и отклики
// предыдущего теста попадают в подсчёты следующего и он падает не по своей причине.
test.beforeEach(() => {
  db.prepare('DELETE FROM applications').run();
  db.prepare('DELETE FROM resumes').run();
});

async function variantsApi() {
  return await import('../src/app/api/resumes/[id]/variants/route');
}

test('колонки вариантов есть и группа по умолчанию пустая', () => {
  const cols = db.prepare('PRAGMA table_info(resumes)').all() as { name: string }[];
  assert.ok(
    cols.some((c) => c.name === 'variant_group'),
    'в resumes нет колонки variant_group',
  );
  assert.ok(
    cols.some((c) => c.name === 'variant_label'),
    'в resumes нет колонки variant_label',
  );

  const id = makeResume(1, 'Обычное резюме');
  const row = db
    .prepare('SELECT variant_group, variant_label FROM resumes WHERE id = ?')
    .get(id) as {
    variant_group: string | null;
    variant_label: string | null;
  };
  assert.equal(row.variant_group, null, 'новое резюме не должно само попасть в группу');
  assert.equal(row.variant_label, null);
  db.prepare('DELETE FROM resumes WHERE id = ?').run(id);
});

test('вариант получает следующую метку и ту же группу', async () => {
  const base = makeResume(1, 'Backend');
  const { POST } = await variantsApi();

  const a = await POST(post({}), { params: Promise.resolve({ id: String(base) }) });
  assert.equal(a.status, 201, `создание варианта A: ${a.status} ${await a.clone().text()}`);

  const b = await POST(post({}), { params: Promise.resolve({ id: String(base) }) });
  assert.equal(b.status, 201, `создание варианта B: ${b.status}`);

  const rows = db
    .prepare(
      'SELECT variant_group, variant_label FROM resumes WHERE variant_group IS NOT NULL ORDER BY id',
    )
    .all() as { variant_group: string; variant_label: string }[];

  const labels = rows.map((r) => r.variant_label);
  assert.deepEqual(labels, ['A', 'B', 'C'], `метки вариантов: ${labels.join(',')}`);
  assert.equal(
    new Set(rows.map((r) => r.variant_group)).size,
    1,
    'варианты разъехались по группам',
  );

  db.prepare('DELETE FROM resumes WHERE variant_group IS NOT NULL OR id = ?').run(base);
});

test('вариант — копия содержимого, а не ссылка на резюме площадки', async () => {
  const base = makeResume(1, 'Основа', 'React, TypeScript');
  // Исходник ОБЯЗАН быть загружен на hh. Пока у него hh_id = NULL, копирование
  // даёт NULL и проверка «hh_id не унаследован» не может упасть: она зеленеет
  // на сломанном коде. Мутация (копируем hh_id) обязана её ронять.
  uploadToHh(base, 'hh-original');

  const { POST } = await variantsApi();
  await POST(post({}), { params: Promise.resolve({ id: String(base) }) });

  const copy = db.prepare("SELECT * FROM resumes WHERE variant_label = 'B'").get() as {
    content: string;
    hh_id: string | null;
  };

  assert.equal(copy.content, 'React, TypeScript', 'вариант не унаследовал текст');
  assert.equal(
    copy.hh_id,
    null,
    'вариант унаследовал hh_id оригинала — это то же резюме на площадке, а не отдельное',
  );
});

test('чужое резюме неотличимо от несуществующего', async () => {
  makeResume(2, 'Чужое резюме');
  const { POST } = await variantsApi();

  const foreign = await POST(post({}), { params: Promise.resolve({ id: '2' }) });
  const absent = await POST(post({}), { params: Promise.resolve({ id: '99999' }) });

  assert.equal(foreign.status, 404, 'вариант чужого резюме создан');
  assert.equal(absent.status, 404);
  assert.equal(
    await foreign.text(),
    await absent.text(),
    'ответы различаются — чужой ресурс выдаёт себя',
  );
});

test('мусорный id не создаёт вариант', async () => {
  const { POST } = await variantsApi();
  for (const junk of ['0', '-1', '1e3', 'abc', ' ']) {
    const res = await POST(post({}), { params: Promise.resolve({ id: junk }) });
    assert.equal(res.status, 400, `id «${junk}» обработан как ${res.status}`);
  }
});

test('без сессии — 401 и никакой записи', async () => {
  const base = makeResume(1, 'Под сессией');
  logout();
  const { POST } = await variantsApi();
  const res = await POST(post({}), { params: Promise.resolve({ id: String(base) }) });
  assert.equal(res.status, 401);

  const count = db
    .prepare('SELECT COUNT(*) AS c FROM resumes WHERE variant_group IS NOT NULL')
    .get() as { c: number };
  assert.equal(count.c, 0, 'без сессии всё же создался вариант');
  loginAs();
  db.prepare('DELETE FROM resumes WHERE id = ?').run(base);
});

test('сравнение на малой выборке не называет победителя', async () => {
  const base = makeResume(1, 'Сравниваемое');
  const { POST } = await variantsApi();
  await POST(post({}), { params: Promise.resolve({ id: String(base) }) });

  uploadToHh(base, 'hh-a');
  uploadToHh(variantId('B'), 'hh-b');
  addApplication(1, 'hh-a', 'hh/vacancy-1', true);
  addApplication(1, 'hh-b', 'hh/vacancy-2', false);

  const { compareVariants } = await import('../src/lib/resume-variants');
  const cmp = compareVariants(1, groupOf(base));

  const a = cmp.variants.find((v) => v.label === 'A');
  const b = cmp.variants.find((v) => v.label === 'B');
  assert.ok(a && b, 'варианты не попали в сравнение');
  assert.equal(a.sent, 1);
  assert.equal(a.responded, 1);
  assert.equal(b.sent, 1);
  assert.equal(b.responded, 0);

  // Один отклик на вариант — это не данные, это совпадение.
  assert.equal(cmp.enough, false, 'на одном отклике объявлено, что данных достаточно');
  assert.equal(cmp.leader, null, 'на одном отклике объявлен победитель');
  assert.ok(cmp.notice.length > 0, 'не сказано, почему вывода нет');

  db.prepare('DELETE FROM resumes WHERE variant_group IS NOT NULL OR id = ?').run(base);
  db.prepare("DELETE FROM applications WHERE job_slug IN ('hh/vacancy-1','hh/vacancy-2')").run();
});

test('симулированные отклики не попадают в сравнение', async () => {
  const base = makeResume(1, 'С симуляцией');
  const { POST } = await variantsApi();
  await POST(post({}), { params: Promise.resolve({ id: String(base) }) });
  const bId = variantId('B');

  // Демо-симуляция не должна выдавать преимущество ни одному варианту.
  uploadToHh(base, 'hh-a');
  uploadToHh(bId, 'hh-b');
  const now = Date.now();
  db.prepare(
    `INSERT INTO applications (user_id, job_slug, resume_id, status, origin, sent_at, responded_at)
     VALUES (1, 'sim/ghost', 'hh-b', 'interview', 'simulated', ?, ?)`,
  ).run(now, now);

  const { compareVariants } = await import('../src/lib/resume-variants');
  const cmp = compareVariants(1, groupOf(base));
  const b = cmp.variants.find((v) => v.label === 'B');
  assert.equal(b?.sent, 0, `симулированный отклик попал в счётчик: ${JSON.stringify(b)}`);
});

test('вариант, не загруженный на hh, показан честно: ноль, а не выброшен', async () => {
  const base = makeResume(1, 'Без загрузки');
  const { POST } = await variantsApi();
  await POST(post({}), { params: Promise.resolve({ id: String(base) }) });
  uploadToHh(base, 'hh-a');

  const { compareVariants } = await import('../src/lib/resume-variants');
  const cmp = compareVariants(1, groupOf(base));
  const b = cmp.variants.find((v) => v.label === 'B');

  assert.ok(b, 'вариант без hh_id выпал из сравнения — человек не видит, что он есть');
  assert.equal(b.uploaded, false, 'вариант без hh_id отмечен как загруженный');
  assert.equal(b.sent, 0);
  assert.equal(b.rate, null, 'доля посчитана по нулю откликов');
});
