import { db } from './db';
import { notifyUser, sendTelegramMessage, escapeHtml } from './telegram';
import { mainKeyboard } from './telegram-keyboard';
import type { ApplicationRow } from './applications';

/**
 * Уведомления в Telegram.
 *
 * Модуль создан потому, что `notifyUser` и `notifyAll` были написаны и не
 * вызывались ниоткуда: бот обещал «прогресс придёт сообщением», а сообщения
 * не приходили никогда. Показывать прогресс можно было только тем, кто открывал
 * кабинет, — то есть ровно тем, кто ради экономии времени и подключал бота.
 *
 * Два правила, без которых уведомления вреднее их отсутствия:
 *
 * 1. Тишина лучше шума. Приглашение на собеседование человек ждёт часами, а
 *    «вы отказались на 12 вакансиях» — нет. Поэтому отклики приходят одним
 *    дайджестом, а приглашения и ответы — сразу и по одному.
 *
 * 2. Повтор недопустим. Синхронизация с hh идёт по расписанию и видит одно и
 *    то же состояние, пока человек не откроет отклик. Без отметки о
 *    прочитанном приглашение приходило бы снова и снова.
 */

/** Ключ последней отправки дайджеста, чтобы не слать его каждый тик. */
const DIGEST_KEY = 'telegram:last_digest';

/** Минимальный интервал между дайджестами об откликах. */
const DIGEST_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type DigestWindow = {
  applied: number;
  withLetter: number;
  viewed: number;
  responded: number;
  invites: number;
  declines: number;
};

/**
 * Что произошло с откликами пользователя за окно.
 *
 * Считается по самой таблице откликов, а не по метаданным прогона: так в окно
 * попадает всё, что человек сделал в кабинете вручную, и это не зависит от того,
 * был ли плановый прогон в этом тике.
 */
