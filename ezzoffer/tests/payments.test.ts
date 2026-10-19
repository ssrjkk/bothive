import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

/**
 * Фундамент оплаты: способы, вебхуки, права доступа.
 *
 * Главное здесь — не каталог, а одно свойство: вебхук обязан быть
 * неподделываемым. Роут, который без проверки подписи выдаёт план, — дыра,
 * через которую любой желающий получает «вечную подписку» одним POST-ом.
 * Поэтому проверяется поведением: подделанный запрос отвергнут, подписанный
 * принят, повторная доставка не выдаёт права дважды.
 *
 * Вторая вещь: способ оплаты добавляется РЕГИСТРАЦИЕЙ, а не правкой кода
 * выдачи прав. Именно это и означает «внедрить по одной кнопке».
 */

const SECRET = 'test-secret-do-not-use-in-prod';

/** Модули достаются лениво: роут тянет БД при импорте. */
const entitlements = () => import('../src/lib/payments/entitlements');
const registry = () => import('../src/lib/payments/registry');
const webhook = () => import('../src/app/api/payments/webhook/[provider]/route');
const catalog = () => import('../src/lib/payments/catalog');

let db: ReturnType<typeof import('../src/lib/db').createDatabase>;

const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

function hook(body: string, sig: string | null, provider = 'card') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== null) headers['x-signature'] = sig;
  return new Request(`http://localhost/api/payments/webhook/${provider}`, {
    method: 'POST',
    headers,
    body,
  });
}

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

