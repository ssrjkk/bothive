import { db, type User } from './db';
import { getValidHhToken } from './hh-oauth';
import {
  responseForHhState,
  isClosedState,
  isReviewedNegotiation,
  hhStateLabel,
} from './hh-states';
import { httpFetch, parseJson } from './http-client';
import { logError, logInfo } from './logger';

/**
 * Синхронизация статусов откликов с hh.ru.
 *
 * Реальный запрос к GET /negotiations с токеном пользователя.
 * Обновляет viewed_at/responded_at/response в БД по данным hh.
 *
 * ## Что здесь было сломано
 *
 * Три независимые поломки, каждая из которых по отдельности обнуляла
 * статистику. Вместе они означали, что синхронизация не работала никогда,
 * хотя формально вызывалась каждый тик планировщика.
 *
 * 1. Эндпоинт `/negotiations/active` отдаёт только АКТИВНЫЕ переписки.
 *    Отказ (`discard`) в них не попадает — он отдельным статусом. Значит
 *    ветка записи `status='declined'` была недостижима в принципе, и
 *    «Отказы» были нулём всегда, хотя и считались в getStats.
 *
 * 2. `per_page` не передавался. Дефолт hh — 20 записей на страницу, при
 *    лимите тарифа 250 откликов в сутки синхронизировались 20 самых свежих,
 *    а остальные навсегда. Страницы не обходились вовсе.
 *
 * 3. Переписки сопоставлялись с откликами через `JOIN vacancies` по
 *    `v.source_id`. Но каталог чистится по TTL в 7 дней (vacancies/index.ts),
 *    а `applications` не удаляется никогда. То есть для всех откликов старше
 *    недели строки в `vacancies` уже нет, JOIN их отбрасывал, и статус не
 *    приходил никогда. JOIN был и не нужен: идентификатор вакансии hh сидит
 *    прямо в slug отклика (`hh-<id>`), то есть в данных, которые не
 *    выбрасываются.
 */

/** Актуальный ресурс переписок. `status=all` — иначе отказов не видно. */
const NEGOTIATIONS_URL = 'https://api.hh.ru/negotiations';

const PAGE_LIMIT = 100;
/** hh отдаёт по 100 за раз; 20 страниц — 2000 переписок, больше не бывает. */
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 20_000;

type HhNegotiation = {
  state?: { id?: string; name?: string };
  created_at?: string;
  updated_at?: string;
  /** Признак «работодатель рассмотрел отклик». Единственный честный сигнал. */
  reviewed?: boolean;
  unread_messages?: number;
  /** id вакансии; в части ответов приходит только в ссылке — см. vacancyIdOf. */
  vacancy?: { id?: string };
  url?: string;
};

type HhNegotiationsResponse = {
  items?: HhNegotiation[];
  found?: number;
  hidden_count?: number;
};

/**
 * Идентификатор вакансии hh в переписке.
 *
 * Берётся из поля `vacancy.id`, а если его нет — из ссылки
 * `…vacancyId=30251545`. Вторая ветка нужна потому, что состав полей
 * переписки менялся на площадке, и полагаться только на `vacancy.id` —
 * значит однажды молча потерять сопоставление целиком.
 */
function vacancyIdOf(n: HhNegotiation): string | null {
  const direct = n.vacancy?.id;
  if (direct) return direct;
  const fromUrl = /vacancyId=(\d+)/.exec(n.url ?? '')?.[1];
  return fromUrl ?? null;
}

/** Момент времени hh; на битой дате — null, чтобы не записать NaN в INTEGER. */
function timeOf(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : fallback;
}

/**
 * Забрать все переписки пользователя.
 *
 * Страницы обходятся до конца: `found` говорит, сколько записей у площадки
 * всего, и цикл идёт, пока не набрано. Раньше страниц не было вовсе, и при
 * 40 активных переписках 20 из них были не видны — причём молча.
 */
async function fetchNegotiations(token: string): Promise<HhNegotiation[]> {
  const out: HhNegotiation[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      // all, а не active: иначе отказы и закрытые переписки не приходят
      // вовсе, а это ровно те события, ради которых синхронизация нужна.
      status: 'all',
      per_page: String(PAGE_LIMIT),
      page: String(page),
      order_by: 'updated_at',
    });
    const res = await httpFetch(`${NEGOTIATIONS_URL}?${params.toString()}`, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'EZOffer/1.0',
      },
    });

    if (!res.ok) {
      // Первая страница не пришла — синхронизации нет, и об этом честно
      // пишем в лог. Дальше — работаем с тем, что есть: часть данных лучше,
      // чем ничего, и следующий тик доберёт остальное.
      if (page === 0) {
        throw new Error(`hh.ru вернул HTTP ${res.status}`);
      }
      break;
    }

    const data = parseJson<HhNegotiationsResponse>(res.body);
    const items = data?.items ?? [];
    if (items.length === 0) break;
    out.push(...items);

    const found = typeof data?.found === 'number' ? data.found : null;
    if (found !== null && out.length >= found) break;
    if (items.length < PAGE_LIMIT) break;
  }
  return out;
}

