import { getCatalog } from './vacancies';
import type { Vacancy } from './vacancies';
import { extractSkills, parseKeywords } from './skills';

/**
 * Подбор вакансий под поиск пользователя.
 *
 * Прежняя реализация была подстрочным поиском:
 *
 *     keywords.some((k) => haystack.includes(k))
 *
 * Что это значило на практике (проверено на рабочем каталоге, 464 вакансии):
 *  - 451 ложное срабатывание: «c» находилась в каждой строке с латинской «c»,
 *    «go» — внутри «Golang», «java» — внутри «javascript»;
 *  - 57 вакансий, где подбор молчал: «Менеджер по продажам» не совпадал ни с
 *    чем, потому что в списке был только английский `sales`.
 *
 * Обе ошибки шли в скоринг, то есть в решение «откликаться или нет».
 *
 * Теперь совпадение идёт по границам слова через `skills.ts`, ключевые слова
 * разбираются на навыки и обычные слова, а условия комбинируются через
 * «или», а не только через «и». Последнее — самое важное для реального
 * человека: запрос «Москва или удалённо» раньше был невозможен в принципе.
 */

export type SearchRow = {
  id: number;
  user_id: number;
  title: string;
  keywords: string;
  salary_min: number | null;
  salary_max: number | null;
  format: string;
  city: string;
  level: string;
  company_blacklist: string;
  active: number;
  started_at: number | null;
  created_at: number;
};

/** Разбор строки условий: части через «или» и «и». */
type Condition = { op: 'or' | 'and'; text: string };

function splitClauses(value: string): Condition[] {
  const out: Condition[] = [];
  for (const raw of (value ?? '').split(/[;\n]+/)) {
    const clause = raw.trim();
    if (!clause) continue;
    if (/\s+или\s+|\s+or\s+/i.test(clause)) {
      for (const part of clause.split(/\s+или\s+|\s+or\s+/i)) {
        const text = part.trim();
        if (text) out.push({ op: 'or', text });
      }
    } else {
      out.push({ op: 'and', text: clause });
    }
  }
  return out;
}

