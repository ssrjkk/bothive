import { db } from './db';
import { envNum } from './env';
import { parseKeywords } from './skills';
import { refreshProviders } from './vacancies';
import type { SourceStatus } from './vacancies';
import { logError, logInfo } from './logger';

/**
 * Обновление каталога под реальные поиски пользователей.
 *
 * Прежняя версия вызывала `refreshProviders({ limit: 50 })` — БЕЗ запроса.
 * То есть даже работающий hh.ru отдавал общую витрину первых 50 вакансий
 * («что угодно»), и каталог обслуживал витрину, а не человека: ни один
 * активный поиск пользователя не влиял на то, что попадает в базу.
 *
 * Теперь запросы берутся из активных поисков. Это единственный способ, при
 * котором каталог растёт в ту сторону, которая нужна конкретному соискателю,
 * и одновременно ограничивает нагрузку: сколько у людей запросов, столько и
 * обновлений.
 *
 * Что ещё поменялось:
 *
 *  - Свежесть. Обещание «отклик в первые часы после публикации даёт в 3–5
 *    раз больше просмотров» невозможно, пока каталог обновляется раз в 6 часов.
 *    Для hh, где свежесть и есть ценность, интервал короче; для агрегаторов,
 *    где выдача меняется медленно, — длиннее, чтобы не бить по их лимитам.
 *  - Наблюдаемость. Каталог мог молча сутки не обновляться, и это нигде не
 *    было видно. Теперь результат пишется в meta с числом источников, запросов
 *    и вакансий — по этим числам видно, работает ли обновление.
 */

type SearchRow = {
  id: number;
  user_id: number;
  keywords: string;
  city: string;
  active: number;
};

/** Провайдеры, чья выдача меняется быстро: обновляем их чаще. */
const FAST_SOURCES = new Set(['hh']);

/** Сколько вакансий забирать с одного провайдера за один запрос. */
const PER_QUERY_LIMIT = 100;

/** Сколько разных поисков обрабатывать за проход. */
const MAX_QUERIES_PER_RUN = 8;

export type RefreshReport = {
  ran: boolean;
  skipped?: string;
  queries: number;
  statuses: SourceStatus[];
  added: number;
  durationMs: number;
};

/**
 * Текст запроса для провайдера из строки ключевых слов пользователя.
 *
 * Навыки приоритетнее: «React, TypeScript, Москва, удалённо» на hh уместнее
 * отдать как «React», потому что город там отдельным параметром, а
 * «удалённо» — фильтром. Иначе строка целиком уходит в text=, hh не находит
 * ровно ничего, и источник молча выглядит сломанным.
 */
export function buildQueryText(keywords: string): string {
  const parsed = parseKeywords(keywords);
  if (parsed.skills.length > 0) return parsed.skills.slice(0, 3).join(' ');
  // Слов из словаря нет — берём как есть, но коротко: длинный текст в поиске
  // hh работает как «все слова должны встретиться» и не находит ничего.
  return parsed.words.slice(0, 3).join(' ');
}

function activeSearches(): SearchRow[] {
  return db
    .prepare('SELECT id, user_id, keywords, city, active FROM searches WHERE active = 1')
    .all() as SearchRow[];
}

/**
 * Разные тексты запросов от всех активных поисков.
 *
 * Дедупликация нужна обязательно: пять человек с одинаковым запросом не должны
 * пять раз дёргать hh по одному и тому же. Ключ — текст плюс город.
 */
export function distinctQueries(limit = MAX_QUERIES_PER_RUN): { text: string; city: string }[] {
  const seen = new Set<string>();
  const out: { text: string; city: string }[] = [];

  for (const row of activeSearches()) {
    const text = buildQueryText(row.keywords);
    if (!text) continue;
    const key = `${text.toLowerCase()}|${row.city.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, city: row.city });
    if (out.length >= limit) break;
  }

  return out;
}

/** Записи в meta: последний результат обновления, для наблюдаемости. */
const REPORT_KEY = 'scheduler:catalog_report';

export function lastRefreshReport(): RefreshReport | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(REPORT_KEY) as
    { value: string } | undefined;
  const raw = row?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RefreshReport;
  } catch {
    return null;
  }
}

/**
 * Обновление каталога.
 *
 * onFast отделяет быстрые провайдеры от медленных: у них свой интервал, и
 * один общий TTL для всех либо тормозит hh, либо бьёт по агрегаторам чаще,
 * чем нужно.
 */
export async function refreshCatalogForSearches(opts?: {
  now?: () => number;
  force?: boolean;
}): Promise<RefreshReport> {
  const started = opts?.now?.() ?? Date.now();

  const queries = distinctQueries();

  if (queries.length === 0) {
    /*
     * Нет активных поисков — обновлять нечего. Раньше в этом случае каталог
     * всё равно обновлялся общей витриной: работа впустую плюс нагрузка на
     * девять внешних доменов каждые 6 часов ради данных, которые никто не
     * ищет.
     */
    const report: RefreshReport = {
      ran: false,
      skipped: 'нет активных поисков',
      queries: 0,
      statuses: [],
      added: 0,
      durationMs: Date.now() - started,
    };
    return report;
  }

  const statuses: SourceStatus[] = [];
  const before = countVacancies();

  for (const q of queries) {
    try {
      const result = await refreshProviders({
        text: q.text,
        ...(q.city ? { city: q.city } : {}),
        limit: PER_QUERY_LIMIT,
      });
      statuses.push(...result);
    } catch (err) {
      logError('catalog:refresh', err, { query: q.text, city: q.city });
      statuses.push({
        source: 'local',
        label: 'Обновление',
        available: true,
        count: 0,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  const added = Math.max(0, countVacancies() - before);
  const report: RefreshReport = {
    ran: true,
    queries: queries.length,
    statuses,
    added,
    durationMs: Date.now() - started,
  };

  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(REPORT_KEY, JSON.stringify(report));

  const failed = statuses.filter((s) => !s.ok && !s.requiresSetup);
  logInfo(
    'catalog:refresh',
    `запросов: ${queries.length}, добавлено вакансий: ${added}, источников с ошибкой: ${failed.length}, ${report.durationMs} мс`,
  );

  return report;
}

function countVacancies(): number {
  return (db.prepare('SELECT COUNT(*) c FROM vacancies').get() as { c: number }).c;
}

/**
 * Свежи ли каталог для быстрых источников.
 *
 * Быстрые (hh) обновляем часто: именно на них держится обещание откликать
 * в первые минуты после публикации. При шестичасовом интервале вакансия,
 * висевшая два часа, попадала бы в автоотклик через шесть — то есть обещание
 * было бы невыполнимо по построению, а не из-за настроек.
 */
export function fastProvidersDue(now: number, lastAt: number): boolean {
  const ttlMs = envNum(process.env, 'CATALOG_FAST_TTL_MS', 30 * 60 * 1000, { min: 60_000 });
  return now - lastAt >= ttlMs;
}

/** Медленным источникам достаточно обновляться редко. */
export function slowProvidersDue(now: number, lastAt: number): boolean {
  const ttlMs = envNum(process.env, 'CATALOG_SLOW_TTL_MS', 6 * 60 * 60 * 1000, { min: 60_000 });
  return now - lastAt >= ttlMs;
}

export { FAST_SOURCES };