before(async () => {
  const { useInMemoryDb } = await import('./helpers/route-session');
  useInMemoryDb({
    PAYMENT_HMAC_SECRET: SECRET,
    PAYMENT_CRYPTO_USDT_WALLET: 'TTestWalletAddress123',
  });
  db = (await import('../src/lib/db')).db;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (1, 'pay@test', 'h', 'none', NULL, ?, 1)`,
  ).run(Date.now());
  (await registry()).registerProviders();
});

test('каталог: у каждого тарифа есть цена и способы оплаты', async () => {
  const { CATALOG } = await catalog();
  for (const item of CATALOG) {
    assert.ok(item.methods.length > 0, `у тарифа ${item.id} нет ни одного способа оплаты`);
  }
  const methods = new Set(CATALOG.flatMap((c) => c.methods));
  for (const m of ['card', 'sbp', 'crypto_usdt']) {
    assert.ok(methods.has(m as never), `способ оплаты ${m} не зарегистрирован`);
  }
});

test('бета-подписка не имеет срока', async () => {
  const { CATALOG } = await catalog();
  const life = CATALOG.find((c) => c.lifetime);
  assert.ok(life, 'вечной тариф не заведён');
  assert.ok(life.permanent, 'вечной тариф не помечен permanent — срок в plan_expires_at останется');
});

test('поддельный вебхук не выдаёт права', async () => {
  const { POST } = await webhook();
  const { hasActiveEntitlement } = await entitlements();
  const body = JSON.stringify({
    event: 'paid',
    planId: 'beta_life',
    paymentId: 'fake-1',
    userId: 1,
  });

  const res = await POST(hook(body, 'deadbeef'), params('card'));
  assert.equal(res.status, 401, `поддельный вебхук обработан как ${res.status}`);
  assert.equal(hasActiveEntitlement(1), false, 'поддельный вебхок выдал права');
});

test('вебхук без подписи отвергнут', async () => {
  const { POST } = await webhook();
  const body = JSON.stringify({
    event: 'paid',
    planId: 'beta_life',
    paymentId: 'nosig-1',
    userId: 1,
  });
  assert.equal((await POST(hook(body, null), params('card'))).status, 401);
});

test('подпись, посчитанная чужим секретом, отвергнута', async () => {
  const { POST } = await webhook();
  const body = JSON.stringify({
    event: 'paid',
    planId: 'beta_life',
    paymentId: 'wrong-1',
    userId: 1,
  });
  const res = await POST(hook(body, sign(body, 'wrong-secret')), params('card'));
  assert.equal(res.status, 401, `подпись с чужим секретом принята: ${res.status}`);
});

test('подписанный вебхук выдаёт права', async () => {
  const { POST } = await webhook();
  const { hasActiveEntitlement, listEntitlements } = await entitlements();
  const body = JSON.stringify({
    event: 'paid',
    planId: 'beta_life',
    paymentId: 'good-1',
    userId: 1,
  });

  const res = await POST(hook(body, sign(body)), params('card'));
  assert.equal(res.status, 200, `подписанный вебхук отвергнут: ${res.status}`);
  assert.equal(hasActiveEntitlement(1), true, 'подписанный вебхук не выдал права');

  const user = db.prepare('SELECT plan, plan_expires_at FROM users WHERE id = 1').get() as {
    plan: string;
    plan_expires_at: number | null;
  };
  assert.equal(user.plan, 'beta_life');
  assert.equal(user.plan_expires_at, null, 'у вечной подписки поставлен срок — она кончится сама');

  const list = listEntitlements(1);
  assert.equal(list.length, 1);
  assert.equal(list[0].expires_at, null, 'у вечного права записан срок');
});

test('повторная доставка вебхука не выдаёт права дважды', async () => {
  const { POST } = await webhook();
  const { listEntitlements } = await entitlements();
  const body = JSON.stringify({ event: 'paid', planId: 'pro', paymentId: 'dup-1', userId: 1 });
  const sig = sign(body);
  const url = params('card');

  const first = await POST(hook(body, sig), url);
  const second = await POST(hook(body, sig), url);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200, 'повтор отвергнут — провайдер будет слать снова вечно');

  const rows = db
    .prepare("SELECT COUNT(*) AS c FROM payments WHERE external_id = 'dup-1'")
    .get() as {
    c: number;
  };
  assert.equal(rows.c, 1, `повторная доставка записала оплату ещё раз: ${rows.c}`);
  assert.equal(
    listEntitlements(1).filter((e) => e.plan_id === 'pro').length,
    1,
    'права выданы дважды',
  );
});

test('неизвестный провайдер — 404, а не тихий успех', async () => {
  const { POST } = await webhook();
  const res = await POST(hook('{}', sign('{}')), params('квас'));
  assert.equal(res.status, 404, `неизвестный провайдер обработан как ${res.status}`);
});

test('сумма берётся из каталога, а не из тела вебхука', async () => {
  const { POST } = await webhook();
  const body = JSON.stringify({
    event: 'paid',
    planId: 'expert',
    paymentId: 'amt-1',
    userId: 1,
    amountRub: 1,
  });
  const res = await POST(hook(body, sign(body)), params('card'));
  assert.equal(res.status, 200);

  const row = db.prepare("SELECT amount_rub FROM payments WHERE external_id = 'amt-1'").get() as {
    amount_rub: number;
  };
  assert.equal(row.amount_rub, 4990, `в запись попала сумма из тела вебхука: ${row.amount_rub}`);
});

test('крипта-способ включён и берёт адрес кошелька из окружения', async () => {
  const { registry: reg } = await registry();
  const crypto = reg.get('crypto_usdt');
  assert.ok(crypto, 'крипта-способ не зарегистрирован');
  assert.equal(crypto.ready(), true, 'кошелёк из окружения не подхвачен');
  const intent = crypto.createIntent({ userId: 1, planId: 'beta_life' });
  assert.equal(intent.address, 'TTestWalletAddress123');
  assert.ok(intent.invoiceId.length > 0, 'нет идентификатора инвойса');
});

test('крипта-способ без адреса честно говорит, что не готов', async () => {
  const { registerProviders, registry: reg } = await registry();
  const saved = process.env.PAYMENT_CRYPTO_USDT_WALLET;
  delete process.env.PAYMENT_CRYPTO_USDT_WALLET;
  try {
    registerProviders();
    const crypto = reg.get('crypto_usdt')!;
    assert.equal(crypto.ready(), false, 'способ без кошелька заявил готовность');
    assert.match(crypto.reason?.() ?? '', /Кошелёк/i);
  } finally {
    process.env.PAYMENT_CRYPTO_USDT_WALLET = saved;
    registerProviders();
  }
});

test('оплаченный beta_life активен: срок не требуется (regression)', async () => {
  const { POST } = await webhook();
  const { hasActiveEntitlement } = await entitlements();
  const body = JSON.stringify({
    event: 'paid',
    planId: 'beta_life',
    paymentId: 'life-active-1',
    userId: 1,
  });
  const res = await POST(hook(body, sign(body)), params('card'));
  assert.equal(res.status, 200);

  /*
   * Раньше isPlanActive смотрел только на plan_expires_at, а у permanent он
   * NULL — то есть человек платил за «навсегда», а автоотклик его пропускал.
   * Проверяется именно продуктовая функция, а не наличие строки в БД.
   */
  const { isPlanActive } = await import('../src/lib/plans');
  const user = db.prepare('SELECT plan, plan_expires_at FROM users WHERE id = 1').get() as {
    plan: string;
    plan_expires_at: number | null;
  };
  assert.equal(user.plan, 'beta_life');
  assert.equal(user.plan_expires_at, null);
  assert.equal(isPlanActive(user), true, 'оплаченный вечный тариф обязан быть активным');
  assert.equal(hasActiveEntitlement(1), true);
});

test('paidAt из будущего не продлевает подписку из воздуха (regression)', async () => {
  const { POST } = await webhook();
  const before = Date.now();
  const body = JSON.stringify({
    event: 'paid',
    planId: 'pro',
    paymentId: 'future-1',
    userId: 1,
    paidAt: before + 365 * 86_400_000,
  });
  const res = await POST(hook(body, sign(body)), params('card'));
  assert.equal(res.status, 200);

  const row = db
    .prepare(
      "SELECT expires_at FROM entitlements WHERE source_payment_id = (SELECT id FROM payments WHERE external_id = 'future-1')",
    )
    .get() as {
    expires_at: number;
  };
  assert.ok(
    row.expires_at <= before + 30 * 86_400_000 + 5_000,
    `срок посчитан от будущего paidAt: ${new Date(row.expires_at).toISOString()}`,
  );
});

test('одинаковый номер у разных способов — разные платежи (regression)', async () => {
  const { POST } = await webhook();
  const mk = (provider: string) => {
    const body = JSON.stringify({
      event: 'paid',
      planId: 'start',
      paymentId: 'same-no-1',
      userId: 1,
    });
    return POST(hook(body, sign(body), provider), params(provider));
  };
  assert.equal((await mk('card')).status, 200);
  assert.equal((await mk('sbp')).status, 200, 'второй способ с тем же номером отклонён как дубль');

  const rows = db
    .prepare("SELECT COUNT(*) AS c FROM payments WHERE external_id = 'same-no-1'")
    .get() as {
    c: number;
  };
  assert.equal(rows.c, 2, 'платежи разных способов с одним номером обязаны записываться оба');
});

test('возврат отзывает права и гасит план (regression)', async () => {
  /*
   * Раньше событие "refunded" отбрасывал сам verify (там принимался только
   * "paid"): деньги возвращались, а тариф оставался — подписка за чужой счёт.
   *
   * Отдельный пользователь: права в этой базе копятся между тестами, и чужие
   * записи смазали бы проверку hasActiveEntitlement.
   */
  const { POST } = await webhook();
  const { hasActiveEntitlement } = await entitlements();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (21, 'refund@test', 'h', 'none', NULL, ?, 1)`,
  ).run(Date.now());

  const paid = JSON.stringify({ event: 'paid', planId: 'pro', paymentId: 'back-1', userId: 21 });
  assert.equal((await POST(hook(paid, sign(paid)), params('card'))).status, 200);
  assert.equal(hasActiveEntitlement(21), true);

  const refunded = JSON.stringify({
    event: 'refunded',
    planId: 'pro',
    paymentId: 'back-1',
    userId: 21,
  });
  const res = await POST(hook(refunded, sign(refunded)), params('card'));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { applied: boolean }).applied, true);
  assert.equal(hasActiveEntitlement(21), false, 'после возврата права обязаны закрыться');

  const user = db.prepare('SELECT plan FROM users WHERE id = 21').get() as { plan: string };
  assert.equal(user.plan, 'none', 'после возврата план обязан гаснуть, а не висеть');
});

