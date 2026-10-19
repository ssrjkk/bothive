import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { cleanHtml, sanitizeExternalUrl, toSalaryNumber } from './util';
import { parsePublishedAt } from './published';
import { httpFetch, parseJson } from '../http-client';

const BASE = 'https://remoteok.com/api';
const FETCH_TIMEOUT = 25_000;

type RemoteOkSalary = { min?: number | null; max?: number | null };

export type RemoteOkRaw = {
  slug?: string;
  id?: string | number;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  url?: string;
  apply_url?: string;
  location?: string | string[];
  salary_min?: number | string | null;
  salary_max?: number | string | null;
  salary?: RemoteOkSalary;
  currency?: string;
};

export function remoteOkSalaryValues(raw: RemoteOkRaw): { min: number | null; max: number | null } {
  const min = toSalaryNumber(raw.salary?.min ?? raw.salary_min);
  const max = toSalaryNumber(raw.salary?.max ?? raw.salary_max);
  if (
    min == null &&
    max == null &&
    typeof raw.salary_min === 'string' &&
    typeof raw.salary_max === 'string'
  ) {
    const a = raw.salary_min.replace(/[^0-9-]/g, '');
    const b = raw.salary_max.replace(/[^0-9-]/g, '');
    if (a && b) {
      const s = Number(a.replace('-', ''));
      const e = Number(b.replace('-', ''));
      if (Number.isFinite(s) && Number.isFinite(e) && s > 0 && e >= s) return { min: s, max: e };
    }
  }
  return { min, max };
}

export function mapRemoteOkVacancy(raw: RemoteOkRaw): Vacancy | null {
  if (!raw.slug && !raw.id) return null;
  const title = raw.position ?? 'Вакансия';
  const salary = remoteOkSalaryValues(raw);
  const salaryField =
    salary.min != null && salary.max != null
      ? `$${salary.min.toLocaleString('en-US')}–$${salary.max.toLocaleString('en-US')}`
      : salary.min != null
        ? `от $${salary.min.toLocaleString('en-US')}`
        : salary.max != null
          ? `до $${salary.max.toLocaleString('en-US')}`
          : 'по договорённости';

  const loc = Array.isArray(raw.location) ? raw.location.join(', ') : (raw.location ?? 'Remote');
  const about = cleanHtml(raw.description ?? '');

  function inferLevel(name: string): Level {
    const s = name.toLowerCase();
    if (/(intern|trainee|student)/.test(s)) return 'Intern';
    if (/(junior|entry)/.test(s)) return 'Junior';
    if (/(senior|principal|lead|staff|director|head|manager)/.test(s)) return 'Senior';
    return 'Middle';
  }

  function inferFormat(): WorkFormat {
    const s = loc.toLowerCase();
    if (/(remote|distributed)/.test(s)) return 'Удалённо';
    if (/(hybrid)/.test(s)) return 'Гибрид';
    return 'В офисе';
  }

  return {
    slug: `remoteok-${raw.slug ?? raw.id}`,
    source: 'remoteok',
    source_id: String(raw.id ?? raw.slug),
    title,
    company: raw.company?.replace(/\s+$/g, '') ?? 'Компания',
    salary: salaryField,
    salary_min: salary.min,
    salary_max: salary.max,
    level: inferLevel(title),
    format: inferFormat(),
    city: loc || 'Remote',
    posted: 'сегодня',
    published_at: parsePublishedAt(raw.date ?? null),
    category: 'Работа',
    about: about.slice(0, 2000) || 'Описание доступно на RemoteOK.',
    responsibilities: [],
    requirements: (raw.tags ?? []).slice(0, 10),
    bonus: [],
    source_url: sanitizeExternalUrl(raw.apply_url ?? raw.url),
    contact_email: null,
    contact_phone: null,
  };
}

export const remoteokProvider: VacancyProvider = {
  source: 'remoteok',
  label: 'RemoteOK',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const res = await httpFetch(BASE, {
      timeoutMs: FETCH_TIMEOUT,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'EZOffer/1.0 (vacancy aggregator)',
        Referer: 'https://ezoffer.local/',
      },
    });
    if (!res.ok) {
      return {
        vacancies: [],
        provider: 'remoteok',
        ok: false,
        error: res.error ?? 'network error',
      };
    }
    const data = parseJson<RemoteOkRaw[]>(res.body);
    if (data === null) {
      return { vacancies: [], provider: 'remoteok', ok: false, error: 'некорректный JSON' };
    }

    // Первый элемент — служебный (legal/terms), пропускаем.
    const items = Array.isArray(data) ? data.slice(1) : [];
    let vacancies = items.map(mapRemoteOkVacancy).filter((v): v is Vacancy => Boolean(v));

    if (query.text) {
      const t = query.text.toLowerCase();
      vacancies = vacancies.filter((v) =>
        `${v.title} ${v.company} ${v.requirements.join(' ')}`.toLowerCase().includes(t),
      );
    }
    const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
    return { vacancies: vacancies.slice(0, limit), provider: 'remoteok', ok: true };
  },
};
