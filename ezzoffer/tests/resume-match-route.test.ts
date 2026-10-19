import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { loginAs, logout, post, useInMemoryDb } from './helpers/route-session';

/**
 * Разрыв резюме и вакансии доступен из интерфейса.
 *
 * Словарь требований был написан, покрыт тестами — и не вызывался ниоткуда.
 * Код, который никто не может достать, не является возможностью продукта:
 * человек не мог посмотреть, что в его резюме совпадает с требованиями, и
 * не мог увидеть пробелы. Роут закрывает именно эту дыру.
 *
 * Идиом проверяется поведением: сессия, мусорный id, владение, битое тело.
 */

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

before(async () => {
  useInMemoryDb();
  db = (await import('../src/lib/db')).db;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (1, 'match@test', 'h', 'pro', ?, ?, 1)`,
  ).run(Date.now() + 86_400_000, Date.now());
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (2, 'other@test', 'h', 'pro', ?, ?, 1)`,
  ).run(Date.now() + 86_400_000, Date.now());

  const now = Date.now();
  db.prepare(
    `INSERT INTO resumes (user_id, title, content, created_at, updated_at)
     VALUES (1, 'Моё', 'React, TypeScript, JavaScript', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO resumes (user_id, title, content, created_at, updated_at)
     VALUES (2, 'Чужое', 'React', ?, ?)`,
  ).run(now, now);

  loginAs();
});

async function api() {
  return await import('../src/app/api/resumes/[id]/match/route');
}

test('без сессии — 401', async () => {
  logout();
  const { POST } = await api();
  const res = await POST(post({ vacancy: 'React обязателен' }), {
    params: Promise.resolve({ id: '1' }),
  });
  assert.equal(res.status, 401);
  loginAs();
});

test('мусорный id — 400', async () => {
  const { POST } = await api();
  for (const junk of ['0', '-1', '1e3', 'abc', ' ']) {
    const res = await POST(post({ vacancy: 'React' }), { params: Promise.resolve({ id: junk }) });
    assert.equal(res.status, 400, `id «${junk}» обработан как ${res.status}`);
  }
});

test('чужое резюме неотличимо от несуществующего', async () => {
  const { POST } = await api();
  const foreign = await POST(post({ vacancy: 'React' }), { params: Promise.resolve({ id: '2' }) });
  const absent = await POST(post({ vacancy: 'React' }), {
    params: Promise.resolve({ id: '9999' }),
  });
  assert.equal(foreign.status, 404);
  assert.equal(absent.status, 404);
  assert.equal(
    await foreign.text(),
    await absent.text(),
    'ответы различаются — чужой ресурс выдаёт себя',
  );
});

test('битое тело — 400, а не 500', async () => {
  const { POST } = await api();
  const res = await POST(
    new Request('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{не json',
    }),
    { params: Promise.resolve({ id: '1' }) },
  );
  assert.equal(res.status, 400, `битое тело обработано как ${res.status}`);
});

test('пустая вакансия объясняет, что нечего сравнивать', async () => {
  const { POST } = await api();
  const res = await POST(post({ vacancy: '   ' }), { params: Promise.resolve({ id: '1' }) });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /текст вакансии/i);
});

test('ответ разделяет совпавшее и пробел и говорит, что это значит', async () => {
  const { POST } = await api();
  const res = await POST(
    post({ vacancy: 'Требуется React и Docker. React обязателен. Опыт с Docker обязателен.' }),
    { params: Promise.resolve({ id: '1' }) },
  );
  assert.equal(res.status, 200);

  const body = (await res.json()) as {
    match: {
      matched: { label: string }[];
      missing: { label: string }[];
      coverage: number;
      notice: string;
    };
  };

  const matched = body.match.matched.map((m) => m.label);
  assert.ok(matched.includes('React'), `React не найден: ${matched.join(', ')}`);
  assert.ok(!matched.includes('Docker'), `Docker в резюме нет, но найден: ${matched.join(', ')}`);

  const missing = body.match.missing.map((m) => m.label);
  assert.ok(missing.includes('Docker'), `Docker должен быть в пробеле: ${missing.join(', ')}`);

  assert.ok(body.match.coverage > 0 && body.match.coverage < 1, `покрытие ${body.match.coverage}`);
  assert.ok(body.match.notice.length > 0, 'ответ не объясняет, что означает результат');
});

/*
 * Два разных ограничения, и их нельзя путать.
 *
 * Общий readJson отвергает тело крупнее 200 000 символов — это защита всего
 * приложения, и она срабатывает раньше логики роута. Внутри оставшегося
 * предела роут сам обрезает описание до 20 000 символов: разбирать мегабайт
 * текста ради сорока требований незачем.
 */
test('тело крупнее общего лимита отвергается общим ридером', async () => {
  const { POST } = await api();
  const res = await POST(post({ vacancy: 'React '.repeat(50_000) }), {
    params: Promise.resolve({ id: '1' }),
  });
  assert.equal(res.status, 400, `огромное тело обработано как ${res.status}`);
  assert.match(await res.text(), /больш/i, 'не сказано, что тело слишком велико');
});

test('тело в пределах общего лимита обрезается роутом, а не роняет сервер', async () => {
  const { POST } = await api();
  // 150 000 символов: readJson пропускает, срез роута обязан отработать.
  const res = await POST(post({ vacancy: 'React обязателен. '.repeat(10_000) }), {
    params: Promise.resolve({ id: '1' }),
  });
  assert.equal(res.status, 200, `длинный вход обработан как ${res.status}`);
  const body = (await res.json()) as { match: { matched: { label: string }[] } };
  assert.ok(
    body.match.matched.some((m) => m.label === 'React'),
    'длинный, но допустимый текст не разобран',
  );
});
