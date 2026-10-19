import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Инварианты на всём живом каталоге.
 *
 * Проверки на одном примере ничего не ловят. «Курьер» я ловил дважды, а ловится
 * всё, что не попало в этот конкретный заголовок: в том же разделе нашлись
 * «Грузчик», «Водитель категории Е» и «Продавец-кассир», а в направлении
 * «управление продуктом» — «Head of Global Logistics» и «Dispatch Specialist».
 *
 * Здесь проверяется весь каталог целиком, со всех источников сразу. Данные
 * меняются день о дню, поэтому проверка не привязана к конкретным заголовкам и
 * не может стать зелёной навсегда на старом снимке.
 *
 * Если сеть недоступна, проверка пропускается: миграция каталога не должна
 * ронять сборку.
 */

type Row = {
  slug: string;
  source: string;
  title: string;
  category: string;
  about: string;
  level: string;
  employment: string | null;
};

let db: { prepare(sql: string): { all(...a: unknown[]): unknown[] } };
let direction: typeof import('../src/lib/direction');

const LEVELS = new Set(['Intern', 'Junior', 'Middle', 'Senior']);
const FORMATS = new Set(['Удалённо', 'Гибрид', 'В офисе']);
const FREELANCE = new Set(['flru', 'kwork']);

before(async () => {
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db as never;
  direction = await import('../src/lib/direction');
  await (await import('../src/lib/vacancies')).refreshProviders({ limit: 100 });
});

function catalog(): Row[] {
  return db
    .prepare(`SELECT slug, source, title, category, about, level, employment FROM vacancies`)
    .all() as Row[];
}

test('инварианты каталога', async (t) => {
  const rows = catalog();
  if (rows.length < 200) {
    t.skip(`каталог мал (${rows.length}) — источники не обновились`);
    return;
  }

  const violations = new Map<string, string[]>();
  const add = (key: string, title: string) => {
    const list = violations.get(key) ?? [];
    if (list.length < 3) list.push(`${title.slice(0, 60)}`);
    violations.set(key, list);
  };

  const slugs = new Set<string>();
  for (const r of rows) {
    const text = [r.title, r.about, r.category].join(' ');
    const dir = direction.detectDirection(r.category, r.title, text);
    const mode = direction.detectWorkMode(text, FREELANCE.has(r.source), r.employment);

    if (!direction.DIRECTION_LABELS[dir]) add('направление без подписи', r.title);
    if (!LEVELS.has(r.level)) add(`грейд не из четырёх: «${r.level}»`, r.title);
    if (!direction.WORK_MODE_LABELS[mode]) add('режим работы не определён', r.title);
    if (slugs.has(r.slug)) add('слаг повторяется', `${r.title} (${r.source})`);
    slugs.add(r.slug);
    if (!r.title.trim()) add('пустой заголовок', r.slug);
    if (r.employment?.trim() === '—') add('прочерк вместо пустого значения занятости', r.title);

    /*
     * Поле занятости и режим обязаны совпадать.
     *
     * Это проверка на рассогласование, а не на конкретные слова: если площадка
     * сказала «неполный день», режим обязан быть подработкой. И наоборот — если
     * в поле только полная занятость, подработкой быть не может.
     */
    const sidegig = /неполн|частичн|гибк|временн|сезонн|договор/i;
    if (r.employment && sidegig.test(r.employment) && mode !== 'подработка') {
      add('поле обещает подработку, режим другой', r.title);
    }
    if (
      r.employment &&
      /полная занятость/i.test(r.employment) &&
      !sidegig.test(r.employment) &&
      mode === 'подработка'
    ) {
      add('поле обещает основную, режим подработка', r.title);
    }

    /* Профессии вне IT не должны получать цифровое направление. */
    if (
      dir !== 'other' &&
      /(^|\W)(трактор|кассир|курьер|водител|грузчик|электрик|продав|врач|учител|бухгалтер|повар|охранник)(\W|$)/i.test(
        r.title,
      )
    ) {
      add('профессия не из IT получила направление', r.title);
    }

    void FORMATS;
  }

  const summary = [...violations]
    .map(([k, v]) => `${k}: ${v.length}\n        ${v.join('\n        ')}`)
    .join('\n      ');
  assert.equal(violations.size, 0, `нарушений в живом каталоге:\n      ${summary}`);
});

test('распределение по направлениям не вырождается', (t) => {
  const rows = catalog();
  if (rows.length < 200) {
    t.skip('каталог мал');
    return;
  }

  const counts = new Map<string, number>();
  for (const r of rows) {
    const d = direction.detectDirection(
      r.category,
      r.title,
      [r.title, r.about, r.category].join(' '),
    );
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }

  /*
   * Одно направление не должно съедать каталог.
   *
   * На живых данных «управление продуктом» разрослось до 112 вакансий из-за
   * отдела «Product & Operations» на Jobicy: «Head of Global Logistics» и
   * «Dispatch Specialist» считались продуктовыми. Ни одно правило не ловило
   * это, пока не посчитали распределение по всему каталогу.
   */
  for (const [dir, n] of counts) {
    /*
     * Ограничение не распространяется на «неизвестно».
     *
     * Это честная корзина, а не ошибка классификации: каталог наполняется
     * площадками по всем профессиям, и большинство вакансий там — водители,
     * бухгалтеры и продавцы, которым направление в IT не полагается. Проверка
     * снизу отдельно следит, чтобы корзина не схлопнулась: если «неизвестно»
     * почти не осталось, значит направление выдумывается.
     */
    if (dir === 'other') continue;
    const share = n / rows.length;
    assert.ok(
      share <= 0.2,
      `направление «${dir}» занимает ${Math.round(share * 100)}% каталога (${n} из ${rows.length}) — правило, вероятно, слишком широкое`,
    );
  }

  const other = counts.get('other') ?? 0;
  assert.ok(
    other / rows.length >= 0.4,
    `«неизвестно» всего ${Math.round((other / rows.length) * 100)}% — подозрительно мало, направление выдумывается`,
  );
});
