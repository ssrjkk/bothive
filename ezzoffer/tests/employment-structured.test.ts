import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Занятость, полученная от площадки.
 *
 * Режим работы раньше выводился только из текста вакансии. Это работало, но
 * означало, что мы разбирали формулировки там, где площадка уже сказала ответ
 * структурно: у GeekJob есть `jobFormat.parttime`, у Работы России — поля
 * `employment` и `schedule` с собственными значениями.
 *
 * Здесь проверяется именно приоритет: структурный ответ сильнее текста в обе
 * стороны. Не только «поле сказало „подработка“ — значит подработка», но и
 * «поле сказало „полная занятость“, а в тексте похожие слова — всё равно
 * основная». Второе важнее: без него добавление поля было бы улучшением на
 * бумаге, а на деле подработки стало бы больше, а не точнее.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let direction: typeof import('../src/lib/direction');
let gigs: typeof import('../src/lib/gigs');
let trud: typeof import('../src/lib/vacancies/trudvsem');
let geek: typeof import('../src/lib/vacancies/geekjob');
let resetCatalogCache: () => void;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db;
  direction = await import('../src/lib/direction');
  gigs = await import('../src/lib/gigs');
  trud = await import('../src/lib/vacancies/trudvsem');
  geek = await import('../src/lib/vacancies/geekjob');
  resetCatalogCache = (await import('../src/lib/vacancies')).resetCatalogCache;
});

beforeEach(() => {
  db.exec('DELETE FROM vacancies;');
  resetCatalogCache();
});

test('поле площадки сильнее текста в обе стороны', () => {
  // Поле сказало «подработка», в тексте её нет — верим полю.
  assert.equal(
    direction.detectWorkMode(
      'Разработчик в банк, офис в центре',
      false,
      'Неполный рабочий день/неполная рабочая неделя',
    ),
    'подработка',
    'структурное поле проигнорировано',
  );
  // Поле сказало «основная», в тексте «частичная занятость» — верим полю.
  assert.equal(
    direction.detectWorkMode(
      'Частичная занятость возможна',
      false,
      'Полная занятость · Полный рабочий день',
    ),
    'основная',
    'текст перебил структурное поле',
  );
});

test('живые значения Работы России распознаются', () => {
  /*
   * Строки взяты из живого ответа opendata.trudvsem.ru, а не придуманы:
   * в выборке из 100 вакансий встречаются «Неполный рабочий
   * день/неполная рабочая неделя», «Режим гибкого рабочего времени»,
   * «Временная работа» и «Сезонная работа».
   */
  const sidegig: [string, string][] = [
    ['Полная занятость', 'Неполный рабочий день/неполная рабочая неделя'],
    ['Полная занятость', 'Режим гибкого рабочего времени'],
    ['Временная работа', 'Полный рабочий день'],
    ['Сезонная работа', 'Сменная работа'],
    ['Полная занятость', 'Частичная занятость'],
  ];
  for (const [employment, schedule] of sidegig) {
    const joined = `${employment} · ${schedule}`;
    assert.equal(
      direction.detectWorkMode('Ничего в тексте нет', false, joined),
      'подработка',
      `«${joined}» не признана подработкой`,
    );
  }

  const fulltime: [string, string][] = [
    ['Полная занятость', 'Полный рабочий день'],
    ['Полная занятость', 'Сменная работа'],
  ];
  for (const [employment, schedule] of fulltime) {
    assert.equal(
      direction.detectWorkMode('', false, `${employment} · ${schedule}`),
      'основная',
      `«${employment} · ${schedule}» названа подработкой`,
    );
  }
});

test('GeekJob отдаёт занятость булевым полем, и оно доезжает до вакансии', () => {
  const raw = {
    id: 42,
    position: 'Разработчик',
    company: { name: 'Компания' },
    jobFormat: { remote: true, parttime: true, relocate: false, inhouse: false },
  } as unknown as Parameters<typeof geek.mapGeekVacancy>[0];

  const v = geek.mapGeekVacancy(raw);
  assert.ok(v, 'вакансия GeekJob не разобралась');
  assert.equal(
    v!.employment,
    'Частичная занятость',
    `parttime=true, а занятость: ${v!.employment}`,
  );
  assert.equal(
    direction.detectWorkMode('Обычное описание без подработки', false, v!.employment),
    'подработка',
    'структурное поле GeekJob не привело к подработке',
  );

  const full = geek.mapGeekVacancy({
    ...raw,
    jobFormat: { remote: true, parttime: false, relocate: false, inhouse: false },
  } as unknown as Parameters<typeof geek.mapGeekVacancy>[0]);
  assert.equal(full!.employment, 'Полная занятость');
  assert.equal(direction.detectWorkMode('', false, full!.employment), 'основная');
});