export function digestWindow(userId: number, sinceMs: number): DigestWindow {
  /*
   * Приглашения и отказы считаются по `response`, а не по `status`.
   *
   * Раньше стояло `status = 'invited'`, и это значение НЕ ПИСАЛОСЬ НИГДЕ —
   * синхронизация с hh записывала приглашение как `status='responded'`.
   * То есть счётчик приглашений был нулём всегда, и человек, которого
   * пригласили на собеседование, получал сообщение «HR ответил на отклик»
   * вместо «Приглашение на собеседование» — без совета подготовиться.
   *
   * Теперь источник один и тот же, что и в `stats.ts`: `response`. И
   * `responded_at IS NOT NULL` в условии — иначе приглашение попадало бы в
   * окно дайджеста сразу после отправки отклика, то есть задолго до того,
   * как площадка на него ответила.
   */
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS applied,
         SUM(CASE WHEN message != '' THEN 1 ELSE 0 END) AS withLetter,
         SUM(CASE WHEN viewed_at IS NOT NULL THEN 1 ELSE 0 END) AS viewed,
         SUM(CASE WHEN responded_at IS NOT NULL THEN 1 ELSE 0 END) AS responded,
         SUM(CASE WHEN response = 'interview' AND responded_at IS NOT NULL THEN 1 ELSE 0 END) AS invites,
         SUM(CASE WHEN response = 'decline' AND responded_at IS NOT NULL THEN 1 ELSE 0 END) AS declines
       FROM applications
       WHERE user_id = ? AND sent_at >= ? AND withdrawn = 0`,
    )
    .get(userId, sinceMs) as Record<string, number | null> | undefined;

  return {
    applied: Number(row?.applied ?? 0),
    withLetter: Number(row?.withLetter ?? 0),
    viewed: Number(row?.viewed ?? 0),
    responded: Number(row?.responded ?? 0),
    invites: Number(row?.invites ?? 0),
    declines: Number(row?.declines ?? 0),
  };
}

/**
 * Текст дайджеста.
 *
 * Отдельная функция без БД и сети: проверять надо именно формулировки, потому
 * что это единственное, что человек видит, и ошибка здесь стоит доверия.
 */
export function formatDigest(user: { id: number }, w: DigestWindow): string | null {
  // Молчать, когда нечего сказать. Пустое «за последние 6 часов ничего не
  // произошло» хуже отсутствия сообщения: человек перестаёт открывать бота.
  if (
    w.applied === 0 &&
    w.viewed === 0 &&
    w.responded === 0 &&
    w.invites === 0 &&
    w.declines === 0
  ) {
    return null;
  }

  const lines: string[] = [];

  if (w.invites > 0) {
    lines.push(
      w.invites === 1
        ? '🎉 Приглашение на собеседование!'
        : `🎉 Приглашений на собеседование: ${w.invites}`,
    );
  }

  if (w.applied > 0) {
    const withLetter = w.withLetter === w.applied;
    lines.push(
      `Отправлено откликов: ${w.applied}` +
        (withLetter ? ' (с письмами)' : `, из них с письмами: ${w.withLetter}`),
    );
  }
  if (w.viewed > 0) lines.push(`Просмотрено: ${w.viewed}`);
  if (w.responded > 0) lines.push(`Ответов HR: ${w.responded}`);
  if (w.declines > 0 && w.invites === 0) {
    lines.push(`Отказов: ${w.declines}`);
    lines.push('', 'Разбор отказов — в кабинете: /dashboard');
  }

  if (w.invites > 0) {
    lines.push(
      '',
      'Подготовьтесь: в кабинете есть разбор вакансии и вопросы по вашему резюме — /dashboard',
    );
  }

  if (lines.length === 0) return null;
  lines.push('', 'Подробнее: /статистика');
  return lines.join('\n');
}

/**
 * Рассылает дайджесты об откликах всем привязанным чатам.
 *
 * Возвращает, сколько сообщений ушло. Ошибка отправки одного чата не должна
 * срывать рассылку остальным.
 */
export async function sendDigests(): Promise<number> {
  const last = Number(
    (
      db.prepare('SELECT value FROM meta WHERE key = ?').get(DIGEST_KEY) as
        { value: string } | undefined
    )?.value ?? 0,
  );
  const now = Date.now();
  if (last > 0 && now - last < DIGEST_INTERVAL_MS) return 0;

  const since = last > 0 ? last : now - DIGEST_INTERVAL_MS;
  const users = db.prepare('SELECT id FROM users WHERE telegram_chat_id IS NOT NULL').all() as {
    id: number;
  }[];

  let sent = 0;
  for (const u of users) {
    const text = formatDigest(u, digestWindow(u.id, since));
    if (!text) continue;
    if (await notifyUser(u.id, text)) sent++;
  }

  // Метка ставится, даже если никто не ответил: иначе пустой дайджест
  // перечитывал бы то же окно снова и снова.
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(DIGEST_KEY, String(now));

  return sent;
}

/**
 * Отклики, о которых ещё не сообщали.
 *
 * Отметка живёт в самой строке отклика: приглашение по конкретной вакансии
 * должно уйти ровно один раз, и таблица откликов — единственное место, где
 * это состояние переживает перезапуск процесса.
 */
export function pendingAlerts(limit = 20): ApplicationRow[] {
  return db
    .prepare(
      `SELECT * FROM applications
       WHERE notified_at IS NULL
         AND (
           (response = 'interview' AND responded_at IS NOT NULL)
           OR (response = 'decline' AND responded_at IS NOT NULL)
         )
         AND sent_at <= ?
       ORDER BY sent_at DESC
       LIMIT ?`,
    )
    .all(Date.now() - 60_000, limit) as ApplicationRow[];
}

/*
 * Заголовок — по факту ответа, а не по `status`.
 *
 * `status` в таблице один на все случаи («отправлен» / «responded»), и по
 * нему приглашение на собеседование не отличить от простого ответа HR.
 * Различает `response`, который кладёт синхронизация.
 */
function headingFor(row: ApplicationRow): string | null {
  if (row.response === 'interview') return STATUS_TEXT.interviewed;
  if (row.response === 'decline') return STATUS_TEXT.declined;
  return null;
}

const STATUS_TEXT = {
  invited: '🎉 Приглашение на собеседование',
  interviewed: '🎉 Приглашение на собеседование',
  declined: 'Отказ',
} as const;

/**
 * Отправляет уведомления по накопившимся ответам и отмечает их отправленными.
 *
 * Отметка ставится ПОСЛЕ успешной отправки, а не до неё. Раньше было наоборот:
 * при сбое Telegram на середине рассылки строка уже считалась отмеченной,
 * а `pendingAlerts` её больше не выбирал — то есть человек терял приглашение
 * на собеседование из-за одного сетевого сбоя, и узнавал об этом, когда
 * проходил час. Дубликат хуже потери, но и потеря недопустима: повторная
 * отправка того же приглашения — просто повтор, молчание — это провал.
 */
export async function sendAlerts(
  getVacancyTitle: (slug: string) => string | null,
): Promise<number> {
  const rows = pendingAlerts();
  if (rows.length === 0) return 0;

  const mark = db.prepare('UPDATE applications SET notified_at = ? WHERE id = ?');
  let sent = 0;

  for (const row of rows) {
    const heading = headingFor(row);
    if (!heading) continue;

    const vacancy = getVacancyTitle(row.job_slug);
    const lines = [heading, ''];
    if (vacancy) lines.push(`Вакансия: ${vacancy}`);
    if (row.response_note) lines.push(`Компания ответила: ${row.response_note}`);
    if (row.external_url) lines.push('', row.external_url);

    if (row.response === 'interview') {
      lines.push('', 'Подготовьтесь: разбор вакансии и вопросы по вашему резюме — /dashboard');
    }

    if (await notifyUser(row.user_id, lines.join('\n'))) {
      mark.run(Date.now(), row.id);
      sent++;
    }
  }

  return sent;
}

/**
 * Сообщение об ограничении аккаунта площадкой.
 *
 * Отправляется один раз — в тот момент, когда блокировка возникла, а не на
 * каждом тике планировщика. Поэтому отдельная отметка «уже отправлено» не
 * нужна: вызывающий код знает, что это новое событие.
 *
 * Молчать здесь нельзя. При 403 отклики не уходят вообще, и без сообщения
 * человек видит только то, что их «мало», — то есть не видит ничего. Уведомление
 * объясняет и что случилось, и что делать, и что делать не надо.
 */
export async function notifyAccountBlocked(
  chatId: string | null,
  reason: string,
  until: number,
): Promise<boolean> {
  if (!chatId) return false;

  const when = new Date(until).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return sendTelegramMessage(
    chatId,
    [
      `<b>${escapeHtml(reason)}</b>`,
      '',
      'Автоотклики остановлены. Пока ограничение висит, отправка откликов только ухудшает положение аккаунта, поэтому бот ждёт и не повторяет попытки.',
      '',
      `Попробуем снова: ${escapeHtml(when)}`,
      '',
      'Что делать:',
      '— зайти на hh.ru и проверить, нет ли ограничений на аккаунт или требования его подтвердить;',
      '— если после снятия ограничения отклики так и не пошли, переподключите аккаунт в кабинете.',
    ].join('\n'),
    { html: true, keyboard: mainKeyboard() },
  );
}

/** Сброс для тестов. */
export function resetNotificationState(): void {
  db.prepare('DELETE FROM meta WHERE key = ?').run(DIGEST_KEY);
}
