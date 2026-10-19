import { db } from './db';
import { getStats } from './stats';
import { extractSkills } from './skills';

/**
 * Что делать дальше.
 *
 * В кабинете был набор экранов: вакансии, отклики, статистика, письма. Между
 * ними не было ничего, что отвечало на вопрос человека «ок, я откликнулся на
 * 40 вакансий, и что теперь?». Статистика показывала цифры («просмотров 40%»)
 * и общую подсказку, но не давала ни одного конкретного действия.
 *
 * Здесь считается то, что можно посчитать из реальных данных пользователя:
 *
 *  - КОМУ НАПИСАТЬ. Отклик, который просмотрели и на который не ответили
 *    дольше N дней, — это отложенный шанс. На hh такие отклики висят недели.
 *    Автоматически написать нельзя: API hh не даёт кандидату отправлять
 *    сообщения работодателю (устаревшие методы есть только у работодателя),
 *    поэтому даём готовое действие и текст, а не имитацию отправки.
 *  - ГДЕ ГОТОВИТЬСЯ. Приглашение без подготовки — это потерянный оффер.
 *    Собираем из самой вакансии то, о чём будут спрашивать.
 *  - ПОЧЕМУ ОТКАЗЫВАЮТ. Собираем отказы по общим навыкам и уровням: если из
 *    20 отказов 15 пришлись на вакансии с Kafka, дело не в резюме, а в том,
 *    что в него добавить.
 *  - ГДЕ ПОИСК НЕ РАБОТАЕТ. Поиск, который дал ноль просмотров за много
 *    откликов, почти наверняка слишком узкий или ведёт в вакансии не того
 *    профиля.
 *
 * Порядок — по убыванию ценности действия: то, что скоро перестанет
 * работать (звонок HR), раньше того, что можно сделать завтра.
 */

export type ActionKind = 'followup' | 'interview' | 'declines' | 'search' | 'profile' | 'start';

export type NextAction = {
  kind: ActionKind;
  title: string;
  detail: string;
  /** Ссылка, куда ведёт действие. */
  href: string;
  /** Насколько срочно: 1 — сегодня, 2 — на неделе, 3 — когда получится. */
  urgency: 1 | 2 | 3;
  /** Число объектов, к которым относится действие. */
  count: number;
  /** Готовый текст, если действие предполагает написать. */
  draft?: string;
};

type ApplicationRow = {
  id: number;
  job_slug: string;
  response: string;
  response_note: string;
  message: string;
  sent_at: number;
  viewed_at: number | null;
  responded_at: number | null;
  title: string;
  company: string;
  source_url: string | null;
  /**
   * Требования и описание вакансии (JSON-строки из vacancies).
   *
   * Необязательные, потому что строку собирает LEFT JOIN: вакансии может уже
   * не быть в каталоге, а прямые вызовы analyzeDeclines в тестах передают
   * только заголовок. Отсутствие — не ошибка, просто уже текстов.
   */
  requirements?: string | null;
  about?: string | null;
};

/**
 * Через сколько дней просмотренного отклика стоит написать.
 *
 * Три дня — точка, после которой переписка остывает: hr уже закрыл задачу
 * и смотрит на новые отклики. Неделя — верхняя граница, после которой
 * напоминание выглядит навязчивым и часто вредит.
 */
const FOLLOWUP_AFTER_DAYS = 3;
const FOLLOWUP_BEFORE_DAYS = 14;

/**
 * Собирает список действий по данным пользователя.
 *
 * `now` внедрён, чтобы сроки не зависели от времени запуска теста: проверка
 * «просмотрен три дня назад» иначе была бы вечной через Date.now() прямо в
 * теле функции.
 */
