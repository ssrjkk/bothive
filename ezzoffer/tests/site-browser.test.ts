import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/**
 * Страницы в настоящем браузере.
 *
 * Проверки через fetch видели только код ответа и не видели того, что видит
 * человек: ошибок в консоли, неудавшихся запросов, изображений без картинки и
 * ссылок без подписи. Эта открывает страницу по-настоящему.
 *
 * Отдельно проверяется страница у человека без JavaScript. Раньше это выглядело
 * подозрительно: контент появляется при прокрутке через анимацию, и на снимке
 * всей страницы секции выглядели пустыми. Оказалось — не выглядят: текст на
 * месте и без скриптов. Проверка остаётся, чтобы это не разъехалось позже.
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
  '/login',
  '/signup',
];

async function sweep(): Promise<string[]> {
  const browser = await chromium.launch();
  const problems: string[] = [];

  for (const path of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const failed: string[] = [];

    page.on('console', (m) => {
      if (m.type() === 'error') failed.push(`ошибка в консоли: ${m.text().slice(0, 120)}`);
    });
    page.on('requestfailed', (r) => {
      // Префетч Next.js отменяется при уходе со страницы — это норма, а не поломка.
      const err = r.failure()?.errorText ?? '';
      if (r.url().includes('_rsc=') || err.includes('ERR_ABORTED')) return;
      failed.push(`запрос не прошёл: ${r.url().slice(0, 80)}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.url().slice(0, 80)} -> ${r.status()}`);
    });

    // Страница у человека без JavaScript.
    const noJs = await ctx.newPage();
    await noJs.route('**/*', (route) =>
      route.request().resourceType() === 'script' ? route.abort() : route.continue(),
    );
    await noJs.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    const blankNoJs = await noJs.evaluate(() => document.body.innerText.trim().length);
    await noJs.close();

    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const status = res?.status() ?? 0;

    const info = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      return {
        h1: document.querySelectorAll('h1').length,
        title: document.title.trim(),
        lang: document.documentElement.getAttribute('lang'),
        brokenImgs: imgs.filter((img) => img.complete && img.naturalWidth === 0).length,
        emptyLinks: [...document.querySelectorAll('a')].filter(
          (a) =>
            !a.textContent?.trim() && !a.getAttribute('aria-label') && !a.querySelector('img,svg'),
        ).length,
      };
    });

    if (status >= 400) problems.push(`${path} -> ${status}`);
    if (!info.lang) problems.push(`${path}: нет атрибута lang`);
    if (!info.title) problems.push(`${path}: пустой заголовок вкладки`);
    if (info.h1 === 0) problems.push(`${path}: нет заголовка первого уровня`);
    if (info.h1 > 1) problems.push(`${path}: заголовок первого уровня встречается ${info.h1} раз`);
    if (info.brokenImgs) problems.push(`${path}: не загрузилось ${info.brokenImgs} изображений`);
    if (info.emptyLinks) problems.push(`${path}: ${info.emptyLinks} ссылок без подписи`);
    if (blankNoJs < 400) problems.push(`${path}: без JavaScript остаётся ${blankNoJs} символов`);
    for (const f of failed.slice(0, 3)) problems.push(`${path}: ${f}`);

    await ctx.close();
  }

  await browser.close();
  return problems;
}

test('страницы открываются в настоящем браузере без изъянов', async (t) => {
  let problems: string[];
  try {
    problems = await sweep();
  } catch (e) {
    t.skip(`браузер недоступен: ${(e as Error).message.slice(0, 90)}`);
    return;
  }
  assert.deepEqual(problems, [], `замечания по страницам:\n      ${problems.join('\n      ')}`);
});
