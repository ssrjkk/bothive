import { db, type User } from './db';
import { randomBytes } from 'node:crypto';
import { envOpt } from './env';
import { decryptSecret, encryptSecret } from './secrets';

/**
 * Подключение аккаунта hh.ru через OAuth2 (authorization_code).
 * Всё активируется через env: HH_CLIENT_ID, HH_CLIENT_SECRET, HH_REDIRECT_URI.
 * Без ключей flow честно недоступен.
 */

const AUTH_URL = 'https://hh.ru/oauth/authorize';
const TOKEN_URL = 'https://api.hh.ru/token';
const RESUMES_URL = 'https://api.hh.ru/resumes/mine';

export function hhConfigured(): boolean {
  return Boolean(
    envOpt(process.env, 'HH_CLIENT_ID') &&
    envOpt(process.env, 'HH_CLIENT_SECRET') &&
    envOpt(process.env, 'HH_REDIRECT_URI'),
  );
}

export function hhAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: envOpt(process.env, 'HH_CLIENT_ID') ?? '',
    redirect_uri: envOpt(process.env, 'HH_REDIRECT_URI') ?? '',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type HhTokenResponse = {
  access_token?: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export async function exchangeCode(code: string): Promise<HhTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: envOpt(process.env, 'HH_CLIENT_ID') ?? '',
    client_secret: envOpt(process.env, 'HH_CLIENT_SECRET') ?? '',
    redirect_uri: envOpt(process.env, 'HH_REDIRECT_URI') ?? '',
    code,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
  });
  const data = (await res.json()) as HhTokenResponse;
  if (!res.ok || !data.access_token) {
    return { error: data.error ?? `HTTP ${res.status}`, error_description: data.error_description };
  }
  return data;
}

export async function fetchHhResumeId(accessToken: string): Promise<string | null> {
  const res = await fetch(RESUMES_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'EZOffer/1.0',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: { id?: string; title?: string }[] };
  const item = data.items?.find((r) => r.id);
  return item?.id ?? null;
}

export async function refreshAccessToken(refreshToken: string): Promise<HhTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: envOpt(process.env, 'HH_CLIENT_ID') ?? '',
    client_secret: envOpt(process.env, 'HH_CLIENT_SECRET') ?? '',
    refresh_token: refreshToken,
  });
  /*
   * Ни таймаута, ни try/catch здесь не было, и это стоило дороже, чем кажется.
   *
   * 1. `fetch` без таймаута на зависании не бросает исключение — он ждёт
   *    вечно. Планировщик обходит пользователей ПО ОЧЕРЕДИ и держит
   *    блокировку прогона, поэтому один зависший запрос к api.hh.ru
   *    останавливал автоотклик у ВСЕХ остальных: цикл просто не доходил до
   *    них, а `finally` с освобождением блокировки не выполнялся.
   *
   * 2. `await res.json()` бросает, если ответ — не JSON: страница ошибки,
   *    HTML-заглушка прокси, пустое тело при 502. Тоже исключение наружу.
   *
   * Итог: у одного человека с истёкшим токеном и медленной сетью переставали
   * работать отклики у всех остальных. Функция обязана возвращать ошибку
   * ЗНАЧЕНИЕМ — ровно так, как её уже читает вызывающий
   * (`if (!refreshed.access_token) return { token: accessToken }`).
   */
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      error: 'network',
      error_description: err instanceof Error ? err.message : 'не удалось связаться с hh.ru',
    };
  }

  let data: HhTokenResponse;
  try {
    data = (await res.json()) as HhTokenResponse;
  } catch {
    return { error: `HTTP ${res.status}`, error_description: 'ответ hh.ru не является JSON' };
  }
  if (!res.ok || !data.access_token) {
    return { error: data.error ?? `HTTP ${res.status}`, error_description: data.error_description };
  }
  return data;
}

export function saveHhConnection(
  user: User,
  token: string,
  refreshToken: string | undefined,
  expiresIn: number,
  resumeId: string,
): void {
  db.prepare(
    `UPDATE users SET hh_token = ?, hh_token_expires_at = ?, hh_refresh_token = ?, hh_resume_id = ? WHERE id = ?`,
  ).run(
    // Пишем зашифрованным: колонка хранит шифротекст, а не открытый токен.
    encryptSecret(token),
    Date.now() + Math.max(expiresIn, 60) * 1000,
    encryptSecret(refreshToken ?? null),
    resumeId,
    user.id,
  );
}

