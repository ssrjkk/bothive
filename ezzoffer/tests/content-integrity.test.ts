import test from 'node:test';
import assert from 'node:assert/strict';
import { articleDateIso, articleMonthIso } from '../src/lib/article-date';
import { articles, jobs, internships, plans } from '../src/lib/data';

/**
 * Даты статей и целостность контента.
 *
 * Регрессия: в разметке schema.org у всех статей стояло
 * `datePublished: new Date().toISOString()`, вычисленное на уровне модуля.
 * То есть каждая статья объявлялась опубликованной в момент сборки, а
 * поисковики ориентируются именно на это поле при индексации и оценке
 * свежести. Теперь дата берётся реальная, и она должна разбираться из
 * русскоязычного формата, который используется в data.ts.
 */

test('дата статьи разбирается в ISO', () => {
  assert.equal(articleDateIso('12 сентября 2026'), '2026-09-12');
  assert.equal(articleDateIso('1 января 2026'), '2026-01-01');
  assert.equal(articleDateIso('31 декабря 2025'), '2025-12-31');
});

test('сокращённый месяц тоже распознаётся', () => {
  assert.equal(articleDateIso('3 сен 2026'), '2026-09-03');
  assert.equal(articleDateIso('3 сент. 2026'), '2026-09-03');
});

test('неизвестный формат даёт null, а не выдуманную дату', () => {
  assert.equal(articleDateIso('когда-то'), null);
  assert.equal(
    articleDateIso('2026-09-12'),
    null,
    'ISO не в этом формате не ожидается, но не должно ломаться',
  );
  assert.equal(articleDateIso(''), null);
  assert.equal(articleDateIso('32 сентября 2026'), null, 'несуществующий день отвергается');
  assert.equal(articleDateIso('12 бартваря 2026'), null, 'неизвестный месяц отвергается');
});

test('месяц без дня разбирается для группировки', () => {
  assert.equal(articleMonthIso('12 сентября 2026'), '2026-09');
  assert.equal(articleMonthIso('сентябрь 2026'), '2026-09');
  assert.equal(articleMonthIso('мусор'), null);
});

