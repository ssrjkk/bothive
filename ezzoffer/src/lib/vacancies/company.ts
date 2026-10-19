import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { sanitizeExternalUrl, toSalaryNumber } from './util';
import { parsePublishedAt } from './published';
import { filterOutboundUrls } from '../ssrf';
import { httpFetch } from '../http-client';

const FETCH_TIMEOUT = 25_000;

/**
 * Провайдер вакансий с сайтов компаний через публичные RSS/Atom-фиды.
 * Фиды задаются env COMPANY_JOB_FEEDS (список URL через запятую).
 * Реальный парсинг RSS — без симуляции. Без фидов честно сообщает «не настроен».
 */

function rawFeedUrls(): string[] {
  return (process.env.COMPANY_JOB_FEEDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/**
 * URL пропускаются через SSRF-фильтр.
 *
 * Раньше строки из env уходили в fetch как есть: схема file:// читала бы локальные
 * файлы, а 169.254.169.254 — метаданные облака. Env задаёт администратор, но
 * опечатка или подстановка из недоверенного источника — уже достаточная причина,
 * чтобы проверять адрес перед исходящим запросом.
 */
function parseFeedUrls(): string[] {
  return filterOutboundUrls(rawFeedUrls()).allowed;
}

export function companyFeedsConfigured(): boolean {
  return rawFeedUrls().length > 0;
}

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

function extractText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'im'));
  return m ? decodeXmlEntities(m[1].trim()) : '';
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function salaryFromText(text: string): { display: string; min: number | null; max: number | null } {
  const m = text.match(/(\d[\d\s\u00A0]{2,})[–—-](\d[\d\s\u00A0]{2,})/);
  if (m) {
    const min = toSalaryNumber(m[1].replace(/\s/g, ''));
    const max = toSalaryNumber(m[2].replace(/\s/g, ''));
    if (min && max) {
      return {
        display: `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} ₽`,
        min,
        max,
      };
    }
  }
  const single = text.match(/(\d[\d\s\u00A0]{3,})\s*₽|руб/);
  if (single) {
    const n = toSalaryNumber(single[1].replace(/\s/g, ''));
    if (n) return { display: `от ${n.toLocaleString('ru-RU')} ₽`, min: n, max: null };
  }
  return { display: 'по договорённости', min: null, max: null };
}

function inferLevel(name: string): Level {
  const s = name.toLowerCase();
  if (/(intern|стажер|стажёр)/.test(s)) return 'Intern';
  if (/(junior|младш)/.test(s)) return 'Junior';
  if (/(senior|старш|ведущ|lead|principal|director|head|manager)/.test(s)) return 'Senior';
  return 'Middle';
}

function inferFormat(desc: string): WorkFormat {
  const s = desc.toLowerCase();
  if (/(remote|удаленн|дистанц)/.test(s)) return 'Удалённо';
  if (/(hybrid|гибрид|смешан)/.test(s)) return 'Гибрид';
  return 'В офисе';
}

function extractCity(desc: string): string {
  const m = desc.match(/(?:город|г\.?|city|location)[:;]\s*([А-ЯЁа-яёA-Za-z-]{2,40})/i);
  const c = m?.[1];
  if (c && !/^(remote|удалённо|удаленно|online|онлайн|офис)$/i.test(c)) return c;
  return '—';
}

type RssItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  company: string;
};

function parseRssItems(xml: string, feedUrl: string): RssItem[] {
  // RSS (channel/item) или Atom (feed/entry)
  const items: RssItem[] = [];
  const itemPattern = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null && items.length < 100) {
    const block = match[1];
    const title = extractText(block, 'title') || 'Вакансия';
    const link =
      extractText(block, 'link') ||
      extractText(block, 'id') ||
      (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? feedUrl);
    let description = extractText(block, 'description') || extractText(block, 'content');
    if (!description) {
      const contentEncoded = block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
      description = contentEncoded ? decodeXmlEntities(contentEncoded[1]) : '';
    }
    const pubDate =
      extractText(block, 'pubDate') ||
      extractText(block, 'published') ||
      extractText(block, 'updated');
    items.push({
      title,
      link,
      description: stripTags(description),
      pubDate,
      company: '',
    });
  }
  // Название компании — из заголовка канала.
  const channelTitle = extractText(xml, 'title');
  if (channelTitle) {
    const cleanCompany = channelTitle
      .replace(/вакансии|вакансий|jobs|careers|career|работа|work|hiring/i, '')
      .replace(/[|–—-]/g, '')
      .trim();
    for (const item of items) item.company = cleanCompany;
  }
  return items;
}

function relativePosted(pubDate: string): string {
  if (!pubDate) return 'недавно';
  const t = new Date(pubDate).getTime();
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

export function mapCompanyFeedItem(raw: RssItem, sourceSlug: string): Vacancy | null {
  if (!raw.title || !raw.link) return null;
  const salary = salaryFromText(raw.description);
  const city = extractCity(raw.description);
  return {
    slug: `${sourceSlug}-${raw.link
      .replace(/^https?:\/\//, '')
      .slice(0, 60)
      .replace(/[^a-z0-9-_]/gi, '')}-${raw.title.slice(0, 40).replace(/[^a-z0-9-_]/gi, '')}`.slice(
      0,
      140,
    ),
    source: 'company',
    source_id: raw.link,
    title: raw.title.slice(0, 150),
    company: raw.company || 'Компания',
    salary: salary.display,
    salary_min: salary.min,
    salary_max: salary.max,
    level: inferLevel(raw.title),
    format: inferFormat(raw.description),
    city,
    posted: relativePosted(raw.pubDate),
    published_at: parsePublishedAt(raw.pubDate),
    category: 'Работа',
    about: raw.description.slice(0, 2000) || 'Описание на странице компании.',
    responsibilities: [],
    requirements: [],
    bonus: [],
    source_url: sanitizeExternalUrl(raw.link),
    contact_email: null,
    contact_phone: null,
  };
}

export const companyFeedProvider: VacancyProvider = {
  source: 'company',
  label: 'Сайты компаний (RSS)',
  isAvailable: () => companyFeedsConfigured(),
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const feeds = parseFeedUrls();
    if (feeds.length === 0) {
      return {
        vacancies: [],
        provider: 'company',
        ok: false,
        error: 'COMPANY_JOB_FEEDS не настроены',
      };
    }
    const all: Vacancy[] = [];
    await Promise.all(
      feeds.map(async (feed, idx) => {
        // Две попытки вместо трёх: фидов бывает до 50, и полная лестница
        // повторов на каждом растянула бы обновление каталога на минуты.
        const res = await httpFetch(feed, {
          timeoutMs: FETCH_TIMEOUT,
          attempts: 2,
          headers: {
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          },
        });
        if (!res.ok) return;
        const items = parseRssItems(res.body, feed);
        for (const item of items) {
          const v = mapCompanyFeedItem(item, `feed-${idx}`);
          if (v) all.push(v);
        }
      }),
    );
    let vacancies = all;
    if (query.text) {
      const t = query.text.toLowerCase();
      vacancies = vacancies.filter((v) =>
        `${v.title} ${v.company} ${v.about}`.toLowerCase().includes(t),
      );
    }
    const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
    return {
      vacancies: vacancies.slice(0, limit),
      provider: 'company',
      ok: vacancies.length > 0,
      ...(vacancies.length === 0 ? { error: 'Фирменные RSS-фиды недоступны' } : {}),
    };
  },
};