export function clearHhConnection(userId: number): void {
  /*
   * Отключение hh гасит live обратно в demo: без площадки «живого» режима
   * быть не может. Отдельный UPDATE не нужен — условие то же самое.
   */
  db.prepare(
    "UPDATE users SET hh_token = NULL, hh_token_expires_at = NULL, hh_refresh_token = NULL, hh_resume_id = NULL, mode = 'demo' WHERE id = ?",
  ).run(userId);
}

/**
 * Подключён ли hh в смысле «можно отправлять и синхронизировать».
 *
 * Протухший access-токен — ещё не «отключено»: getValidHhToken обновит его
 * по refresh_token. Единое место проверки: те же условия смотрят
 * /api/hh/status и /api/mode, иначе они разойдутся и кабинет скажет
 * «подключено», а переключение в live — «не подключено».
 */
export function isHhConnected(
  fresh: Pick<User, 'hh_token' | 'hh_token_expires_at' | 'hh_refresh_token' | 'hh_resume_id'>,
): boolean {
  const tokenValid = Boolean(
    fresh.hh_token && fresh.hh_token_expires_at && fresh.hh_token_expires_at > Date.now(),
  );
  const canRefresh = Boolean(fresh.hh_refresh_token) && hhConfigured();
  return (tokenValid || canRefresh) && Boolean(fresh.hh_resume_id);
}

export function generateOauthState(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Возвращает актуальный access-токен пользователя, автоматически обновляя
 * протухший токен через refresh_token. Если обновить нечем — null.
 */
export async function getValidHhToken(
  user: Pick<User, 'id' | 'hh_token' | 'hh_token_expires_at' | 'hh_refresh_token'>,
): Promise<{ token: string } | null> {
  if (!user.hh_token) return null;

  /*
   * Расшифровка ЗДЕСЬ, а не в SQL и не в типе User.
   *
   * Колонка хранит шифротекст, а всё остальное приложения работает с
   * настоящим токеном. Расшифровка на границе — единственное место, где
   * известен ключ; если расшифровать в getUserById, то ключ понадобился бы
   * и там, где токен не нужен, и любая ошибка ключа роняла бы просмотр
   * профиля вместо авторизации hh.
   */
  const accessToken = decryptSecret(user.hh_token);
  const refreshToken = decryptSecret(user.hh_refresh_token);
  if (!accessToken) return null;

  /*
   * Срок не задан — токен всё равно пробуем.
   *
   * Раньше здесь стояло условие `hh_token_expires_at && ... > Date.now()`, и при
   * незаполненном сроке функция молча возвращала null. Автоотклик на этом
   * просто ничего не отправлял: человек привязал аккаунт, видел «всё
   * настроено», а откликов не было и объяснения тоже. Это худший вид отказа
   * — тихий.
   *
   * Проверить срок нечем, но и отказываться на этом основании незачем: если
   * токен протух, hh ответит 401, провайдер вернёт ошибку, сработает backoff
   * анти-бана и статус будет виден. Лучше один отказ с причиной, чем тишина.
   */
  const expiresAt = user.hh_token_expires_at ?? 0;
  if (expiresAt === 0 || expiresAt > Date.now() + 60_000) {
    return { token: accessToken };
  }

  // Срок ушёл в прошлое, но обновить нечем (нет refresh_token или OAuth не
  // настроен) — пробуем старый: он мог оказаться живым, а мог и нет.
  if (!refreshToken || !hhConfigured()) {
    return { token: accessToken };
  }

  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed.access_token) {
    return { token: accessToken };
  }
  db.prepare(
    `UPDATE users SET hh_token = ?, hh_token_expires_at = ?, hh_refresh_token = ? WHERE id = ?`,
  ).run(
    /*
     * Токен пишется зашифрованным — ровно как в saveHhConnection.
     *
     * Раньше здесь стоял `refreshed.access_token` открытым текстом, при том что
     * колонка объявлена шифротекстом и соседний писатель шифрует. Итог был
     * ровно тот, ради которого шифрование и затевалось: бэкап базы переставал
     * быть списком аккаунтов только до первого обновления токена — а refresh
     * происходит каждый час, то есть практически сразу. Строка при этом ещё и
     * оставалась наполовину зашифрованной (hh_token открытым, hh_refresh_token
     * шифротекстом) — состояние, на которое миграция не рассчитана.
     *
     * Молчаливым это не было только потому, что decryptSecret на значении без
     * префикса `v1:` работает как проходная: чтение не падало, и баг не
     * проявлялся ни в логах, ни в тестах.
     */
    encryptSecret(refreshed.access_token),
    Date.now() + Math.max(refreshed.expires_in ?? 3600, 60) * 1000,
    encryptSecret(refreshed.refresh_token ?? refreshToken),
    user.id,
  );
  return { token: refreshed.access_token };
}