test('все даты статей реально разбираются', () => {
  for (const article of articles) {
    const iso = articleDateIso(article.date);
    assert.ok(
      iso,
      `дата «${article.date}» статьи ${article.slug} не распознана — в разметке не будет datetime`,
    );
    assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("slug'ы статей уникальны", () => {
  const slugs = articles.map((a) => a.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  assert.deepEqual([...new Set(dupes)], [], "дубли slug'ов ломают generateStaticParams");
});

/**
 * Стажировки и вакансии делят пространство slug'ов: у вакансий slug —
 * первичный ключ таблицы vacancies. Сейчас коллизия безвредна (на
 * /internships slug используется только как ключ React), но при появлении
 * /internships/[slug] одинаковые пути схлопнулись бы.
 */
test("slug'ы вакансий и стажировок не пересекаются", () => {
  const jobSlugs = new Set(jobs.map((j) => j.slug));
  for (const int of internships) {
    assert.ok(
      !jobSlugs.has(int.slug),
      `стажировка «${int.slug}» совпадает со slug'ом вакансии — пути схлопнутся`,
    );
  }
});

test("все slug'ы — kebab-case латиницей", () => {
  for (const item of [...articles, ...jobs, ...internships]) {
    assert.match(item.slug, /^[a-z0-9-]+$/, `некорректный slug: ${item.slug}`);
  }
});

test('цены тарифов заданы для всех периодов и возрастают', () => {
  for (const plan of plans) {
    const values = [plan.prices[7], plan.prices[14], plan.prices[30]];
    assert.ok(
      values.every((v) => Number.isFinite(v) && v > 0),
      `цены тарифа ${plan.name} некорректны`,
    );
    assert.ok(values[1] >= values[0] && values[2] >= values[1], `цены ${plan.name} не монотонны`);
  }
});

/**
 * Выдуманных отзывов на сайте нет.
 *
 * Раньше здесь стоял тест на диапазон рейтингов у восьми отзывов, которых не
 * существовало: сервис был новым, а отзывы читались как подтверждённый опыт.
 * Проверка диапазона 1..5 выглядела как контроль качества и ничего не
 * контролировала — она просто разбирала список выдуманных данных.
 *
 * Теперь проверяется обратное: данных нет, и в текстах страниц не появилось
 * утверждений об опыте пользователей. Возвращать такой блок нельзя.
 */
test('в исходниках нет выдуманных отзывов', async () => {
  const data = await import('../src/lib/data');
  assert.equal(
    (data as Record<string, unknown>).reviews,
    undefined,
    'массив отзывов снова в данных — вернитесь к выдуманным историям успеха',
  );

  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const offenders: string[] = [];
  const stripped: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const raw = readFileSync(full, 'utf8');
      /*
       * Комментарии вырезаются. Они цитируют удалённые формулировки, чтобы
       * объяснить, что было убрано, — и без этого проверка находила бы сама
       * себя. Проверяются только строки, которые видит человек.
       */
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
      stripped.push(text);
      for (const claim of [
        'Нам доверяют',
        'сотни клиентов',
        'средняя оценка',
        'средний рейтинг',
        'офферов получено',
        'получают оффер за',
      ]) {
        if (text.includes(claim)) offenders.push(`${full}: ${claim}`);
      }
    }
  };
  walk(join(process.cwd(), 'src'));

  assert.deepEqual(
    offenders,
    [],
    `в текстах остались утверждения об опыте пользователей:\n${offenders.join('\n')}`,
  );

  /*
   * Обещания результата в шагах воронки.
   *
   * Плашки шагов стояли рядом с цифрами сервиса и читались как его замеры:
   * «В 4 раза больше приглашений», «Экономия до 27 часов», «Оффер за 3–4
   * недели». Ни одну из них сервис не измерял — это была оценка автора текста.
   * Плюс «До 100 откликов в день» противоречило коду: дневной лимит в
   * anti-ban.ts равен 50.
   *
   * Проверяются и цифры-обещания, и само слово «AI-агент»: LLM в отклике не
   * участвует (это блокировало бы планировщик), и называть сервис агентом
   * было преувеличением, которое FAQ уже не поддерживает.
   */
  const promises = [
    'В 4 раза больше',
    'Экономия до 27',
    'Оффер за 3',
    'AI-агент',
    'оффер через 2 недели',
  ];
  const promiseOffenders: string[] = [];
  for (const [i, text] of stripped.entries()) {
    for (const claim of promises) {
      if (text.includes(claim)) promiseOffenders.push(`файл #${i}: ${claim}`);
    }
  }
  assert.deepEqual(
    promiseOffenders,
    [],
    `в текстах остались обещания результата, которых сервис не измеряет:\n${promiseOffenders.join('\n')}`,
  );

  /*
   * Лимит откликов должен совпадать с лимитом в коде.
   *
   * Проверяются только те массивы, где сервис что-то обещает покупателю:
   * плашки на главной, шаги воронки и список возможностей тарифов. Первая
   * версия сканировала весь исходник и ловила статьи блога — «первые 20
   * откликов, которые HR просматривает», «платформы ограничивают 200 в
   * сутки», — где числа верны и относятся к рынку, а не к сервису.
   *
   * Лимиты разные по тарифам (plans.ts — 50 / 100 / 250), и «до 100 откликов»
   * на тарифе Pro — правда. Поэтому сверка идёт со всей таблицей лимитов, а
   * не с одной константой: любое обещанное число должно совпадать с одним из
   * реальных.
   */
  const plansSource = readFileSync(join(process.cwd(), 'src/lib/plans.ts'), 'utf8');
  const fn =
    /function planDailyLimit[\s\S]*?switch[\s\S]*?default:[\s\S]*?\}/.exec(plansSource)?.[0] ?? '';
  const limits = [...fn.matchAll(/return\s+(\d+);/g)].map((m) => Number(m[1])).filter((n) => n > 0);
  assert.ok(limits.length > 0, 'не удалось прочитать лимиты откликов из plans.ts');

  const promised = JSON.stringify([data.stats, data.steps, data.plans]);

  /*
   * \p{L}, а не \w.
   *
   * В JavaScript \w — это [A-Za-z0-9_], кириллицу он не покрывает. Вариант
   * с \w* не совпадал ни с одной строкой и проверял пустоту: тест проходил
   * при любом числе в любом тексте. Тот же дефект, что был с `git ls-files`:
   * проверка выглядела работающей, а не работала.
   */
  const found = [...promised.matchAll(/(\d+)\s+отклик\p{L}*/gu)];
  const mismatches = found
    .map((m) => Number(m[1]))
    .filter((claimed) => !limits.includes(claimed))
    .map((claimed) => `обещано ${claimed}, в plans.ts: ${limits.join(' / ')}`);

  assert.deepEqual(
    mismatches,
    [],
    `обещанный лимит откликов не совпадает с кодом:\n${mismatches.join('\n')}`,
  );

  // Регулярка обязана что-то находить, иначе она проверяет пустоту.
  assert.ok(
    found.length > 0,
    'в плашках, шагах и тарифах нет ни одного упоминания лимита — проверка перестала видеть текст',
  );

  /*
   * Числа о тарифах без слова «отклик» рядом.
   *
   * Первая проверка ловит «900 откликов», но не «до 400 на «Эксперте»» — там
   * между числом и словом «отклик» стоит целое предложение, и такая формулировка
   * читалась бы как настоящий лимит тарифа. Поэтому отдельный проход по
   * строкам, где речь о тарифе или о частоте: любое крупное число в такой
   * строке должно быть реальным лимитом.
   *
   * Порог 200, а не 100: в шагах есть пауза «45–180 с», и 180 — не лимит.
   * Числа поменьше рядом со словом «отклик» ловит проверка выше.
   */
  const tariffStrings: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === 'string') tariffStrings.push(node);
    else if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') Object.values(node).forEach(collect);
  };
  collect([data.stats, data.steps, data.plans]);

  const loose: string[] = [];
  for (const s of tariffStrings) {
    if (!/тариф|Эксперт|в день|в сутки|отклик/i.test(s)) continue;
    for (const m of s.matchAll(/(\d{3,})/g)) {
      const n = Number(m[1]);
      if (n >= 200 && !limits.includes(n)) loose.push(`«${n}» в «${s.slice(0, 60)}…»`);
    }
  }
  assert.deepEqual(
    loose,
    [],
    `крупные числа о тарифах не совпадают с лимитами (${limits.join(' / ')}):\n${loose.join('\n')}`,
  );
});

test('у вакансий заполнены обязательные поля', () => {
  for (const job of jobs) {
    assert.ok(job.title.trim(), `вакансия ${job.slug}: пустое название`);
    assert.ok(job.company.trim(), `вакансия ${job.slug}: пустая компания`);
    assert.ok(job.about.trim(), `вакансия ${job.slug}: пустое описание`);
    assert.ok(job.requirements.length > 0, `вакансия ${job.slug}: нет требований`);
  }
});