test('возврат без платежа ничего не отзывает', async () => {
  const { POST } = await webhook();
  const body = JSON.stringify({
    event: 'refunded',
    planId: 'pro',
    paymentId: 'never-paid-1',
    userId: 1,
  });
  const res = await POST(hook(body, sign(body)), params('card'));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { applied: boolean }).applied, false);
});

test('возврат одного из двух платежей не убивает второй', async () => {
  const { POST } = await webhook();
  const { hasActiveEntitlement } = await entitlements();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, email_verified)
     VALUES (22, 'multi@test', 'h', 'none', NULL, ?, 1)`,
  ).run(Date.now());

  for (const pid of ['multi-1', 'multi-2']) {
    const paid = JSON.stringify({ event: 'paid', planId: 'start', paymentId: pid, userId: 22 });
    assert.equal((await POST(hook(paid, sign(paid)), params('card'))).status, 200);
  }
  const refunded = JSON.stringify({
    event: 'refunded',
    planId: 'start',
    paymentId: 'multi-1',
    userId: 22,
  });
  await POST(hook(refunded, sign(refunded)), params('card'));

  assert.equal(hasActiveEntitlement(22), true, 'второй платёж обязан держать права');
  const user = db.prepare('SELECT plan FROM users WHERE id = 22').get() as { plan: string };
  assert.equal(user.plan, 'start');
});

test('grant не бросает на несуществующем пользователе (regression)', async () => {
  const { grant } = await entitlements();
  let threw = false;
  let applied = true;
  try {
    applied = grant({
      externalId: 'ghost-1',
      userId: 999_999,
      planId: 'pro',
      amountRub: 2490,
      method: 'card',
      paidAt: Date.now(),
      kind: 'paid',
    });
  } catch {
    threw = true;
  }
  assert.equal(
    threw,
    false,
    'grant обязан возвращать false, а не бросать (иначе 500 и вечные ретраи)',
  );
  assert.equal(applied, false);
});
