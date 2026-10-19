import type { Level, WorkFormat } from '../data';
import type {
  Vacancy,
  VacancyApplyResult,
  VacancyFetchResult,
  VacancyProvider,
  VacancyQuery,
} from './types';
import { sanitizeExternalUrl, toSalaryNumber } from './util';
import { parsePublishedAt } from './published';
import { httpFetch, parseJson } from '../http-client';
import { getHhAppToken, hhSearchConfigured } from '../hh-app-token';
import { resolveAreaId } from '../hh-areas';
import { logError } from '../logger';

const BASE = 'https://api.hh.ru/vacancies';
const FETCH_TIMEOUT = 25_000;
/** hh отдаёт максимум 100 за раз (per_page cap). */
const MAX_PER_PAGE = 100;
/** Сколько страниц дёргаем за один проход. 10 страниц = до 1000 вакансий. */
const MAX_PAGES = 10;

type HhRaw = {
  items?: HhVacancyRaw[];
};

type HhSalary = {
  from?: number | null;
  to?: number | null;
  currency?: string;
  gross?: boolean;
};

export type HhVacancyRaw = {
  id?: string;
  name?: string;
  alternate_url?: string;
  published_at?: string;
  employer?: { name?: string };
  area?: { name?: string };
  salary?: HhSalary | null;
  schedule?: { id?: string; name?: string };
  professional_roles?: { name?: string }[];
  snippet?: { requirement?: string; responsibility?: string | null };
};

function relativePosted(iso: string): string {
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
  if (/(стаж|intern)/.test(s)) return 'Intern';
  if (/(младш|junior)/.test(s)) return 'Junior';
  if (/(ведущ|senior|старш|principal|lead)/.test(s)) return 'Senior';
  return 'Middle';
}

function inferFormat(id?: string): WorkFormat {
  switch (id) {
    case 'remote':
      return 'Удалённо';
    case 'flexible':
    case 'hybrid':
    case 'shift':
      return 'Гибрид';
    default:
      return 'В офисе';
  }
}

function salaryDisplay(s?: HhSalary | null): string {
  if (!s) return 'по договорённости';
  const from = toSalaryNumber(s.from) ?? 0;
  const to = toSalaryNumber(s.to) ?? 0;
  const sym = s.currency === 'RUR' || s.currency === 'RUB' ? '₽' : (s.currency ?? '');
  if (from > 0 && to > 0)
    return `${from.toLocaleString('ru-RU')}–${to.toLocaleString('ru-RU')} ${sym}`;
  if (from > 0) return `от ${from.toLocaleString('ru-RU')} ${sym}`;
  if (to > 0) return `до ${to.toLocaleString('ru-RU')} ${sym}`;
  return 'по договорённости';
}

function cleanSnippet(s?: string): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapHhVacancy(raw: HhVacancyRaw): Vacancy | null {
  if (!raw.id || !raw.name) return null;
  const req = cleanSnippet(raw.snippet?.requirement);
  const resp = cleanSnippet(raw.snippet?.responsibility ?? undefined);
  return {
    slug: `hh-${raw.id}`,
    source: 'hh',
    source_id: raw.id,
    title: raw.name,
    company: raw.employer?.name ?? 'Компания',
    salary: salaryDisplay(raw.salary),
    salary_min: toSalaryNumber(raw.salary?.from),
    salary_max: toSalaryNumber(raw.salary?.to),
    level: inferLevel(raw.name),
    format: inferFormat(raw.schedule?.id),
    city: raw.area?.name ?? 'Россия',
    posted: relativePosted(raw.published_at ?? ''),
    published_at: parsePublishedAt(raw.published_at),
    category: raw.professional_roles?.[0]?.name ?? 'Работа',
    about: resp ? `${resp}\n\n${req}` : req || 'Описание доступно на hh.ru.',
    responsibilities: resp ? [resp] : [],
    requirements: req ? [req] : [],
    bonus: [],
    source_url: sanitizeExternalUrl(raw.alternate_url),
    contact_email: null,
    contact_phone: null,
  };
}

/**
 * Классификация отказа hh по POST /negotiations.
 *
 * Разделение принципиальное: backoff существует ради риска блокировки, а не
 * ради очистки мусора. Если на закрытую вакансию включать паузу, то одна
 * запись, пролежавшая в каталоге неделю, замедлит весь прогон.
 *
 *   404 / 400 «не найдена», «закрыта», «недоступна»  → closed
 *   401 / 403                                          → auth
 *   429 / 503                                           → rate_limit
 *   прочее                                              → other
 *
 * Текст ошибки нужен: hh не всегда пишет код, соответствующий сути, и по
 * одному 400 нельзя понять, закрыта вакансия или отказали по резюме.
 */
