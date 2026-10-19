/**
 * Словарь требований работодателя и разрыв с резюме.
 *
 * Что делает `detectKeywords` в resume-enhance: достаёт навыки из САМОГО
 * резюме. Это самооценка — резюме всегда «содержит» всё, что в нём есть, и
 * сравнивать его с собой бесполезно. Настоящая проверка — против вакансии:
 * одними ли словами человек описал то же, что описал работодатель.
 *
 * Повторение как вес. Требование, встреченное трижды («Docker обязателен»),
 * для ATS весит больше, чем одна строка в «О нас». Поэтому частота — часть
 * результата, а не деталь реализации.
 *
 * Граница, которая здесь принципиальна. Функция НЕ предлагает вставить в
 * резюме навык, которого у человека нет: результат разделён на «совпало» и
 * «нет в резюме», и второе — это ожидание работодателя, а не задание вставить.
 * Подробное сравнение с резюме — задача Фазы 5 («проверка утверждений»).
 */

import { KEYWORDS } from './resume-enhance-keys';

export type Requirement = {
  /** Каноническое имя навыка, как его пишет человек. */
  label: string;
  /** Сколько раз встретилось в тексте вакансии. */
  mentions: number;
};

export type MatchItem = Requirement & {
  /** Что человек может сделать: проверить наличие, а не просто дописать. */
  hint: string;
};

export type ResumeMatchResult = {
  matched: MatchItem[];
  missing: MatchItem[];
  /** Доля требований вакансии, найденных в резюме; 0 — вакансии нет. */
  coverage: number;
  /** Всегда заполнено: что означает результат. */
  notice: string;
};

/*
 * Считает вхождения алиаса по границам слова, а не подстроке.
 *
 * Границы — через lookaround, а не потребляющие группы.
 *
 * Раньше шаблон был `(^|[^...])alias($|[^...])`: граничные символы ВХОДИЛИ в
 * совпадение и съедались им. При повторе через один пробел («React react»)
 * пробел уходил в первое совпадение, и второму уже не хватало ведущей
 * границы — два вхождения считались как одно. С запятыми («React, react»)
 * ошибки не было, поэтому она долго не попадалась на глаза: в реальных
 * текстах навыки чаще перечисляются через запятую.
 *
 * Недосчёт бил по сортировке требований (частота — первый ключ) и по
 * формулировкам «требовался в N вакансиях».
 */
function countWord(text: string, alias: string): number {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![a-zA-Zа-яА-ЯёЁ0-9])${escaped}(?![a-zA-Zа-яА-ЯёЁ0-9])`, 'giu');
  return [...text.matchAll(re)].length;
}

/**
 * Требования из текста вакансии, отсортированные по убыванию частоты.
 *
 * Порядок убывающий, а внутри одинаковой частоты — по длине названия: длинная
 * формулировка («Python/Аналитика») информативнее короткой («SQL») при равном
 * числе упоминаний.
 */
export function employerDictionary(vacancyText: string): Requirement[] {
  const text = vacancyText.toLowerCase();
  if (!text.trim()) return [];

  const found: Requirement[] = [];
  for (const kw of KEYWORDS) {
    let mentions = 0;
    for (const alias of kw.aliases) {
      mentions += countWord(text, alias.toLowerCase());
    }
    if (mentions > 0) found.push({ label: kw.label, mentions });
  }

  return found.sort((a, b) => b.mentions - a.mentions || b.label.length - a.label.length);
}

/**
 * Разрыв между вакансией и резюме.
 *
 * `coverage` — доля требований вакансии, покрытых резюме. Это НЕ вероятность
 * приглашения и не обещание: ATS не единственный фильтр, и рекрутер читает
 * глазами. Поэтому рядом всегда идёт notice, который так и говорит.
 */
export function resumeMatch(resumeText: string, vacancyText: string): ResumeMatchResult {
  const requirements = employerDictionary(vacancyText);

  if (requirements.length === 0) {
    return {
      matched: [],
      missing: [],
      coverage: 0,
      notice:
        'В вакансии не распознано требований — не с чем сравнивать. Словарь строится по известным навыкам, а не по любому тексту.',
    };
  }

  const resume = resumeText.toLowerCase();
  const matched: MatchItem[] = [];
  const missing: MatchItem[] = [];

  for (const req of requirements) {
    const present = KEYWORDS.filter((k) => k.label === req.label).some((k) =>
      k.aliases.some((a) => countWord(resume, a.toLowerCase()) > 0),
    );

    const item: MatchItem = {
      ...req,
      hint: present
        ? 'Навык есть в резюме теми же словами, что и в вакансии — это то, что читает фильтр.'
        : 'Требование вакансии, которого нет в резюме. Если опыт есть — напишите о нём своими словами; если нет — это честный пробел, и подставлять его не стоит.',
    };
    (present ? matched : missing).push(item);
  }

  const coverage = matched.length / requirements.length;
  const notice =
    missing.length === 0
      ? 'Все распознанные требования вакансии встречаются в резюме.'
      : `В пробеле ${missing.length} из ${requirements.length} требований вакансии. Совпадение по словам — это входной фильтр, а не обещание ответа: дальше смотрит человек.`;

  return { matched, missing, coverage, notice };
}
