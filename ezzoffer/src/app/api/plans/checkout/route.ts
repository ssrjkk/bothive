import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { catalogItem } from '@/lib/payments/catalog';
import { registry } from '@/lib/payments/registry';
import { NO_STORE_HEADERS } from '@/lib/http';

/**
 * POST /api/plans/checkout — создать счёт за тариф.
 *
 * Провайдер берётся из реестра способов, а не из тела запроса: иначе клиент
 * мог бы назвать несуществующий способ и получить счёт, который никто не
 * оплатит, а потом и подписку — если бы проверка плана была слабее.
 *
 * Способ, который не готов, честно отвечает 503 с причиной. Молчаливый успех
 * здесь опаснее отказа: человек заплатил бы и не получил бы ничего.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const planId = url.searchParams.get('planId') ?? '';
  const methodId = url.searchParams.get('method') ?? '';

  const item = catalogItem(planId);
  if (!item) return NextResponse.json({ error: 'Тариф неизвестен' }, { status: 400 });

  // Бесплатный тариф оплатой не проходит: это activate, а не checkout.
  if (item.priceRub <= 0) {
    return NextResponse.json({ error: 'Этот тариф не требует оплаты' }, { status: 400 });
  }

  if (!registry.has(methodId)) {
    return NextResponse.json({ error: 'Способ оплаты неизвестен' }, { status: 400 });
  }

  const method = registry.get(methodId)!;
  /*
   * Проверяется умение выставить счёт, а не готовность принимать вебхуки.
   *
   * Раньше здесь стояло method.ready(): карта и СБП его проходили (HMAC-секрет
   * задан), счёт «создавался» — номер без адреса и ссылки, платить некуда, а
   * клиент показывал «Готово». Человек уходил уверенным, что оплатил.
   */
  if (!method.canCheckout()) {
    return NextResponse.json(
      { error: method.checkoutReason?.() ?? 'Способ оплаты не настроен', ready: false },
      { status: 503 },
    );
  }

  try {
    const intent = method.createIntent({ userId: user.id, planId });
    return Response.json(
      { invoiceId: intent.invoiceId, address: intent.address, payUrl: intent.payUrl },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json({ error: 'Не удалось создать счёт' }, { status: 502 });
  }
}
