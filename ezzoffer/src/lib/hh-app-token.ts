import { envOpt } from './env';
import { logError, logInfo } from './logger';

/**
 * Токен приложения hh.ru.
 *
 * Зачем он отдельный от пользовательского — ключевой момент всей интеграции.
 * У hh.ru два разных эндпоинта с разными требованиями:
 *
 *  - `GET /vacancies` (ПОИСК) отвечает 403 без токена. Проверено вживую с
 *    разными User-Agent: поиск требует токена приложения.
 *  - `GET /vacancy/{id}` (одна вакансия) без токена отвечает 404, то есть
 *    доступен анонимно.
 *  - `POST /negotiations` (ОТКЛИК) требует токен того, кто откликается, —
 *    то есть пользовательский OAuth.
 *
 * Значит подменить пользовательский токен в поиске нельзя: у пользователя
 * в `users.hh_token` лежит именно тот, который умеет отправлять отклик от
 * его имени, и на поиске он либо недействителен, либо упирается в лимиты
 * конкретного соискателя вместо общих лимитов приложения.
 *
 * Токен приложения получается один раз по client_credentials из тех же
 * HH_CLIENT_ID / HH_CLIENT_SECRET, что уже настроены для OAuth-пользователей,
 * и живёт ограниченное время — поэтому он кэшируется в памяти процесса и
 * обновляется заранее, до истечения.
 *
 * Раньше провайдер hh требовал статический HH_ACCESS_TOKEN для поиска. В
 * рабочей базе hh = 0 вакансий, а autoapply отбирает только source === "hh",
 * то есть автоотклик не отправлял ничего вообще.
 */

const TOKEN_URL = 'https://api.hh.ru/token';
/** Обновляем за 5 минут до истечения: токен может протухнуть во время запроса. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export type HhAppToken = {
  token: string;
  expiresAt: number;
};

let cached: HhAppToken | null = null;
let inFlight: Promise<HhAppToken | null> | null = null;

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = envOpt(process.env, 'HH_CLIENT_ID');
  const clientSecret = envOpt(process.env, 'HH_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Настроен ли поиск по hh.
 *
 * Раньше проверялся только HH_ACCESS_TOKEN. Теперь статический токен тоже
 * принимается — он полезен в тестах и в развёртываниях, где токен выдаётся
 * вручную, — но основной путь это client_credentials.
 */
export function hhSearchConfigured(): boolean {
  if (envOpt(process.env, 'HH_ACCESS_TOKEN')) return true;
  return credentials() !== null;
}

type HhTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

/**
 * Токен приложения, пригодный для поиска.
 *
 * Возвращает null, если приложение не настроено или hh отказал. Ошибка не
 * бросается: провайдер каталога обязан деградировать до пустого результата
 * с текстом причины, а не ронять весь цикл обновления из-за одного источника.
 */
export async function getHhAppToken(): Promise<string | null> {
  const now = Date.now();

  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) return cached.token;

  // Статический токен в конфигурации приоритетнее: он не протухает сам.
  const staticToken = envOpt(process.env, 'HH_ACCESS_TOKEN');
  if (staticToken) return staticToken;

  const creds = credentials();
  if (!creds) return null;

  // Параллельные вызовы не должны делать N одинаковых запросов за токеном:
  // каталог обновляет все провайдеры конкурентно, и без этого уходило бы
  // по одному запросу на каждого подключившегося пользователя.
  if (inFlight) return (await inFlight)?.token ?? null;

  inFlight = (async (): Promise<HhAppToken | null> => {
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': 'EZOffer/1.0',
          },
          body,
          cache: 'no-store',
        });

        const text = await res.text();
        let data: HhTokenResponse = {};
        try {
          data = text ? (JSON.parse(text) as HhTokenResponse) : {};
        } catch {
          // hh вернул не JSON — разбираем ниже как ошибку HTTP.
        }

        if (!res.ok || !data.access_token) {
          const detail = data.error_description || data.error || `HTTP ${res.status}`;
          logError('hh:app-token', new Error(detail), { detail: text.slice(0, 200) });
          // Сбрасываем кэш, чтобы следующая попытка не ждала истечения.
          cached = null;
          return null;
        }

        // Если hh не отдал срок — считаем час, типичное значение для клиентских токенов.
        const ttlMs = (data.expires_in ?? 3600) * 1000;
        cached = { token: data.access_token, expiresAt: now + ttlMs };
        logInfo('hh:app-token', `токен приложения получен, ttl ${Math.round(ttlMs / 1000)} с`);
        return cached;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      logError('hh:app-token', e);
      cached = null;
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return (await inFlight)?.token ?? null;
}

/** Сброс кэша — используется в тестах. */
export function resetHhAppToken(): void {
  cached = null;
  inFlight = null;
}

/** Текущий кэш без обращения к сети — для диагностики и тестов. */
export function hhAppTokenCache(): HhAppToken | null {
  return cached;
}
