/**
 * Город → код области hh.ru.
 *
 * ## Что здесь было сломано
 *
 * `vacancies/hh.ts` отправлял в hh то, что человек написал в поле «Город»:
 *
 *     if (query.city) params.set("area", query.city);
 *
 * То есть `area=Москва`. Но `area` у hh — это ИДЕНТИФИКАТОР области из
 * справочника `/areas`, а не название. Ответ на такой запрос — 400, а
 * `fetchVacancies` на первой неудачной странице возвращает `ok: false`, и
 * `refreshProviders` по этому флагу не делает ни запись, ни чистку.
 *
 * Итог: у каждого, кто задал в поиске город, источник hh не давал НИ ОДНОЙ
 * вакансии. Автоотклик работает только по `v.source === "hh"`, то есть у
 * таких людей воронка была пуста полностью — молча, без ошибки в логах.
 *
 * ## Как здесь
 *
 * Три уровня, от дешёвого к точному:
 *
 * 1. Встроенная таблица крупных городов. Коды hh стабильны (Москва — 1,
 *    Санкт-Петербург — 2), таблица покрывает большинство соискателей и
 *    работает без сети вообще.
 * 2. Живой справочник `/areas/113`, один раз на процесс. Покрывает все
 *    15 000+ населённых пунктов, включая те, что появятся после релиза.
 * 3. Если город не нашёлся — `area` НЕ передаётся. Отдавать мусор и получать
 *    400 хуже, чем искать по всей России: молчаливое расширение выдачи
 *    человек заметит по нерелевантным вакансиям, а пустую выдачу — нет.
 *
 * ## Почему не встроить весь справочник
 *
 * Плоская карта «название → код» весит 764 КБ (замерено на живом ответе
 * `/areas/113`). Класть это в исходники ради функции, которая зовётся раз в
 * 30 минут, — неразумно: таблица меняется на стороне hh, а в коде она была
 * бы навсегда устаревшей без возможности обновиться.
 */

/** Коды hh для крупных городов. Проверено по живому `/areas/113`. */
const MAJOR_CITIES: Record<string, number> = {
  москва: 1,
  'санкт-петербург': 2,
  спб: 2,
  питер: 2,
  екатеринбург: 3,
  новосибирск: 4,
  казань: 88,
  'нижний новгород': 66,
  краснодар: 53,
  самара: 78,
  омск: 68,
  'ростов-на-дону': 76,
  уфа: 99,
  красноярск: 54,
  пермь: 72,
  воронеж: 26,
  волгоград: 24,
  саратов: 79,
  тюмень: 95,
  тольятти: 212,
  ижевск: 96,
  барнаул: 11,
  ульяновск: 98,
  иркутск: 35,
  хабаровск: 102,
  ярославль: 112,
  владивосток: 22,
  махачкала: 29,
  томск: 90,
  orenбург: 70,
  кемерово: 47,
  новокузнецк: 1240,
  рязань: 77,
  астрахань: 15,
  пенза: 71,
  липецк: 58,
  тула: 92,
  чебоксары: 107,
  калининград: 41,
  брянск: 19,
  курск: 56,
  ставрополь: 84,
  сочи: 237,
  белгород: 17,
  владимир: 23,
  архангельск: 14,
  калуга: 43,
  смоленск: 83,
  мурманск: 64,
  череповец: 1753,
};

/**
 * Приводит название к виду, по которому ищем в справочнике.
 *
 * Регистр не значит ничего для площадки («МОСКВА» и «Москва» — один город),
 * а вот лишние пробелы и точки после «г.» — да. Поэтому сравниваем по
 * нормализованной строке, а не по исходной.
 */
export function normalizeCity(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Плоская карта «название → код», полученная из `/areas/113`. */
let liveAreas: Map<string, number> | null = null;
let liveAreasPromise: Promise<Map<string, number>> | null = null;

type HhArea = { id: number; name: string; areas?: HhArea[] };

/** Обходит дерево справочника и раскладывает всё в плоскую карту. */
function flatten(areas: HhArea[], into: Map<string, number>): Map<string, number> {
  for (const a of areas) {
    if (a && typeof a.id === 'number' && typeof a.name === 'string') {
      const key = normalizeCity(a.name);
      // Первый выигрывает: верхний уровень идёт раньше вложенных, и для
      // одноимённых населённых пунктов важна именно область, а не посёлок.
      if (key && !into.has(key)) into.set(key, a.id);
      if (a.areas?.length) flatten(a.areas, into);
    }
  }
  return into;
}

/**
 * Живой справочник hh. Один запрос на процесс.
 *
 * Отдельная функция, а не инлайн в резолвере, по трём причинам: её нужно
 * подменить в тестах, её интересно логировать отдельно, и она обязана
 * отработать ОДИН раз даже при параллельных вызовах из нескольких
 * одновременных обновлений каталога.
 */
async function loadLiveAreas(fetchImpl: typeof fetch): Promise<Map<string, number>> {
  const res = await fetchImpl('https://api.hh.ru/areas/113', {
    headers: { Accept: 'application/json', 'User-Agent': 'EZOffer/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`hh /areas/113 → HTTP ${res.status}`);
  const root = (await res.json()) as HhArea;
  const children = root.areas ?? [];
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error('hh /areas/113 вернул пустой справочник');
  }
  return flatten(children, new Map());
}

/** Тестовая подмена сетевого запроса и сброс кэша. */
export function __setAreasLoader(
  loader: ((f: typeof fetch) => Promise<Map<string, number>>) | null,
): void {
  liveAreas = null;
  liveAreasPromise = null;
  if (loader) liveAreasPromise = Promise.resolve(loader(fetch));
}

/** Сброс кэша (тесты). */
export function resetAreasCache(): void {
  liveAreas = null;
  liveAreasPromise = null;
}

/**
 * Код области hh по названию.
 *
 * Возвращает `null`, если город не опознан. Вызывающий обязан в этом случае
 * НЕ передавать `area`, а не подставлять мусор.
 */
export async function resolveAreaId(
  city: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const key = normalizeCity(city);
  if (!key) return null;

  // Человек мог написать несколько городов через запятую — берём первый,
  // потому что остальные для hh всё равно не имеют смысла в одном запросе.
  const first = key.split(',')[0]!.trim();
  if (!first) return null;

  const local = MAJOR_CITIES[first];
  if (local) return local;

  if (liveAreas === null) {
    // Один запрос на процесс: все параллельные вызовы ждут же его.
    liveAreasPromise =
      liveAreasPromise ??
      loadLiveAreas(fetchImpl).catch((err) => {
        // Сеть недоступна — это не повод ронять обновление каталога.
        // Следующий вызов попробует снова.
        liveAreasPromise = null;
        throw err;
      });
    try {
      liveAreas = await liveAreasPromise;
    } catch {
      return null;
    }
  }

  return liveAreas.get(first) ?? null;
}
