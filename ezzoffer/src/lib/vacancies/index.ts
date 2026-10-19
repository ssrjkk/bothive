import { db } from '../db';
import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyProvider, VacancyQuery, VacancySource } from './types';
import { allLocalVacancies, localProvider } from './local';
import { trudvsemProvider } from './trudvsem';
import { hhProvider } from './hh';
import { remoteokProvider } from './remoteok';
import { greenhouseProvider } from './greenhouse';
import { ashbyProvider } from './ashby';
import { companyFeedProvider } from './company';
import { geekjobProvider } from './geekjob';
import { jobicyProvider } from './jobicy';
import { weworkremotelyProvider } from './weworkremotely';
import { rabotaProvider } from './rabota';
import { flruProvider, kworkProvider } from './freelance';

export type {
  Vacancy,
  VacancyFetchResult,
  VacancyProvider,
  VacancyQuery,
  VacancySource,
} from './types';

export const SOURCE_LABELS: Record<VacancySource, string> = {
  local: 'EZOffer',
  trudvsem: 'Работа России',
  hh: 'hh.ru',
  remoteok: 'RemoteOK',
  greenhouse: 'Сайты компаний (Greenhouse)',
  ashby: 'Сайты компаний (Ashby)',
  company: 'Сайты компаний (RSS)',
  x: 'X / Twitter',
  tg: 'Telegram-каналы',
  geekjob: 'GeekJob',
  jobicy: 'Jobicy (remote)',
  weworkremotely: 'We Work Remotely',
  rabota: 'Работа.ру',
  flru: 'FL.ru (фриланс)',
  kwork: 'Kwork (фриланс)',
};

export type SourceStatus = {
  source: string;
  label: string;
  available: boolean;
  count: number;
  requiresSetup?: boolean;
  ok?: boolean;
  error?: string;
};

const providers: VacancyProvider[] = [
  localProvider,
  trudvsemProvider,
  hhProvider,
  remoteokProvider,
  greenhouseProvider,
  ashbyProvider,
  companyFeedProvider,
  geekjobProvider,
  jobicyProvider,
  weworkremotelyProvider,
  rabotaProvider,
  flruProvider,
  kworkProvider,
];

const EXTERNAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOG_TTL_MS = 30_000;

type VacancyRow = {
  slug: string;
  source: string;
  source_id: string;
  title: string;
  company: string;
  salary: string;
  salary_min: number | null;
  salary_max: number | null;
  level: Level;
  format: WorkFormat;
  city: string;
  posted: string;
  published_at: number | null;
  category: string;
  about: string;
  responsibilities: string;
  requirements: string;
  bonus: string;
  source_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  employment?: string | null;
  fetched_at: number;
};

