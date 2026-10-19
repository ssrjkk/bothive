import { db, type User } from './db';
import { isPlanActive, planDailyLimit } from './plans';

export type Stats = {
  sent: number;
  viewed: number;
  responded: number;
  invited: number;
  declined: number;
  questions: number;
  viewRate: number;
  respondRate: number;
  inviteRate: number;
  today: number;
  todayLimit: number;
  activeSearches: number;
  withdrawn: number;
  hint: string | null;
  series: { label: string; sent: number; viewed: number; invited: number }[];
};

export function getStats(userId: number): Stats {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const base = db
    .prepare(
      `SELECT
        SUM(CASE WHEN withdrawn = 0 THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN viewed_at IS NOT NULL AND withdrawn = 0 THEN 1 ELSE 0 END) AS viewed,
        SUM(CASE WHEN responded_at IS NOT NULL AND withdrawn = 0 THEN 1 ELSE 0 END) AS responded,
        SUM(CASE WHEN response = 'interview' AND withdrawn = 0 THEN 1 ELSE 0 END) AS invited,
        SUM(CASE WHEN response = 'decline' AND withdrawn = 0 THEN 1 ELSE 0 END) AS declined,
        SUM(CASE WHEN response = 'question' AND withdrawn = 0 THEN 1 ELSE 0 END) AS questions,
        SUM(withdrawn) AS withdrawn
       FROM applications WHERE user_id = ?`,
    )
    .get(userId) as {
    sent: number;
    viewed: number;
    responded: number;
    invited: number;
    declined: number;
    questions: number;
    withdrawn: number;
  };

  const today = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND sent_at >= ? AND withdrawn = 0',
      )
      .get(userId, todayStart.getTime()) as { c: number }
  ).c;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  const activeSearches = (
    db
      .prepare('SELECT COUNT(*) AS c FROM searches WHERE user_id = ? AND active = 1')
      .get(userId) as { c: number }
  ).c;

  const active = isPlanActive(user);
  const limit = active ? planDailyLimit(user.plan) : 0;

  const sent = Number(base.sent);
  const viewed = Number(base.viewed);
  const responded = Number(base.responded);
  const invited = Number(base.invited);
  const declined = Number(base.declined);
  const questions = Number(base.questions);

  const viewRate = sent ? Math.round((viewed / sent) * 100) : 0;
  const respondRate = viewed ? Math.round((responded / viewed) * 100) : 0;
  const inviteRate = sent ? Math.round((invited / sent) * 100) : 0;

  let hint: string | null = null;
  if (sent === 0) {
    hint = active
      ? 'Откликов ещё нет. Откройте раздел «Вакансии», чтобы отправить первый отклик или запустить автопоиск.'
      : 'Активируйте пробный период, чтобы отправлять отклики и видеть статистику.';
  } else if (sent >= 10 && viewRate < 40) {
    hint = 'Просмотров мало — пора усилить резюме и ключевые навыки под вакансии.';
  } else if (viewed >= 10 && respondRate < 35) {
    hint = 'Резюме смотрят, но HR не отвечают — добавьте цифры и результаты в разделы опыта.';
  } else if (responded >= 10 && inviteRate < 20) {
    hint =
      'Отклики доходят, но приглашений мало — проверьте сопроводительное письмо и зарплатные ожидания.';
  } else if (sent >= 1) {
    hint = 'Воронка в норме. Держите темп: чем больше откликов — тем выше шанс оффера.';
  }

  const series: Stats['series'] = [];
  for (let d = 6; d >= 0; d--) {
    const dayStart = new Date(todayStart);
    dayStart.setDate(dayStart.getDate() - d);
    const next = new Date(dayStart);
    next.setDate(next.getDate() + 1);
    const row = db
      .prepare(
        `SELECT
          COUNT(*) AS sent,
          SUM(CASE WHEN viewed_at IS NOT NULL THEN 1 ELSE 0 END) AS viewed,
          SUM(CASE WHEN response = 'interview' THEN 1 ELSE 0 END) AS invited
         FROM applications
         WHERE user_id = ? AND sent_at >= ? AND sent_at < ? AND withdrawn = 0`,
      )
      .get(userId, dayStart.getTime(), next.getTime()) as {
      sent: number;
      viewed: number;
      invited: number;
    };
    const label = dayStart.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    series.push({
      label,
      sent: Number(row.sent),
      viewed: Number(row.viewed),
      invited: Number(row.invited),
    });
  }

  return {
    sent,
    viewed,
    responded,
    invited,
    declined,
    questions,
    viewRate,
    respondRate,
    inviteRate,
    today,
    todayLimit: limit,
    activeSearches,
    withdrawn: Number(base.withdrawn),
    hint,
    series,
  };
}