export async function syncHhStatuses(userId: number): Promise<{ updated: number; error?: string }> {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  if (!user) return { updated: 0 };
  const token = (await getValidHhToken(user))?.token;
  if (!token || !user.hh_resume_id) {
    return { updated: 0 };
  }

  try {
    const items = await fetchNegotiations(token);

    // По вакансии, а не по флагу разобранного состояния: две переписки по
    // одной вакансии (повторный отклик) должны схлопнуться в одну запись.
    const hhVacancies = new Map<string, HhNegotiation>();
    for (const n of items) {
      const vacancyId = vacancyIdOf(n);
      if (!vacancyId) continue;
      const previous = hhVacancies.get(vacancyId);
      // Список отсортирован по updated_at, поэтому первая — свежайшая.
      if (!previous) hhVacancies.set(vacancyId, n);
    }

    let updated = 0;
    /*
     * Отклики hh берутся напрямую по slug, без JOIN с vacancies.
     *
     * slug — это `hh-<id>` (vacancies/hh.ts), то есть идентификатор площадки
     * лежит в нём самом. Соединение с каталогом было нужно только ради
     * source_id, а каталог протухает за 7 дней: JOIN выбрасывал ровно те
     * отклики, ради которых синхронизация и нужна.
     */
    const apps = db
      .prepare(
        `SELECT id, job_slug, status, viewed_at, responded_at, response, response_note, withdrawn
         FROM applications
         WHERE user_id = ? AND job_slug LIKE 'hh-%' AND withdrawn = 0`,
      )
      .all(userId) as {
      id: number;
      job_slug: string;
      status: string;
      viewed_at: number | null;
      responded_at: number | null;
      response: string;
      response_note: string;
      withdrawn: number;
    }[];

    for (const app of apps) {
      const vacancyId = app.job_slug.slice(3);
      const hh = hhVacancies.get(vacancyId);
      if (!hh) continue;
      // Идентификатор из slug и из переписки обязаны совпадать как числа:
      // "30251545" и "030251545" — один id, но строки разные.
      if (vacancyId !== vacancyIdOf(hh)) continue;
      const now = Date.now();
      const updatedAt = timeOf(hh.updated_at, now);

      const state = hh.state?.id ?? null;
      const response = responseForHhState(state);
      const closed = isClosedState(state);
      const reviewed = isReviewedNegotiation(hh.reviewed);

      /*
       * Причина отказа берётся из `state.name` — это текст самой площадки
       * («Вакансия закрыта», «Отказ по причине отсутствия опыта»), и для
       * человека это единственное объяснение, которое что-то значит.
       * Ключ состояния в подпись не годится: по нему получилось бы
       * «discard» — слово, которого на русском нет.
       */
      const label = hh.state?.name?.trim() || hhStateLabel(state);

      // Рассмотрено: единственный признак, который hh отдаёт соискателю.
      if (reviewed && app.viewed_at === null) {
        const r = db
          .prepare('UPDATE applications SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL')
          .run(updatedAt, app.id);
        if (r.changes > 0) updated++;
      }

      /*
       * Отказ — это и ответ, и закрытие. Ответом он делается через
       * responded_at: иначе отказы выпадали бы из знаменателя «ответили HR»
       * и портили расчёт конверсии.
       *
       * Ключевое: перезаписывать уже записанный ответ нельзя. Отклик, который
       * сначала пригласили, а потом отказали, должен остаться приглашением с
       * пометкой об отказе — иначе приглашение исчезает из статистики навсегда.
       */
      if (closed) {
        const r = db
          .prepare(
            `UPDATE applications
             SET viewed_at = COALESCE(viewed_at, ?),
                 responded_at = COALESCE(responded_at, ?),
                 status = 'declined',
                 response = 'decline',
                 response_note = COALESCE(NULLIF(response_note, ''), ?)
             WHERE id = ?`,
          )
          .run(reviewed ? updatedAt : null, updatedAt, label ?? 'отказ', app.id);
        if (r.changes > 0) updated++;
        continue;
      }

      if (response === 'interview') {
        const r = db
          .prepare(
            `UPDATE applications
             SET viewed_at = COALESCE(viewed_at, ?),
                 responded_at = COALESCE(responded_at, ?),
                 status = 'responded',
                 response = 'interview',
                 response_note = COALESCE(NULLIF(response_note, ''), ?)
             WHERE id = ?`,
          )
          .run(reviewed ? updatedAt : null, updatedAt, label ?? 'приглашение', app.id);
        if (r.changes > 0) updated++;
      }
    }

    if (updated > 0) {
      logInfo('hh:sync', `обновлено статусов: ${updated}`, { userId });
    }
    return { updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    return { updated: 0, error: msg };
  }
}

export async function syncAllHhUsers(): Promise<void> {
  const users = db
    .prepare("SELECT id FROM users WHERE hh_token IS NOT NULL AND hh_token != ''")
    .all() as {
    id: number;
  }[];
  for (const u of users) {
    try {
      const res = await syncHhStatuses(u.id);
      if (res.error) {
        logError('hh:sync:all', new Error(res.error), { userId: u.id });
      }
    } catch (err) {
      logError('hh:sync:all', err, { userId: u.id });
    }
  }
}
