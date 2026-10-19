/**
 * Ожидание окна лимита запросов.
 *
 * Прокси режет страницы 30 в минуту и /api 60 в минуту (src/proxy.ts).
 * `npm test` делает сотни запросов подряд, и к концу прогона квота исчерпана:
 * без этого браузерные тесты падали на ПОСЛЕДНЕЙ странице, а повторный
 * запуск — на входе, потому что login получал 429.
 *
 * Лимит поднимать нельзя: он там правильный. Чинится порядок тестов — они
 * ждут окно и повторяют попытку, а не заявляют, что страница «сломана».
 *
 * Повтор именно потому, что 429 — это сигнал «позже», а не «никогда». На
 * любой другой код ответа повторов нет: тест должен честно упасть.
 */

const RETRYABLE_STATUS = 429;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Вызов, переживающий 429: ждёт окно и повторяет.
 *
 * Принимает функцию, а не URL намеренно: вход идёт через `context.request`,
 * который делит cookie-jar с браузером. Обычный fetch свои куки в контекст
 * не положит, и вход «пройдёт», а кабинет откроет как гостя.
 */
export async function retryOn429<T extends { status(): number; headers?: unknown }>(
  call: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let last: T | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await call();
    if (res.status() !== RETRYABLE_STATUS) return res;
    last = res;
    // Своё окно лучше заголованного: попытка вслепую сожжёт время прогона.
    if (i < attempts - 1) {
      const header = (res as { headers?: { get(n: string): string | null } }).headers?.get?.(
        'retry-after',
      );
      const seconds = Number(header);
      await sleep(
        Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60_000) : 2_000,
      );
    }
  }
  return last as T;
}

/**
 * Переход страницы с тем же ожиданием.
 *
 * Отдельная функция, а не обёртка над goto: page.goto бросает на не-2xx и
 * «okuдается» в собственный HTTP-ответ, поэтому статус нужно смотреть
 * через response().
 */
export async function gotoRetry(
  page: {
    goto: (
      u: string,
      o?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' },
    ) => Promise<{ status(): number } | null>;
  },
  url: string,
  attempts = 4,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
      status = res ? res.status() : 0;
    } catch {
      status = 0;
    }
    if (status !== RETRYABLE_STATUS) return true;
    if (i < attempts - 1) await sleep(2_000);
  }
  return false;
}
