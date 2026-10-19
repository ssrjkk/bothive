import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { sanitizeExternalUrl, toSalaryNumber } from './util';
import { parsePublishedAt } from './published';
import { httpFetch } from '../http-client';

const BASE = 'https://www.rabota.ru/vacancy/';
const FETCH_TIMEOUT = 25_000;

/**
 * Провайдер вакансий с Rabota.ru (работа.ру).
 * Rabota.ru — SSR-сайт (Nuxt), в HTML есть JSON-LD со схемой JobPosting,
 * поэтому парсим реальные данные без какого-либо API-ключа.
 * Отклик — только переход на сайт (у площадки нет публичного API для откликов).
 */

type RabotaJsonLd = {
  '@type'?: string | string[];
  title?: string;
  url?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: {
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      streetAddress?: string;
    };
  };
  estimatedSalary?: {
    '@type'?: string;
    value?:
      | { minValue?: number | string; maxValue?: number | string; unitText?: string }
      | number
      | string;
    currency?: string;
  };
  baseSalary?: {
    '@type'?: string;
    value?:
      | { minValue?: number | string; maxValue?: number | string; unitText?: string }
      | number
      | string;
    currency?: string;
  };
  datePosted?: string;
  description?: string;
  employmentType?: string;
  workHours?: string;
};

function unwrapLdArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function extractJsonLd(html: string): RabotaJsonLd[] {
  const out: RabotaJsonLd[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(match[1].trim());
      for (const item of unwrapLdArray(parsed)) {
        if (item && typeof item === 'object') {
          const obj = item as RabotaJsonLd;
          const type = Array.isArray(obj['@type']) ? obj['@type'] : obj['@type'];
          const types = Array.isArray(type) ? type : [type];
          if (types.includes('JobPosting')) out.push(obj);
        }
      }
    } catch {
      /* повреждённый JSON-LD — пропускаем */
    }
  }
  return out;
}

function relativePosted(datePosted?: string): string {
  if (!datePosted) return 'недавно';
  const t = new Date(datePosted).getTime();
  if (Number.isNaN(t)) return 'недавно';
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

function inferLevel(name: string): Level {
  const s = name.toLowerCase();
  if (/(стаж|intern|стажёр)/.test(s)) return 'Intern';
  if (/(младш|junior|без опыта|начальн)/.test(s)) return 'Junior';
  if (/(senior|ведущ|старш|lead|principal|director|head|руководит|главн)/.test(s)) return 'Senior';
  return 'Middle';
}

function inferFormat(desc: string, type?: string): WorkFormat {
  const s = `${desc} ${type ?? ''}`.toLowerCase();
  if (/(удаленн|дистанц|remote)/.test(s)) return 'Удалённо';
  if (/(гибрид|hybrid|смен|частичн)/.test(s)) return 'Гибрид';
  return 'В офисе';
}

function extractCity(raw: RabotaJsonLd): string {
  const address = raw.jobLocation?.address;
  const locality = address?.addressLocality?.trim();
  if (locality && /^(удалённо|удаленно|remote)$/i.test(locality)) return 'Remote';
  if (locality) return locality;
  const street = address?.streetAddress ?? '';
  const m = street.match(/(?:г|город|м\.?)\s*([А-ЯЁа-яёA-Za-z-]{2,40})/i);
  if (m?.[1]) return m[1];
  const region = address?.addressRegion?.trim();
  if (region && /^(удалённо|удаленно|remote)$/i.test(region)) return 'Remote';
  if (region) return region;
  return '—';
}

function salaryDisplay(raw: RabotaJsonLd): {
  display: string;
  min: number | null;
  max: number | null;
} {
  const salary = raw.estimatedSalary ?? raw.baseSalary;
  if (!salary) return { display: 'по договорённости', min: null, max: null };
  const currency = (salary.currency ?? 'RUB').trim().toUpperCase();
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₽';

  let min: number | null = null;
  let max: number | null = null;
  if (salary.value && typeof salary.value === 'object') {
    const v = salary.value as { minValue?: number | string; maxValue?: number | string };
    min = toSalaryNumber(v.minValue);
    max = toSalaryNumber(v.maxValue);
  } else {
    const flat = toSalaryNumber(salary.value as number | string | null);
    if (flat != null) {
      min = flat;
      max = flat;
    }
  }
  if (min == null && max == null) return { display: 'по договорённости', min: null, max: null };
  if (min != null && max != null && min !== max) {
    return {
      display: `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} ${symbol}`,
      min,
      max,
    };
  }
  const single = (min ?? max)!;
  return { display: `от ${single.toLocaleString('ru-RU')} ${symbol}`, min: single, max: null };
}

function cleanDescription(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 63))
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapRabotaVacancy(raw: RabotaJsonLd, idx: number): Vacancy | null {
  if (!raw.title && !raw.url) return null;
  const title = raw.title?.trim() ?? 'Вакансия';
  const url = raw.url ?? `https://www.rabota.ru/vacancy/`;
  const salary = salaryDisplay(raw);
  const about = cleanDescription(raw.description ?? '');
  return {
    slug: `rabota-${url.replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9-_]/gi, '') || idx}`.slice(
      0,
      140,
    ),
    source: 'rabota',
    source_id: url,
    title: title.slice(0, 150),
    company: raw.hiringOrganization?.name?.trim() ?? 'Работа.ру',
    salary: salary.display,
    salary_min: salary.min,
    salary_max: salary.max,
    level: inferLevel(title),
    format: inferFormat(about, raw.employmentType),
    city: extractCity(raw),
    posted: relativePosted(raw.datePosted),
    published_at: parsePublishedAt(raw.datePosted),
    category: 'Работа',
    about: about.slice(0, 2000) || 'Описание вакансии доступно на сайте Работа.ру.',
    responsibilities: [],
    requirements: [],
    bonus: [],
    source_url: sanitizeExternalUrl(url),
    contact_email: null,
    contact_phone: null,
  };
}

export const rabotaProvider: VacancyProvider = {
  source: 'rabota',
  label: 'Работа.ру',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const params = new URLSearchParams();
    if (query.text) params.set('q', query.text);

    const res = await httpFetch(`${BASE}?${params.toString()}`, {
      timeoutMs: FETCH_TIMEOUT,
      attempts: 3,
      retryBaseMs: 1000,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });
    if (!res.ok) {
      return { vacancies: [], provider: 'rabota', ok: false, error: res.error ?? 'network error' };
    }

    const rows = extractJsonLd(res.body);
    const vacancies = rows.map(mapRabotaVacancy).filter((v): v is Vacancy => Boolean(v));

    const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
    if (vacancies.length === 0) {
      return {
        vacancies: [],
        provider: 'rabota',
        ok: false,
        error: 'Нет вакансий в ответе Работа.ру',
      };
    }
    return { vacancies: vacancies.slice(0, limit), provider: 'rabota', ok: true };
  },
};
