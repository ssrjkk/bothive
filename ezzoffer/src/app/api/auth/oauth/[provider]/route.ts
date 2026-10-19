import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { authMethod, authMethodReady } from '@/lib/auth-methods';
import { authorizeUrl, createState } from '@/lib/auth/oauth';
import { NO_STORE_HEADERS } from '@/lib/http';

/**
 * GET /api/auth/oauth/[provider] — увести человека к провайдеру.
 *
 * Провайдер берётся из белого списка auth-methods, а не используется как есть:
 * иначе ?provider=https://evil.com увёл бы человека с нашего домена. Ссылка
 * собирается только на разрешённый хост, перечисленный в модуле.
 *
 * `state` — одноразовый код, привязанный к текущему пользователю. Без него
 * работает login CSRF: злоумышленник подсовывает жертве ссылку со своим
 * кодом, и всё, что жертва сделает дальше, достаётся ему.
 *
 * Незалогиненному отвечаем 401, а не редиректом: начать внешний вход можно
 * только из формы входа, где нет пользователя. Условный сценарий «сначала
 * залогиниться, потом продолжить» требует отдельного хранения намерения и
 * не должен выглядеть как работающая кнопка.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { provider } = await ctx.params;

  if (!authMethod(provider)) {
    return NextResponse.json({ error: 'Способ входа неизвестен' }, { status: 404 });
  }
  if (!authMethodReady(provider)) {
    return NextResponse.json(
      { error: 'Этот способ входа не настроен на сервере' },
      { status: 503 },
    );
  }

  const state = createState(user.id);
  const url = authorizeUrl(provider, state);
  if (!url) {
    return NextResponse.json({ error: 'Не удалось построить ссылку входа' }, { status: 502 });
  }

  return Response.json({ url }, { headers: { ...NO_STORE_HEADERS, Location: url } });
}