export function classifyApplyFailure(
  status: number,
  body: string,
): { kind: NonNullable<VacancyApplyResult['kind']>; error: string } {
  const text = (body ?? '').toLowerCase();

  const looksClosed =
    text.includes('closed') ||
    text.includes('not found') ||
    text.includes('закрыт') ||
    text.includes('не найден') ||
    text.includes('недоступн') ||
    text.includes('архив') ||
    text.includes('vacancy not') ||
    text.includes('not available');

  if (status === 404 || (status === 400 && looksClosed)) {
    return { kind: 'closed', error: 'Вакансия закрыта на hh.ru' };
  }
  if (status === 401 || status === 403) {
    /*
     * 401 и 403 разведены по разным видам.
     *
     * Раньше оба сводились в один «auth» и дальше вели к одному и тому же
     * действию. 401 — сервис не предъявил действующий токен: он истёк, лечится
     * перепривязкой в кабинете, и ждать шесть часов незачем. 403 — токен принят,
     * а доступ к аккаунту ограничила площадка: это уже не настройка сервиса,
     * смотреть надо ограничения на самом hh.
     *
     * Путать их было дорого: человек с истёкшим токеном получал «hh ограничил
     * аккаунт, проверьте ограничения на hh» — то есть отправлялся совсем не туда.
     */
    return status === 401
      ? { kind: 'token', error: 'Токен hh.ru истёк — перепривяжите аккаунт в кабинете' }
      : {
          kind: 'auth',
          error: 'hh.ru ограничил доступ к аккаунту — проверьте ограничения на hh.ru',
        };
  }
  if (status === 429 || status === 503) {
    return { kind: 'rate_limit', error: `Платформа ограничивает темп (HTTP ${status})` };
  }
  return {
    kind: 'other',
    error:
      `${status === 0 ? 'сетевая ошибка' : `HTTP ${status}`} ${(body ?? '').slice(0, 180)}`.trim(),
  };
}

