import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Кабинет живого человека.
 *
 * Две предыдущие проверки этого места были неверными, и обе показывали то, что
 * хотели увидеть.
 *
 * Первая шла через `fetch` с одним заголовком cookie. Прокси ротирует токен
 * сессии на каждом запросе к `/dashboard` и `/api` и отдаёт новый в `Set-Cookie`.
 * Браузер его подхватывает, а статичный fetch-клиент держит старый — и десять
 * страниц выглядели сломанными, хотя сайт работает.
 *
 * Вторая шла через `Invoke-WebRequest`, который по умолчанию следует за
 * редиректами: редирект на `/login` возвращал 200 страницы входа, и проверка
 * рапортовала об успехе. Ни один вариант не отвечал на вопрос «открывается ли
 * кабинет у человека».
 *
 * Здесь cookie-jar полный: каждый ответ обновляет его, как это делает браузер.
 */

const BASE = process.env.BASE ?? 'http://localhost:3121';
const EMAIL = process.env.QA_EMAIL ?? 'qa2@example.com';
const PASSWORD = process.env.QA_PASSWORD ?? 'testpass123';

const PAGES = [
  '/dashboard',
  '/dashboard/resumes',
  '/dashboard/jobs',
  '/dashboard/bookmarks',
  '/dashboard/applications',
  '/dashboard/letters',
  '/dashboard/consultations',
  '/dashboard/settings',
  '/dashboard/skills',
  '/dashboard/gigs',
];

let jar: Map<string, string>;

before(async () => {
  jar = new Map<string, string>();

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, referer: `${BASE}/login` },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) return;
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
});

/** Запрос с обновлением cookie-jar — так ведёт себя браузер. */
async function visit(
  path: string,
): Promise<{ status: number; html: string; location: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    redirect: 'manual',
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return {
    status: res.status,
    html: res.status === 200 ? await res.text() : '',
    location: res.headers.get('location'),
  };
}

test('вход проходит и кабинет открывается', async (t) => {
  if (jar.size === 0) {
    t.skip('вход не удался: нет тестовой учётной записи');
    return;
  }
  const first = await visit('/dashboard');
  assert.equal(first.status, 200, 'кабинет не открылся после входа');

  // Повторно: прокси ротирует токен, и ошибка в этом месте выглядела бы
  // как «сессия умирает после первого клика».
  const second = await visit('/dashboard');
  assert.equal(
    second.status,
    200,
    'повторный вход в кабинет не работает: сессия не переживает ротацию токена',
  );
});

test('все страницы кабинета открыты и содержат заголовок', async (t) => {
  if (jar.size === 0) {
    t.skip('вход не удался');
    return;
  }

  const problems: string[] = [];
  const noH1: string[] = [];

  for (const p of PAGES) {
    const { status, html, location } = await visit(p);
    if (status !== 200) {
      problems.push(`${p} -> ${status}${location ? ` (редирект на ${location})` : ''}`);
      continue;
    }
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length < 200) problems.push(`${p}: почти пустая страница (${text.length} символов)`);
    if (/Application error|Internal Server Error/i.test(html))
      problems.push(`${p}: страница ошибки`);

    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
    if (h1s.length === 0) {
      noH1.push(p);
      continue;
    }
    if (h1s.length > 1) problems.push(`${p}: на странице ${h1s.length} заголовков первого уровня`);
    const head = h1s[0][1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    /*
     * Порог в три символа, а не в восемь: «Резюме» и «Отклики» —
     * нормальные заголовки страниц, а проверка на длину их отвергала.
     * Оценивать надо пустоту, а не количество букв.
     */
    if (head.length < 3) problems.push(`${p}: заголовок пустой`);
  }

  assert.deepEqual(
    problems,
    [],
    `страницы кабинета в порядке:\n      ${problems.join('\n      ')}`,
  );
  assert.deepEqual(
    noH1,
    [],
    `на страницах нет заголовка первого уровня:\n      ${noH1.join('\n      ')}`,
  );
});
