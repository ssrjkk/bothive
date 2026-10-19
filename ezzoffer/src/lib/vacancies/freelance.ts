import type { Level, WorkFormat } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';
import { httpFetch } from '../http-client';
import { logError } from '../logger';
import { detectDirection, inferFreelanceLevel } from '../direction';
import { extractSkills } from '../skills';

/**
 * Заказы с фриланс-досок: fl.ru и Kwork.
 *
 * Это не вакансии, а заказы: у них нет зарплатной вилки, нет контракта, нет
 * отклика одной кнопкой. Поэтому провайдер отдаёт ручные лиды — как остальные
 * источники кроме hh, — и не притворяется, что на них можно откликнуться
 * автоматически.
 *
 * Что здесь не так с качеством, и почему это не выдаётся пользователю «как
 * есть»: в ленте fl.ru примерно половина заказов вообще не про IT — отзывы на
 * маркетплейсах, постинг, написание текстов. Загружать их в общую ленту
 * нельзя: человек, подписанный на IT, получает мусор и перестаёт смотреть. Фильтр
 * по навыкам и разделам площадки — внизу, и он режет заказ молча, потому что
 * «мы отфильтровали 34 заказа из 60» — это шум, а не польза.
 *
 * Заголовок Accept здесь широкий намеренно: fl.ru отдаёт 406 на
 * `Accept: application/xml`, требуя вариант `text/html`. Это проверяется в
 * тестах, потому что выглядит как «сломанный фид», а на деле это заголовок.
 */

const FETCH_TIMEOUT = 25_000;

type Feed = {
  name: string;
  url: string;
  source: 'flru' | 'kwork';
  /** Кто заказчик. У fl.ru в фиде нет, поэтому не выдумывается, а остаётся пустым. */
  pickCompany: (item: RawItem) => string;
  /** Раздел площадки. У fl.ru есть, у Kwork тоже. */
  pickCategory: (item: RawItem) => string;
};

type RawItem = {
  title: string;
  link: string;
  description: string;
  category: string;
  pubDate: string;
};

/** Разбирает RSS. Возвращает плоский список полей — вложенность здесь не нужна. */
function parseRss(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const raw = pick(block, 'title');
    const link = pick(block, 'link');
    const description = pick(block, 'description');
    const category = pick(block, 'category');
    const pubDate = pick(block, 'pubDate');
    if (!raw || !link) continue;
    items.push({
      title: raw,
      link,
      description: description ?? '',
      category: category ?? '',
      pubDate: pubDate ?? '',
    });
  }
  return items;
}

