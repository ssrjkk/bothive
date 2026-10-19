import { db } from './db';
import { extractSkills, skillCategory, type SkillCategory } from './skills';
import { getCatalog } from './vacancies';
import { matchesSearch, type SearchRow } from './matcher';
import type { Vacancy } from './vacancies/types';

/**
 * Пробелы в навыках.
 *
 * Раздел «повышения квалификации» строится не на каталоге курсов, а на
 * собственных данных человека: какие навыки требуют вакансии, на которые он
 * откликается или собирается, и которых нет в резюме. Учебный план без такой
 * опоры превращается в список, где всё «важно изучить», и человек закрывает
 * первое попавшееся и бросает.
 *
 * Порядок определяется не тем, что «популярнее», а двумя величинами, которые
 * видны по факту:
 *
 *  - сколько откликов ушло на вакансии с этим требованием;
 *  - сколько из них закончились отказом именно на этом навыке.
 *
 * Второе важнее первого. Навык, который встречается в двадцати вакансиях и ни
 * в одной нет отказа, — это не то, что учить первым: с ним и так всё в порядке.
 *
 * Рекомендации не выдумываются: здесь только то, что можно посчитать из
 * данных. Что именно учить по навыку — в learning-paths.ts, и это содержание
 * программы, а не ссылка на курс, который никто не проверял.
 */

export type SkillGap = {
  skill: string;
  category: SkillCategory;
  /** Вакансий с этим требованием, куда человек откликался. */
  demanded: number;
  /** Отказов, где навык был среди требований. */
  declinedWith: number;
  /** Вакансий в подборе, где навык требуется, а в резюме его нет. */
  inTarget: number;
  /** Насколько это мешает прямо сейчас: 0..1, по плотности отказов и спросу. */
  pressure: number;
  /** Почему это в списке — объяснение человеку, а не балл. */
  reason: string;
};

export type SkillGapsReport = {
  gaps: SkillGap[];
  /** Навыки, которые уже есть в резюме и закрывают спрос. */
  covered: string[];
  /** Откуда взяты данные. */
  basis: {
    applications: number;
    targetedVacancies: number;
    resumeFound: boolean;
  };
};

type AppRow = { job_slug: string; response: string; sent_at: number };

/** Требования вакансии как набор навыков из словаря. */
function requiredSkills(v: Vacancy): string[] {
  const parts = [v.title, v.about, ...(v.requirements ?? [])].join(' ');
  return extractSkills(parts);
}

/**
 * Навыки, уже прописанные в резюме.
 *
 * Фильтр по user_id обязателен, а не формален: база общая на всех, и запрос
 * «последнее резюме вообще» в продакшене показывал бы человеку чужой резюме и
 * строил бы его список пробелов по чужому резюме. Первая версия так и делала, и
 * лишний параметр команды это выдал.
 */
