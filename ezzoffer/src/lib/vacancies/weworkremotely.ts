import type { Level } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { cleanHtml, sanitizeExternalUrl } from './util';
import { parsePublishedAt } from './published';
import { httpFetch } from '../http-client';

const RSS_URL = 'https://weworkremotely.com/remote-jobs.rss';
const FETCH_TIMEOUT = 25_000;

type WwRItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  category: string;
  type: string;
  region: string;
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 63));
}

function tagContent(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'im'));
  return m ? decodeXmlEntities(m[1].trim()) : '';
}

function parseItems(xml: string): WwRItem[] {
  const items: WwRItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null && items.length < 100) {
    const block = match[1];
    items.push({
      title: tagContent(block, 'title') || 'Вакансия',
      link: tagContent(block, 'link'),
      description: tagContent(block, 'description'),
      pubDate: tagContent(block, 'pubDate'),
      category: tagContent(block, 'category'),
      type: tagContent(block, 'type'),
      region: tagContent(block, 'region'),
    });
  }
  return items;
}

function relativePosted(rfc822: string): string {
  if (!rfc822) return 'недавно';
  const t = new Date(rfc822).getTime();
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
  if (/(intern|trainee|entry)/.test(s)) return 'Intern';
  if (/(junior)/.test(s)) return 'Junior';
  if (/(senior|principal|staff|lead|director|head|manager)/.test(s)) return 'Senior';
  return 'Middle';
}

export function mapWwRItem(raw: WwRItem): Vacancy | null {
  if (!raw.title || !raw.link) return null;
  // Формат заголовка: «Company: Role»
  const colon = raw.title.indexOf(':');
  const company = colon > 0 ? raw.title.slice(0, colon).trim() : 'Компания';
  const title = colon > 0 ? raw.title.slice(colon + 1).trim() : raw.title;
  const region = raw.region || 'Remote';
  const desc = cleanHtml(raw.description);
  return {
    slug: `weworkremotely-${raw.link
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9-_]/gi, '-')
      .slice(-60)}`,
    source: 'weworkremotely',
    source_id: raw.link,
    title: title.slice(0, 150),
    company: company.slice(0, 100),
    salary: 'по договорённости',
    salary_min: null,
    salary_max: null,
    level: inferLevel(title),
    format: 'Удалённо',
    city: region,
    posted: relativePosted(raw.pubDate),
    published_at: parsePublishedAt(raw.pubDate),
    category: raw.category || 'Работа',
    about: desc.slice(0, 2000) || 'Описание доступно на We Work Remotely.',
    responsibilities: [],
    requirements: [],
    bonus: [],
    source_url: sanitizeExternalUrl(raw.link),
    contact_email: null,
    contact_phone: null,
  };
}

export const weworkremotelyProvider: VacancyProvider = {
  source: 'weworkremotely',
  label: 'We Work Remotely',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const res = await httpFetch(RSS_URL, {
      timeoutMs: FETCH_TIMEOUT,
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!res.ok) {
      return {
        vacancies: [],
        provider: 'weworkremotely',
        ok: false,
        error: res.error ?? 'network error',
      };
    }
    let vacancies = parseItems(res.body)
      .map(mapWwRItem)
      .filter((v): v is Vacancy => Boolean(v));
    if (query.text) {
      const t = query.text.toLowerCase();
      vacancies = vacancies.filter((v) =>
        `${v.title} ${v.company} ${v.about}`.toLowerCase().includes(t),
      );
    }
    const limit = Math.min(Math.max(1, query.limit ?? 20), 50);
    return { vacancies: vacancies.slice(0, limit), provider: 'weworkremotely', ok: true };
  },
};
