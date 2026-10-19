import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { cleanHtml, parseSalaryText, sanitizeExternalUrl, unwrapExtended } from './util';
import { parsePublishedAt } from './published';
import { httpFetch, parseJson } from '../http-client';

const FILTER_URL = 'https://geekjob.ru/json/find/vacancy';
const FETCH_TIMEOUT = 25_000;

type GeekCompany = {
  name?: string;
  logo?: string;
};

type GeekJobFormat = {
  remote?: boolean;
  relocate?: boolean;
  parttime?: boolean;
  inhouse?: boolean;
};

type GeekRecruiter = {
  name?: string;
  email?: string;
};

export type GeekRawVacancy = {
  id?: string;
  position?: string;
  salary?: string;
  country?: string | null;
  city?: string | null;
  jobFormat?: GeekJobFormat;
  company?: GeekCompany;
  recruiter?: GeekRecruiter;
  log?: { modify?: unknown; archived?: unknown };
  description?: string;
  link?: string;
  published?: string;
};

type GeekPayload = {
  data?: GeekRawVacancy[];
  documentsCount?: number;
  nextpage?: number;
  pagecount?: number;
};

const RUS_DAYS: Record<string, number> = {
  понедельник: 0,
  вторник: 1,
  среда: 2,
  четверг: 3,
  пятница: 4,
  суббота: 5,
  воскресенье: 6,
};

const RUS_MONTHS: Record<string, number> = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

/**
 * GeekJob отдаёт «28 сентября» без года и day-of-week. Конвертируем в
 * приблизительную дату: текущий год, если месяц не в будущем; иначе прошлый.
 */
function parseRusDate(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : unwrapExtended(raw);
  if (typeof value !== 'string') return 'недавно';
  const s = value.trim();
  if (/дней|час(а|ов)?|только что/i.test(s)) return 'сегодня';
  const m = s.match(/^(\d{1,2})\s+([а-яё]+)$/i);
  if (m) {
    const day = Number(m[1]);
    const monthName = m[2].toLowerCase();
    const month = RUS_MONTHS[monthName];
    if (month !== undefined && day >= 1 && day <= 31) {
      const now = new Date();
      const year = month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
      const d = new Date(year, month, day);
      const diff = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
      if (diff <= 0) return 'сегодня';
      if (diff === 1) return 'вчера';
      if (diff < 7) return `${diff} дн. назад`;
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  }
  if (RUS_DAYS[s.toLowerCase()] !== undefined) return 'на этой неделе';
  return 'недавно';
}

function inferLevel(name: string): Level {
  const s = name.toLowerCase();
  if (/(стаж|intern|стажёр)/.test(s)) return 'Intern';
  if (/(младш|junior)/.test(s)) return 'Junior';
  if (/(senior|ведущ|lead|principal|director|head|cto|архитект)/.test(s)) return 'Senior';
  return 'Middle';
}

function extractFormat(format: GeekJobFormat | undefined, city: string | null): WorkFormat {
  if (format?.remote) return 'Удалённо';
  if (format?.parttime || format?.relocate) return 'Гибрид';
  if (city) return 'В офисе';
  return 'Удалённо';
}

function salaryDisplay(raw: string | undefined): {
  display: string;
  min: number | null;
  max: number | null;
} {
  const parsed = parseSalaryText(raw);
  return parsed;
}

export function mapGeekVacancy(raw: GeekRawVacancy): Vacancy | null {
  const id = typeof unwrapExtended(raw.id) === 'string' ? (raw.id as string) : String(raw.id ?? '');
  if (!id || !raw.position) return null;
  const salary = salaryDisplay(raw.salary);
  const city =
    typeof raw.city === 'string' && raw.city
      ? raw.city
      : typeof raw.country === 'string' && raw.country
        ? raw.country
        : '';
  const remote = raw.jobFormat?.remote;

  const desc = cleanHtml(raw.description ?? '');
  return {
    slug: `geekjob-${id}`,
    source: 'geekjob',
    source_id: id,
    title: raw.position,
    company: raw.company?.name ?? 'Компания',
    salary: salary.display,
    salary_min: salary.min,
    salary_max: salary.max,
    level: inferLevel(raw.position),
    format: extractFormat(raw.jobFormat, city),
    city: city || (remote ? 'Remote' : 'Россия'),
    posted: parseRusDate(raw.log?.modify ?? raw.published),
    published_at: parsePublishedAt(String(raw.log?.modify ?? raw.published ?? '')),
    //
    // Занятость при��та�� структурно: jobFormat.parttime. Держать её текстом
    // было бы жаловаться на отсутствие поля у площадки, которая его отдаёт.
    employment: raw.jobFormat?.parttime ? 'Частичная занятость' : 'Полная занятость',
    category: 'Работа',
    about:
      desc.slice(0, 2000) ||
      `Вакансия «${raw.position}»${raw.company?.name ? ` в компании ${raw.company.name}` : ''}. Подробности на GeekJob.ru.`,
    responsibilities: [],
    requirements: [],
    bonus: [],
    source_url: sanitizeExternalUrl(raw.link ?? `https://geekjob.ru/vacancy/${id}`),
    contact_email:
      raw.recruiter?.email && /@/.test(raw.recruiter.email) ? raw.recruiter.email : null,
    contact_phone: null,
  };
}

export const geekjobProvider: VacancyProvider = {
  source: 'geekjob',
  label: 'GeekJob',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const page = 1;
    const params = new URLSearchParams({ page: String(page) });
    if (query.text) params.set('qs', query.text);

    const res = await httpFetch(`${FILTER_URL}?${params.toString()}`, {
      timeoutMs: FETCH_TIMEOUT,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return { vacancies: [], provider: 'geekjob', ok: false, error: res.error ?? 'network error' };
    }
    const data = parseJson<GeekPayload>(res.body);
    if (data === null) {
      return { vacancies: [], provider: 'geekjob', ok: false, error: 'некорректный JSON' };
    }
    const seen = new Set<string>();
    const vacancies = (data.data ?? [])
      .filter((v) => {
        const id = String(v.id ?? '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(mapGeekVacancy)
      .filter((v): v is Vacancy => Boolean(v));
    const limit = Math.min(Math.max(1, query.limit ?? 20), 50);
    return { vacancies: vacancies.slice(0, limit), provider: 'geekjob', ok: true };
  },
};
