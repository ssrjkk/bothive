import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Фриланс-источники и классификация.
 *
 * Проверка делится на две части по разному принципу.
 *
 * Первая — про то, что уже измерено живьём. В ленте fl.ru из 60 заказов примерно
 * половина вообще не про IT: отзывы на маркетплейсах, постинг, копирайтинг.
 * Если отдать их в общую ленту, человек, подписанный на IT, получит мусор и
 * перестанет смотреть. Значит фильтр — часть продукта, а не оптимизация, и
 * должен быть проверен на реальном составе фида.
 *
 * Вторая — про то, что нельзя проверить из среды разработки: hh отдаёт 403 на
 * всё, включая параметры занятости. Поэтому режим работы («подработка»,
 * «фриланс», «основная») определяется по тексту вакансии, и это проверяется
 * явно — с указанием, что при появлении структурного поля у hh оно должно
 * проверяться первым.
 */

let freelance: typeof import('../src/lib/vacancies/freelance');
let direction: typeof import('../src/lib/direction');

before(async () => {
  process.env.EZOFFER_SILENT = '1';
  freelance = await import('../src/lib/vacancies/freelance');
  direction = await import('../src/lib/direction');
});

/** Живой фид fl.ru. Пропускается, если сеть недоступна: это не повод ронять сборку. */
async function liveFlItems(): Promise<
  { title: string; description: string; category: string }[] | null