export function nextActions(userId: number, now = Date.now()): NextAction[] {
  const actions: NextAction[] = [];
  const stats = getStats(userId);

  const apps = db
    .prepare(
      `SELECT a.id, a.job_slug, a.response, a.response_note, a.message, a.sent_at,
              a.viewed_at, a.responded_at,
              COALESCE(v.title, a.job_slug) AS title,
              COALESCE(v.company, '') AS company,
              v.source_url, v.requirements, v.about
       FROM applications a
       LEFT JOIN vacancies v ON v.slug = a.job_slug
       WHERE a.user_id = ? AND a.withdrawn = 0
       ORDER BY a.sent_at DESC`,
    )
    .all(userId) as ApplicationRow[];

  if (apps.length === 0) {
    return [
      {
        kind: 'start',
        title: 'Отправьте первый отклик',
        detail:
          'Настройте поиск — сервис сам найдёт подходящие вакансии и отправит отклики с письмом.',
        href: '/dashboard/searches',
        urgency: 1,
        count: 1,
      },
    ];
  }

  const followups = collectFollowups(apps, now);
  if (followups.length > 0) {
    const oldest = followups[followups.length - 1]!;
    const days = Math.floor((now - oldest.viewed_at!) / 86_400_000);
    actions.push({
      kind: 'followup',
      title: `Напишите в ${followups.length} ${plural(followups.length, 'чат', 'чата', 'чатов')}`,
      detail:
        `Самый старый просмотр — ${days} ${plural(days, 'день', 'дня', 'дней')} назад. ` +
        'Резюмо посмотрели, но ответа нет: короткое напоминание возвращает часть этих шансов.',
      href: '/dashboard/applications',
      urgency: 1,
      count: followups.length,
      draft: followupDraft(oldest.company, oldest.title),
    });
  }

  const invites = apps.filter((a) => a.response === 'interview');
  if (invites.length > 0) {
    actions.push({
      kind: 'interview',
      title: `Подготовьтесь к ${invites.length} ${plural(invites.length, 'собеседованию', 'собеседованиям', 'собеседованиям')}`,
      detail:
        'По каждому приглашению: требования вакансии, ваши совпадения и пробелы. ' +
        'Собеседование назначают быстро, готовиться обычно некогда.',
      href: '/dashboard/applications',
      urgency: 1,
      count: invites.length,
    });
  }

  const declinePattern = analyzeDeclines(apps);
  if (declinePattern) {
    actions.push({
      kind: 'declines',
      title: declinePattern.title,
      detail: declinePattern.detail,
      href: '/dashboard/resumes',
      urgency: 2,
      count: declinePattern.total,
    });
  }

  const deadSearch = findDeadSearch(userId);
  if (deadSearch) {
    actions.push({
      kind: 'search',
      title: `Поиск «${deadSearch.title}» не даёт просмотров`,
      detail:
        `${deadSearch.count} ${plural(deadSearch.count, 'отклик', 'отклика', 'откликов')} без единого просмотра. ` +
        'Обычно это слишком узкие ключевые слова или уровень, которого на рынке нет.',
      href: '/dashboard/searches',
      urgency: 2,
      count: deadSearch.count,
    });
  }

  const noLetters = stats.sent - countWithLetter(apps);
  if (stats.sent >= 3 && noLetters > 0) {
    actions.push({
      kind: 'profile',
      title: 'Отклики без письма получают меньше ответа',
      detail:
        `${noLetters} из ${stats.sent} ${plural(stats.sent, 'отклика', 'откликов', 'откликов')} ушли без сопроводительного. ` +
        'Письмо — единственная часть отклика, которую читают внимательнее резюме.',
      href: '/dashboard/letters',
      urgency: 2,
      count: noLetters,
    });
  }

  return actions.sort((a, b) => a.urgency - b.urgency || b.count - a.count);
}

/** Отклики: просмотрены, но без ответа, и ещё не «протухли». */
function collectFollowups(apps: ApplicationRow[], now: number): ApplicationRow[] {
  const out: ApplicationRow[] = [];
  for (const a of apps) {
    if (!a.viewed_at || a.responded_at) continue;
    if (a.response === 'interview' || a.response === 'decline') continue;
    const age = now - a.viewed_at;
    if (age < FOLLOWUP_AFTER_DAYS * 86_400_000) continue;
    if (age > FOLLOWUP_BEFORE_DAYS * 86_400_000) continue;
    out.push(a);
  }
  return out;
}

function countWithLetter(apps: ApplicationRow[]): number {
  return apps.filter((a) => a.message.trim().length > 0).length;
}

/**
 * Правильное склонение.
 *
 * «Напишите в 1 чат», «в 2 чата», «в 5 чатов» — по умолчанию склоняется
 * неправильно, и на странице, которую читает человек ищет работу,
 * это заметно.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Готовый текст напоминания.
 *
 * Короткий и без извинений: длинное письмо без ответа выглядит отчаянием,
 * а одна-две конкретные детали из резюме показывают, что отклик не массовый.
 */
export function followupDraft(company: string, title: string): string {
  const companyText = company ? ` в ${company}` : '';
  const titleText = title ? ` (${title})` : '';
  return (
    `Здравствуйте!\n\n` +
    `Отклик${titleText} на вакансию${companyText} я отправил(а) несколько дней назад. ` +
    `Понимаю, что откликов много — если позиция ещё актуальна, готов(а) обсудить детали ` +
    `или прислать дополнительные материалы.\n\nС уважением`
  );
}

