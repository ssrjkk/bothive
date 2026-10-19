import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Внешний вид: ссылки и обещания.
 *
 * Две проверки, которые не могут пройти на бумаге.
 *
 * Первая обходит все страницы сайта и каждую внутреннюю ссылку на них. Человек
 * уходит за минуту, если встретил 404, а битая ссылка не видна ни в типах, ни
 * в линтере — она просто есть.
 *
 * Вторая ищет заголовки, обещающие то, что продукт не может дать. На главной
 * был блок «Никаких блокировок» с заголовком «Полная безопасность
 * гарантирована», а карточки под ним говорили «Блокировка возможна» и «Токен
 * хранится у нас — и это риск». Всё, что делает сервис, отдаёт именно честную
 * половину этого текста, а заголовок обещал вторую.
 */

const BASE = process.env.BASE ?? 'http://localhost:3121';

const PAGES = [
  '/',
  '/about',
  '/blog',
  '/faq',
  '/platform-rules',
  '/pricing',
  '/reviews',
  '/internships',
  '/jobs',
  '/resume-examples',
];

async function getHtml(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hrefs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:'))
      continue;
    out.add(href);
  }
  return [...out];
}

const DYNAMIC = /^\/[a-z-]+\/\[slug\]$/;

test('публичные страницы открываются', async (t) => {
  const home = await getHtml('/');
  if (!home) {
    t.skip('сервер не поднят');
    return;
  }
  const broken: string[] = [];
  for (const p of PAGES) {
    if (DYNAMIC.test(p)) continue;
    if (!(await getHtml(p))) broken.push(p);
  }
  assert.deepEqual(broken, [], `страницы не открываются: ${broken.join(', ')}`);
});

test('внутренние ссылки ведут в существующие страницы', async (t) => {
  const home = await getHtml('/');
  if (!home) {
    t.skip('сервер не поднят');
    return;
  }

  const known = new Set(PAGES);
  const broken: string[] = [];
  const checked = new Set<string>();

  for (const page of PAGES) {
    const html = await getHtml(page);
    if (!html) continue;
    for (const href of hrefs(html)) {
      let path: string;
      try {
        path = href.startsWith('http') ? new URL(href).pathname : href.split('#')[0].split('?')[0];
      } catch {
        continue;
      }
      if (!path.startsWith('/')) continue;
      if (checked.has(path)) continue;
      checked.add(path);
      if (known.has(path)) continue;
      // Маршруты кабинета закрыты входом — 307 на /login это правильный ответ.
      const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
      if (res.status >= 400) broken.push(`${path} -> ${res.status} (со страницы ${page})`);
    }
  }

  assert.ok(checked.size > 20, `проверено всего ${checked.size} ссылок — обход ничего не собрал`);
  assert.deepEqual(broken, [], `битые ссылки:\n      ${broken.join('\n      ')}`);
});

/**
 * Обещания, которых продукт не может выполнить.
 *
 * `why` — не описание совпадения, а объяснение, почему совпадение плохое:
 * иначе список превращается в запрещённые слова, и его обходят, не замечая.
 */
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /гарантир(ирована|уем|ияем)\b/i, why: 'гарантия того, что сервис не может обеспечить' },
  {
    re: /безопасн\w*\s+(абсолютн|полная|гарант)/i,
    why: 'абсолютная безопасность недостижима при хранении чужого токена',
  },
  {
    re: /никаких\s+(блокиров|отказ|огранич)/i,
    why: 'блокировка площадкой возможна, и это написано в том же разделе',
  },
  { re: /полностью\s+(безопасно|автомат)/i, why: 'полнота несовместима с наличием ограничений' },
  {
    re: /(лучш|дешевле|быстрее)\s+(чем|на)\s+конкурент/i,
    why: 'сравнение с конкурентами, которое никто не проверял',
  },
];

/** Рядом с опровержением совпадение — честное предупреждение, а не обещание. */
const EXEMPT = [/риск(и|ом)?\b/i, /возможна/i, /нельзя/i, /честно/i, /но\b.{0,40}не/i];

test('заголовки не обещают то, что продукт не делает', async (t) => {
  const home = await getHtml('/');
  if (!home) {
    t.skip('сервер не поднят');
    return;
  }

  const found: string[] = [];
  for (const page of PAGES) {
    const html = await getHtml(page);
    if (!html) continue;
    const text = visibleText(html);
    for (const { re, why } of FORBIDDEN) {
      const m = re.exec(text);
      if (!m) continue;
      const around = text.slice(Math.max(0, m.index - 130), m.index + 170);
      if (EXEMPT.some((e) => e.test(around))) continue;
      found.push(`${page}: «${m[0].trim()}» — ${why}\n      …${around}…`);
    }
  }

  assert.deepEqual(
    found,
    [],
    `невыполнимые обещания на страницах:\n      ${found.join('\n      ')}`,
  );
});

test('на главной один h1 и он осмысленный', async (t) => {
  const home = await getHtml('/');
  if (!home) {
    t.skip('сервер не поднят');
    return;
  }
  const h1 = [...home.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  assert.equal(
    h1.length,
    1,
    `на главной ${h1.length} заголовков первого уровня: ${h1.join(' | ')}`,
  );
  assert.ok(h1[0].length > 10, `заголовок пустой или обрезан: «${h1[0]}»`);
});
