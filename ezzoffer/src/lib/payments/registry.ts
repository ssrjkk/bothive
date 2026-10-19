import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MethodId, PaymentProvider, PaymentIntent, VerifiedEvent } from './types';
import { catalogItem } from './catalog';

/**
 * Реестр способов оплаты.
 *
 * Здесь и только здесь решается, какие способы существуют. Роут вебхука,
 * выдача прав и страница тарифов спрашивают реестр и ничего не знают про
 * конкретные методы — поэтому «внедрить по одной кнопке» означает добавить
 * одну реализацию и одну строку регистрации.
 */

/** Общий секрет подписи вебхуков. Без него в провайдере нет смысла. */
function hmacSecret(): string {
  return process.env.PAYMENT_HMAC_SECRET ?? '';
}

function requireSecret(): string {
  const s = hmacSecret();
  if (!s) throw new Error('PAYMENT_HMAC_SECRET не задан: вебхуки принимать нельзя');
  return s;
}

/** HMAC-SHA256 по телу запроса, hex. */
function sign(body: string): string {
  return createHmac('sha256', requireSecret()).update(body).digest('hex');
}

/** Сравнение подписей за постоянное время. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Парсер тела вебхука: ожидаем ровно то, что умеем разобрать. */
function parseEvent(body: string, method: MethodId): VerifiedEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  /*
   * Два события, а не одно. Раньше принимался только "paid", а возврат
   * отбрасывался как «неизвестный формат» (verify → null → 401): деньги
   * возвращались, а права оставались. Подпись-то при этом сходилась — ответ
   * 401 врал про причину.
   */
  if (data.event !== 'paid' && data.event !== 'refunded') return null;

  const externalId = typeof data.paymentId === 'string' ? data.paymentId : '';
  const planId = typeof data.planId === 'string' ? data.planId : '';
  const userId = Number(data.userId);
  if (!externalId || !planId || !Number.isSafeInteger(userId) || userId <= 0) return null;

  /*
   * Сумма берётся из каталога, а не из тела вебхука. Иначе провайдер (или
   * подделка) прислал бы planId: "expert" с amount: 1, и проверка прошла бы.
   */
  const item = catalogItem(planId);
  if (!item) return null;

  return {
    externalId,
    userId,
    planId,
    amountRub: item.priceRub,
    method,
    paidAt: Number.isFinite(Number(data.paidAt)) ? Number(data.paidAt) : Date.now(),
    kind: data.event,
  };
}

/** Общая основа: одна и та же проверка подписи для всех методов. */
function hmacProvider(
  id: MethodId,
  title: string,
  opts?: { walletEnv?: string; noCheckoutReason?: string },
): PaymentProvider {
  return {
    id,
    title,
    ready: () => {
      if (!hmacSecret()) return false;
      if (opts?.walletEnv) return Boolean(process.env[opts.walletEnv]);
      return true;
    },
    reason: () => {
      if (!hmacSecret()) return 'PAYMENT_HMAC_SECRET не задан на сервере';
      if (opts?.walletEnv && !process.env[opts.walletEnv])
        return `Кошелёк не задан (${opts.walletEnv})`;
      return null;
    },
    /*
     * Счёт выставляет только способ с адресом. Карта и СБП принимают вебхуки
     * (подпись проверяется общим секретом), но начать оплату ими нельзя:
     * эквайринг не подключён, и createIntent вернул бы номер счёта, платить
     * по которому некуда. Клиент при этом показывал «Готово» — человек думал,
     * что оплатил, а платить было некуда.
     */
    canCheckout: () => {
      if (!hmacSecret()) return false;
      if (opts?.walletEnv) return Boolean(process.env[opts.walletEnv]);
      return !opts?.noCheckoutReason;
    },
    checkoutReason: () => {
      if (!hmacSecret()) return 'PAYMENT_HMAC_SECRET не задан на сервере';
      if (opts?.walletEnv && !process.env[opts.walletEnv])
        return `Кошелёк не задан (${opts.walletEnv})`;
      return opts?.noCheckoutReason ?? null;
    },
    createIntent: ({ userId }): PaymentIntent => {
      const invoiceId = `inv_${id}_${userId}_${Date.now().toString(36)}`;
      const intent: PaymentIntent = { invoiceId, expiresInMs: 30 * 60 * 1000 };
      if (opts?.walletEnv) intent.address = process.env[opts.walletEnv];
      return intent;
    },
    verify: ({ body, headers }) => {
      const provided = headers.get('x-signature') ?? '';
      if (!provided || !hmacSecret()) return null;
      if (!safeEqual(sign(body), provided)) return null;
      return parseEvent(body, id);
    },
  };
}

const providers = new Map<string, PaymentProvider>();

/** Регистрация всех способов. Вызывается один раз при старте и в тестах. */
export function registerProviders(): void {
  providers.clear();
  providers.set(
    'card',
    hmacProvider('card', 'Карта', { noCheckoutReason: 'Онлайн-оплата картой не подключена' }),
  );
  providers.set(
    'sbp',
    hmacProvider('sbp', 'СБП', { noCheckoutReason: 'Оплата через СБП не подключена' }),
  );
  providers.set(
    'crypto_usdt',
    hmacProvider('crypto_usdt', 'Крипта (USDT)', { walletEnv: 'PAYMENT_CRYPTO_USDT_WALLET' }),
  );
}

export const registry = {
  get: (id: string): PaymentProvider | undefined => providers.get(id),
  has: (id: string): boolean => providers.has(id),
  all: (): PaymentProvider[] => [...providers.values()],
};

registerProviders();
