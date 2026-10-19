import type { Level } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { cleanHtml, toSalaryNumber } from './util';
import { parsePublishedAt } from './published';
import { httpFetch, parseJson } from '../http-client';

const BASE = 'https://jobicy.com/api/v2/remote-jobs';
const FETCH_TIMEOUT = 25_000;

type JobicyJob = {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string | null;
  jobLevel?: string;
  jobType?: string[];
  jobIndustry?: string[];
  pubDate?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  salaryPeriod?: string;
  jobExcerpt?: string;
  jobDescription?: string;
};

type JobicyPayload = {
  jobs?: JobicyJob[];
  jobCount?: number;
};

function currencySymbol(code?: string): string {
  switch (code) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'RUB':
    case 'RUR':
      return '₽';
    default:
      return code ? ` ${code}` : ' ₽';
  }
}

function salaryDisplay(job: JobicyJob): {
  display: string;
  min: number | null;
  max: number | null;
} {
  const min = toSalaryNumber(job.salaryMin) ?? 0;
  const max = toSalaryNumber(job.salaryMax) ?? 0;
  const symbol = currencySymbol(job.salaryCurrency);
  if (min > 0 && max > 0)
    return {
      display: `${symbol}${min.toLocaleString('en-US')}–${symbol}${max.toLocaleString('en-US')}`,
      min,
      max,
    };
  if (min > 0) return { display: `от ${symbol}${min.toLocaleString('en-US')}`, min, max: null };
  if (max > 0) return { display: `до ${symbol}${max.toLocaleString('en-US')}`, min: null, max };
  return { display: 'по договорённости', min: null, max: null };
}

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

function inferLevel(jobLevel?: string, name?: string): Level {
  const lvl = (jobLevel ?? '').toLowerCase();
  if (/(senior|lead|staff|principal|director|head|manager)/.test(lvl)) return 'Senior';
  if (/(junior|entry|intern)/.test(lvl)) return 'Junior';
  if (/intern/i.test(name ?? '')) return 'Intern';
  return 'Middle';
}

export function mapJobicyVacancy(raw: JobicyJob): Vacancy | null {
  if (!raw.id && !raw.jobTitle) return null;
  const title = raw.jobTitle ?? 'Вакансия';
  const salary = salaryDisplay(raw);
  const geo = raw.jobGeo ?? 'Remote';
  const geoLower = (raw.jobGeo ?? '').toLowerCase();
  const desc = cleanHtml(raw.jobDescription ?? raw.jobExcerpt ?? '');
  return {
    slug: `jobicy-${raw.id ?? title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`,
    source: 'jobicy',
    source_id: String(raw.id ?? title),
    title,
    company: raw.companyName ?? 'Компания',
    salary: salary.display,
    salary_min: salary.min,
    salary_max: salary.max,
    level: inferLevel(raw.jobLevel, title),
    format: /remote/i.test(geoLower) ? 'Удалённо' : 'В офисе',
    city: geo,
    posted: relativePosted(raw.pubDate),
    published_at: parsePublishedAt(raw.pubDate),
    category: (raw.jobIndustry ?? [])[0] ?? 'Работа',
    about: desc.slice(0, 2000) || 'Описание доступно на Jobicy.',
    responsibilities: [],
    requirements: (raw.jobType ?? []).slice(0, 5),
    bonus: [],
    source_url: raw.url && /^https?:\/\//.test(raw.url) ? raw.url : null,
    contact_email: null,
    contact_phone: null,
  };
}

export const jobicyProvider: VacancyProvider = {
  source: 'jobicy',
  label: 'Jobicy (remote)',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const limit = Math.min(Math.max(1, query.limit ?? 20), 50);
    const params = new URLSearchParams({ count: String(limit) });
    if (query.text) params.set('search', query.text);

    const headers = { Accept: 'application/json' };
    const res = await httpFetch(`${BASE}?${params.toString()}`, {
      timeoutMs: FETCH_TIMEOUT,
      headers,
    });

    if (res.status === 400) {
      // Именованный параметр search API не принимает (проверено) — перезапрашиваем без него.
      const res2 = await httpFetch(`${BASE}?count=${limit}`, { timeoutMs: FETCH_TIMEOUT, headers });
      if (!res2.ok) {
        return {
          vacancies: [],
          provider: 'jobicy',
          ok: false,
          error: res2.error ?? 'network error',
        };
      }
      const data2 = parseJson<JobicyPayload>(res2.body);
      if (data2 === null) {
        return { vacancies: [], provider: 'jobicy', ok: false, error: 'некорректный JSON' };
      }
      const vacancies = (data2.jobs ?? [])
        .map(mapJobicyVacancy)
        .filter((v): v is Vacancy => Boolean(v));
      return { vacancies: vacancies.slice(0, limit), provider: 'jobicy', ok: true };
    }

    if (!res.ok) {
      return { vacancies: [], provider: 'jobicy', ok: false, error: res.error ?? 'network error' };
    }
    const data = parseJson<JobicyPayload>(res.body);
    if (data === null) {
      return { vacancies: [], provider: 'jobicy', ok: false, error: 'некорректный JSON' };
    }
    const vacancies = (data.jobs ?? [])
      .map(mapJobicyVacancy)
      .filter((v): v is Vacancy => Boolean(v));
    return { vacancies: vacancies.slice(0, limit), provider: 'jobicy', ok: true };
  },
};
