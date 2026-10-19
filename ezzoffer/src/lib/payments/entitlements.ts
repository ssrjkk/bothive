import { db } from '../db';
import { logError } from '../logger';
import { catalogItem } from './catalog';
import type { VerifiedEvent } from './types';

/**
 * Права доступа по факту оплаты.
 *
 * Права хранятся отдельно от users.plan сознательно. `plan` — это то, чем
 * пользователь пользуется сейчас, и он перезаписывается пробным периодом,
 * отменой и любым будущим переходом. История оплат — это другое: она не
 * переписывается никогда, и именно из неё видно, что человек заплатил.
 *
 * Идемпотентность по external_id: провайдеры любят доставлять вебхук дважды
 * (и не зря), и вторая доставка не должна ни продлевать подписку ещё на раз,
 * ни падать.
 */

export type Entitlement = {
  id: number;
  user_id: number;
  plan_id: string;
  method: string;
  expires_at: number | null;
  created_at: number;
};

/**
 * Выдать права по подтверждённому событию.
 *
 * Возвращает false, если платёж уже записан или записать нельзя. Никогда не
 * бросает: повторная доставка — норма, а исключение из grant превращалось в
 * 500 на вебхуке, и провайдер слал poison-сообщение вечно.
 */
export function grant(event: VerifiedEvent): boolean {
  const item = catalogItem(event.planId);
  if (!item) return false;

  /*
   * Идемпотентность — по паре (провайдер, внешний id), а не по голому id.
   *
   * Раньше проверка шла только по external_id, а он в схеме UNIQUE глобально.
   * Формат paymentId задаёт внешняя сторона, и два разных способа оплаты
   * вправе выдать одинаковый номер: тогда второй (легитимный) платёж
   * отклонялся как «уже записан», а человек оставался без тарифа за свои
   * деньги. Пара (provider, external_id) — это настоящий ключ события.
   */
  const existing = db
    .prepare('SELECT id FROM payments WHERE provider = ? AND external_id = ?')
    .get(event.method, event.externalId) as { id: number } | undefined;
  if (existing) return false;

  /*
   * Время оплаты ограничивается сверху текущим.
   *
   * paidAt приходит снаружи (подпись подтверждает авторство, а не честность
   * часов), и срок подписки считается от него: paidAt из будущего продлевал
   * бы подписку из воздуха. В прошлое ограничение не ставится: вебхук вправе
   * опоздать, и честная задержка не должна съедать оплаченные дни.
   */
  const now = Date.now();
  const paidAt =
    Number.isFinite(event.paidAt) && event.paidAt > 0 ? Math.min(event.paidAt, now) : now;
  const expiresAt = item.permanent ? null : paidAt + item.days * 86_400_000;

  let applied = false;
  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO payments (user_id, external_id, provider, plan_id, amount_rub, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(event.userId, event.externalId, event.method, event.planId, event.amountRub, paidAt);

      db.prepare(
        `INSERT INTO entitlements (user_id, plan_id, source_payment_id, expires_at, created_at)
         VALUES (?, ?, (SELECT id FROM payments WHERE provider = ? AND external_id = ?), ?, ?)`,
      ).run(event.userId, event.planId, event.method, event.externalId, expiresAt, paidAt);

      /*
       * users.plan обновляется здесь же, потому что весь продукт читает именно
       * его. Постоянный тариф ставит plan_expires_at в NULL — «вечно» не может
       * значить «через год».
       */
      db.prepare(
        'UPDATE users SET plan = ?, plan_period = ?, plan_expires_at = ? WHERE id = ?',
      ).run(event.planId, item.permanent ? 0 : item.days, expiresAt, event.userId);
    })();
    applied = true;
  } catch (err) {
    /*
     * Сюда попадают детерминированные ошибки: нет такого пользователя (FK),
     * гонка двух доставок (UNIQUE). Бросать их наружу — значит отвечать 500 и
     * получать то же сообщение снова: poison-доставка крутилась бы вечно.
     * Возвращаем false, роут отвечает 200 с applied:false, причина — в логе.
     */
    logError('payments:grant', err instanceof Error ? err : new Error(String(err)), {
      externalId: event.externalId,
      userId: event.userId,
    });
  }

  return applied;
}

/**
 * Отзыв прав по возврату.
 *
 * Закрывает только права, выданные ЭТИМ платежом (по source_payment_id), —
 * а не все права плана. У человека может быть два платежа за один план
 * (продление): возврат одного не должен убивать второй, за который деньги
 * не возвращались.
 *
 * Журнал payments не трогается: возврат — это тоже событие истории, а не
 * отмена прошлого.
 *
 * Возвращает false, если отзывать нечего (платежа не было или права уже
 * закрыты). Как и grant, не бросает: повторная доставка — норма.
 */
export function revoke(event: VerifiedEvent): boolean {
  try {
    const payment = db
      .prepare('SELECT id, user_id, plan_id FROM payments WHERE provider = ? AND external_id = ?')
      .get(event.method, event.externalId) as
      { id: number; user_id: number; plan_id: string } | undefined;
    // Платёж чужой или его не было: отзывать нечего. Молча false, а не ошибка —
    // порядок доставок «refund раньше paid» возможен при ретраях.
    if (!payment || payment.user_id !== event.userId || payment.plan_id !== event.planId) {
      return false;
    }

    const now = Date.now();
    const closed = db
      .prepare(
        `UPDATE entitlements SET expires_at = ?
         WHERE source_payment_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .run(now, payment.id, now);
    if (closed.changes === 0) return false;

    /*
     * Витрина users.plan приводится к остатку прав.
     *
     * Остались действующие права (второй платёж) — срок витрины ставится по
     * самому дальнему из них, а не остаётся от отозванного. Не осталось
     * вовсе — план сбрасывается в none: у вечного тарифа isPlanActive срок
     * не смотрит, и гасить сроком его было бы нельзя — возврат оставлял бы
     * подписку.
     */
    const rest = db
      .prepare(
        `SELECT COUNT(*) AS c, MAX(expires_at) AS farthest FROM entitlements
         WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(event.userId, now) as { c: number; farthest: number | null };
    if (rest.c > 0) {
      db.prepare('UPDATE users SET plan_expires_at = ? WHERE id = ?').run(
        rest.farthest,
        event.userId,
      );
    } else {
      db.prepare("UPDATE users SET plan = 'none', plan_expires_at = NULL WHERE id = ?").run(
        event.userId,
      );
    }
    return true;
  } catch (err) {
    logError('payments:revoke', err instanceof Error ? err : new Error(String(err)), {
      externalId: event.externalId,
      userId: event.userId,
    });
    return false;
  }
}

/** Есть ли у человека хоть одно действующее право. */
export function hasActiveEntitlement(userId: number): boolean {
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM entitlements
       WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(userId, now) as { c: number };
  return row.c > 0;
}

export function listEntitlements(userId: number): Entitlement[] {
  return db
    .prepare('SELECT * FROM entitlements WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Entitlement[];
}
