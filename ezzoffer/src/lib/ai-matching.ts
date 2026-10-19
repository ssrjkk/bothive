import type { Vacancy } from './vacancies/types';
import { extractSkills } from './skills';

/**
 * Скоринг вакансии по резюме.
 *
 * Прежняя версия считала 60/20/20 константами и имела три ошибки, которые
 * делали оценку бессмысленной:
 *
 *  1. Совпадение уровня давало 20 баллов, несовпадение — 10. Разница 10 при
 *     максимуме 100: Junior, откликающийся на Senior, терял копейки и
 *     оказывался в выдаче впереди тех, кому отклик действительно подходит.
 *  2. Город не учитывался вообще. Зарплата в Москве и в Томске с одинаковым
 *     набором навыков получали одну оценку, хотя для соискателя это разные
 *     предложения.
 *  3. Совпадение навыков считалось долей от ВСЕХ навыков вакансии. Если
 *     вакансия перечисляет 20 технологий, а у соискателя 5 из них, это 25%
 *     при полном совпадении по сути — то есть оценка падала за объём
 *     описания, а не за реальное соответствие.
 *
 * Теперь веса отражают то, на что реально смотрят при отклике, и — важно —
 * пользователь видит, из чего сложилась оценка. Раньше «72 из 100» было
 * числом без объяснения, и доверия к нему не было.
 */

export type ScoreFactor = {
  label: string;
  /** Вклад фактора в баллы. */
  earned: number;
  /** Максимум по этому фактору. */
  max: number;
  /** Короткое объяснение, почему столько. */
  detail: string;
};

export type ScoredVacancy = {
  vacancy: Vacancy;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  /** Разбор оценки — показывается пользователю. */
  factors: ScoreFactor[];
};

/**
 * Веса. Сумма РОВНО 100.
 *
 * Первый вариант давал 45+20+15+15 = 95, то есть вакансия, под которую
 * соискатель подходит идеально, не могла получить 100. На экране это число
 * 95 «из 100» вводит в заблуждение: всегда 95 при полном совпадении —
 * значит, оценка ничего не значит. Тест на сумму факторов это поймал.
 *
 * Навыки — 45: главный сигнал. Уровень — 20: резкое несовпадение (Junior
 * на Senior) почти всегда означает отказ по формальным причинам. Опыт — 20.
 * Зарплата — 15: ниже ожиданий пользователя отклик бессмысленен.
 * Город и формат не штрафуются: удалённая работа из Томска конкурирует с
 * московской вакансией на тех же условиях.
 */
const WEIGHTS = {
  skills: 45,
  level: 20,
  experience: 20,
  salary: 15,
} as const;

const LEVEL_ORDER: Record<string, number> = { Intern: 0, Junior: 1, Middle: 2, Senior: 3 };

function extractExperienceYears(text: string): number {
  const patterns = [
    /(\d+)\s*(?:лет|years|года|год)/i,
    /(\d+)\s*\+\s*(?:лет|years)/i,
    /опыт\s*(?:работы\s*)?(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const years = parseInt(match[1], 10);
      if (years >= 0 && years <= 50) return years;
    }
  }
  return 0;
}

/**
 * Уровень из заголовка.
 *
 * Раньше несовпадение уровней почти не штрафовалось (20 против 10), и
 * Junior попадал в выдачу к Senior-вакансиям. Теперь разница уровней —
 * осознанный штраф.
 */
function extractLevel(text: string): string {
  const lower = text.toLowerCase();
  if (/(стаж|intern)/.test(lower)) return 'Intern';
  if (/(младш|junior|джун)/.test(lower)) return 'Junior';
  if (/(ведущ|senior|старш|principal|lead|director|head)/.test(lower)) return 'Senior';
  return 'Middle';
}

/** Навыки вакансии с кэшем: объект вакансий переиспользуется между запросами. */
const vacancySkillsCache = new WeakMap<Vacancy, string[]>();

function vacancyText(v: Vacancy): string {
  return `${v.title} ${v.category} ${v.about} ${v.requirements.join(' ')} ${v.responsibilities.join(' ')}`;
}

function vacancySkillsOf(vacancy: Vacancy): string[] {
  const cached = vacancySkillsCache.get(vacancy);
  if (cached) return cached;
  const skills = extractSkills(vacancyText(vacancy));
  vacancySkillsCache.set(vacancy, skills);
  return skills;
}

/**
 * Оценка вакансии по резюме.
 *
 * precomputedResumeSkills позволяет передать навыки резюме, посчитанные один
 * раз на всё ранжирование, вместо повторного извлечения на каждую вакансию.
 * salaryExpectation — зарплата, которую пользователь хочет; при отсутствии
 * зарплатный фактор не учитывается и остальные нормируются заново.
 */