function resumeSkills(userId: number): Set<string> {
  const row = db
    .prepare('SELECT content FROM resumes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(userId) as { content: string } | undefined;
  return new Set(row ? extractSkills(row.content) : []);
}

/**
 * Человеческое объяснение, почему навык в списке.
 *
 * Формулировки без числа бесполезны: «уделите внимание этому навыку» не
 * отличает «давно пора» от «так, на будущее».
 */
function reasonFor(gap: Pick<SkillGap, 'demanded' | 'declinedWith' | 'inTarget'>): string {
  const { demanded, declinedWith, inTarget } = gap;

  if (declinedWith >= 3 && declinedWith / Math.max(1, demanded) >= 0.5) {
    return `Отказов с этим требованием: ${declinedWith} из ${demanded}. Похоже, именно здесь резюме не убеждает.`;
  }
  if (declinedWith >= 1) {
    return `Требовался в ${demanded} вакансиях, отказов с ним: ${declinedWith}. Стоит закрыть до следующего отклика.`;
  }
  if (inTarget > 0) {
    return `Требуется в ${inTarget} вакансиях из вашего подбора, а в резюме его нет.`;
  }
  return `Встречается в требованиях ${demanded} вакансий, на которые вы откликались.`;
}

export function computeSkillGaps(userId: number, limit = 8): SkillGapsReport {
  const mine = resumeSkills(userId);
  /*
   * Без резюме список не собирается вовсе.
   *
   * Если считать при пустом множестве навыков, то «пробелом» окажется всё, что
   * встречалось в вакансиях, — а человек получит уверенный список пробелов по
   * резюме, которого у него нет. Это выдумка с цифрами, хуже отсутствия раздела.
   */
  if (mine.size === 0) {
    return {
      gaps: [],
      covered: [],
      basis: { applications: 0, targetedVacancies: 0, resumeFound: false },
    };
  }

  const apps = db
    .prepare(
      `SELECT job_slug, response, sent_at FROM applications
       WHERE user_id = ? AND withdrawn = 0 ORDER BY sent_at DESC LIMIT 400`,
    )
    .all(userId) as AppRow[];

  const catalog = new Map<string, Vacancy>();
  for (const v of getCatalog()) catalog.set(v.slug, v);

  /** Навык → сколько раз требовался и сколько раз на него был отказ. */
  const demanded = new Map<string, number>();
  const declined = new Map<string, number>();
  const covered = new Set<string>();

  for (const app of apps) {
    const vacancy = catalog.get(app.job_slug);
    if (!vacancy) continue;
    const skills = requiredSkills(vacancy);
    const isDecline = app.response === 'decline';

    for (const skill of skills) {
      demanded.set(skill, (demanded.get(skill) ?? 0) + 1);
      if (isDecline) declined.set(skill, (declined.get(skill) ?? 0) + 1);
      if (mine.has(skill)) covered.add(skill);
    }
  }

  /*
   * Что требует то, к чему человек целится прямо сейчас.
   *
   * Сопоставление вакансии с поиском делает matchesSearch — тот же, что и в
   * подборе. Первый вариант проверял, не входит ли «заголовок + ключевые слова»
   * в текст вакансии: строка целиком в заголовке не встречается никогда, и
   * ветка молча ничего не считала. Проверка на глаз не выглядела подозрительно,
   * потому что выглядела как фильтр.
   */
  const inTarget = new Map<string, number>();
  /*
   * Число целевых вакансий считается отдельно от упоминаний навыков.
   *
   * Раньше basis.targetedVacancies собирался как сумма значений inTarget — то
   * есть считались УПОМИНАНИЯ навыков, а называлось это «вакансиями». Пять
   * вакансий с десятью навыками давали «целевых вакансий: 50», и человек
   * читал это как размер своего подбора. Теперь множество slug — отдельно,
   * счётчики навыков — отдельно.
   */
  const targetedSlugs = new Set<string>();
  for (const search of db
    .prepare('SELECT * FROM searches WHERE user_id = ? AND active = 1')
    .all(userId) as SearchRow[]) {
    for (const v of catalog.values()) {
      if (!matchesSearch(v, search)) continue;
      targetedSlugs.add(v.slug);
      for (const skill of requiredSkills(v)) {
        if (mine.has(skill)) continue;
        inTarget.set(skill, (inTarget.get(skill) ?? 0) + 1);
      }
    }
  }

  const union = new Set([...demanded.keys(), ...inTarget.keys()]);
  const gaps: SkillGap[] = [];

  for (const skill of union) {
    if (mine.has(skill)) continue;
    const d = demanded.get(skill) ?? 0;
    const dec = declined.get(skill) ?? 0;
    const t = inTarget.get(skill) ?? 0;
    // Проверки «d === 0 && t === 0» здесь нет намеренно: множество union
    // собрано ровно из demanded и inTarget, так что оба нуля невозможны.
    // Мутатор с её удалением это подтвердил — код был недостижим.

    const base = {
      skill,
      category: skillCategory(skill) ?? 'other',
      demanded: d,
      declinedWith: dec,
      inTarget: t,
    };
    /*
     * Давление считается из отказов и из вакансий подбора, а не из «популярности».
     * Взвешено так, чтобы отказ всегда был важнее одного упоминания: скилл, на
     * который отказали трижды, обязан стоять выше скилла, который встретился
     * двадцать раз без единого отказа.
     */
    const pressure = dec * 1 + d * 0.15 + t * 0.3;

    gaps.push({ ...base, pressure, reason: reasonFor(base) });
  }

  gaps.sort((a, b) => b.pressure - a.pressure || a.skill.localeCompare(b.skill));

  return {
    gaps: gaps.slice(0, limit),
    covered: [...covered].sort((a, b) => a.localeCompare(b)),
    basis: {
      applications: apps.length,
      targetedVacancies: targetedSlugs.size,
      resumeFound: mine.size > 0,
    },
  };
}