function parseList(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function rowToVacancy(row: VacancyRow): Vacancy {
  return {
    slug: row.slug,
    source: row.source as VacancySource,
    source_id: row.source_id,
    title: row.title,
    company: row.company,
    salary: row.salary,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    level: row.level,
    format: row.format,
    city: row.city,
    posted: row.posted,
    published_at: row.published_at,
    category: row.category,
    about: row.about,
    responsibilities: parseList(row.responsibilities),
    requirements: parseList(row.requirements),
    bonus: parseList(row.bonus),
    source_url: row.source_url,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    employment: row.employment ?? undefined,
  };
}

const upsertStmt = db.prepare(
  `INSERT INTO vacancies (
     slug, source, source_id, title, company, salary, salary_min, salary_max,
     level, format, city, posted, category, about,
     responsibilities, requirements, bonus,
     source_url, contact_email, contact_phone, published_at, employment, fetched_at
   ) VALUES (
     @slug, @source, @source_id, @title, @company, @salary, @salary_min, @salary_max,
     @level, @format, @city, @posted, @category, @about,
     @responsibilities, @requirements, @bonus,
     @source_url, @contact_email, @contact_phone, @published_at, @employment, @fetched_at
   )
   ON CONFLICT(slug) DO UPDATE SET
     source = excluded.source,
     source_id = excluded.source_id,
     title = excluded.title,
     company = excluded.company,
     salary = excluded.salary,
     salary_min = excluded.salary_min,
     salary_max = excluded.salary_max,
     level = excluded.level,
     format = excluded.format,
     city = excluded.city,
     posted = excluded.posted,
     category = excluded.category,
     about = excluded.about,
     responsibilities = excluded.responsibilities,
     requirements = excluded.requirements,
     bonus = excluded.bonus,
     source_url = excluded.source_url,
     contact_email = excluded.contact_email,
     contact_phone = excluded.contact_phone,
     published_at = COALESCE(excluded.published_at, vacancies.published_at),
     employment = excluded.employment,
     fetched_at = excluded.fetched_at`,
);

function upsertMany(list: Vacancy[], fetchedAt = Date.now()): number {
  if (list.length === 0) return 0;
  const tx = db.transaction((items: Vacancy[]) => {
    for (const v of items) {
      upsertStmt.run({
        slug: v.slug,
        source: v.source,
        source_id: v.source_id,
        title: v.title,
        company: v.company,
        salary: v.salary,
        salary_min: v.salary_min,
        salary_max: v.salary_max,
        level: v.level,
        format: v.format,
        city: v.city,
        posted: v.posted,
        category: v.category,
        about: v.about,
        responsibilities: JSON.stringify(v.responsibilities),
        requirements: JSON.stringify(v.requirements),
        bonus: JSON.stringify(v.bonus),
        source_url: v.source_url,
        contact_email: v.contact_email,
        contact_phone: v.contact_phone,
        published_at: v.published_at,
        employment: v.employment ?? undefined,
        fetched_at: fetchedAt,
      });
    }
    return items.length;
  });
  const n = tx(list);
  invalidateCatalog();
  return n;
}

let localSeeded = false;
let catalogCache: Vacancy[] | null = null;
let catalogCachedAt = 0;

function invalidateCatalog(): void {
  catalogCache = null;
  catalogCachedAt = 0;
}

/**
 * Сбросить кэш каталога.
 *
 * Кэш живёт 30 секунд и сбрасывается сам, когда вакансии попадают в базу
 * через upsertMany. Но если запись идёт в обход — напрямую в SQL, как в
 * тестах, — кэш остаётся и каталог молча не показывает новое. Это уже стоило
 * тестам прохождения не по той причине: вакансия из первого теста попадала
 * в кэш, а вакансии из следующих тестов туда не попадали, и проверки
 * «отклик ушёл» выполнялись на первой попавшейся записи.
 *
 * Сбрасывается и флаг localSeeded, а не только кэш. Иначе после стирания
 * таблицы (тесты между кейсами делают DELETE FROM vacancies) сид локальных
 * вакансий не повторялся бы: флаг говорил «уже засеяно», а засеяно было в
 * уже стёртую таблицу. Каталог оставался бы пустым до конца процесса.
 */
export function resetCatalogCache(): void {
  invalidateCatalog();
  localSeeded = false;
}

export function ensureLocalSeeded(): void {
  if (localSeeded) return;
  const count = (
    db.prepare("SELECT COUNT(*) AS c FROM vacancies WHERE source = 'local'").get() as { c: number }
  ).c;
  if (count === 0) upsertMany(allLocalVacancies());
  localSeeded = true;
}

export function getCatalog(): Vacancy[] {
  ensureLocalSeeded();
  const now = Date.now();
  if (catalogCache && now - catalogCachedAt < CATALOG_TTL_MS) return catalogCache;
  const rows = db
    .prepare(
      `SELECT * FROM vacancies
       ORDER BY CASE source
         WHEN 'local' THEN 0 WHEN 'trudvsem' THEN 1 WHEN 'hh' THEN 2
         WHEN 'remoteok' THEN 3 WHEN 'greenhouse' THEN 4 WHEN 'company' THEN 5
         WHEN 'x' THEN 6 WHEN 'tg' THEN 7
         WHEN 'geekjob' THEN 8 WHEN 'jobicy' THEN 9
         WHEN 'weworkremotely' THEN 10 WHEN 'rabota' THEN 11 ELSE 12 END, title`,
    )
    .all() as VacancyRow[];
  catalogCache = rows.map(rowToVacancy);
  catalogCachedAt = now;
  return catalogCache;
}

export function getVacancyIndex(): Map<string, Vacancy> {
  return new Map(getCatalog().map((v) => [v.slug, v]));
}

export function getVacancyBySlug(slug: string): Vacancy | null {
  ensureLocalSeeded();
  const row = db.prepare('SELECT * FROM vacancies WHERE slug = ?').get(slug) as
    VacancyRow | undefined;
  return row ? rowToVacancy(row) : null;
}

function sourceCounts(): Map<string, number> {
  const rows = db.prepare('SELECT source, COUNT(*) AS c FROM vacancies GROUP BY source').all() as {
    source: string;
    c: number;
  }[];
  return new Map(rows.map((r) => [r.source, r.c]));
}

export function listSources(): SourceStatus[] {
  ensureLocalSeeded();
  const counts = sourceCounts();
  return providers.map((p) => ({
    source: p.source,
    label: p.label,
    available: p.isAvailable(),
    requiresSetup: !p.isAvailable(),
    count: counts.get(p.source) ?? 0,
  }));
}

export async function refreshProviders(query: VacancyQuery = {}): Promise<SourceStatus[]> {
  ensureLocalSeeded();
  const staleBefore = Date.now() - EXTERNAL_TTL_MS;
  const statuses: SourceStatus[] = [];
  const local = providers.find((p) => p.source === 'local')!;
  statuses.push({
    source: local.source,
    label: local.label,
    available: true,
    count: allLocalCount(),
    ok: true,
  });
  const external = providers.filter((p) => p.source !== 'local');
  // Сколько запросов можно успеть: каждый с таймаутом 25с — успеваем все параллельно,
  // но ограничиваем конкурентность, чтобы не бить по всем доменам разом.
  const CONCURRENCY = Math.min(4, external.length);
  const limit = Math.min(Math.max(1, query.limit ?? 50), 100);

  const run = async (p: VacancyProvider): Promise<void> => {
    const base = { source: p.source, label: p.label, available: p.isAvailable() };
    if (!p.isAvailable()) {
      statuses.push({
        ...base,
        count: sourceCounts().get(p.source) ?? 0,
        requiresSetup: true,
        ok: false,
        error: 'Провайдер не настроен',
      });
      return;
    }
    const result = await p.fetchVacancies({ ...query, limit });
    if (result.ok && result.vacancies.length > 0) {
      upsertMany(result.vacancies);
      db.prepare('DELETE FROM vacancies WHERE source = ? AND fetched_at < ?').run(
        p.source,
        staleBefore,
      );
    }
    statuses.push({
      ...base,
      // При ошибке показываем реальное количество уже сохранённых вакансий (не обнуляем каталог).
      count: sourceCounts().get(p.source) ?? 0,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
    });
  };

  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (cursor < external.length) {
          const p = external[cursor++];
          if (p) await run(p);
        }
      })(),
    );
  }
  await Promise.all(workers);
  invalidateCatalog();
  return statuses;
}

function allLocalCount(): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM vacancies WHERE source = 'local'").get() as { c: number }
  ).c;
}