test('Работа России склеивает занятость и график в одну строку', () => {
  const raw = {
    id: 'abc',
    'job-name': 'Инженер',
    employment: 'Полная занятость',
    schedule: 'Неполный рабочий день/неполная рабочая неделя',
  } as unknown as Parameters<typeof trud.mapTrudVacancy>[0];

  const v = trud.mapTrudVacancy(raw);
  assert.ok(v);
  const emp = v!.employment ?? '';
  assert.match(emp, /Полная занятость/, `потеряна занятость: «${emp}»`);
  assert.match(emp, /Неполный рабочий день/, `потерян график: «${emp}»`);
});

test('пустое занятость не превращается в прочерк в базе', () => {
  const v = trud.mapTrudVacancy({
    id: 'x',
    'job-name': 'Инженер',
    employment: '',
    schedule: '',
  } as unknown as Parameters<typeof trud.mapTrudVacancy>[0]);
  assert.ok(v);
  assert.ok(
    v!.employment === undefined || v!.employment === '',
    `пустое значение сохранилось как «${v!.employment}»`,
  );
});

test('подработка из структурного поля попадает в раздел, а текстовая — тоже', () => {
  const seed = (slug: string, source: string, about: string, employment: string | null) => {
    db.prepare(
      `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
         posted, published_at, category, about, requirements, employment, fetched_at)
       VALUES (?, ?, ?, 'Разработчик', 'Компания', '200000', 'Middle', 'Удалённо', 'Москва',
         'сегодня', ?, 'Работа', ?, '[]', ?, ?)`,
    ).run(slug, source, slug, Date.now(), about, employment, Date.now());
  };

  seed('geek-part', 'geekjob', 'Обычное описание', 'Частичная занятость');
  // У Работы России цифровую вакансию выдаёт навык в описании: площадка по всем
  // профессиям, и без «Требуется: Linux, PostgreSQL» это «Обычное описание».
  seed(
    'trud-part',
    'trudvsem',
    'Требуется: Python, PostgreSQL, Git',
    'Полная занятость · Неполный рабочий день',
  );
  seed('hh-text', 'hh', 'Требуется разработчик. Частичная занятость, 3 часа в день.', null);
  seed('full', 'hh', 'Полная занятость, офис', null);
  resetCatalogCache();

  const list = gigs.findGigs({ mode: 'подработка' });
  const slugs = list.map((g) => g.slug);

  for (const s of ['geek-part', 'trud-part', 'hh-text']) {
    assert.ok(slugs.includes(s), `подработка «${s}» не попала в раздел: ${slugs.join(', ')}`);
  }
  assert.ok(
    !slugs.includes('full'),
    `вакансия с полной занятостью попала в подработку: ${slugs.join(', ')}`,
  );
});

test('без поля решение остаётся прежним — по тексту', () => {
  assert.equal(direction.detectWorkMode('Подработка на вечер, удалённо'), 'подработка');
  assert.equal(direction.detectWorkMode('Полная занятость, 5/2, офис'), 'основная');
  assert.equal(direction.detectWorkMode('Ничего особенного'), 'основная');
});

test('раздел подработки не показывает профессии не из IT', () => {
  /*
   * Проверено на живом каталоге: до этого в подбор попадали «Тракторист -
   * машинист», «Продавец-кассир», «Курьер» и «Водитель категории Е». Работа
   * России и Работа.ру — площадки по всем профессиям, и в общем подборе они
   * правы, но обещание раздела про IT они не выполняли.
   */
  const seed = (slug: string, source: string, title: string, category: string, about: string) => {
    db.prepare(
      `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
         posted, published_at, category, about, requirements, employment, fetched_at)
       VALUES (?, ?, ?, ?, 'Р', '100000', 'Middle', 'Удалённо', 'Россия', 'сегодня', ?, ?, ?, '[]',
         'Неполный рабочий день/неполная рабочая неделя', ?)`,
    ).run(slug, source, slug, title, Date.now(), category, about, Date.now());
  };

  // Площадка по всем профессиям: нужен навык из словаря.
  seed(
    'tractor',
    'trudvsem',
    'Тракторист - машинист',
    'Сельское хозяйство, экология, ветеринария',
    'Работа в поле',
  );
  seed(
    'cashier',
    'trudvsem',
    'Продавец-кассир',
    'Продажи, закупки, снабжение, торговля',
    'Приёмка товара',
  );
  seed('courier', 'rabota', 'Курьер на автомобиле', 'Услуги', 'Доставка заказов');
  seed('electrician', 'rabota', 'Электрик', 'Строительство', 'Прокладка кабеля');
  // А вот это — цифровая работа, пусть даже на общей площадке.
  seed(
    'real-it',
    'trudvsem',
    'Системный администратор',
    'Информационные технологии',
    'Требуется: Linux, PostgreSQL, Bash',
  );
  resetCatalogCache();

  const slugs = gigs.findGigs({ mode: 'подработка' }).map((g) => g.slug);
  assert.ok(slugs.includes('real-it'), `настоящая IT-вакансия отсеяна: ${slugs.join(', ')}`);
  for (const junk of ['tractor', 'cashier', 'courier', 'electrician']) {
    assert.ok(!slugs.includes(junk), `профессия не из IT попала в подбор: ${junk}`);
  }
});

