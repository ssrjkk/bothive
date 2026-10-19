import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { sanitizeExternalUrl, toSalaryNumber } from './util';
import { parsePublishedAt } from './published';
import { httpFetch, parseJson } from '../http-client';

const BASE = 'https://opendata.trudvsem.ru/api/v1/vacancies';
const FETCH_TIMEOUT = 25_000;

type TrudRaw = {
  status?: string;
  meta?: { total?: number };
  results?: {
    vacancies?: { vacancy: TrudVacancyRaw }[];
  };
};

export type TrudVacancyRaw = {
  id?: string;
  'job-name'?: string;
  salary?: string;
  salary_min?: number | string | null;
  salary_max?: number | string | null;
  vac_url?: string;
  schedule?: string;
  employment?: string;
  qualification?: string;
  typicalPosition?: string;
  requirement?: { education?: string; experience?: number | null };
  duty?: string;
  requirements?: string;
  category?: { specialisation?: string };
  region?: { name?: string };
  addresses?: { address?: { location?: string }[] };
  company?: { name?: string; email?: string; site?: string };
  contact_list?: { contact_type?: string; contact_value?: string }[];
  'creation-date'?: string;
  currency?: string;
};

function parseDate(v: string): number | null {
  const d = new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Занятость и график в одной строке.
 *
 * Площадка отдаёт их раздельно: `employment` — «Полная занятость»,
 * «Временная работа», «Сезонная работа»; `schedule` — «Неполный рабочий
 * день/неполная рабочая неделя», «Режим гибкого рабочего времени».
 *
 * Склеиваются потому, что подработкой делает любая из двух: «Временная работа»
 * при полном дне — это подработка, и «Неполный рабочий день» при полной
 * занятости тоже. Раздельное хранение заставило бы разбирать пару в двух
 * местах, а места — это разные функции, которые разъезжаются.
 */
function joinEmployment(employment?: string, schedule?: string): string | undefined {
  const parts = [employment, schedule]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0 && v !== '—');
  if (parts.length === 0) return undefined;
  return [...new Set(parts)].join(' · ');
}

function relativePosted(iso: string): string {
  const t = parseDate(iso);
  if (!t) return 'недавно';
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return new Date(t).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function inferLevel(raw: TrudVacancyRaw): Level {
  const hay = [raw['job-name'] ?? '', raw.qualification ?? '', raw.typicalPosition ?? '']
    .join(' ')
    .toLowerCase();
  if (/(стаж|intern)/.test(hay)) return 'Intern';
  if (/(младш|junior)/.test(hay)) return 'Junior';
  if (/(ведущ|senior|старш)/.test(hay)) return 'Senior';
  const exp = raw.requirement?.experience ?? null;
  const n = typeof exp === 'number' ? exp : Number(exp) || 0;
  if (n <= 0) return 'Junior';
  if (n <= 2) return 'Junior';
  if (n <= 5) return 'Middle';
  return 'Senior';
}

function inferFormat(schedule?: string): WorkFormat {
  const s = (schedule ?? '').toLowerCase();
  if (/(дистанц|удален)/.test(s)) return 'Удалённо';
  if (/(неполн|частичн|гибк|смен)/.test(s)) return 'Гибрид';
  return 'В офисе';
}

function extractCity(raw: TrudVacancyRaw): string {
  const location = raw.addresses?.address?.[0]?.location ?? '';
  const m = location.match(/(?:^|[,;]\s*)(?:г|город)\s+([^,\d]+)/i);
  if (m?.[1]?.trim()) return m[1].trim();
  const region = raw.region?.name ?? '';
  return region.replace(/^Город\s+/i, '').trim() || 'Россия';
}

function salaryDisplay(raw: TrudVacancyRaw): string {
  const currency = (raw.currency ?? '').replace(/[«»"]/g, '').trim();
  const cur = currency.startsWith('руб') || currency === '' ? '₽' : currency;
  const min = toSalaryNumber(raw.salary_min) ?? 0;
  const max = toSalaryNumber(raw.salary_max) ?? 0;
  if (min > 0 && max > 0)
    return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} ${cur}`;
  if (min > 0) return `от ${min.toLocaleString('ru-RU')} ${cur}`;
  if (raw.salary) return raw.salary;
  return 'по договорённости';
}

export function mapTrudVacancy(raw: TrudVacancyRaw): Vacancy | null {
  if (!raw.id || !raw['job-name']) return null;
  const aboutParts = [raw.duty ?? '', raw.requirements ?? ''].filter(Boolean);
  return {
    slug: `trudvsem-${raw.id}`,
    source: 'trudvsem',
    source_id: raw.id,
    title: raw['job-name'],
    company: raw.company?.name ?? 'Работодатель',
    salary: salaryDisplay(raw),
    salary_min: toSalaryNumber(raw.salary_min),
    salary_max: toSalaryNumber(raw.salary_max),
    level: inferLevel(raw),
    format: inferFormat(raw.schedule),
    city: extractCity(raw),
    posted: relativePosted(raw['creation-date'] ?? ''),
    published_at: parsePublishedAt(raw['creation-date']),
    //
    // Площадка отдаёт занятость и график отдельными полями со своими значениями
    // ("Временная работа", "Неполный рабочий день/неполная рабочая неделя"),
    // поэтому сохраняются оба: занятость отвечает на «сколько», график — на «когда».
    employment: joinEmployment(raw.employment, raw.schedule),
    category: raw.category?.specialisation ?? 'Работа',
    about: aboutParts.join('\n\n') || 'Описание вакансии обновляется на портале «Работа в России».',
    responsibilities: raw.duty ? [raw.duty] : [],
    requirements: raw.requirements ? [raw.requirements] : [],
    bonus: [],
    source_url: sanitizeExternalUrl(raw.vac_url),
    contact_email:
      raw.contact_list?.find((c) => /почт|email/i.test(c.contact_type ?? ''))?.contact_value ??
      raw.company?.email ??
      null,
    contact_phone:
      raw.contact_list?.find((c) => /телефон|тел/i.test(c.contact_type ?? ''))?.contact_value ??
      null,
  };
}

export const trudvsemProvider: VacancyProvider = {
  source: 'trudvsem',
  label: 'Работа России (trudvsem)',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const params = new URLSearchParams();
    if (query.text) params.set('text', query.text);
    params.set('limit', String(Math.min(Math.max(1, query.limit ?? 50), 100)));
    params.set('offset', '0');

    const res = await httpFetch(`${BASE}?${params.toString()}`, {
      timeoutMs: FETCH_TIMEOUT,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        vacancies: [],
        provider: 'trudvsem',
        ok: false,
        error: res.error ?? 'network error',
      };
    }
    const data = parseJson<TrudRaw>(res.body);
    if (data === null) {
      return { vacancies: [], provider: 'trudvsem', ok: false, error: 'некорректный JSON' };
    }
    const rows = data.results?.vacancies ?? [];
    const vacancies = rows
      .map((r) => mapTrudVacancy(r.vacancy))
      .filter((v): v is Vacancy => Boolean(v));
    return { vacancies, provider: 'trudvsem', ok: true };
  },
};
