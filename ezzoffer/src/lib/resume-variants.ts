import { db } from './db';

/**
 * A/B-варианты одного резюме.
 *
 * Один человек — несколько редакций одного резюме, честный счёт, какая
 * откликнулась. Это НЕ десять аккаунтов и не спам: рекрутер видит одного
 * кандидата. Совет «тестируй гипотезы на нескольких версиях» легален; совет
 * «создай десять аккаунтов с разными телефонами» — обман, и он здесь не
 * реализуется.
 *
 * Что уже умеет схема: в applications есть resume_id, то есть каким резюме
 * ушёл отклик, оно записывается само. Поэтому варианты — это строки в resumes
 * с общим variant_group; отдельной таблицы не нужно.
 */

/** Сколько откликов на вариант нужно, чтобы вообще что-то сказать. */
export const MIN_SAMPLE_PER_VARIANT = 5;

export type VariantRow = {
  id: number;
  title: string;
  content: string;
  variant_group: string | null;
  variant_label: string | null;
  hh_id: string | null;
  created_at: number;
};

/** Алфавит для меток. Больше 26 вариантов смысла не имеет — это не эксперимент. */
const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function getResumeForUser(userId: number, resumeId: number): VariantRow | undefined {
  return db.prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?').get(resumeId, userId) as
    VariantRow | undefined;
}

export function listVariants(userId: number, group: string): VariantRow[] {
  return db
    .prepare(
      'SELECT * FROM resumes WHERE user_id = ? AND variant_group = ? ORDER BY created_at, id',
    )
    .all(userId, group) as VariantRow[];
}

/**
 * Создаёт вариант B из варианта A (или из обычного резюме).
 *
 * Новая строка в resumes с копией текста и общей группой. hh_id НЕ копируется
 * намеренно: на площадке это отдельное резюме, и до первой загрузки у варианта
 * своего идентификатора нет. Копия hh_id была бы ссылкой на резюме, которого
 * на hh не существует, — и молчаливой ошибкой при автоотклике.
 */
export function createVariant(userId: number, resumeId: number): VariantRow | null {
  const source = getResumeForUser(userId, resumeId);
  if (!source) return null;

  // Обычное резюме становится «A» и основанием группы; вариант — «B».
  const group = source.variant_group ?? `g${source.id}_${Date.now()}`;
  if (!source.variant_group) {
    db.prepare(
      "UPDATE resumes SET variant_group = ?, variant_label = 'A' WHERE id = ? AND user_id = ?",
    ).run(group, source.id, userId);
  }

  const siblings = listVariants(userId, group);
  const used = new Set(siblings.map((v) => v.variant_label));
  const next = LABELS.split('').find((l) => !used.has(l)) ?? null;
  if (!next) return null; // 26 вариантов одного резюме — не эксперимент, а мусор

  const now = Date.now();
  const title = `${source.title} — вариант ${next}`.slice(0, 100);
  const result = db
    .prepare(
      `INSERT INTO resumes (user_id, title, content, years_label, ai_improved, hh_id, variant_group, variant_label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      title,
      source.content,
      (source as { years_label?: string }).years_label ?? '',
      0,
      group,
      next,
      now,
      now,
    );

  return db.prepare('SELECT * FROM resumes WHERE id = ?').get(result.lastInsertRowid) as VariantRow;
}

export type VariantStat = {
  id: number;
  label: string;
  title: string;
  /** Загружен ли этот вариант на hh. Без hh_id у него не может быть откликов. */
  uploaded: boolean;
  /** Отправлено откликов этой редакцией. Только реальные и пользовательские. */
  sent: number;
  /** Из них последовал ответ площадки или человека. */
  responded: number;
  /** Доля ответов среди отправленных; null, когда отправлять было нечего. */
  rate: number | null;
};

export type VariantComparison = {
  group: string;
  variants: VariantStat[];
  /** Данных достаточно для вывода. */
  enough: boolean;
  /** Лучшая редакция по доле ответов; null, пока данных мало или ничья. */
  leader: string | null;
  /** Почему вывода нет. Показывается человеку, а не прячется. */
  notice: string;
};

/**
 * Честное сравнение редакций.
 *
 * Ответы считаются по origin IN ('real','user'): демо-симуляция не имеет права
 * создавать победителя — иначе в демо любой вариант выглядел бы удачным по
 * воле планировщика, а не по действиям человека.
 *
 * Победитель назначается только когда по каждой редакции есть хотя бы
 * MIN_SAMPLE_PER_VARIANT откликов. Иначе leader остаётся null, а notice
 * объясняет, чего не хватает. Карта прямо запрещает «статистику и выводы на
 * малой выборке» — то есть объявлять победителя на двух откликах нельзя.
 */
export function compareVariants(userId: number, group: string): VariantComparison {
  const variants = listVariants(userId, group);

  /*
   * Соединение идёт по hh_id, а НЕ по resumes.id, и это не выбор вкуса.
   *
   * В applications.resume_id лежит идентификатор резюме НА hh — та самая
   * строка, которая уходит в POST /negotiations. Колонка объявлена TEXT
   * намеренно (см. migrateApplicationsResumeId: в INTEGER SQLite превращал
   * «7» в 7, и поиск резюме к отклику молча возвращал пусто). Следовательно
   * applications.resume_id = resumes.hh_id, а не resumes.id.
   *
   * Вариант без hh_id не может иметь откликов: на площадке его не существует.
   * Он честно показывается с нулём, а не выбрасывается из сравнения.
   */
  const rows = db
    .prepare(
      `SELECT r.id AS row_id, a.responded_at
       FROM applications a
       JOIN resumes r ON r.hh_id = a.resume_id AND r.user_id = a.user_id
       WHERE a.user_id = ? AND a.origin IN ('real','user')`,
    )
    .all(userId) as { row_id: number; responded_at: number | null }[];

  const sentBy = new Map<number, number>();
  const respondedBy = new Map<number, number>();
  for (const r of rows) {
    sentBy.set(r.row_id, (sentBy.get(r.row_id) ?? 0) + 1);
    if (r.responded_at !== null) {
      respondedBy.set(r.row_id, (respondedBy.get(r.row_id) ?? 0) + 1);
    }
  }

  const stats: VariantStat[] = variants.map((v) => {
    const sent = sentBy.get(v.id) ?? 0;
    const responded = respondedBy.get(v.id) ?? 0;
    return {
      id: v.id,
      label: v.variant_label ?? '—',
      title: v.title,
      uploaded: Boolean(v.hh_id),
      sent,
      responded,
      rate: sent > 0 ? responded / sent : null,
    };
  });

  const enough = stats.length > 1 && stats.every((s) => s.sent >= MIN_SAMPLE_PER_VARIANT);

  let leader: string | null = null;
  let notice = '';
  if (stats.length < 2) {
    notice = 'Создайте второй вариант резюме, чтобы было что сравнивать.';
  } else if (!enough) {
    const worst = Math.min(...stats.map((s) => s.sent));
    notice =
      `Данных пока мало: меньше всего откликов у варианта — ${worst}, ` +
      `для вывода нужно ${MIN_SAMPLE_PER_VARIANT} на каждый. Разница на такой выборке ` +
      `чаще случайность, чем результат.`;
  } else {
    const best = Math.max(...stats.map((s) => s.rate ?? 0));
    const winners = stats.filter((s) => (s.rate ?? 0) === best);
    if (winners.length === 1) leader = winners[0].label;
    else notice = 'Ничья: доли ответов совпали.';
  }

  return { group, variants: stats, enough, leader, notice };
}