> {
  try {
    const res = await fetch('https://www.fl.ru/rss/all', {
      headers: {
        'User-Agent': 'EZOffer/1.0 (+https://ezoffer.example)',
        Accept: 'application/json, application/xml, text/xml, text/html, */*',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
    const pick = (b: string, tag: string) =>
      decode(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(b)?.[1] ?? '');
    return blocks.map((b) => ({
      title: pick(b, 'title'),
      description: pick(b, 'description'),
      category: pick(b, 'category'),
    }));
  } catch {
    return null;
  }
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c: string) => String.fromCodePoint(Number(c)))
    .replace(/\s+/g, ' ')
    .trim();
}

function item(title: string, category: string, description = '') {
  return {
    source: 'flru',
    title,
    link: `https://www.fl.ru/projects/1/${title.slice(0, 20)}.html`,
    description,
    category,
    pubDate: new Date().toUTCString(),
  };
}

test('заказ без IT-признаков не попадает в ленту', () => {
  const noise = [
    item('Размещение отзывов на маркетплейсах', 'Тексты / Копирайтинг', 'Разместить 50 отзывов'),
    item('Написать 10 постов для соцсетей', 'Тексты / Постинг', 'Темы известны заранее'),
    item(
      'Озвучка рекламного ролика',
      'Аудио/Видео/Фото / Озвучка | Дубляж',
      'Нужно записать ролик',
    ),
  ];
  for (const n of noise) {
    assert.equal(freelance.mapFreelanceItem(n), null, `не-IT заказ прошёл в ленту: ${n.title}`);
  }
});

test('заказ по IT проходит, даже если навыка нет в словаре', () => {
  const v = freelance.mapFreelanceItem(
    item('Нужен разбор отчёта на макросах Excel', 'Программирование / 1С-программирование'),
  );
  assert.ok(v, 'IT-заказ без навыков из словаря не прошёл');
  assert.equal(v!.source, 'flru');
  assert.ok(v!.source_url?.startsWith('https://www.fl.ru/'), 'нет ссылки на заказ');
});

test('у заказа нет зарплаты — и она не выдумывается', () => {
  const v = freelance.mapFreelanceItem(
    item('Разработать лендинг на WordPress', 'Сайты / WordPress'),
  );
  assert.ok(v);
  assert.equal(v!.salary_min, null);
  assert.equal(v!.salary_max, null);
  assert.match(v!.salary, /договор/i, `вместо «по договорённости» выведено: ${v!.salary}`);
});

test('одинаковые ссылки не превращаются в две вакансии', () => {
  const one = freelance.mapFreelanceItem(item('Сверстать лендинг', 'Сайты / Интернет-магазины'));
  const two = freelance.mapFreelanceItem(item('Сверстать лендинг', 'Сайты / Интернет-магазины'));
  assert.ok(one && two);
  assert.equal(one!.slug, two!.slug, 'один и тот же заказ получил два разных слага');
});

test('на живом фиде IT-заказы есть, а мусор в ленту не проходит', async (t) => {
  const items = await liveFlItems();
  if (!items || items.length === 0) {
    t.skip('сеть недоступна, фид не проверен');
    return;
  }
  assert.ok(items.length >= 20, `в фиде всего ${items.length} заказов — фид выродился`);

  const mapped = items
    .map((i) =>
      freelance.mapFreelanceItem({
        ...i,
        source: 'flru',
        link: `https://www.fl.ru/x/${i.title}.html`,
        pubDate: '',
      }),
    )
    .filter((v) => v !== null);

  assert.ok(mapped.length > 0, 'ни один заказ живого фида не распознан как IT');
  /*
   * Инвариант ленты: у всего, что в неё попало, есть опознанное направление.
   *
   * Раньше здесь стоял белый список слов, и проверка гонялась за лентой: каждый
   * прогон фид отдаёт другие заказы, и на следующем появлялся новый
   * неучтённый — «Яндекс Директ», «3D рендеры». Обе штуки подходят: Директ
   * это направление «Продажи и маркетинг», 3D — дизайн. Ловля слов означала бы,
   * что проверку чинят добавлением слов, а продукт — добавлением разделов.
   *
   * Поэтому проверяется то, что действительно обещано: у заказа в ленте есть
   * направление, и оно не «неизвестно».
   */
  for (const v of mapped) {
    const dir = direction.detectDirection(v.category, v.title, v.about);
    assert.notEqual(
      dir,
      'other',
      `в ленту попал заказ без опознанного направления: ${v.title} [${v.category}]`,
    );
    assert.ok(direction.DIRECTION_LABELS[dir]?.length, `у направления ${dir} нет подписи`);
  }
});

/*
 * 3D и анимация проходят: дизайн в продукте заявлен как направление, а 3D —
 * это дизайн. Заказ на рендер памятника человеку, который ищет подработку в
 * цифровых навыках, подходит, и называть его не-моей было бы неверно.
 */
test('3D и анимация проходят как дизайн', () => {
  const v = freelance.mapFreelanceItem(
    item('3D рендеры памятника', '3D Графика / 3D Моделирование'),
  );
  assert.ok(v, 'заказ на 3D-рендер отброшен');
  assert.equal(direction.detectDirection(v!.category, v!.title, v!.about), 'design');
});

test('один и тот же заказ дважды в фиде остаётся одним заказом', () => {
  /*
   * Проверка через разбор целого фида, а не через mapFreelanceItem: дедупликация
   * живёт в фиде, и её не видели, пока она была спрятана в сетевом вызове.
   */
  const one = item('Разработать лендинг на WordPress', 'Сайты / WordPress');
  const xml = `<?xml version="1.0"?><rss><channel>
    <title>канал</title>
    <item><title>${one.title}</title><link>${one.link}</link><description>нужен лендинг</description><category>${one.category}</category><pubDate>${one.pubDate}</pubDate></item>
    <item><title>${one.title}</title><link>${one.link}</link><description>тот же заказ повторно</description><category>${one.category}</category><pubDate>${one.pubDate}</pubDate></item>
  </channel></rss>`;

  const parsed = freelance.parseFreelanceFeed(xml, 'flru');
  assert.equal(parsed.length, 1, `один заказ распался на ${parsed.length}`);

  const other = item('Сверстать интернет-магазин', 'Сайты / Интернет-магазины');
  const xml2 = `<?xml version="1.0"?><rss><channel><title>канал</title>
    <item><title>${one.title}</title><link>${one.link}</link><description>a</description><category>${one.category}</category><pubDate>${one.pubDate}</pubDate></item>
    <item><title>${other.title}</title><link>${other.link}</link><description>b</description><category>${other.category}</category><pubDate>${other.pubDate}</pubDate></item>
  </channel></rss>`;
  const two = freelance.parseFreelanceFeed(xml2, 'flru');
  assert.equal(two.length, 2, 'два разных заказа схлопнулись');
  assert.notEqual(
    two[0]?.slug,
    two[1]?.slug,
    `у разных заказов один слаг: ${two.map((v) => v.slug).join(', ')} — кириллица выпала из слага`,
  );
});

test('русские заказы не сливаются в один из-за кириллицы', () => {
  /*
   * Регрессия: регулярка вида [^a-zA-Z0-9]+ выбрасывала кириллицу целиком, и
   * ссылки fl.ru вида /projects/1/razrabotat-lending.html давали один и тот же
   * слаг. Из шестидесяти заказов в ленте оставался первый.
   */
  const titles = [
    'Разработать лендинг на WordPress',
    'Сверстать интернет-магазин',
    'Настроить Яндекс Директ',
    'Сделать парсер для поставщика',
    'Доработать CRM Битрикс24',
    'Нарисовать дизайн приложения',
  ];
  const xml = `<?xml version="1.0"?><rss><channel><title>канал</title>${titles
    .map((t, i) => {
      const c = i % 2 === 0 ? 'Сайты / WordPress' : 'Программирование / Python';
      return `<item><title>${t}</title><link>https://www.fl.ru/projects/${i}/${t}.html</link><description>нужен исполнитель</description><category>${c}</category><pubDate>${new Date().toUTCString()}</pubDate></item>`;
    })
    .join('')}</channel></rss>`;

  const parsed = freelance.parseFreelanceFeed(xml, 'flru');
  const slugs = new Set(parsed.map((v) => v.slug));
  assert.equal(
    slugs.size,
    parsed.length,
    `из ${parsed.length} заказов уникальных слагов ${slugs.size}`,
  );
  assert.equal(
    parsed.length,
    titles.length,
    `из ${titles.length} заказов распознано ${parsed.length}`,
  );
});

test('продажа ссылок не выдаётся за подработку в IT', () => {
  /*
   * На Kwork весь фид сегодня — заказы на покупку бэклинков. Под правило на
   * seo они попадали, и раздел «фриланс для IT» обещал работу, которой нет.
   * Настоящий SEO-аудит под это правило не попадает — проверяется отдельно.
   */
  for (const junk of [
    'Build 1000 High Authority Web 2.0 PBN Homepage SEO Dofollow Backlinks',
    '350 backlinks blog comments Unique domains SEO Mix',
    'Купить 500 ссылок на сайт',
  ]) {
    assert.equal(
      freelance.mapFreelanceItem(item(junk, 'Продвижение сайтов (SEO, GEO) / Внешняя оптимизация')),
      null,
      `продажа ссылок попала в ленту: ${junk}`,
    );
  }

  const real = freelance.mapFreelanceItem(
    item(
      'Провести аудит сайта и дать план продвижения',
      'Продвижение сайтов (SEO, GEO) / Аудит сайта',
    ),
  );
  assert.ok(real, 'настоящий SEO-аудит отброшен вместе со спамом');
});

test('направление берётся из раздела площадки, а не из случайного слова', () => {
  const cases: [string, string, string][] = [
    ['Программирование / Python', 'Скрипт для обработки данных', 'backend'],
    ['Сайты / WordPress', 'Доработать интернет-магазин', 'frontend'],
    ['Mobile / Приложения для iOS', 'Разработать приложение', 'mobile'],
    ['Программирование / 1С-программирование', 'Настроить учёт', 'backend'],
    ['Реклама и Маркетинг / Продажи и генерация лидов', 'Искать клиентов', 'sales'],
    ['Дизайн / Дизайн для маркетплейсов', 'Отрисовать карточку', 'design'],
    ['Сайты / Корпоративный сайт', 'Сверстать лендинг', 'frontend'],
  ];
  /*
   * Инжиниринга в списке намеренно нет: «Слаботочные сети/Автоматизация» и
   * «Электрика» с fl.ru — это электротехника, а не IT. Ждали devops, а правильный
   * ответ other: человеку, ищущему DevOps, такая вакансия не нужна, и называть
   * её своей было бы обещанием, которого продукт не держит.
   */
  for (const [category, title, want] of cases) {
    assert.equal(
      direction.detectDirection(category, title),
      want,
      `«${category}» → ${want}, получено ${direction.detectDirection(category, title)}`,
    );
  }
});

test('в заголовке про Python с React в описании — это всё равно бэкенд', () => {
  const got = direction.detectDirection(
    '',
    'Python-разработчик',
    'Обязательно: Python, PostgreSQL, React',
  );
  assert.equal(got, 'backend', `получено ${got}: фронтенд из требований перебил заголовок`);
});

test('фулстек опознаётся, когда есть и фронт, и бэк одновременно', () => {
  const got = direction.detectDirection(
    '',
    'Разработчик в команду',
    'Python, PostgreSQL, React, TypeScript',
  );
  assert.equal(got, 'fullstack', `получено ${got}`);
});

test('неизвестное направление честно остаётся неизвестным', () => {
  assert.equal(direction.detectDirection('', 'Менеджер по клинингу', 'Беседовать людей'), 'other');
});

test('подработка отличивается от основной работы', () => {
  const cases: [string, string][] = [
    ['Требуется программист. Частичная занятость, 3 часа в день.', 'подработка'],
    ['Проектная работа: разработать модуль за 3 месяца', 'подработка'],
    ['Подработка на вечер, удалённо', 'подработка'],
    ['Работа с гибким графиком, part-time', 'подработка'],
    ['Требуется инженер. Полная занятость, 5/2, офис в Москве.', 'основная'],
  ];
  for (const [text, want] of cases) {
    assert.equal(
      direction.detectWorkMode(text),
      want,
      `«${text}» → ${want}, получено ${direction.detectWorkMode(text)}`,
    );
  }
});

test('заказ всегда фриланс, даже если в тексте написано «частичная занятость»', () => {
  assert.equal(
    direction.detectWorkMode('Частичная занятость, проектная работа', true),
    'фриланс',
    'заказ перепутан с подработкой',
  );
});

test('студенту и стажёру заказ отдаётся как Intern, а не как Middle', () => {
  assert.equal(direction.inferFreelanceLevel('Студенту: сверстать лендинг'), 'Intern');
  assert.equal(direction.inferFreelanceLevel('Стажёр-разработчик'), 'Intern');
  assert.equal(direction.inferFreelanceLevel('Разработать интернет-магазин'), 'Middle');
});

test('отдел «Product & Operations» не превращается в продуктовый менеджмент', async () => {
  /*
   * Регрессия, найденная пересчётом распределения по живому каталогу, а не
   * отдельным примером: правило «product|продукт|аналитик|анализ» давало 112
   * вакансий в направлении «управление продуктом», и к продукту относились
   * единицы. Ни одна проверка на одном примере это не ловила.
   *
   * Строки взяты из живого ответа Jobicy как есть. Отдел не роль: «President -
   * Business Unit» и «Head of Global Logistics» не становятся продуктовыми
   * менеджерами оттого, что стоят в отделе Product.
   */
  const { detectDirection } = await import('../src/lib/direction');
  const cases: [string, string][] = [
    ['Head of Global Logistics', 'other'],
    ['Dispatch Specialist', 'other'],
    ['President - Business Unit', 'other'],
    ['Senior Sales Operations Manager', 'other'],
    ['Senior Product Manager - Growth', 'pm'],
    ['Product Owner', 'pm'],
    // 1С — это разработка, а не анализ данных. Ожидание «data» было догадкой,
    // и код оказался прав: консультант по 1С настраивает учёт, а не строит
    // аналитику. Слово «аналитик» в названии не делает вакансию про данные.
    ['Аналитик-консультант 1С', 'backend'],
    ['Senior Data Analyst', 'data'],
  ];
  for (const [title, want] of cases) {
    const got = detectDirection('Product & Operations', title);
    assert.equal(
      got,
      want,
      `«${title}» в отделе Product & Operations → ожидалось ${want}, получено ${got}`,
    );
  }
});

test('«Работа» не содержит «бот», и водитель не становится бэкендом', async () => {
  /*
   * Регрессия из живого каталога. На Работе.ру раздел вакансии — строка
   * «Работа», а правило на ботов было «бот[а-яё]*» без левой границы, и
   * «работа» подходила под него. С описанием, где есть слово «поддержка»,
   * любая вакансия объявлялась бэкендом: «Курьер», «Грузчик-сборщик»,
   * «Водитель категории Е». В разделе подработки они оказывались как
   * backend-вакансии, и ни один тест на одном примере это не ловил.
   */
  const { detectDirection } = await import('../src/lib/direction');
  const cases: [string, string][] = [
    ['Курьер', 'other'],
    ['Водитель-курьер на автомобиле компании', 'other'],
    ['Грузчик-сборщик заказов на склад', 'other'],
    ['Водитель категории Е', 'other'],
    ['Разработчик Telegram-ботов', 'backend'],
  ];
  for (const [title, want] of cases) {
    const got = detectDirection('Работа', title);
    assert.equal(got, want, `«${title}» → ожидалось ${want}, получено ${got}`);
  }
});

test('у каждого направления и режима есть человеческая подпись', () => {
  for (const key of Object.keys(direction.DIRECTION_LABELS)) {
    assert.ok(
      direction.DIRECTION_LABELS[key as keyof typeof direction.DIRECTION_LABELS].length > 0,
    );
  }
  for (const key of Object.keys(direction.WORK_MODE_LABELS)) {
    assert.ok(
      direction.WORK_MODE_LABELS[key as keyof typeof direction.WORK_MODE_LABELS].length > 0,
    );
  }
});
