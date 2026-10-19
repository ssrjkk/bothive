import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db, type User } from '@/lib/db';
import { isPlanActive } from '@/lib/plans';

/**
 * POST /api/plan — активация тарифа без оплаты.
 *
 * ВАЖНО: это не приём оплаты, а витрина для демонстрации. Настоящие права
 * выдаёт единственный путь — `grant()` в `lib/payments/entitlements` после
 * проверки подписи вебхука провайдера. Здесь подписи нет, платёжного намерения
 * нет и сумма не сверяется ни с чем.
 *
 * ПОЧЕМУ ТАК ОСТОРОЖНО. Раньше роут был открыт всегда, и «Демо-режим:
 * оплата отключена» было текстом ОТВЕТА, а не контролем. Любой, кто
 * зарегистрировался (регистрация не требует подтверждения почты), получал
 * Expert за 4 990 ₽ и мог повторять это каждые 30 дней. При этом UPDATE был
 * безусловным по `plan`, то есть вызов ещё и сбрасывал срок уже оплаченного
 * тарифа и понижал его до «Старта».
 *
 * Что здесь теперь:
 *  1. DEMO_MODE_PLAN=1 — явное согласие оператора. По умолчанию выключено,
 *     и на живом сервере без этой переменной тариф бесплатно не выдаётся.
 *  2. UPDATE никогда не продлевает и не понижает действующий тариф: если
 *     срок ещё не истёк, отказ с объяснением. Иначе один вызов сбрасывал бы
 *     оплаченное время назад.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_PLANS = ['start', 'pro', 'expert'];
const VALID_PERIODS = [7, 14, 30];

/**
 * Разрешена ли бесплатная активация.
 *
 * Строгое сравнение с "1": пустая переменная в .env — это отсутствие, а не
 * согласие. `Boolean(process.env.X)` был бы тем же, что и без проверки.
 */
export function demoPlanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEMO_MODE_PLAN === '1';
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await readJson<{ planId?: string; period?: number }>(request);
  if (error) return error;

  const plan = data?.planId ?? '';
  const period = Number(data?.period ?? 14);
  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Неизвестный тариф' }, { status: 400 });
  }
  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json({ error: 'Неверный период' }, { status: 400 });
  }

  /*
   * Строка пользователя перечитывается до записи, а не берётся из сессии.
   *
   * `requireUser` опирается на сессию, а сессия может пережить саму строку
   * (удалили аккаунт, восстановили БД из бэкапа). Без этой проверки роут дошёл
   * бы до UPDATE по несуществующему id и ответил бы 403 «оплата отключена»
   * там, где правильный ответ — 401: сессия недействительна, пусть человек
   * зайдёт заново.
   *
   * Проверка разбора тела идёт ПЕРЕД ней намеренно: мусор в теле человек
   * исправляет сам, и говорить ему «войдите заново» вместо «неверный период»
   * значит отправить его чинить не то.
   */
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User | undefined;
  if (!fresh) return unauthorized();

  /*
   * Проверка флага — после разбора тела, но до записи.
   *
   * Порядок выбран один: ошибка «неизвестный тариф» полезнее, чем «оплата
   * отключена», когда человек опечатался. И наоборот — при живых провайдерах
   * флаг выключен, и никакая комбинация planId/period не дойдёт до UPDATE.
   */
  if (!demoPlanEnabled()) {
    return NextResponse.json(
      {
        error:
          'Оплата недоступна: тариф активируется после подтверждения оплаты. ' +
          'Напишите нам, если нужно оформить подписку.',
      },
      { status: 403 },
    );
  }

  const now = Date.now();

  /*
   * Активный тариф не трогаем.
   *
   * Раньше UPDATE шёл безусловно, и любой повторный вызов продлевал срок
   * (бесплатно) или понижал план до «Старта», обнуляя оплаченный «Эксперт».
   * Здесь действующий тариф защищён, а истёкший можно сменить честно.
   *
   * Читается свежая строка, а не объект сессии: срок мог истечь между
   * авторизацией и записью, и тогда действующим его считать нельзя.
   *
   * Проверка — через isPlanActive, а не сравнением срока: у вечного тарифа
   * (beta_life) срока нет вовсе, и наивное `expires_at > now` его не видит.
   * Без этого демо-активация сносила бы оплаченное «навсегда» обычным платным.
   */
  if (isPlanActive(fresh)) {
    const until = fresh.plan_expires_at
      ? ` до ${new Date(fresh.plan_expires_at).toLocaleDateString('ru-RU')}`
      : ' (без срока)';
    return NextResponse.json(
      {
        error: `У вас уже действует тариф${until}. Он сменится сам после окончания.`,
      },
      { status: 409 },
    );
  }

  db.prepare(
    `UPDATE users SET plan = ?, plan_period = ?, plan_activated_at = ?, plan_expires_at = ? WHERE id = ?`,
  ).run(plan, period, now, now + period * DAY_MS, user.id);

  // Та же защита, что в /api/trial: отсутствие строки пользователя после
  // прохождения авторизации не должно превращаться в 500 (TypeError на
  // undefined.plan), но означает недействительную сессию.
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User | undefined;
  if (!updated) {
    return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  }
  return Response.json({
    plan: {
      id: updated.plan,
      period: updated.plan_period,
      expires_at: updated.plan_expires_at,
    },
    note: 'Демо-режим: оплата отключена, тариф активирован без списания.',
  });
}
