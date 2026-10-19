import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db, type User } from '@/lib/db';
import { isPlanActive } from '@/lib/plans';

const TRIAL_MS = 24 * 60 * 60 * 1000;

export async function POST() {
  const user = await requireUser();
  if (!user) return unauthorized();

  if (user.trial_started_at) {
    return NextResponse.json({ error: 'Пробный период уже был активирован' }, { status: 409 });
  }
  /*
   * Проверка — через isPlanActive, а не списком планов: у вечного тарифа
   * (beta_life) срока нет, и наивный список его не видел. Без этого пробник
   * на 24 часа СНОСИЛ оплаченное «навсегда» — та же дыра, что была в /api/plan.
   */
  const fresh = db.prepare('SELECT plan, plan_expires_at FROM users WHERE id = ?').get(user.id) as
    { plan: string; plan_expires_at: number | null } | undefined;
  if (fresh && isPlanActive(fresh)) {
    return NextResponse.json({ error: 'У вас уже активен тариф' }, { status: 409 });
  }

  const now = Date.now();
  db.prepare(
    `UPDATE users SET plan = 'trial', plan_period = 1, plan_activated_at = ?, plan_expires_at = ?, trial_started_at = ? WHERE id = ?`,
  ).run(now, now + TRIAL_MS, now, user.id);

  // Строка пользователя теоретически может исчезнуть между проверкой сессии и
  // записью (удалили аккаунт, восстановили БД из бэкапа). Раньше здесь стояло
  // `as User`, и при отсутствии строки `updated.plan` бросал TypeError —
  // клиент получал 500 вместо внятного ответа. Отвечаем 401: сессия больше
  // недействительна, пусть перезайдёт.
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User | undefined;
  if (!updated) {
    return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
  }
  return Response.json({
    plan: {
      id: updated.plan,
      expires_at: updated.plan_expires_at,
      trial_started_at: updated.trial_started_at,
    },
  });
}
