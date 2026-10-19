/**
 * Даты статей хранятся в data.ts как человекочитаемые строки
 * («12 сентября 2026») — они показываются в списках как есть.
 *
 * Для машинного чтения (SEO-разметка Article, сортировка, «свежие статьи»)
 * нужна машиночитаемая форма. Здесь единственное место, где строка
 * разбирается в дату, поэтому несоответствие формата нельзя разъехаться
 * по разметке.
 */

/**
 * Месяцы в русскоязычных форматах, которые встречаются в контенте:
 * data.ts пишет даты в родительном падеже («12 сентября 2026»), но в
 * заголовках и группировках месяц часто стоит в именительном
 * («Сентябрь 2026»). Без обеих форм разбор молча возвращал null.
 */
const RU_MONTHS: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
  // Именительный падеж (заголовки, группировка по месяцам).
  январь: 0,
  февраль: 1,
  март: 2,
  апрель: 3,
  май: 4,
  июнь: 5,
  июль: 6,
  август: 7,
  сентябрь: 8,
  октябрь: 9,
  ноябрь: 10,
  декабрь: 11,
};

const RU_MONTHS_SHORT: Record<string, number> = {
  янв: 0,
  фев: 1,
  мар: 2,
  апр: 3,
  мая: 4,
  июн: 5,
  июл: 6,
  авг: 7,
  сен: 8,
  окт: 9,
  ноя: 10,
  дек: 11,
};

/**
 * Ищет месяц по укороченному написанию.
 *
 * Сравнение идёт по префиксу полного названия, а не по таблице сокращений:
 * в тексте встречаются и «сен.», и «сент.», и «сентябрь.», а таблица на
 * точный набор строк была бы хрупкой — любое новое сокращение молча
 * возвращало бы null, и в разметке молча пропадала бы дата.
 */
function lookupShortMonth(token: string): number | null {
  const key = token.toLowerCase().replace(/\.$/, '');
  if (key in RU_MONTHS) return RU_MONTHS[key]!;
  if (key in RU_MONTHS_SHORT) return RU_MONTHS_SHORT[key]!;
  for (const [name, index] of Object.entries(RU_MONTHS)) {
    if (name.startsWith(key)) return index;
  }
  return null;
}

/**
 * Разбирает «12 сентября 2026» в ISO-строку для атрибута datetime.
 * Возвращает null, если формат не распознан: лучше не вывести атрибут,
 * чем вывести заведомо неверную дату.
 */
export function articleDateIso(value: string): string | null {
  const trimmed = value.trim();

  // Сначала полная форма «12 сентября 2026». Регексп жадно хватает любой
  // набор букв, поэтому неизвестный месяц здесь означает лишь «попробуем
  // следующий шаблон», а не отказ: иначе «3 сен 2026» уходил в null,
  // не дойдя до ветки сокращений.
  const full = /^(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/i.exec(trimmed);
  if (full) {
    const month = RU_MONTHS[full[2]!.toLowerCase()];
    if (month !== undefined) return toIso(Number(full[3]), month, Number(full[1]));
  }

  // Укороченная форма «3 сен. 2026» / «3 сент 2026».
  const short = /^(\d{1,2})\s+([а-яё]{3,})\.?\s+(\d{4})$/i.exec(trimmed);
  if (short) {
    const month = lookupShortMonth(short[2]!);
    if (month !== null) return toIso(Number(short[3]), month, Number(short[1]));
  }

  return null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** «сентябрь 2026» / «09.2026» → ISO для groupBy по месяцам. */
export function articleMonthIso(value: string): string | null {
  const withDay = articleDateIso(value);
  if (withDay) return withDay.slice(0, 7);

  const m = /^([а-яё]+)\s+(\d{4})$/i.exec(value.trim());
  if (m) {
    const month = RU_MONTHS[m[1]!.toLowerCase()];
    if (month === undefined) return null;
    return `${m[2]}-${String(month + 1).padStart(2, '0')}`;
  }
  return null;
}
