import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Обновление каталога под реальные поиски.
 *
 * Прежняя реализация вызывала `refreshProviders({ limit: 50 })` БЕЗ текста
 * запроса. То есть в базу попадали первые 50 вакансий площадки вообще,
 * независимо от того, что кто-то ищет: каталог обслуживал витрину, а не
 * человека. Проверяется именно это — какие запросы уходят в провайдеры.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
let db: Database;
let buildQueryText: (keywords: string) => string;
let distinctQueries: (limit?: number) => { text: string; city: string }[];
let refreshCatalogForSearches: typeof import('../src/lib/catalog-refresh').refreshCatalogForSearches;
let lastRefreshReport: typeof import('../src/lib/catalog-refresh').lastRefreshReport;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  const dbMod = await import('../src/lib/db');
  db = dbMod.db;
  const cr = await import('../src/lib/catalog-refresh');
  buildQueryText = cr.buildQueryText;
  distinctQueries = cr.distinctQueries;
  refreshCatalogForSearches = cr.refreshCatalogForSearches;
  lastRefreshReport = cr.lastRefreshReport;

  /*
   * Поиски ссылаются на пользователя по внешнему ключу. В тесте это не
   * связано с проверяемым поведением, но без пользователя SQLite отвергает
   * вставку — и падение выглядит как ошибка логики обновления, а не как
   * «забыли создать владельца».
   */
  db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, 'h', ?)").run(
    'catalog@example.com',
    Date.now(),
  );
});

function addSearch(keywords: string, city = '', active = 1, userId = 1): number {
  return Number(
    db
      .prepare(
        "INSERT INTO searches (user_id, title, keywords, city, active, created_at) VALUES (?, 's', ?, ?, ?, ?)",
      )
      .run(userId, keywords, city, active, Date.now()).lastInsertRowid,
  );
}

test('в hh уходит навык, а не вся строка пользователя', () => {
  // «React, TypeScript, Москва, удалённо» целиком в text= даёт на hh
  // требование «все слова должны встретиться» и ноль результатов.
  const query = buildQueryText('React, TypeScript, Москва, удалённо');
  assert.ok(query.includes('React'), `в запрос не попал React: ${query}`);
  assert.ok(!query.includes('Москва'), 'город ушёл в текст запроса, а не в параметр area');
  assert.ok(query.split(' ').length <= 3, `слишком длинный запрос: ${query}`);
});

test('запрос строится и из слов, которых нет в словаре', () => {
  const query = buildQueryText('водитель, грузчик');
  assert.ok(query.length > 0, 'запрос пустой');
  assert.ok(query.length <= 30, `слишком длинный запрос: ${query}`);
});

test('пустые ключевые слова дают пустой запрос, а не мусорный', () => {
  assert.equal(buildQueryText(''), '');
  assert.equal(buildQueryText('   '), '');
});

test('запросы разных пользователей с одинаковым текстом не дублируются', () => {
  // Пять человек с одинаковым запросом не должны пять раз дёргать hh по
  // одному и тому же: это и лишняя нагрузка, и риск упереться в лимит.
  addSearch('React', 'Москва');
  addSearch('react', 'москва');
  addSearch('React', 'Москва');

  const queries = distinctQueries();
  const reactMoscow = queries.filter((q) => q.text === 'React' && q.city === 'Москва');
  assert.equal(reactMoscow.length, 1, `одинаковый запрос ушёл ${reactMoscow.length} раз`);
});

test('одинаковый текст в разных городах — разные запросы', () => {
  addSearch('Python', 'Москва');
  addSearch('Python', 'Петербург');

  const queries = distinctQueries();
  const python = queries.filter((q) => q.text === 'Python');
  assert.equal(python.length, 2, 'города схлопнулись в один запрос');
});

test('неактивные поиски не обновляют каталог', () => {
  addSearch('Rust', '', 0);
  const queries = distinctQueries().filter((q) => q.text === 'Rust');
  assert.equal(queries.length, 0, 'неактивный поиск попал в обновление');
});

test('без активных поисков обновление не ходит в сеть', async () => {
  db.prepare('UPDATE searches SET active = 0').run();

  let networkCalled = false;
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkCalled = true;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  try {
    const report = await refreshCatalogForSearches();
    assert.equal(report.ran, false, 'каталог обновлялся без единого активного поиска');
    assert.match(report.skipped ?? '', /нет активных поисков/);
    assert.equal(networkCalled, false, 'сеть дёрнулась впустую');
  } finally {
    globalThis.fetch = saved;
  }
});

test('после обновления пишется отчёт: сколько запросов и вакансий', async () => {
  addSearch('React', 'Москва', 1);

  const saved = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 't', expires_in: 3600 }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          items: [
            {
              id: String(Math.floor(Math.random() * 1e9)),
              name: 'React-разработчик',
              employer: { name: 'ООО' },
              area: { name: 'Москва' },
            },
          ],
        }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  try {
    const report = await refreshCatalogForSearches();
    assert.equal(report.ran, true, 'обновление не выполнено');
    assert.ok(report.queries > 0, 'запросов ноль — поиски пользователей проигнорированы');
    assert.ok(report.durationMs >= 0, 'нет замера длительности');

    // Отчёт обязан быть виден: иначе «каталог молча не обновляется сутки»
    // невозможно заметить.
    const stored = lastRefreshReport();
    assert.ok(stored, 'отчёт не сохранён');
    assert.equal(stored!.ran, true);
  } finally {
    globalThis.fetch = saved;
  }
});