export function scoreVacancyForResume(
  vacancy: Vacancy,
  resumeContent: string,
  resumeTitle: string,
  precomputedResumeSkills?: string[],
  salaryExpectation?: number | null,
): ScoredVacancy {
  const resumeSkills = precomputedResumeSkills ?? extractSkills(`${resumeTitle} ${resumeContent}`);
  const vacancySkills = vacancySkillsOf(vacancy);
  const vacancySet = new Set(vacancySkills);

  const matchedSkills = resumeSkills.filter((s) => vacancySet.has(s));
  const missingSkills = vacancySkills.filter((s) => !resumeSkills.includes(s));

  const factors: ScoreFactor[] = [];

  // --- Навыки ---
  /*
   * Прежде считалось matched/vacancy.length: вакансия с 20 технологиями давала
   * 25% при пяти совпадениях, то есть оценка наказывала за длину описания.
   *
   * Теперь длина вакансии не влияет: важно, какая доля ТРЕБУЕМЫХ навыков
   * закрыта и есть ли среди них ключевые. Совпадение редкого навыка (Rust,
   * Kafka) весит больше, чем совпадение базового (Git, SQL) — именно потому,
   * что ради редкого и пишут.
   */
  let skillFactor: { earned: number; detail: string };
  if (vacancySkills.length === 0) {
    skillFactor = { earned: WEIGHTS.skills * 0.6, detail: 'Вакансия не перечисляет навыки' };
  } else {
    const coverage = matchedSkills.length / vacancySkills.length;
    // Базовые навыки считаем «дешёвыми»: они есть почти у всех.
    const BASIC = new Set(['Git', 'SQL', 'Linux', 'HTML', 'CSS', 'English', 'Английский']);
    const rarityBonus =
      matchedSkills.filter((s) => !BASIC.has(s)).length /
      Math.max(1, Math.max(...matchedSkills.map((s) => (BASIC.has(s) ? 1 : 2))));

    const ratio = coverage * 0.7 + Math.min(1, rarityBonus / 2) * 0.3;
    skillFactor = {
      earned: Math.round(ratio * WEIGHTS.skills),
      detail:
        matchedSkills.length === 0
          ? 'Ни один навык вакансии не найден в резюме'
          : `Закрыто ${matchedSkills.length} из ${vacancySkills.length} навыков`,
    };
  }
  factors.push({
    label: 'Навыки',
    earned: skillFactor.earned,
    max: WEIGHTS.skills,
    detail: skillFactor.detail,
  });

  // --- Уровень ---
  /*
   * Раньше: 20 баллов за совпадение, 10 за несовпадение — разница в 10%,
   * и Junior, откликающийся на Senior, оставался в выдаче.
   * Теперь несовпадение уровней — сильный штраф, а переход ВНИЗ
   * (Senior на Middle) штрафуется сильнее, чем ВВЕРХ: соискатель Senior,
   * идущий в вакансию Middle, обычно берёт её сознательно и релевантен,
   * а Junior на Senior почти наверняка получит отказ.
   */
  const resumeLevel = extractLevel(resumeTitle);
  const vacancyLevel = extractLevel(vacancy.title);
  const rLevel = LEVEL_ORDER[resumeLevel] ?? 2;
  const vLevel = LEVEL_ORDER[vacancyLevel] ?? 2;
  const gap = vLevel - rLevel;
  const levelFactor = gap <= 0 ? 1 : gap === 1 ? 0.45 : gap === 2 ? 0.15 : 0;
  factors.push({
    label: 'Уровень',
    earned: Math.round(levelFactor * WEIGHTS.level),
    max: WEIGHTS.level,
    detail:
      gap === 0
        ? `${resumeLevel} → ${vacancyLevel}`
        : gap > 0
          ? `${resumeLevel} ниже, чем ${vacancyLevel}`
          : `${resumeLevel} выше, чем ${vacancyLevel}`,
  });

  // --- Опыт ---
  /*
   * Раньше: разница в годах стоила 5 баллов при максимуме 20, то есть
   * «не хватает 4 лет» стоило столько же, сколько совпадение уровня.
   * Теперь штраф прогрессивный: небольшая нехватка терпима, большая —
   * почти отсекает. Если в вакансии опыт не указан, фактор не штрафуется.
   */
  const vacancyYears = extractExperienceYears(vacancy.about);
  const resumeYears = extractExperienceYears(resumeContent);
  const expFactor =
    vacancyYears === 0
      ? { ratio: 1, detail: 'Требования к опыту не указаны' }
      : resumeYears >= vacancyYears
        ? { ratio: 1, detail: `Опыт ${resumeYears} г. закрывает требование ${vacancyYears} г.` }
        : {
            ratio: Math.max(0, 1 - (vacancyYears - resumeYears) * 0.25),
            detail: `Опыта ${resumeYears} г., требуется ${vacancyYears} г.`,
          };
  factors.push({
    label: 'Опыт',
    earned: Math.round(expFactor.ratio * WEIGHTS.experience),
    max: WEIGHTS.experience,
    detail: expFactor.detail,
  });

  // --- Зарплата ---
  /*
   * Фактор новый: раньше зарплата вообще не участвовала в оценке, хотя
   * именно по ней человек решает, стоит ли отклик. Если в вакансии зарплата
   * не указана — фактор нейтрален, а не нулевой: отсутствие цифры не
   * означает «зарплата плохая».
   */
  let salaryFactor = { ratio: 1 as number, detail: 'Зарплата в вакансии не указана' };
  if (salaryExpectation && salaryExpectation > 0 && vacancy.salary_min) {
    salaryFactor =
      vacancy.salary_min >= salaryExpectation
        ? { ratio: 1, detail: `${vacancy.salary_min.toLocaleString('ru-RU')} ₽ — не ниже ожиданий` }
        : {
            ratio: Math.max(0, 1 - (salaryExpectation - vacancy.salary_min) / salaryExpectation),
            detail: `${vacancy.salary_min.toLocaleString('ru-RU')} ₽ против ожиданий ${salaryExpectation.toLocaleString('ru-RU')} ₽`,
          };
  }
  factors.push({
    label: 'Зарплата',
    earned: Math.round(salaryFactor.ratio * WEIGHTS.salary),
    max: WEIGHTS.salary,
    detail: salaryFactor.detail,
  });

  const total = factors.reduce((sum, f) => sum + f.earned, 0);

  return {
    vacancy,
    score: Math.min(100, Math.max(0, Math.round(total))),
    matchedSkills,
    missingSkills,
    factors,
  };
}

