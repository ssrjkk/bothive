import { envOpt } from './env';
import { logError } from './logger';

/**
 * Резюме на hh.ru: список и содержимое.
 *
 * Зачем это отдельным модулем, а не функцией в hh-oauth: чтение резюме —
 * это про данные пользователя и их вывод в наш формат, а не про авторизацию.
 * И это единственное место, где приходится разбирать структуру ответа hh,
 * которая заметно отличается от привычного плоского JSON.
 *
 * Главная причина существования — неудобство, а не функциональность.
 * Человек, который уже ищет работу, имеет резюме на hh. Заставлять его
 * перепечатывать его в сторонний сервис — это преграда на самом входе,
 * и она снимает половину людей до того, как они увидят пользу.
 */

const RESUMES_URL = 'https://api.hh.ru/resumes/mine';
const RESUME_URL = 'https://api.hh.ru/resumes';
const TIMEOUT_MS = 20_000;

export type HhResumeSummary = {
  id: string;
  title: string;
  updatedAt: string | null;
};

/**
 * Раздел резюме hh.
 *
 * У hh резюме состоит из именованных блоков, а не из цельного текста:
 * разные разделы приходят отдельными объектами со своей разметкой.
 * Поэтому содержимое собирается в порядке, который читается как документ.
 */
type HhResumeBlock = {
  name?: string;
  paragraphs?: { text?: string }[];
  bullets?: { text?: string }[];
};

export type HhResumeContent = {
  id: string;
  title: string;
  /** Текст в порядке чтения. */
  text: string;
};

/** Порядок блоков: сначала «О себе» и опыт, потом образование и навыки. */
const BLOCK_ORDER: { name: string; aliases: string[] }[] = [
  { name: 'О себе', aliases: ['о себе', 'about'] },
  { name: 'Опыт работы', aliases: ['опыт', 'опыт работы', 'работа', 'employment'] },
  { name: 'Образование', aliases: ['образование', 'education'] },
  { name: 'Навыки', aliases: ['навыки', 'skills', 'ключевые навыки'] },
  { name: 'Дополнительно', aliases: ['дополнительно', 'прочее', 'about'] },
  { name: 'Языки', aliases: ['языки', 'language'] },
];

function blockScore(name: string): number {
  const lower = name.toLowerCase();
  const index = BLOCK_ORDER.findIndex((b) => b.aliases.some((a) => lower.includes(a)));
  // Неизвестный блок уходит в конец, но не теряется.
  return index === -1 ? BLOCK_ORDER.length : index;
}

async function fetchJson<T>(url: string, token: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'EZOffer/1.0',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      logError('hh:resume', new Error(`HTTP ${res.status}`), { url });
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    logError('hh:resume', e, { url });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Список резюме пользователя на hh. */
export async function listHhResumes(token: string): Promise<HhResumeSummary[]> {
  const data = await fetchJson<{
    items?: { id?: string; title?: string; updated_at?: string }[];
  }>(RESUMES_URL, token);

  const items = data?.items ?? [];
  return items
    .filter((r): r is { id: string; title?: string; updated_at?: string } => Boolean(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title ?? 'Без названия',
      updatedAt: r.updated_at ?? null,
    }));
}

/**
 * Содержимое резюме hh в виде плоского текста.
 *
 * Текст собирается из блоков в порядке чтения. Форматирование hh (жирный,
 * ссылки, списки) отбрасывается — наш анализ работает с текстом, а
 * разметка вакансий и резюме на hh разная, и переносить её было бы значило
 * тащить в оценку мусор.
 */
export async function fetchHhResumeContent(
  token: string,
  resumeId: string,
): Promise<HhResumeContent | null> {
  const data = await fetchJson<{
    id?: string;
    title?: string;
    blocks?: HhResumeBlock[];
    /** Заголовок и подзаголовок приходят отдельными полями, не блоками. */
    first_name?: string;
    last_name?: string;
    city?: { name?: string };
  }>(`${RESUME_URL}/${encodeURIComponent(resumeId)}`, token);

  if (!data) return null;

  const lines: string[] = [];
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ');
  if (name) lines.push(name);
  if (data.title) lines.push(data.title);
  if (data.city?.name) lines.push(data.city.name);

  const blocks = [...(data.blocks ?? [])].sort(
    (a, b) => blockScore(a.name ?? '') - blockScore(b.name ?? ''),
  );

  for (const block of blocks) {
    const paragraphs = (block.paragraphs ?? []).map((p) => clean(p.text ?? '')).filter(Boolean);
    const bullets = (block.bullets ?? []).map((b) => clean(b.text ?? '')).filter(Boolean);

    const body = [...paragraphs, ...bullets];
    if (body.length === 0) continue;

    if (block.name) lines.push(`\n${block.name}`);
    for (const line of body) {
      // Маркер списка: без него строки слипаются в абзац и оценка по опыту
      // не находит границ между достижениями.
      lines.push(`- ${line}`);
    }
  }

  return {
    id: data.id ?? resumeId,
    title: data.title ?? 'Резюме',
    text: lines.join('\n').trim(),
  };
}

/** Убирает разметку hh и схлопывает пробелы. */
function clean(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Настроен ли импорт: нужны те же ключи, что и для привязки аккаунта. */
export function hhResumeImportConfigured(): boolean {
  return Boolean(envOpt(process.env, 'HH_CLIENT_ID') && envOpt(process.env, 'HH_CLIENT_SECRET'));
}
