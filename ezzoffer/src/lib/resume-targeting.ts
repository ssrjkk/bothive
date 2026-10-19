import { extractSkills } from './skills';
import type { Vacancy } from './vacancies';

/**
 * Выбор резюме под конкретную вакансию.
 *
 * Разрыв, который здесь закрывается, — не «хочу фичу», а несоответствие в
 * основном цикле. Ранжирование шло по одному резюме — последнему обновлённому,
 * а отправлялся `users.hh_resume_id`, то есть другое, с hh. Человек с резюме
 * «Python» и «React» получал подбор под Python и отправку резюме «React».
 * Система оценивала одно, а отправляла другое, и человек об этом не знал.
 *
 * Теперь на каждую вакансию выбирается то резюме, которое к ней ближе, и
 * отправляется именно оно. Одно резюме — то же поведение, что было.
 */

export type ResumeTarget = {
  id: number;
  title: string;
  content: string;
  /**
   * id резюме на hh.
   *
   * null, если резюме создано вручную и на hh ему ничего не соответствует.
   * Такое резюме годится для оценки и письма, но отправить его нельзя —
   * hh принимает только свой id.
   */
  hh_id: string | null;
};

/** Навыки резюме — считаются один раз, а не на каждую вакансию. */
export function resumeSkills(resume: ResumeTarget): Set<string> {
  return new Set(extractSkills(`${resume.title} ${resume.content}`));
}

/** Текст вакансии, из которого извлекаются навыки. */
function vacancySkills(
  vacancy: Vacancy,
  known: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  if (known) return known;
  return new Set(
    extractSkills(
      `${vacancy.title} ${vacancy.category} ${vacancy.about} ${vacancy.requirements.join(' ')}`,
    ),
  );
}

/**
 * Сколько навыков вакансии закрывает резюме.
 *
 * Деление на размер вакансии, а не просто счётчик совпадений: иначе вакансия
 * с двадцатью требованиями всегда выигрывает у вакансии с тремя, даже если
 * закрывает две из трёх, а не две из двадцати.
 */
export function overlapRatio(
  resumeSet: ReadonlySet<string>,
  vacancySet: ReadonlySet<string>,
): number {
  if (resumeSet.size === 0 || vacancySet.size === 0) return 0;
  const hits = [...vacancySet].filter((s) => resumeSet.has(s)).length;
  return hits / vacancySet.size;
}

export type ScoredResume = {
  resume: ResumeTarget;
  ratio: number;
  hits: number;
};

/**
 * Все резюме с оценкой совпадения — по убыванию.
 *
 * Отдельная функция, потому что вызывать её дважды противно: и для выбора
 * резюме под вакансию, и для порядка отправки. Порядок сортировки одинаковый
 * (score, потом исходный индекс) — иначе выбор резюме и порядок вакансий
 * считались бы по разным правилам и могли противоречить друг другу.
 */
export function scoreResumes(
  vacancy: Vacancy,
  resumes: readonly ResumeTarget[],
  skills: readonly Set<string>[] = resumes.map(resumeSkills),
  known?: ReadonlySet<string>,
): ScoredResume[] {
  const need = vacancySkills(vacancy, known);
  return resumes
    .map((resume, i) => {
      const set = skills[i] ?? resumeSkills(resume);
      const hits = [...need].filter((s) => set.has(s)).length;
      return { resume, ratio: overlapRatio(set, need), hits, i };
    })
    .sort((a, b) => b.ratio - a.ratio || b.hits - a.hits || a.i - b.i)
    .map(({ resume, ratio, hits }) => ({ resume, ratio, hits }));
}

/** Резюме, отправляемое на вакансию. */
export function bestResumeFor(
  vacancy: Vacancy,
  resumes: readonly ResumeTarget[],
  skills?: readonly Set<string>[],
  known?: ReadonlySet<string>,
): ResumeTarget | null {
  return scoreResumes(vacancy, resumes, skills, known)[0]?.resume ?? null;
}

export type RankedVacancy = {
  vacancy: Vacancy;
  resume: ResumeTarget | null;
  ratio: number;
  hits: number;
  /** Исходный индекс — для стабильной сортировки при равенстве. */
  i: number;
};

/**
 * Порядок отправки с назначенным резюме на каждую вакансию.
 *
 * Раньше вакансии ранжировались по одному резюме, и вакансия, идеально
 * подходящая под второе резюме, могла оказаться в конце списка просто из-за
 * того, что первое резюме с ней не пересекалось. Теперь оценка берётся от
 * лучшего подходящего резюме, то есть «насколько эта вакансия подходит кому-то
 * из моих резюме» — именно тот вопрос, на который человек и отвечает, заполняя
 * несколько резюме.
 *
 * Стабильная сортировка: при полном равенстве порядок каталога сохраняется,
 * иначе поведение прыгало бы между прогонами.
 */
export function rankVacancies(
  vacancies: readonly Vacancy[],
  resumes: readonly ResumeTarget[],
  knownSkills?: ReadonlyMap<string, ReadonlySet<string>>,
): RankedVacancy[] {
  if (resumes.length === 0) {
    return vacancies.map((vacancy, i) => ({ vacancy, resume: null, ratio: 0, hits: 0, i }));
  }

  const skills = resumes.map(resumeSkills);
  return vacancies
    .map((vacancy, i) => {
      const best = scoreResumes(vacancy, resumes, skills, knownSkills?.get(vacancy.slug))[0];
      return {
        vacancy,
        resume: best?.resume ?? null,
        ratio: best?.ratio ?? 0,
        hits: best?.hits ?? 0,
        i,
      };
    })
    .sort((a, b) => b.ratio - a.ratio || b.hits - a.hits || a.i - b.i);
}