function pick(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return undefined;
  return decodeXml(m[1]);
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «для всех», «предложить услугу» и прочее — не заказы. */
function isOrder(title: string, description: string): boolean {
  return !/(предложить услугу|для всех|посмотреть отклики)/i.test(
    `${title} ${description}`.slice(0, 200),
  );
}

/**
 * Заказ IT или нет.
 *
 * Решение по навыкам из словаря и по разделу площадки. Навыки — основной
 * сигнал: в fl.ru «Программирование / Python» попадает в навыки как Python, а
 * «Тексты / Копирайтинг» не попадает ни во что.
 *
 * Порог ненулевой: одного случайного слова в описании мало. Один навык из
 * словаря, который ещё и встречается в теме заказа, — уже признак.
 */
function isItOrder(item: RawItem): boolean {
  const head = `${item.title} ${item.category}`;

  /*
   * Технические маркеры — сильное основание, слова из словаря навыков — тоже.
   *
   * Отдельный случай — «AI». Раздел «AI — искусственный интеллект / Генерация
   * видео» на fl.ru полон контентных заказов: ролики для Reels с виртуальным
   * персонажем, озвучка, генерация картинок. Человеку, который ищет
   * разработку, это шум, и по одному слову «AI» он в ленту попадает. Поэтому
   * «AI» засчитывается только рядом с техническим маркером: генерация видео —
   * контент, а «сделать скрипт под ChatGPT» — работа.
   */
  /*
   * Раздел «Инжиниринг» на fl.ru — это электротехника: «Слаботочные сети»,
   * «Электрика», «КОМПАС-3D», «Модернизация серверных тома СС и ЭОМ». Для
   * человека, ищущего IT-подработку, это не подходит, а слово «серверных»
   * в названии ловило такие заказы как серверные. Раздел отсекается целиком.
   *
   * «Озвучка» и «Дубляж» — производство контента, а не настройка каналов.
   * Реклама засчитывается по названиям каналов (Директ, таргет, email), а не по
   * слову «реклама»: иначе в ленту попадает «Озвучка рекламного ролика».
   */
  if (
    /^\s*инжиниринг(?=[\s\/-]|$)/i.test(item.category) ||
    /(озвучка|дубляж|фоторабот|видеомонтаж)/i.test(head)
  ) {
    return false;
  }

  /*
   * Продажа ссылок отсекается.
   *
   * На Kwork весь фид сегодня — это «Build 1000 High Authority PBN Homepage SEO
   * Dofollow Backlinks» и «350 backlinks blog comments». Под это работает правило
   * на seo, но человеку, ищущему подработку в разработке, такая работа не
   * подходит, и обещать её в разделе «фриланс для IT» было бы неверно.
   * Настоящий SEO-аудит и продвижение под это правило не попадают.
   */
  if (
    /(backlink|бэклинк|pbn|dofollow|прода[жь][аие][а-яёa-z]{0,6}\s+ссыл|куп[а-яёa-z]{0,6}\s+[\p{N}\s]{0,20}ссыл|ссылк[а-яё]{0,3}\s+(?:на\s+)?(?:куп|прод|разм)|размещени[а-яё]{0,3}\s+ссыл|comment(?:s)?\s+on)/iu.test(
      head,
    )
  ) {
    return false;
  }

  const strong =
    /(программирован|разработка|разработчик|сайт|вёрстк|верстк|дизайн|приложени|1с(?![а-яё])|1с-программирован|битрикс|wordpress|скрипт|база данных|api|лендинг|ботdevops|тестирован|seo|frontend|backend|fullstack|автоматизац|3d|график|иллюстрац|моушн|анимац|яндекс директ|директ|таргет|email-маркетинг|контекстная реклам)/i;
  if (strong.test(head)) return true;

  /*
   * «AI/ML» есть в словаре навыков, поэтому слово «AI» в заголовке даёт
   * навык — и контентные заказы вроде «Генерация AI-видео для Reels» проходили
   * в IT-ленту по одному совпадению. Проверка «AI» стоит раньше общей по
   * словарю и требует рядом технического маркера.
   */
  if (/(^|[^a-z])ai([^a-z]|$)|искусственн.{0,3} интеллект/i.test(head)) {
    return /(скрипт|бот|api|автоматиз|интегрирован|напиш|разработ|дообуч|обучить модель|парсер)/i.test(
      `${item.title} ${item.description}`,
    );
  }

  if (extractSkills(item.title).length > 0) return true;

  // Описание длиннее двух предложений почти всегда про задачу, а навыки в нём
  // могли не попасть в словарь («сделать табличку на макросах»).
  return item.description.length > 180 && extractSkills(item.description).length > 0;
}

/**
 * Слаг заказа.
 *
 * Кириллица здесь обязательна, а не украшение: русские доски дают ссылки вида
 * `/projects/1/razrabotat-lending.html`, где значимая часть — кириллица. Регулярка
 * вида `[^a-zA-Z0-9]+` выбрасывала её целиком, и все 60 заказов fl.ru
 * превращались в один и тот же слаг «flru-html» — из ленты оставался первый.
 *
 * Такое не замечалось, пока проверка шла в обход разбора фида и смотрела на
 * один заказ; столкнулись два заказа — и сразу стало видно. Проверка теперь
 * идёт через разбор целого фида, где схлопывание заметно сразу.
 */
function slugFor(source: string, link: string): string {
  const tail = link.replace(/\/+$/, '').split('/').pop() ?? link;
  const clean = tail
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${source}-${clean || Math.abs(hash(link))}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export type FreelanceInput = RawItem & { source: string };

/**
 * Разбирает заказ в вакансию. Вынесено отдельно, чтобы проверялось без сети.
 */
export function mapFreelanceItem(item: FreelanceInput): Vacancy | null {
  const title = decodeXml(item.title ?? '');
  const description = decodeXml(item.description ?? '');
  const link = decodeXml(item.link ?? '');
  if (!title || !link || !isOrder(title, description)) return null;
  if (!isItOrder({ ...item, title, description, category: decodeXml(item.category) })) return null;

  const category = decodeXml(item.category ?? '');
  const published = item.pubDate ? Date.parse(item.pubDate) : NaN;
  const direction = detectDirection(category, title, description);
  const level: Level = inferFreelanceLevel(title);

  return {
    slug: slugFor(item.source, link),
    source: item.source as Vacancy['source'],
    source_id: link,
    title,
    company: '',
    salary: 'по договорённости',
    salary_min: null,
    salary_max: null,
    level,
    format: 'Удалённо' satisfies WorkFormat,
    city: 'Удалённо',
    posted: relativePosted(published),
    published_at: Number.isNaN(published) ? null : published,
    category: category || DIRECTION_FALLBACK[direction],
    about: description.slice(0, 1200),
    responsibilities: [],
    requirements: extractSkills(`${title} ${description}`),
    bonus: [],
    source_url: link,
    contact_email: null,
    contact_phone: null,
  };
}

const DIRECTION_FALLBACK: Record<string, string> = {
  frontend: 'Разработка сайтов',
  backend: 'Программирование',
  fullstack: 'Программирование',
  mobile: 'Мобильная разработка',
  data: 'Данные и аналитика',
  devops: 'DevOps и инфраструктура',
  design: 'Дизайн',
  qa: 'Тестирование',
  pm: 'Управление и аналитика',
  sales: 'Продажи и маркетинг',
  other: 'Фриланс',
};

function relativePublished(ms: number): string {
  if (Number.isNaN(ms)) return 'недавно';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return new Date(ms).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const relativePosted = relativePublished;

/**
 * Разбирает фид в список заказов.
 *
 * Вынесено отдельно от сети намеренно: дедупликация и фильтр — самое важное в
 * провайдере, а проверять их, не имея живого фида под рукой, невозможно. Раньше
 * это было внутри сетевого вызова, и проверка схватывала только то, что успевала
 * поймать сеть.
 */
export function parseFreelanceFeed(xml: string, source: string, limit = 60): Vacancy[] {
  const items = parseRss(xml);
  const out: Vacancy[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const mapped = mapFreelanceItem({ ...item, source });
    if (!mapped) continue;
    if (seen.has(mapped.slug)) continue;
    seen.add(mapped.slug);
    out.push(mapped);
    if (out.length >= limit) break;
  }
  return out;
}

async function loadFeed(feed: Feed, limit: number): Promise<Vacancy[]> {
  const res = await httpFetch(feed.url, {
    timeoutMs: FETCH_TIMEOUT,
    headers: {
      'User-Agent': 'EZOffer/1.0 (+https://ezoffer.example)',
      Accept: 'application/json, application/xml, text/xml, text/html, */*',
    },
  });
  if (!res.ok) throw new Error(res.error ?? 'network error');
  return parseFreelanceFeed(res.body, feed.source, limit);
}

function makeProvider(feed: Feed): VacancyProvider {
  return {
    source: feed.source,
    label: feed.name,
    isAvailable: () => true,
    async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
      try {
        const vacancies = await loadFeed(feed, query.limit ?? 60);
        return { vacancies, provider: feed.source, ok: true };
      } catch (err) {
        const message = (err as Error).message;
        logError(`[${feed.source}]`, new Error(message));
        return { vacancies: [], provider: feed.source, ok: false, error: message };
      }
    },
  };
}

export const FL_RU_URL = 'https://www.fl.ru/rss/all';
export const KWORK_URL = 'https://kwork.com/rss';

/** Заказы с fl.ru — русская доска, самый большой объём IT-заказов из доступных. */
export const flruProvider = makeProvider({
  name: 'FL.ru',
  url: FL_RU_URL,
  source: 'flru',
  pickCompany: () => '',
  pickCategory: (i) => i.category,
});

/** Kwork — маленький фид (5 позиций), но живой и с IT-категориями. */
export const kworkProvider = makeProvider({
  name: 'Kwork',
  url: KWORK_URL,
  source: 'kwork',
  pickCompany: () => '',
  pickCategory: (i) => i.category,
});
