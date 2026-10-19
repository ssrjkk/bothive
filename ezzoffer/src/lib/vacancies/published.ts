/**
 * Дата публикации из текстовой или ISO-формы.
 *
 * Нужна отдельно от `posted` (строки «3 дн. назад»): возраст решает, стоит ли
 * тратить слот дневного лимита отклика на эту вакансию, а текст для этого
 * непригоден.
 *
 * Возвращает null, а не 0 и не текущее время. Разница принципиальна:
 *  - 0 читался бы как «опубликована в 1970 году» и отсекал бы всё;
 *  - текущее время выдавало бы за свежую вакансию, которой неделю, и
 *    автоотклик тратил бы лимит впустую.
 *
 * Неразобранная дата тоже null: неизвестный возраст должен приводить к
 * осторожному поведению (не отсекать), а не к уверенному.
 */
export function parsePublishedAt(value: string | number | null | undefined): number | null {
  if (value == null) return null;

  if (typeof value === 'number') {
    // Секунды или миллисекунды — определяем по величине.
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 1e11 ? Math.round(value) : Math.round(value * 1000);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Числовая строка (RSS иногда отдаёт epoch строкой).
  if (/^\d{9,13}$/.test(raw)) return parsePublishedAt(Number(raw));

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  // Дата из далёкого будущего — почти наверняка мусор в данных площадки.
  if (parsed > Date.now() + 86_400_000) return null;
  return parsed;
}

/**
 * Относительный текст «3 дн. назад» из даты.
 *
 * Обратная операция к parsePublishedAt: часть провайдеров отдаёт только
 * дату, а каталог хранит и текст для показа человеку.
 */
export function relativePosted(iso: string | number | null | undefined): string {
  const ms = parsePublishedAt(iso);
  if (ms === null) return 'дата неизвестна';

  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  if (days < 30) return `${Math.floor(days / 7)} нед. назад`;
  return new Date(ms).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