test('«Специалист» без цифровых признаков в подбор не идёт, даже на IT-площадке', () => {
  /*
   * Здесь была проверка «IT-площадке можно верить на слово» — GeekJob доска
   * про IT, поэтому любую её вакансию считали цифровой. Она отбрасывала
   * настоящие вакансии («DevOps-инженер», «Стажёр Frontend-разработчик»
   * навыков из словаря не содержат) и пропускала «Специалист» без единого
   * признака. Признак один на всех — определено направление.
   *
   * Ограничение честное и заметное: вакансия с заголовком «Специалист» и пустым
   * описанием в раздел не попадёт. На GeekJob это несколько позиций в неделю.
   */
  const put = (slug: string, title: string, about: string, employment: string) => {
    db.prepare(
      `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
         posted, published_at, category, about, requirements, employment, fetched_at)
       VALUES (?, 'geekjob', ?, ?, 'Р', '100000', 'Middle', 'Удалённо', 'Россия', 'сегодня', ?,
         'Работа', ?, '[]', ?, ?)`,
    ).run(slug, slug, title, Date.now(), about, employment, Date.now());
  };

  put('geek-generic', 'Специалист', 'Описание без перечня навыков', 'Частичная занятость');
  put(
    'geek-devops',
    'DevOps-инженер',
    'Требуется: Docker, Kubernetes, Linux',
    'Частичная занятость',
  );
  resetCatalogCache();

  const slugs = gigs.findGigs({ mode: 'подработка' }).map((g) => g.slug);
  assert.ok(slugs.includes('geek-devops'), `IT-вакансия по названию отсеяна: ${slugs.join(', ')}`);
  assert.ok(
    !slugs.includes('geek-generic'),
    `«Специалист» без признаков попал в подбор: ${slugs.join(', ')}`,
  );
});

test('миграция добавляет колонку в старую базу и не падает на новой', async () => {
  /*
   * Проверка колонки без самого ALTER — это не «миграция», а пустая функция с
   * хорошим названием. Такое и случилось: страховка от «duplicate column name»
   * была, а ALTER убрали при правке соседней строки. На новой базе всё работало,
   * и ломалось только на рабочей — там, где её и создают.
   */
  const { createDatabase } = await import('../src/lib/db');
  const Database = (await import('better-sqlite3')).default;

  // Путь к временной базе не берётся из EZOFFER_DB_PATH: в тестах это
  // «:memory:», и склейка дала бы имя вида «:memory:.mig-123», которое SQLite
  // открыть не может.
  const tmp = join(tmpdir(), `ezoffer-mig-${Date.now()}-${process.pid}.db`);
  const old = new Database(tmp);
  // База, какой она была до этой колонки.
  old.exec(`CREATE TABLE IF NOT EXISTS vacancies (
    slug TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
    title TEXT NOT NULL, company TEXT NOT NULL, salary TEXT NOT NULL,
    salary_min INTEGER, salary_max INTEGER, level TEXT NOT NULL,
    format TEXT NOT NULL, city TEXT NOT NULL, posted TEXT NOT NULL,
    category TEXT NOT NULL, about TEXT NOT NULL,
    responsibilities TEXT NOT NULL DEFAULT '[]',
    requirements TEXT NOT NULL DEFAULT '[]',
    bonus TEXT NOT NULL DEFAULT '[]',
    source_url TEXT, contact_email TEXT, contact_phone TEXT,
    published_at INTEGER, fetched_at INTEGER NOT NULL)`);
  old.close();

  const migrated = createDatabase(tmp);
  const cols = migrated
    .prepare('PRAGMA table_info(vacancies)')
    .all()
    .map((c) => (c as { name: string }).name);
  migrated.close();

  assert.ok(cols.includes('employment'), `в старой базе колонка не появилась: ${cols.join(', ')}`);

  // На свежей базе миграция не должна падать: колонка уже создана CREATE TABLE.
  const fresh = createDatabase(':memory:');
  const freshCols = fresh
    .prepare('PRAGMA table_info(vacancies)')
    .all()
    .map((c) => (c as { name: string }).name);
  assert.ok(freshCols.includes('employment'), 'на свежей базе колонки нет');

  const unlink = (await import('node:fs')).unlinkSync;
  try {
    unlink(tmp);
  } catch {
    /* временный файл мог не остаться */
  }
});
