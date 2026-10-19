import test from 'node:test';
import assert from 'node:assert/strict';

import { mapAshbyVacancy, parseAshbyBoards, ashbyProvider } from '../src/lib/vacancies/ashby';

/**
 * Провайдер Ashby.
 *
 * Проверяется на заглушках, без сети: тест, который ходит в интернет, падает
 * то из-за сети, то из-за лимитов площадки, и это говорит о внешнем мире, а не
 * о коде.
 *
 * Отдельно закрыт случай, найденный живой проверкой: заголовок раздела вида
 * «What you'll do|Responsibilities» содержал «|», который не экранировался.
 * Регулярное выражение разбиралось как две альтернативы, у первой не было
 * группы захвата, и `m[1].trim()` ронял весь обход каталога на первой же
 * вакансии с описанием.
 */

test('вакансия приводится к общему виду', () => {
  const v = mapAshbyVacancy(
    {
      id: 'abc-123',
      title: 'Senior Frontend Engineer',
      location: 'Europe',
      employmentType: 'FullTime',
      department: 'Product',
      team: 'Engineering',
      isRemote: true,
      publishedAt: new Date().toISOString(),
      jobUrl: 'https://jobs.ashbyhq.com/linear/abc-123',
      descriptionHtml: '<p>Ищем разработчика.</p>',
    },
    'linear',
  );

  assert.ok(v, 'вакансия не приведена');
  assert.equal(v.slug, 'ashby-abc-123');
  assert.equal(v.source, 'ashby');
  assert.equal(v.company, 'Linear', 'компания берётся из доски, а не из описания');
  assert.equal(v.level, 'Senior', 'уровень не распознан по названию');
  assert.equal(v.format, 'Удалённо', 'удалённость не распознана');
  assert.equal(v.posted, 'сегодня');
  assert.equal(v.source_url, 'https://jobs.ashbyhq.com/linear/abc-123');
  assert.ok(v.about.includes('Ищем разработчика'), 'описание не очищено от HTML');
});

test('уровень распознаётся по названию', () => {
  const cases: [string, string][] = [
    ['Intern Data Analyst', 'Intern'],
    ['Junior React Developer', 'Junior'],
    ['Principal Architect', 'Senior'],
    ['Staff Engineer', 'Senior'],
    ['Product Designer', 'Middle'],
  ];
  for (const [title, level] of cases) {
    const v = mapAshbyVacancy({ id: `id-${title}`, title }, 'acme');
    assert.equal(v?.level, level, `«${title}» определён как ${v?.level}, а не ${level}`);
  }
});

test('снятые и пустые записи не попадают в каталог', () => {
  assert.equal(mapAshbyVacancy({ id: 'x' }, 'acme'), null, 'запись без названия принята');
  assert.equal(
    mapAshbyVacancy({ id: 'y', title: 'T', isListed: false }, 'acme'),
    null,
    'снятая вакансия принята — её нельзя показывать и на неё нельзя откликаться',
  );
  assert.ok(mapAshbyVacancy({ id: 'z', title: 'T', isListed: true }, 'acme'));
});

test('разделы описания не роняют разбор', () => {
  /*
   * Регрессия: «|» в заголовке разрывал регулярное выражение, и у первой
   * альтернативы не было группы захвата. Падало всё, а не одна вакансия.
   */
  const withAlternation = mapAshbyVacancy(
    {
      id: 'alt',
      title: 'Engineer',
      descriptionHtml: '<p>Requirements: знать TypeScript</p>',
    },
    'acme',
  );
  assert.ok(withAlternation, 'вакансия с чередованием в заголовке уронила разбор');
  assert.equal(withAlternation.requirements.length, 1, 'требования не извлечены');
  assert.match(withAlternation.requirements[0] ?? '', /TypeScript/);
});

test('вакансия без разделов просто остаётся без них', () => {
  const v = mapAshbyVacancy(
    { id: 'plain', title: 'Engineer', descriptionHtml: '<p>Коротко.</p>' },
    'acme',
  );
  assert.ok(v);
  assert.deepEqual(v.requirements, []);
  assert.deepEqual(v.responsibilities, []);
  assert.equal(v.about, 'Коротко.');
});

test('доски задаются переменной окружения', () => {
  const saved = process.env.ASHBY_BOARDS;
  try {
    delete process.env.ASHBY_BOARDS;
    const defaults = parseAshbyBoards();
    assert.ok(defaults.length > 0, 'без переменной должен быть набор по умолчанию');
    assert.ok(defaults.length <= 25, 'досок не должно быть чрезмерно много за раз');

    process.env.ASHBY_BOARDS =
      'acme, globex , https://api.ashbyhq.com/posting-api/job-board/initech';
    assert.deepEqual(parseAshbyBoards(), ['acme', 'globex', 'initech'], 'доски не разобраны');
  } finally {
    if (saved === undefined) delete process.env.ASHBY_BOARDS;
    else process.env.ASHBY_BOARDS = saved;
  }
});

test('провайдер не падает на недоступной доске', async () => {
  const saved = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    seen.push(u);
    // Первая доска отвечает, остальные недоступны.
    if (u.includes('/linear')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ jobs: [{ id: 'a1', title: 'Engineer' }] }),
      } as unknown as Response;
    }
    return { ok: false, status: 500, text: async () => '' } as unknown as Response;
  }) as typeof globalThis.fetch;

  const savedBoards = process.env.ASHBY_BOARDS;
  process.env.ASHBY_BOARDS = 'linear, broken';
  try {
    const result = await ashbyProvider.fetchVacancies({ limit: 10 });
    assert.equal(result.ok, true, `одна доступная доска должна давать результат: ${result.error}`);
    assert.equal(result.vacancies.length, 1);
    assert.ok(
      seen.some((u) => u.includes('/linear')),
      'доска не была опрошена',
    );
  } finally {
    globalThis.fetch = saved;
    if (savedBoards === undefined) delete process.env.ASHBY_BOARDS;
    else process.env.ASHBY_BOARDS = savedBoards;
  }
});

test('пустой ответ даёт понятную ошибку, а не тишину', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jobs: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  const savedBoards = process.env.ASHBY_BOARDS;
  process.env.ASHBY_BOARDS = 'linear';
  try {
    const result = await ashbyProvider.fetchVacancies({ limit: 10 });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /Ashby/, `ошибка без названия источника: «${result.error}»`);
  } finally {
    globalThis.fetch = saved;
    if (savedBoards === undefined) delete process.env.ASHBY_BOARDS;
    else process.env.ASHBY_BOARDS = savedBoards;
  }
});

test('ответ приходит и списком, и объектом с полем jobs', async () => {
  /*
   * Формат ответа Ashby различался между досками: у одних массив, у других
   * объект с `jobs`. Раньше провайдер ждал только второй и молча отдавал пустой
   * каталог.
   */
  const saved = globalThis.fetch;
  const savedBoards = process.env.ASHBY_BOARDS;
  process.env.ASHBY_BOARDS = 'acme';
  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: 'b1', title: 'Analyst' }]),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  try {
    const result = await ashbyProvider.fetchVacancies({ limit: 10 });
    assert.equal(result.vacancies.length, 1, 'ответ-массив не прочитан');
    assert.equal(result.vacancies[0]?.title, 'Analyst');
  } finally {
    globalThis.fetch = saved;
    if (savedBoards === undefined) delete process.env.ASHBY_BOARDS;
    else process.env.ASHBY_BOARDS = savedBoards;
  }
});
