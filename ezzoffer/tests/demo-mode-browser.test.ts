import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { retryOn429, gotoRetry } from './helpers/rate-limit-retry';

/**
 * Баннер демо-режима виден настоящему человеку (Фаза 1, задача 3).
 *
 * Почему именно браузером, а не разбором HTML. Баннер — серверный компонент,
 * и в HTML он попал бы мгновенно, проверка прошла бы, а человек ничего бы не
 * увидел: раскладка прячет боковую навигацию под `lg`, а сам баннер должен
 * пережить и мобильную ширину. Кроме того, правило «проверка, которая не
 * падает, — не проверка» здесь буквально: проверка должна ловить сломанную
 * раскладку, а не подтверждать наличие строки в исходнике.
 *
 * Вход идёт через request-контекст того же browser context: cookie-jar у них
 * общий, поэтому сессия настоящая, а страница открывается в браузере.
 *
 * Ограничение, как и у routes-malformed-body: проверка бьёт по СБОРКЕ, которая
 * сейчас работает. После правки исходников нужен `npm run build` и перезапуск,
 * иначе тест продолжит проверять старый сервер.
 */

const BASE = process.env.BASE ?? 'http://localhost:3121';
const EMAIL = process.env.QA_EMAIL ?? 'qa2@example.com';
const PASSWORD = process.env.QA_PASSWORD ?? 'testpass123';

async function login(ctx: BrowserContext): Promise<boolean> {
  // Через context.request, а не fetch: он делит cookie-jar с браузером, и
  // иначе вход прошёл бы, а кабинет открылся гостю.
  const res = await retryOn429(() =>
    ctx.request.post(`${BASE}/api/auth/login`, {
      headers: { 'content-type': 'application/json', origin: BASE, referer: `${BASE}/login` },
      data: { email: EMAIL, password: PASSWORD },
    }),
  );
  return res.ok();
}

let browser: Browser;

test.before(async () => {
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
});

test('баннер демо-режима виден в кабинете на каждой странице', async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (!(await login(ctx))) {
    await ctx.close();
    t.skip('вход не удался: нет тестовой учётной записи');
    return;
  }
  const page = await ctx.newPage();

  try {
    const PAGES = ['/dashboard', '/dashboard/applications', '/dashboard/jobs'];
    const missing: string[] = [];

    for (const path of PAGES) {
      if (!(await gotoRetry(page, `${BASE}${path}`))) {
        missing.push(`${path} (лимит запросов не отпустил за 4 попытки)`);
        continue;
      }
      const banner = page.locator('[data-demo-banner]');
      if ((await banner.count()) === 0) {
        missing.push(path);
        continue;
      }
      // Баннер обязан быть видимым, а не присутствовать в разметке: скрытый
      // «напоминатель» — это отсутствие напоминания.
      if (!(await banner.isVisible())) {
        missing.push(`${path} (есть в разметке, но не виден)`);
        continue;
      }
      const text = (await banner.innerText()).replace(/\s+/g, ' ').trim();
      if (!/не отражают ответы площадок/i.test(text)) {
        missing.push(`${path} (текст не говорит, что данные ненастоящие: «${text}»)`);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `баннер демо-режима не доказан на страницах:\n      ${missing.join('\n      ')}`,
    );
  } finally {
    await ctx.close();
  }
});

test('в настройках есть переключатель режима', async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (!(await login(ctx))) {
    await ctx.close();
    t.skip('вход не удался');
    return;
  }
  const page = await ctx.newPage();

  try {
    await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'domcontentloaded' });
    const sw = page.locator('[data-mode-switch]');
    assert.equal(await sw.count(), 1, 'в настройках нет переключателя режима');
    const mode = await sw.getAttribute('data-mode-switch');
    assert.ok(mode === 'demo' || mode === 'live', `неизвестный режим в интерфейсе: ${mode}`);
  } finally {
    await ctx.close();
  }
});
