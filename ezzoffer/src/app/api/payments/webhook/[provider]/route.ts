import { NextResponse } from 'next/server';
import { registry } from '@/lib/payments/registry';
import { grant, revoke } from '@/lib/payments/entitlements';

/**
 * POST /api/payments/webhook/[provider] — приём подтверждения об оплате.
 *
 * Роут намеренно БЕЗ сессии: вебхук приходит от провайдера, а не от
 * человека, и у него нет cookie. Доверие даёт не авторизация, а подпись.
 *
 * Порядок проверок именно такой, и это единственный порядок, при котором
 * безопасно:
 *   1. провайдер известен            → иначе 404;
 *   2. секрет подписи задан          → иначе 503, а не «проверка пройдена»;
 *   3. подпись сошлась               → иначе 401;
 *   4. событие разобрано             → иначе 400;
 *   5. сумма сверена с каталогом;
 *   6. права выданы идемпотентно.
 *
 * Ответ всегда 200 на «всё хорошо» и на «уже применено»: провайдер считает
 * не-2xx ошибкой доставки и будет слать снова, пока не перестанет. Повтор
 * безвреден — выдача идемпотентна.
 */
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const impl = registry.get(provider);
  if (!impl) {
    return NextResponse.json({ error: 'Неизвестный способ оплаты' }, { status: 404 });
  }

  // Секрет настроен на сервере? Иначе проверять нечем и принимать нельзя.
  if (!impl.ready() && !impl.reason?.()) {
    return NextResponse.json({ error: 'Способ оплаты не настроен' }, { status: 503 });
  }

  const body = await request.text();
  const event = impl.verify({ body, headers: request.headers });
  if (!event) {
    return NextResponse.json(
      { error: 'Подпись не сошлась или формат неизвестен' },
      { status: 401 },
    );
  }

  /*
   * Возврат отзывает права, а не выдаёт. Раньше событие "refunded" отбрасывал
   * сам verify (там принимался только "paid"): деньги возвращались, а тариф
   * оставался — подписка за чужой счёт.
   */
  const applied = event.kind === 'refunded' ? revoke(event) : grant(event);
  return NextResponse.json({ ok: true, applied, externalId: event.externalId });
}
