import { logInfo } from './logger';

/**
 * HTTP-клиент для внешних источников.
 *
 * Каждый провайдер вакансий раньше делал голый `fetch` с таймаутом: при первом
 * же сетевом сбое (обрыв, DNS, 502 от апстрима) источник молча выпадал из
 * каталога до следующего полного обновления — то есть на 6 часов. При этом
 * refreshProviders дёргает 9 провайдеров параллельно, и одна транзиентная
 * ошибка в любом из них портила результат целиком.
 *
 * Здесь собрано то, что повторялось по девять раз:
 *  - таймаут на каждый запрос (AbortController);
 *  - повтор при сетевых ошибках и 5xx/429 с экспоненциальной задержкой;
 *  - отсутствие повторов на 4xx (кроме 429): клиентская ошибка не
 *    исправляется повтором и только тратит время;
 *  - необязательные User-Agent/Referer.
 */

export type HttpOptions = {
  /** Метод по умолчанию — GET. */
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** Таймаут одного запроса, мс. */
  timeoutMs?: number;
  /** Сколько раз пробовать ВСЕГО (1 = без повторов). */
  attempts?: number;
  /** Базовая задержка между попытками, мс (умножается на 2^n). */
  retryBaseMs?: number;
  /** Максимальная задержка между попытками, мс. */
  retryMaxMs?: number;
  cache?: RequestCache;
  /** Пользовательская проверка ответа: false — повторов не делаем. */
  shouldRetry?: (status: number) => boolean;
};

export type HttpResult = {
  ok: boolean;
  status: number;
  /** Текст ответа (уже прочитан). Вызывающий сам разбирает JSON/XML. */
  body: string;
  error?: string;
  /** Сколько попыток реально понадобилось. */
  attempts: number;
  /**
   * Сколько площадка попросила подождать, мс. 0 — не просила.
   *
   * Раньше этого поля не было, и заголовок Retry-After терялся: клиент читал
   * его для собственных повторов и выбрасывал. Автоотклик, получив 429, не знал,
   * что площадка назвала конкретный срок, и ждал свой, рассчитанный.
   */
  retryAfterMs: number;
};

/**
 * Разбирает Retry-After в миллисекунды.
 *
 * По RFC заголовок бывает двух видов: число секунд и дата. Раньше разбиралось
 * только число, дата давала NaN — то есть «площадка не просила ждать», и
 * инструкция выполнялась только в теории.
 */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number {
  if (!header) return 0;

  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);

  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - now);

  return 0;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_MS = 5_000;

/** Статусы, при которых повтор имеет смысл. */
function defaultShouldRetry(status: number): boolean {
  // 4xx (кроме 429) — ошибка клиента или нашего запроса: повтор не поможет.
  if (status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return status >= 500;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Выполняет HTTP-запрос с таймаутом и повторами.
 *
 * Никогда не бросает исключений: сетевые ошибки возвращаются как { ok:false },
 * потому что вызывающий код (провайдеры) одинаково обрабатывает и исключение,
 * и неуспешный ответ — возвращая пустой список вакансий.
 */
export async function httpFetch(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const {
    method = 'GET',
    headers,
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = DEFAULT_ATTEMPTS,
    retryBaseMs = DEFAULT_BASE_MS,
    retryMaxMs = DEFAULT_MAX_MS,
    cache = 'no-store',
    shouldRetry = defaultShouldRetry,
  } = opts;

  const total = Math.max(1, Math.floor(attempts));
  let lastError = 'unknown error';
  let lastStatus = 0;
  /** Срок, который попросила площадка, — доезжает до паузера. */
  let lastRetryAfterMs = 0;

  for (let attempt = 1; attempt <= total; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers, body, cache, signal: controller.signal });
      const text = await res.text();
      lastStatus = res.status;
      /*
       * Заголовки читаются через опциональную цепочку.
       *
       * Здесь встречаются не только настоящие Response, но и частичные заглушки
       * в тестах, где headers просто нет. Без проверки обращение бросало
       * исключение, его ловил общий catch и превращал в «сетевую ошибку» — то
       * есть отклик, который площадка отвергла, считался таймаутом.
       */
      lastRetryAfterMs = parseRetryAfter(
        typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : null,
        Date.now(),
      );

      if (res.ok) {
        return { ok: true, status: res.status, body: text, attempts: attempt, retryAfterMs: 0 };
      }

      lastError = `HTTP ${res.status}`;
      const retryable = shouldRetry(res.status);
      if (!retryable || attempt === total) {
        return {
          ok: false,
          status: res.status,
          body: text,
          error: lastError,
          attempts: attempt,
          retryAfterMs: lastRetryAfterMs,
        };
      }

      // 429 часто приходит с Retry-After — уважаем его, но с потолком,
      // иначе один капризный апстрим может остановить обновление каталога.
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? Math.min(retryAfterHeader * 1000, retryMaxMs * 4)
          : Math.min(retryBaseMs * 2 ** (attempt - 1), retryMaxMs);
      logInfo('http', `повтор после ${res.status}`, { url, attempt, waitMs });
      await sleep(waitMs);
    } catch (err) {
      // Сетевая ошибка или таймаут — всегда имеет смысл повторить.
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === total) {
        return {
          ok: false,
          status: 0,
          body: '',
          error: lastError,
          attempts: attempt,
          retryAfterMs: 0,
        };
      }
      const waitMs = Math.min(retryBaseMs * 2 ** (attempt - 1), retryMaxMs);
      logInfo('http', `повтор после сетевой ошибки`, { url, attempt, error: lastError });
      await sleep(waitMs);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    body: '',
    error: lastError,
    attempts: total,
    retryAfterMs: lastRetryAfterMs,
  };
}

/** Разбирает JSON-ответ, не бросая исключений. */
export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