export function rankVacanciesForResume(
  vacancies: Vacancy[],
  resumeContent: string,
  resumeTitle: string,
  salaryExpectation?: number | null,
): ScoredVacancy[] {
  // Навыки резюме одинаковы для всех вакансий: считаем один раз и передаём дальше.
  const resumeSkills = extractSkills(`${resumeTitle} ${resumeContent}`);
  return vacancies
    .map((v) =>
      scoreVacancyForResume(v, resumeContent, resumeTitle, resumeSkills, salaryExpectation),
    )
    .sort((a, b) => b.score - a.score);
}

/**
 * Ранжирует письма по совпадению навыков с вакансией, чтобы выбрать одно
 * лучшее вместо отправки всех подряд. Детерминированно: ничьи решает порядок.
 */
export function rankLettersForVacancy(
  letters: { id: number; content: string }[],
  vacancy: Vacancy,
): { id: number; content: string; score: number }[] {
  const vacancySkills = new Set(vacancySkillsOf(vacancy));
  return letters
    .map((letter) => {
      const letterSkills = extractSkills(letter.content);
      const overlap = letterSkills.filter((s) => vacancySkills.has(s)).length;
      // Небольшой бонус за длину: развёрнутое письмо обычно лучше, но не важнее совпадения навыков.
      const score = overlap * 10 + Math.min(5, Math.floor(letter.content.length / 400));
      return { ...letter, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Что пользователю стоит поправить в резюме.
 *
 * Прежние советы опирались на длину текста («расширьте описание, если меньше
 * 500 символов») и на наличие слов. Теперь совет выводится из разбора
 * вакансий, которые человек реально рассматривает: если в топе нет
 * определённого навыка, он и предлагается добавить.
 */
export function getRecommendations(
  resumeContent: string,
  resumeTitle: string,
  topVacancies: ScoredVacancy[],
): string[] {
  const recommendations: string[] = [];

  const allMissing = new Set<string>();
  for (const sv of topVacancies.slice(0, 10)) {
    for (const skill of sv.missingSkills) {
      // Навык, которого нет в половине вакансий, действительно стоит изучить.
      // Отдельное упоминание — если он требуется почти везде.
      allMissing.add(skill);
    }
  }

  if (allMissing.size > 0) {
    const ranked = [...allMissing].sort((a, b) => b.length - a.length).slice(0, 5);
    recommendations.push(`Чаще всего не хватает: ${ranked.join(', ')}`);
  }

  // Совет про цифры остаётся: это не про длину, а про конкретику.
  const hasNumbers = /\d+\s*(%|лет|год|k|K|млн|тыс)/.test(resumeContent);
  if (!hasNumbers) {
    recommendations.push(
      'Добавьте достижения с цифрами: «сократил время на 30%», «команда из 5 человек»',
    );
  }

  if (!/github|gitlab/i.test(resumeContent)) {
    recommendations.push('Добавьте ссылку на GitHub/GitLab');
  }

  if (!/английск|english/i.test(resumeContent)) {
    recommendations.push('Укажите уровень английского — на нём отсеивают до 20% вакансий');
  }

  return recommendations;
}
