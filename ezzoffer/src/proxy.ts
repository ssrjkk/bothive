import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, rotateSession, isHttpsRequest } from '@/lib/auth';
import { rateLimit, rateLimitKey, ANONYMOUS_RATE_LIMIT } from '@/lib/rate-limit';

const API_RATE_LIMIT = { windowMs: 60_000, max: 60 };

/**
 * Серверные «машины» без браузерного Origin-заголовка.
 *
 * Защищены собственными секретами — TELEGRAM_WEBHOOK_SECRET, CRON_SECRET,
 * PAYMENT_HMAC_SECRET, — поэтому проверка Origin к ним неприменима: провайдер
 * её не присылает, и без исключения запрос был бы отвергнут на 403 ДО того,
 * как выполнится проверка подписи в самом роуте.
 *
 * Список пополняется по мере подключения интеграций, и это единственное
 * место, где такое исключение вообще возможно: deny-by-default означает, что
 * забытый путь выглядит как «интеграция молча не работает».
 *
 * `/api/payments/webhook` был в этом списке отсутствующим, и это ломало
 * оплату целиком: подпись считалась бы верной, а человек всё равно не
 * получил бы тариф, потому что до роута дело не доходило.
 */
const SERVER_TO_SERVER: string[] = [
  '/api/telegram/webhook',
  '/api/autoapply/run',
  '/api/payments/webhook',
];

// Rate-limiter хранит состояние в памяти — при нескольких инстансах сервера
// используйте внешний хранилище (Redis) или один инстанс.

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  if (!token && pathname.startsWith('/dashboard')) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (token && pathname.startsWith('/dashboard')) {
    const rotated = rotateSession(token);
    if (rotated) {
      const res = NextResponse.next();
      res.cookies.set(SESSION_COOKIE, rotated.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        expires: new Date(rotated.expiresAt),
        // isHttpsRequest, а не сравнение заголовка: в цепочке прокси
        // x-forwarded-proto бывает "https, http" — точное сравнение сняло бы
        // флаг Secure с ротированной сессии.
        secure: isHttpsRequest(request),
      });
      return res;
    }
  }

  const method = request.method.toUpperCase();
  const isServerRoute = SERVER_TO_SERVER.some((p) => pathname.startsWith(p));
  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    method !== 'OPTIONS' &&
    pathname.startsWith('/api') &&
    !isServerRoute
  ) {
    const origin = request.headers.get('origin');
    if (!origin) {
      return NextResponse.json({ error: 'Запрос отклонён: отсутствует Origin' }, { status: 403 });
    }
    const host = request.headers.get('host') ?? '';
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: 'Запрос отклонён: некорректный Origin' }, { status: 403 });
    }
    if (originHost !== host) {
      return NextResponse.json({ error: 'Запрос отклонён: чужой Origin' }, { status: 403 });
    }

    const key = rateLimitKey(request, 'api');
    // Общий бакет есть только у анонимов без IP и без сессии — у них потолок
    // выше, иначе один такой клиент выбивал бы квоту у всех авторизованных.
    const limiter = rateLimit(key, key.endsWith(':anon') ? ANONYMOUS_RATE_LIMIT : API_RATE_LIMIT);
    if (!limiter.allowed) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
      );
    }
  } else if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    method !== 'OPTIONS' &&
    pathname.startsWith('/api') &&
    isServerRoute
  ) {
    // Серверные роуты без Origin всё равно ограничиваем — иначе их секрет
    // можно перебирать неограниченное число раз.
    const key = rateLimitKey(request, 'srv');
    const limiter = rateLimit(
      key,
      key.endsWith(':anon') ? ANONYMOUS_RATE_LIMIT : { windowMs: 60_000, max: 30 },
    );
    if (!limiter.allowed) {
      return NextResponse.json(
        { error: 'Слишком много запросов' },
        { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