/** JSON-строка списка в массив строк; битый JSON — пусто, а не исключение. */
function listStrings(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/**
 * Разбор отказов по общим навыкам.
 *
 * Считаем навыки, которые требовались в вакансиях, где был отказ, и смотрим,
 * какие из них повторяются. Если из 20 отказов 15 — на вакансии с Kafka, дело
 * не в резюме, а в том, что в него добавить. Без этого пользователь видит
 * «Отказы: 15» и не понимает, что именно переписать.
 */
export function analyzeDeclines(apps: ApplicationRow[]): {
  title: string;
  detail: string;
  total: number;
  skills: string[];
} | null {
  const declined = apps.filter((a) => a.response === 'decline');
  if (declined.length < 3) return null;

  const counter = new Map<string, number>();
  for (const a of declined) {
    /*
     * Навыки берутся из заголовка, требований и описания.
     *
     * Раньше читался только title — «Backend-разработчик». А требование,
     * по которому отказывают («Требуется: Kafka» в requirements), в заголовок
     * не входит никогда. Разбор видел «общих требований нет» там, где все три
     * отказа были по одной Kafka, и советовал «проверьте резюме» вместо
     * «добавьте Kafka».
     *
     * requirements/about в БД — JSON-строки; битый JSON не роняет разбор, а
     * просто не даёт навыков из этого поля.
     */
    const parts = [a.title, ...listStrings(a.requirements), a.about ?? ''].join(' ');
    for (const skill of extractSkills(parts)) {
      counter.set(skill, (counter.get(skill) ?? 0) + 1);
    }
  }

  // Навык, встретившийся в половине и более отказов, — вероятная причина.
  const threshold = Math.max(2, Math.ceil(declined.length / 2));
  const recurring = [...counter.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([skill]) => skill);

  if (recurring.length === 0) {
    return {
      title: `Разберите ${declined.length} ${plural(declined.length, 'отказ', 'отказа', 'отказов')}`,
      detail:
        'Общих требований в отказах не видно. Скорее всего, дело в резюме или в том, что отклики идут не туда: ' +
        'проверьте первые три отклика подряд — как их читает человек со стороны работодателя.',
      total: declined.length,
      skills: [],
    };
  }

  /*
   * В тексте — фактические числа по каждому навыку, а не порог отсечения.
   *
   * Раньше здесь подставлялась величина threshold, то есть для четырёх
   * отказов, где Kafka встречалась во всех четырёх, выводилось «требовалось
   * в 2 из 4». Формально порог и был 2 — но человек читал это как «две из
   * четырёх вакансий требовали Kafka», и делал бы неверный вывод. Факт и
   * порог отсечения — разные вещи, и показывать надо факт.
   */
  const breakdown = [...counter.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1]);

  const list = breakdown
    .slice(0, 3)
    .map(([skill, n]) => `${skill} — ${n} из ${declined.length}`)
    .join(', ');

  return {
    title: 'Отказы повторяются на одних и тех же требованиях',
    detail:
      `${breakdown.length < 3 ? 'Повторяется: ' : 'Повторяются: '}${list}. ` +
      'Если требование есть в резюме — усильте формулировку; если нет — либо добавьте, ' +
      'либо сузьте поиск.',
    total: declined.length,
    skills: breakdown.map(([s]) => s),
  };
}

/**
 * Поиск, который шлёт отклики в пустоту.
 *
 * Порог — не «ноль просмотров вообще», а «много откликов и ни одного просмотра»:
 * у вакансии, отправленной вчера, просмотра может ещё не быть по существу.
 */
function findDeadSearch(userId: number): { title: string; count: number } | null {
  const rows = db
    .prepare(
      `SELECT s.title AS title, COUNT(a.id) AS count,
              SUM(CASE WHEN a.viewed_at IS NOT NULL THEN 1 ELSE 0 END) AS viewed
       FROM searches s
       JOIN applications a ON a.search_id = s.id AND a.user_id = s.user_id
       WHERE s.user_id = ?
       GROUP BY s.id
       HAVING COUNT(a.id) >= 5 AND SUM(CASE WHEN a.viewed_at IS NOT NULL THEN 1 ELSE 0 END) = 0
       ORDER BY COUNT(a.id) DESC
       LIMIT 1`,
    )
    .all(userId) as { title: string; count: number; viewed: number }[];

  const row = rows[0];
  return row ? { title: row.title, count: row.count } : null;
}
