import { db } from './db';
import { getVacancyBySlug } from './vacancies';

export type ApplicationOrigin = 'real' | 'simulated' | 'user' | 'ai';

export type ApplicationRow = {
  id: number;
  user_id: number;
  job_slug: string;
  search_id: number | null;
  /**
   * id резюме, отправленного в этом отклике.
   *
   * Строка, а не число: это идентификатор резюме на hh — именно он уходит в
   * POST /negotiations. Объявлять его числом означало бы искать резюме по
   * локальному resumes.id, что молча не находит ничего (а для числового hh-id
   * находит чужое).
   */
  resume_id: string | null;
  letter_id: number | null;
  status: string;
  /**
   * Происхождение отклика (P1: правда о происхождении).
   *
   * real — отправлен через API площадки; user — человек зафиксировал вручную;
   * simulated — демо-симуляция; ai — сгенерировано моделью.
   */
  origin: ApplicationOrigin;
  response: string;
  response_note: string;
  message: string;
  external_url: string | null;
  sent_at: number;
  viewed_at: number | null;
  responded_at: number | null;
  withdrawn: number;
  /** Когда состояние отклика отправлено в Telegram; null — ещё нет. */
  notified_at: number | null;
};

export const STATUS_RU: Record<string, string> = {
  sent: 'Отправлен',
  viewed: 'Просмотрен',
  responded: 'Ответ HR',
};

/**
 * Сериализация одного отклика.
 *
 * Раньше здесь вызывался getVacancyIndex() — он строит Map по ВСЕМУ каталогу
 * вакансий. Для одного отклика (POST /api/applications) это означало загрузку
 * и разбор сотен-тысяч строк ради одного значения: тяжёлая работа на каждый
 * клик «Откликнуться». Здесь нужен ровно один slug, поэтому идём точечный
 * запрос.
 */
export function serializeApplication(row: ApplicationRow) {
  const vacancy = getVacancyBySlug(row.job_slug);
  return serializeApplicationWith(row, vacancy);
}

function serializeApplicationWith(
  row: ApplicationRow,
  vacancy: ReturnType<typeof getVacancyBySlug>,
) {
  return {
    id: row.id,
    job_slug: row.job_slug,
    search_id: row.search_id,
    resume_id: row.resume_id,
    letter_id: row.letter_id,
    status: row.status,
    status_label: STATUS_RU[row.status] ?? row.status,
    origin: row.origin,
    response: row.response,
    response_note: row.response_note,
    message: row.message,
    external_url: row.external_url,
    sent_at: row.sent_at,
    viewed_at: row.viewed_at,
    responded_at: row.responded_at,
    withdrawn: Boolean(row.withdrawn),
    job: vacancy
      ? {
          title: vacancy.title,
          company: vacancy.company,
          salary: vacancy.salary,
          level: vacancy.level,
          format: vacancy.format,
          city: vacancy.city,
          source: vacancy.source,
          source_url: vacancy.source_url,
        }
      : null,
  };
}

/**
 * Простая выдача откликов без постраничности.
 *
 * Оставлена как совместимая обёртка: страница кабинета и публичный API
 * используют её, а внутри — тот же постраничный путь.
 */
export function listApplications(userId: number, limit = 200) {
  const rows = db
    .prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?')
    .all(userId, Math.min(Math.max(1, Math.floor(limit)), 200)) as ApplicationRow[];
  return rows.map((row) => serializeApplicationWith(row, getVacancyBySlug(row.job_slug)));
}

/**
 * Постраничная выдача откликов по курсору.
 *
 * Ключ — составной (sent_at, id): планировщик может отправить несколько
 * откликов с одинаковым sent_at, и курсор только по времени пропускал бы
 * записи на границе страниц. Загружается limit + 1 строка, чтобы понять,
 * есть ли следующая страница, без отдельного COUNT по всей таблице.
 */
export function listApplicationsPage(
  userId: number,
  limit = 50,
  cursor?: { sentAt: number; id: number } | null,
) {
  const size = Math.min(Math.max(1, Math.floor(limit)), 200);
  const rows = (
    cursor
      ? db
          .prepare(
            `SELECT * FROM applications
              WHERE user_id = ? AND (sent_at < ? OR (sent_at = ? AND id < ?))
              ORDER BY sent_at DESC, id DESC LIMIT ?`,
          )
          .all(userId, cursor.sentAt, cursor.sentAt, cursor.id, size + 1)
      : db
          .prepare(
            `SELECT * FROM applications
              WHERE user_id = ?
              ORDER BY sent_at DESC, id DESC LIMIT ?`,
          )
          .all(userId, size + 1)
  ) as ApplicationRow[];

  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => serializeApplicationWith(row, getVacancyBySlug(row.job_slug))),
    nextCursor: hasMore && last ? { sentAt: last.sent_at, id: last.id } : null,
  };
}
