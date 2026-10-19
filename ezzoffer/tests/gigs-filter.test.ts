import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Подбор подработки и заказов.
 *
 * Проверяется не «список есть», а обещание, которое делает раздел: фильтр по
 * режиму, направлению и грейду даёт осмысленный результат, заказ никогда не
 * приходит как подработка, а пустой результат честно называется пустым.
 *
 * Последнее — важнее прочих. Раньше в продукте разделы, где ничего не нашлось,
 * выглядели как ошибка, и человек не мог отличить «под фильтр ничего не
 * подошло» от «сервис сломался».
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let gigs: typeof import('../src/lib/gigs');
let bot: typeof import('../src/lib/telegram-bot');
let resetCatalogCache: () => void;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db;
  gigs = await import('../src/lib/gigs');
  bot = await import('../src/lib/telegram-bot');
  resetCatalogCache = (await import('../src/lib/vacancies')).resetCatalogCache;
});

beforeEach(() => {
  db.exec('DELETE FROM bookmarks; DELETE FROM applications; DELETE FROM vacancies;');
  resetCatalogCache();
});

function seed(
  slug: string,
  source: string,
  title: string,
  about: string,
  level = 'Middle',
  category = 'Работа',
): void {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
       posted, published_at, category, about, requirements, fetched_at)
     VALUES (?, ?, ?, ?, 'Компания', '200000', ?, 'Удалённо', 'Москва', 'сегодня', ?, ?, ?, '[]', ?)`,
  ).run(slug, source, slug, title, level, Date.now(), category, about, Date.now());
}

test('заказ не приходит как подработка', () => {
  seed(
    'fl-1',
    'flru',
    'Сверстать лендинг',
    'Нужен лендинг на WordPress',
    'Middle',
    'Сайты / WordPress',
  );
  seed('hh-1', 'hh', 'Разработчик', 'Частичная занятость, 3 часа в день', 'Junior');

  const podrabotka = gigs.findGigs({ mode: 'подработка' });
  const freelance = gigs.findGigs({ mode: 'фриланс' });

  assert.ok(
    podrabotka.every((g) => g.slug !== 'fl-1'),
    `заказ попал в подработку: ${podrabotka.map((g) => g.slug).join(', ')}`,
  );
  assert.ok(
    freelance.some((g) => g.slug === 'fl-1'),
    `заказ не попал в фриланс: ${freelance.map((g) => g.slug).join(', ')}`,
  );
  assert.equal(freelance.length, 1, 'в фриланс попал не только заказ');
});

test('фильтр по направлению и грейду сужает список, а не путает его', () => {
  seed(
    'hh-fe',
    'hh',
    'Frontend-разработчик',
    'Частичная занятость. React, TypeScript',
    'Junior',
    'Программирование',
  );
  seed(
    'hh-be',
    'hh',
    'Python-разработчик',
    'Частичная занятость. Python, PostgreSQL',
    'Senior',
    'Программирование',
  );
  seed('hh-des', 'hh', 'Дизайнер', 'Частичная занятость. Figma', 'Middle', 'Дизайн');

  const frontend = gigs.findGigs({ direction: 'frontend' });
  assert.ok(
    frontend.some((g) => g.slug === 'hh-fe'),
    'фронтенд-вакансия не найдена',
  );
  assert.ok(
    !frontend.some((g) => g.slug === 'hh-be'),
    `бэкенд попал во фронтенд: ${frontend.map((g) => g.slug).join(', ')}`,
  );

  const junior = gigs.findGigs({ level: 'Junior' });
  assert.equal(junior.length, 1, `по грейду Junior вышло ${junior.length}, а не одна вакансия`);

  const both = gigs.findGigs({ direction: 'design', level: 'Middle' });
  assert.ok(
    both.some((g) => g.slug === 'hh-des'),
    'пересечение фильтров должно работать',
  );
  assert.ok(!both.some((g) => g.slug === 'hh-fe'), 'пересечение фильтров фильтрует');
});

test('заказ помечен как ручной — автоматической отправки на фриланс-досках нет', () => {
  seed(
    'fl-1',
    'flru',
    'Сверстать лендинг',
    'Нужен лендинг на WordPress',
    'Middle',
    'Сайты / WordPress',
  );
  seed('hh-1', 'hh', 'Разработчик', 'Частичная занятость', 'Middle');

  const all = gigs.findGigs({});
  assert.equal(
    all.find((g) => g.slug === 'fl-1')?.manual,
    true,
    'заказ помечен как автоотправляемый',
  );
  assert.equal(all.find((g) => g.slug === 'hh-1')?.manual, false, 'hh ошибочно помечен как ручной');
});

test('пустой результат возвращается как список без выдуманных вакансий', () => {
  db.exec('DELETE FROM vacancies');
  resetCatalogCache();
  const list = gigs.findGigs({});
  assert.equal(list.length, 0, 'из пустого каталога сделаны вакансии');
  assert.deepEqual(gigs.gigCounts({}), { подработка: 0, фриланс: 0, всего: 0 });
});

test('пустой результат в боте называется пустым, а не списывается на сбой', () => {
  db.exec('DELETE FROM vacancies');
  resetCatalogCache();
  const reply = bot.replyFor('подработка', '', { id: 1 } as never);
  assert.match(reply.text, /пусто/i, `бот сообщил не о пустом: ${reply.text}`);
  assert.match(reply.text, /\/dashboard\/gigs/, 'нет ссылки на раздел с фильтрами');
  assert.ok(reply.keyboard, 'нет клавиатуры');
});

test('счётчики не выдумывают числа, которых нет в каталоге', () => {
  seed('fl-1', 'flru', 'Сверстать лендинг', 'WordPress', 'Middle', 'Сайты / WordPress');
  seed('hh-1', 'hh', 'Разработчик', 'Частичная занятость', 'Middle');
  seed('hh-2', 'hh', 'Разработчик', 'Полная занятость, 5/2', 'Middle');

  const counts = gigs.gigCounts({});
  assert.equal(counts.фриланс, 1, `фриланс посчитан как ${counts.фриланс}`);
  assert.equal(counts.подработка, 1, `подработка посчитана как ${counts.подработка}`);
  assert.equal(counts.всего, 2, 'в вакансию с полной занятостью подработка засчитана');
});

test('направления в фильтре показываются только те, где что-то есть', () => {
  db.exec('DELETE FROM vacancies');
  seed(
    'hh-fe',
    'hh',
    'Frontend-разработчик',
    'Частичная занятость. React',
    'Junior',
    'Программирование',
  );
  resetCatalogCache();

  const dirs = gigs.availableDirections();
  assert.ok(
    dirs.some((d) => d.key === 'frontend'),
    'фронтенд должен быть доступен',
  );
  assert.ok(
    dirs.length <= 2,
    `пустых направлений в списке ${dirs.length}: ${dirs.map((d) => d.key).join(', ')}`,
  );
  assert.ok(
    dirs.every((d) => d.count > 0),
    'направление с нулём в фильтре',
  );
});

test('вкладка «Всё» не показывает обычную работу на полный день', () => {
  /*
   * Раздел называется «Подработка и фриланс», а вкладка «Всё» открывала весь
   * каталог вместе с обычной работой. Человек, пришедший за подработкой на
   * вечер, получал вакансии с полной занятостью — обещание, которое вкладка
   * не выполняла. Проверка на мутацию показала, что иначе это поведение
   * можно было бы удалить незаметно.
   */
  seed('hh-full', 'hh', 'Разработчик', 'Полная занятость, офис в Москве', 'Middle');
  seed('fl-1', 'flru', 'Сверстать лендинг', 'WordPress', 'Middle', 'Сайты / WordPress');
  resetCatalogCache();

  const all = gigs.findGigs({}).map((g) => g.slug);
  assert.ok(all.includes('fl-1'), `заказ должен быть в «Всём»: ${all.join(', ')}`);
  assert.ok(
    !all.includes('hh-full'),
    `обычная работа попала в «Всё»: ${all.join(', ')} — раздел обещает подработку и фриланс`,
  );

  const main = gigs.findGigs({ mode: 'основная' });
  assert.ok(
    main.some((g) => g.slug === 'hh-full'),
    'основная работа должна находиться по своему фильтру',
  );
});

test('в ответе бота заказ и подработка не смешаны, а ссылки экранированы', () => {
  seed(
    'fl-1',
    'flru',
    'Сверстать «лендинг» & страницу',
    'WordPress',
    'Middle',
    'Сайты / WordPress',
  );
  seed('hh-1', 'hh', 'Разработчик', 'Частичная занятость. React', 'Junior', 'Программирование');

  const all = bot.replyFor('подработка', '', { id: 1 } as never);
  assert.ok(!/&(?![a-z]+;|#\d+;)/i.test(all.text), `неэкранированный амперсанд: ${all.text}`);
  assert.match(all.text, /лендинг/, 'заказ не показан в общем списке');
  assert.match(all.text, /Разработчик/, 'подработка не показана в общем списке');
});
