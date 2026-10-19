import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { authMethod, normalizeIdentity } from '@/lib/auth-methods';
import { consumeState, parseProviderResponse, emailVerifiedFrom } from '@/lib/auth/oauth';
import { db } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { NO_STORE_HEADERS } from '@/lib/http';
import { isHttpsRequest } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/auth';

/**
 * GET /api/auth/oauth/[provider]/callback — возврат от внешнего сервиса.
 *
 * Порядок проверок жёсткий, и менять его нельзя:
 *
 *   1. пользователь есть             → иначе 401;
 *   2. провайдер известен             → иначе 404;
 *   3. state есть и сгорает          → иначе 401 (это и есть защита от CSRF);
 *   4. ответ провайдера подписан      → иначе 401;
 *   5. почта подтверждена провайдером→ иначе 403: аккаунт на
 *      непроверенный адрес заводить нельзя, письмо восстановления уйдёт
 *      туда же, и счёт угонят.
 *
 * Возврат всегда ведёт в кабинет и не показывает провайдерские параметры:
 * код и токен в URL утекают в историю браузера и в логи.
 */
export async function GET(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { provider } = await ctx.params;
  if (!authMethod(provider)) {
    return NextResponse.json({ error: 'Способ входа неизвестен' }, { status: 404 });
  }

  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const stateUserId = consumeState(state);
  // Код одноразовый: повторный возврат с той же ссылкой не пройдёт.
  if (stateUserId !== user.id) {
    return NextResponse.json(
      { error: 'Код возврата недействителен или уже использован. Начните вход заново.' },
      { status: 401 },
    );
  }

  const hash = url.searchParams.get('hash') ?? '';
  const identity = parseProviderResponse(provider, hash);
  if (!identity) {
    return NextResponse.json(
      { error: 'Провайдер не подтвердил вход. Попробуйте ещё раз.' },
      { status: 401 },
    );
  }

  if (!emailVerifiedFrom({ email: identity.email, verified: identity.verified })) {
    return NextResponse.json(
      { error: 'Провайдер не подтвердил адрес почты — аккаунт на таком адресе мы не заводим.' },
      { status: 403 },
    );
  }

  const normalized = normalizeIdentity({
    provider,
    providerId: identity.providerId,
    email: identity.email,
    name: identity.name,
  });
  if (!normalized) {
    return NextResponse.json(
      { error: 'Провайдер вернул данные непригодного вида' },
      { status: 502 },
    );
  }

  /*
   * Вход идёт к СУЩЕСТВУЮЩЕМУ пользователю: аккаунт уже есть, он и создал
   * сессию, потому что вход внешним сервисом доступен только залогиненным.
   * Строка служит для отметки «подключён», и она же защищает от повторной
   * привязки того же адреса дважды.
   */
  const already = db
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .get(normalized.email, user.id) as { id: number } | undefined;
  if (already) {
    return NextResponse.json(
      { error: 'Этот адрес уже привязан к другому аккаунту' },
      { status: 409 },
    );
  }

  db.prepare(
    `INSERT INTO oauth_accounts (user_id, provider, provider_id, email, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_id) DO UPDATE SET email = excluded.email`,
  ).run(user.id, provider, normalized.providerId, normalized.email, Date.now());

  // Сессия уже есть, но ротация обязательна: привязка внешнего аккаунта —
  // это изменение привилегий, и старый токен лучше не оставлять в ссылке.
  const session = createSession(user.id);
  const res = NextResponse.redirect(new URL('/dashboard/settings', url.origin), 303);
  if (isHttpsRequest(request))
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      expires: new Date(session.expiresAt),
    });
  else {
    res.headers.set('Cache-Control', NO_STORE_HEADERS['Cache-Control'] ?? 'no-store');
  }
  return res;
}
