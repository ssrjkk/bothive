import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { cleanHtml, sanitizeExternalUrl } from './util';
import { parsePublishedAt } from './published';
import { httpFetch, parseJson } from '../http-client';

/**
 * Ashby — доски вакансий компаний.
 *
 * Тот же класс источника, что Greenhouse и RSS, но другая ATS: у неё тысячи
 * компаний, и публичный API отдаёт вакансии без авторизации —
 * `https://api.ashbyhq.com/posting-api/job-board/<компания>`. Проверено вживую:
 * отдаёт 200, записи с полями title, location, employmentType, jobUrl и
 * описанием. Никакой защиты, никакого обхода — площадка сама публикует эти
 * данные для соискателей.
 *
 * Зачем при уже работающих Greenhouse и RSS: у каждой ATS своя доска, и
 * пересечение между ними почти нулевое. Одна и та же компания может вести
 * набор и на Greenhouse, и на Ashby, и в своём RSS — и вакансии там разные.
 */

const DEFAULT_BOARDS = ['linear', 'openai', 'anthropic', 'notion', 'vercel', 'supabase'];
const FETCH_TIMEOUT = 25_000;

type AshbyJob = {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  employmentType?: string;
  department?: string;
  team?: string;
  isRemote?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  isListed?: boolean;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
};

function relativePosted(iso?: string): string {
  if (!iso) return 'недавно';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'недавно';
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function inferLevel(name: string): Level {
  const s = name.toLowerCase();
  if (/(intern|trainee|стаж)/.test(s)) return 'Intern';
  if (/(junior|entry|стажер)/.test(s)) return 'Junior';
  if (/(senior|principal|staff|lead|director|head|manager|distinguished|архитект)/.test(s)) {
    return 'Senior';
  }
  return 'Middle';
}

function inferFormat(job: AshbyJob): WorkFormat {
  if (job.isRemote || /remote/i.test(job.workplaceType ?? '')) return 'Удалённо';
  if (/hybrid/i.test(job.workplaceType ?? '')) return 'Гибрид';
  return 'В офисе';
}

/**
 * Раздел описания вакансии.
 *
 * Заголовок — список вариантов через «|», и каждый вариант экранируется
 * отдельно, а потом соединяется настоящей альтернативой.
 *
 * Раньше строка подставлялась в выражение как есть, и «|» без экранирования
 * разрывал его на две альтернативы, причём `[:\n]([^\n]{0,1200})` относилось
 * только ко второй: у первой не было группы захвата, `m[1]` становился
 * `undefined`, и `.trim()` ронял весь обход каталога. Найдено живой проверкой.
 */
function sectionOf(text: string, headers: string): string[] {
  const alternation = headers
    .split('|')
    .map((h) => h.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean)
    .join('|');
  if (!alternation) return [];

  const re = new RegExp(`(?:${alternation})\\s*[:\\n]([^\\n]{1,1200})`, 'i');
  const value = text.match(re)?.[1]?.trim();
  return value ? [value] : [];
}

export function mapAshbyVacancy(raw: AshbyJob, board: string): Vacancy | null {
  if (!raw.id || !raw.title) return null;
  // Снятые вакансии отдаются с isListed: false — в каталог им нельзя.
  if (raw.isListed === false) return null;

  const content = cleanHtml(raw.descriptionHtml ?? raw.descriptionPlain ?? '');
  const company = board.charAt(0).toUpperCase() + board.slice(1);
  const location =
    raw.location?.trim() || raw.secondaryLocations?.[0]?.location?.trim() || 'Удалённо';
  const team = [raw.department, raw.team].filter(Boolean).join(' / ');

  return {
    slug: `ashby-${raw.id}`,
    source: 'ashby',
    source_id: raw.id,
    title: raw.title,
    company,
    salary: 'по договорённости',
    salary_min: null,
    salary_max: null,
    level: inferLevel(raw.title),
    format: inferFormat(raw),
    city: location,
    posted: relativePosted(raw.publishedAt),
    published_at: parsePublishedAt(raw.publishedAt),
    category: team || 'Работа',
    about: content.slice(0, 2000) || 'Описание доступно на странице вакансии.',
    responsibilities: sectionOf(content, "What you'll do|Responsibilities"),
    requirements: sectionOf(content, 'Requirements|You may thrive'),
    bonus: [],
    source_url: sanitizeExternalUrl(raw.jobUrl ?? raw.applyUrl),
    contact_email: null,
    contact_phone: null,
  };
}

export function parseAshbyBoards(): string[] {
  const value = (process.env.ASHBY_BOARDS ?? '').trim();
  if (value) {
    return (
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        /*
         * Берётся последний значащий сегмент пути.
         *
         * Раньше выражение отбрасывало только префикс `job-board/`, и полный
         * адрес `https://api.ashbyhq.com/posting-api/job-board/initech` давал
         * после разделения по слэшу строку `https:` — доска уходила в запрос по
         * несуществующему адресу и молча не приносила вакансий.
         */
        .map(
          (s) =>
            s
              .replace(/[?#].*$/, '')
              .split('/')
              .filter(Boolean)
              .pop() ?? s,
        )
        .slice(0, 25)
    );
  }
  return DEFAULT_BOARDS;
}

export const ashbyProvider: VacancyProvider = {
  source: 'ashby',
  label: 'Сайты компаний (Ashby)',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const boards = parseAshbyBoards();
    const jobs = new Map<string, Vacancy>();
    const cap = query.limit ?? 50;

    await Promise.all(
      boards.map(async (board) => {
        // Две попытки вместо общих трёх: досок бывает десятки, и полная
        // лестница повторов на каждой растягивала бы обновление каталога.
        const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`;
        const res = await httpFetch(url, { timeoutMs: FETCH_TIMEOUT, attempts: 2 });
        if (!res.ok) return;
        const data = parseJson<{ jobs?: AshbyJob[] } | AshbyJob[]>(res.body);
        if (data === null) return;
        for (const job of Array.isArray(data) ? data : (data.jobs ?? [])) {
          if (jobs.size >= cap) break;
          const v = mapAshbyVacancy(job, board);
          if (v && !jobs.has(v.slug)) jobs.set(v.slug, v);
        }
      }),
    );

    let vacancies = [...jobs.values()];
    if (query.text) {
      const t = query.text.toLowerCase();
      vacancies = vacancies.filter((v) =>
        `${v.title} ${v.company} ${v.category} ${v.city}`.toLowerCase().includes(t),
      );
    }
    const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
    return {
      vacancies: vacancies.slice(0, limit),
      provider: 'ashby',
      ok: vacancies.length > 0,
      ...(vacancies.length === 0 ? { error: 'Вакансии не получены (доски Ashby недоступны)' } : {}),
    };
  },
};