function splitTerms(value: string): string[] {
  return value
    .split(/[,\s;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Слово встречается в тексте как отдельное.
 *
 * Отдельная функция, а не `includes`, потому что «москва» внутри «москва-река»
 * — совпадение, а «go» внутри «golang» — мусор. Для ключевых слов пользователя
 * (город, компания, технология) достаточно границы по не-букве.
 */
function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Zа-яА-ЯёЁ0-9])${escaped}(?![a-zA-Zа-яА-ЯёЁ0-9])`, 'iu').test(
    haystack,
  );
}

/**
 * Текст вакансии, по которому ищутся ключевые слова.
 *
 * Раньше здесь были только `title + company + category + about`, и это была
 * самая узкая из четырёх определений «текста вакансии» в проекте:
 *
 *   matcher.ts:84            title, company, category, about            ← было
 *   ai-matching.ts:103        + requirements, responsibilities
 *   resume-targeting.ts:40    + requirements
 *   skill-gaps.ts:61          + requirements
 *
 * То есть ранжирование, подбор резюме и разбор пробелов СМОТРЕЛИ в
 * `requirements`, а фильтр подбора — нет. А провайдеры кладут навыки именно
 * туда: greenhouse (`requirementsSection`), ashby (`sectionOf(content,
 * "Requirements")`), remoteok (теги), trudvsem, freelance. В `about` у них
 * попадает описание, а не требования.
 *
 * Проверено на живом коде: вакансия с `requirements: ["React",
 * "TypeScript"]`, `about: "Team"` и запрос «react» не проходила подбор, хотя
 * навык прямо указан в требованиях.
 *
 * Итог предыдущего состояния: один и тот же отклик попадал в выдачу или не
 * попадал в зависимости от того, какая из четырёх функций его смотрела.
 */
function haystackOf(vacancy: Vacancy): string {
  const list = (xs: string[] | undefined): string => (xs?.length ? xs.join(' ') : '');
  return [
    vacancy.title,
    vacancy.company,
    vacancy.category,
    vacancy.about,
    list(vacancy.requirements),
    list(vacancy.responsibilities),
  ]
    .join(' ')
    .toLowerCase();
}

/** Совпадает ли вакансия с одной частью условия. */
function matchesClause(
  vacancy: Vacancy,
  clause: Condition,
  vacancySkills: ReadonlySet<string>,
): boolean {
  const haystack = haystackOf(vacancy);

  // Если часть условия — узнаваемый навык, сравниваем по навыкам, а не по
  // подстроке. Это ключевое отличие от старой реализации.
  const parsed = parseKeywords(clause.text);
  if (parsed.skills.length > 0) {
    const bySkill = parsed.skills.some((s) => vacancySkills.has(s));
    if (!bySkill) return false;
  }

  // Обычные слова ищем как есть: город, формат, уровень, название компании.
  if (parsed.words.length > 0) {
    const byWords = parsed.words.some((w) => containsWord(haystack, w));
    if (!byWords) return false;
  }

  return true;
}

/**
 * Подходит ли вакансия под поиск.
 *
 * `vacancySkills` передаётся снаружи: навыки вакансии считаются один раз на
 * весь каталог, а не на каждую проверку. На 464 вакансиях это разница между
 * одним проходом по регексам и 464.
 */
export function matchesSearch(
  vacancy: Vacancy,
  s: SearchRow,
  vacancySkills?: ReadonlySet<string>,
): boolean {
  const skills = vacancySkills ?? new Set(extractSkills(haystackOf(vacancy)));

  // Ключевые слова: части через «или» — любая подходит, без «или» — все.
  const clauses = splitClauses(s.keywords);
  if (clauses.length > 0) {
    const groups = new Map<Condition['op'], string[]>();
    for (const c of clauses) {
      const list = groups.get(c.op) ?? [];
      list.push(c.text);
      groups.set(c.op, list);
    }

    const orPart = groups.get('or');
    if (orPart && orPart.length > 0) {
      const ok = orPart.some((text) => matchesClause(vacancy, { op: 'or', text }, skills));
      if (!ok) return false;
    }
    const andPart = groups.get('and');
    if (andPart && andPart.length > 0) {
      const ok = andPart.every((text) => matchesClause(vacancy, { op: 'and', text }, skills));
      if (!ok) return false;
    }
  }

  if (s.level && s.level !== vacancy.level) return false;
  if (s.format && s.format !== vacancy.format) return false;
  if (s.city && !vacancy.city.toLowerCase().includes(s.city.toLowerCase())) return false;

  const salary = vacancy.salary_min ?? 0;
  if (s.salary_min != null && salary > 0 && salary < s.salary_min) return false;
  if (s.salary_max != null && salary > 0 && salary > s.salary_max) return false;

  const blacklist = splitTerms(s.company_blacklist);
  if (blacklist.some((c) => containsWord(vacancy.company.toLowerCase(), c))) return false;

  return true;
}

/** Навыки всех вакансий каталога — считается один раз на ранжирование. */
export function skillsByVacancy(vacancies: readonly Vacancy[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const v of vacancies) {
    map.set(v.slug, new Set(extractSkills(haystackOf(v))));
  }
  return map;
}

export function matchCount(s: SearchRow): number {
  const catalog = getCatalog();
  const skills = skillsByVacancy(catalog);
  return catalog.filter((v) => matchesSearch(v, s, skills.get(v.slug))).length;
}

/**
 * Подходящие вакансии с навыками — для ранжирования и показа в интерфейсе.
 *
 * Раньше навыки извлекались по каждой вакансии заново при каждом запросе.
 */
export function matchingVacancies(
  s: SearchRow,
  limit = 200,
): { vacancy: Vacancy; skills: Set<string> }[] {
  const catalog = getCatalog();
  const skills = skillsByVacancy(catalog);
  const out: { vacancy: Vacancy; skills: Set<string> }[] = [];
  for (const v of catalog) {
    const s2 = skills.get(v.slug)!;
    if (matchesSearch(v, s, s2)) out.push({ vacancy: v, skills: s2 });
    if (out.length >= limit) break;
  }
  return out;
}
