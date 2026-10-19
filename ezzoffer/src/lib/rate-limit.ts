import { createHash } from 'node:crypto';

export type RateLimitOptions = {
  windowMs?: number;
  max?: number;
};

type Bucket = { timestamps: number[]; lastSeen: number };

type RateLimiterState = {
  buckets: Map<string, Bucket>;
  now: () => number;
};

export function createRateLimiter(): { check: typeof rateLimit } {
  const state: RateLimiterState = {
    buckets: new Map<string, Bucket>(),
    now: Date.now,
  };

  return { check: (key, options) => rateLimit(key, options, state) };
}

const defaultState: RateLimiterState = {
  buckets: new Map<string, Bucket>(),
  now: Date.now,
};

export function rateLimit(
  key: string,
  { windowMs = 15 * 60 * 1000, max = 10 }: RateLimitOptions = {},
  state: RateLimiterState = defaultState,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = state.now();
  let bucket = state.buckets.get(key);

  if (bucket) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
    bucket.lastSeen = now;
  } else {
    bucket = { timestamps: [], lastSeen: now };
  }

  if (bucket.timestamps.length >= max) {
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    // Отклонённый запрос тоже должен сохранить очищенный бакет: иначе
    // просроченные метки остаются в памяти до следующего успешного запроса
    // и buckets-карта растёт без границ.
    state.buckets.set(key, bucket);
    cleanup(state);
    return { allowed: false, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  bucket.timestamps = bucket.timestamps.slice(-max);
  state.buckets.set(key, bucket);
  cleanup(state);
  return { allowed: true, retryAfterSeconds: 0 };
}

/*
 * Сброс бакета. Нужен там, где успешное действие доказывает легитимность:
 * правильный пароль при входе означает, что попытки делал владелец, и
 * накопленный счётчик обязан обнулиться.
 *
 * Без сброса лимит входа работал как ловушка для живых людей: 10 входов за
 * 15 минут (несколько устройств, перевходы) — и владелец получал 429 на
 * собственном аккаунте. Атакующему сброс не помогает: чтобы сбросить чужой
 * бакет, нужен верный пароль, а с верным паролем подбирать уже нечего.
 */
export function resetRateLimit(key: string, state: RateLimiterState = defaultState): void {
  state.buckets.delete(key);
}

const MAX_BUCKETS = 10_000;
const EVICT_BATCH = 500;

function cleanup(state: RateLimiterState): void {
  if (state.buckets.size <= MAX_BUCKETS) return;
  const stale: [string, number][] = [];
  for (const [key, bucket] of state.buckets) stale.push([key, bucket.lastSeen]);
  stale.sort((a, b) => a[1] - b[1]);
  for (const [key] of stale.slice(0, Math.min(EVICT_BATCH, stale.length))) {
    state.buckets.delete(key);
  }
}

export function clientIp(request: Request): string | null {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() || null;
    return request.headers.get('x-real-ip')?.trim() || null;
  }
  return null;
}

/** Значение заголовка cookie без парсинга всего заголовка. */
function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value ? value : null;
  }
  return null;
}

/** Длина префикса, достаточная для уникальности токена, но не раскрывающая его целиком. */
const KEY_PREFIX_LEN = 16;

/**
 * Ключ rate-limit для клиента.
 *
 * Регрессия: proxy.ts писал `clientIp(request) ?? "unknown"`. clientIp()
 * возвращает null, если TRUST_PROXY не выставлен, а это дефолт в .env.example
 * — значит ВСЕ запросы всех пользователей попадали в один бакет `api:unknown`
 * с потолком 60 запросов в минуту. На любом живом трафике сайт отдавал 429
 * всем подряд: 60 запросов суммарно делились между всеми, а не на каждого.
 *
 * Теперь ключ строится по убыванию точности:
 *  1) IP — когда прокси доверенный (TRUST_PROXY=1), самый точный идентификатор;
 *  2) хеш сессионной cookie — стабилен между запросами и не подделывается
 *     без доступа к cookie (httpOnly, SameSite=Lax), поэтому не обходится
 *     простым подменой заголовка;
 *  3) только для анонимных запросов без сессии остаётся общий бакет — но он
 *     помечен как anonymous, и вызывающий код может (и должен) дать ему
 *     больший потолок, чтобы один аноним не выбивал лимит авторизованным.
 */
export function rateLimitKey(request: Request, scope: string): string {
  const ip = clientIp(request);
  if (ip) return `${scope}:ip:${ip}`;

  const session = cookieValue(request, 'ez_session');
  if (session) {
    // Хешируем, чтобы полный токен сессии не оседал ключами в памяти лимитера.
    const digest = createHash('sha256').update(session).digest('hex').slice(0, KEY_PREFIX_LEN);
    return `${scope}:sess:${digest}`;
  }

  return `${scope}:anon`;
}

/**
 * Лимит для анонимных запросов без доверенного IP и без сессии.
 *
 * Все такие запросы делят один бакет по построению, поэтому потолок должен
 * быть заметно выше, чем у identified-клиента: иначе один анонимный клиент
 * выбивает квоту у всех остальных (ровно тот баг, что был исправлен выше).
 */
export const ANONYMOUS_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60_000,
  max: 600,
};