export const hhProvider: VacancyProvider = {
  source: 'hh',
  label: 'hh.ru',

  /*
   * Доступность ПОИСКА.
   *
   * Смысл для каталога: «можно ли сейчас обновить вакансии hh». Требуется
   * токен приложения.
   *
   * Важное разделение. Раньше этот же метод использовался автооткликом как
   * проверка «можно ли отправить отклик» — и это было неверно: для отправки
   * нужен только пользовательский токен. В итоге человек с привязанным hh
   * получал isAvailable() === false (нет токена приложения у сервиса) и не
   * отправлял НИ ОДНОГО отклика, даже имея рабочий пользовательский токен.
   * Теперь у провайдера два независимых признака, и автоотклик смотрит на
   * applyCanRun(), а обновление каталога — на isAvailable().
   */
  isAvailable: () => hhSearchConfigured(),

  /** Можно ли отправить отклик (нужен пользовательский токен и резюме). */
  canApply(userToken: string | null, resumeId: string | null): boolean {
    return Boolean(userToken?.trim() && resumeId?.trim());
  },

  async apply(vacancy, ctx): Promise<VacancyApplyResult> {
    /*
     * Отправка идёт ТОЛЬКО пользовательским токеном: отклик уходит от имени
     * человека, и подставлять сюда токен приложения нельзя — hh отвергнет
     * запрос или пришлёт вакансию от служебного аккаунта.
     *
     * Раньше был фолбэк на HH_ACCESS_TOKEN, позволявший отправить отклик НЕ
     * от того пользователя, которому он принадлежит.
     */
    const token = ctx.accessToken?.trim();
    if (!token) {
      return { ok: false, kind: 'auth', error: 'Аккаунт hh.ru не привязан' };
    }

    const vacancyId = /^hh-/.test(vacancy.slug) ? vacancy.slug.slice(3) : vacancy.source_id;
    const payload: Record<string, unknown> = { vacancy_id: vacancyId, resume_id: ctx.resumeId };
    if (ctx.message?.trim()) payload.message = ctx.message.trim().slice(0, 500);

    // Один retry при сетевом сбое: hh.ru иногда отвечает 5xx под нагрузкой,
    // и потерянный отклик из-за разового сбоя — это реально потерянная
    // возможность. 4xx (кроме 429) повторами не лечатся.
    const res = await httpFetch('https://api.hh.ru/negotiations', {
      method: 'POST',
      timeoutMs: FETCH_TIMEOUT,
      attempts: 2,
      /*
       * 429 здесь намеренно не повторяется.
       *
       * Клиент по умолчанию повторяет и его — для чтения каталога это удобно.
       * Но площадка сказала «не сейчас», и повтор через паузу делает ровно то,
       * чего она просила не делать, плюс ещё один запрос в счёт лимита. Срок из
       * Retry-After и так доезжает до паузера, который остановит отправку
       * целиком, а не подождёт и не повторит.
       */
      shouldRetry: (status) => status >= 500,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'EZOffer/1.0',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) return { ok: true };

    /*
     * Классификация отказа.
     *
     * Без неё каждая неудачная отправка считалась «платформа отталкивает»
     * и включала backoff. Закрытая за два дня вакансия при этом замедляла
     * весь прогон на часы — то есть каталог, где запись живёт неделю,
     * мог отравить автоотклик целиком.
     */
    return {
      ok: false,
      ...classifyApplyFailure(res.status, res.body),
      /*
       * Срок ожидания доезжает до паузера.
       *
       * Без этого hh говорил «не раньше» в заголовке, а автоотклик об этом не
       * узнавал и ждал рассчитанную паузу — то есть почти наверняка приходил
       * раньше и получал 429 ещё раз.
       */
      retryAfterMs: res.retryAfterMs,
    };
  },

  /**
   * Поиск вакансий с пагинацией.
   *
   * Раньше забиралась ровно одна страница: `per_page=limit` (50 по умолчанию)
   * без `page`. То есть каталог hh никогда не превышал 50 записей, сколько бы
   * страниц ни было доступно — и автоотклик, отбирающий только hh, физически
   * не мог набрать дневной лимит.
   *
   * Теперь страницы обходятся до достижения лимита или MAX_PAGES. Ошибка на
   * промежуточной странице не отменяет уже собранное: терять первую страницу
   * из-за сбоя на третьей незачем.
   */
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    const token = await getHhAppToken();
    if (!token) {
      return {
        vacancies: [],
        provider: 'hh',
        ok: false,
        error: hhSearchConfigured()
          ? 'hh.ru не выдал токен приложения'
          : 'Нет HH_CLIENT_ID/HH_CLIENT_SECRET — поиск по hh.ru недоступен',
      };
    }

    const want = Math.min(Math.max(1, query.limit ?? 50), MAX_PER_PAGE * MAX_PAGES);
    const perPage = Math.min(want, MAX_PER_PAGE);
    const collected: Vacancy[] = [];
    const seen = new Set<string>();
    let pages = 0;
    let lastError: string | undefined;

    while (collected.length < want && pages < MAX_PAGES) {
      const params = new URLSearchParams();
      if (query.text) params.set('text', query.text);
      /*
        area — это ИДЕНТИФИКАТОР области из справочника hh, а не название.
        Раньше сюда уходил текст из поля «Город», то есть `area=Москва`, и hh
        отвечал 400. Дальше первая же неудачная страница давала `ok: false`,
        а refreshProviders по этому флагу не делал ни запись, ни чистку. Итог:
        у каждого, кто задал город, источник hh не давал ни одной вакансии —
        а автоотклик работает только по hh.

        Если город не опознан, `area` не передаётся вовсе: мусорный параметр
        хуже отсутствия параметра, потому что молча отсекает всю выдачу.
        */
      const areaId = await resolveAreaId(query.city);
      if (areaId) params.set('area', String(areaId));
      params.set('per_page', String(perPage));
      if (pages > 0) params.set('page', String(pages));
      // Сортировка по дате: иначе hh отдаёт «витринные» вакансии, а свежие
      // остаются на второй странице и до автоотклика не доходят.
      params.set('order_by', 'publication_time');

      const res = await httpFetch(`${BASE}?${params.toString()}`, {
        timeoutMs: FETCH_TIMEOUT,
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'EZOffer/1.0 (ezoffer.ru)',
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        lastError = res.error ?? `HTTP ${res.status}`;
        if (pages === 0) {
          return { vacancies: [], provider: 'hh', ok: false, error: lastError };
        }
        break; // первая страница есть — возвращаем что собрали
      }

      const data = parseJson<HhRaw>(res.body);
      if (data === null) {
        lastError = 'некорректный JSON';
        break;
      }

      const items = data.items ?? [];
      if (items.length === 0) break; // дошли до конца выдачи

      for (const raw of items) {
        const v = mapHhVacancy(raw);
        if (v && !seen.has(v.slug)) {
          seen.add(v.slug);
          collected.push(v);
        }
        if (collected.length >= want) break;
      }
      pages++;
    }

    if (collected.length === 0 && lastError) {
      logError('hh:search', new Error(lastError));
      return { vacancies: [], provider: 'hh', ok: false, error: lastError };
    }

    return { vacancies: collected, provider: 'hh', ok: true };
  },
};
