import { db, type User } from './db';
import { isPlanActive, planDailyLimit } from './plans';
import { matchesSearch, skillsByVacancy, type SearchRow } from './matcher';
import { getCatalog } from './vacancies';
import { hhProvider } from './vacancies/hh';
import { getValidHhToken } from './hh-oauth';
import { createPacing, type FailureKind, type Pacing, type PacingConfig } from './anti-ban';
import { effectivePacing } from './config';
import { notifyAccountBlocked } from './telegram-digest';
import { renderLetterTemplate } from './cover-letter';
import { rankLettersForVacancy } from './ai-matching';
import { rankVacancies, bestResumeFor, type ResumeTarget } from './resume-targeting';
import { DEMO_MODE_MESSAGE, isLiveMode } from './user-mode';
import type { Vacancy, VacancyApplyResult } from './vacancies/types';
import { logError, logInfo } from './logger';

/**
 * Реальный автоотклик: для каждого активного поиска находит подходящие вакансии
 * и отправляет отклики через hh.ru API от имени пользователя.
 *
 * Что изменилось и почему:
 *
 *  - ПИСЬМА. Раньше в `hhProvider.apply` уходило `message: undefined`, то есть
 *    письмо не отправлялось НИ ОДНОГО РАЗА, хотя API его поддерживает, весь
 *    раздел писем в кабинете написан, и на главной письма обещаны как
 *    отличие сервиса. Теперь письмо подбирается под конкретную вакансию.
 *  - ПОРЯДок. Раньше вакансии брались в порядке каталога, то есть отклик
 *    уходил на первую попавшуюся. Теперь — по скорингу под резюме, и пока
 *    есть выбор, лучшие вакансии расходуют лимит первыми.
 *  - КЭШ. Навыки вакансий считаются один раз на прогон, а не на каждую
 *    проверку.
 */

export type AutoApplyRun = {
  ran: boolean;
  reason?: string;
  searches: number;
  applied: number;
  failed: number;
  /**
   * Подходящие вакансии, на которые отклик не пошёл.
   *
   * Смешивает две разные причины, поэтому для устаревших есть отдельный счётчик
   * `stale`: «вакансия закрыта» и «вы уже откликались» требуют от человека
   * противоположных действий — первую надо исправлять настройкой возраста,
   * второе делать не нужно вовсе. В одной цифре это не различить, и человек
   * чинит несуществующую проблему.
   */
  skipped: number;
  /** Подходящие вакансии старше порога — отклик на них не отправлен намеренно. */
  stale: number;
  pausedFor: string | null;
  /**
   * Чем именно вызвана пауза — своими словами.
   *
   * Раньше в отчёте было только `pausedFor: "backoff"`, и панель писала
   * «платформа отклонила отклики». Это неправда в двух случаях: паузу мог
   * вызвать Retry-After от hh (то есть площадка сама сказала «не раньше») или
   * ограничение аккаунта. Человек читал неверную причину.
   */
  pausedDetail: string | null;
  pausedUsers: number;
  /** Аккаунты, остановленные ограничением hh. */
  blockedUsers: number;
  /** Отклики, к которым приложено письмо. */
  withLetter: number;
  /** Вакансии без подходящего письма — отправлены без него. */
  withoutLetter: number;
  /**
   * Аккаунты, остановленные демо-режимом.
   *
   * Отдельный счётчик, потому что иначе «ноль откликов» у demo-пользователя
   * неотличим от поломки. Человек, который не включил живой режим, должен
   * видеть именно это, а не «подходящих вакансий не было».
   */
  demoUsers: number;
  /**
   * Пользователи, у которых прогон упал с исключением.
   *
   * Отдельный счётчик по той же причине, что и `demoUsers`: «ноль откликов,
   * потому что у одного человека сломалось» и «ноль откликов, потому что
   * вакансий не было» — это разные ситуации с разными действиями, и без
   * этого счётчика обе выглядят одинаково.
   */
  erroredUsers: number;
};

/**
 * Сколько откликов в день допустимо у одной компании.
 *
 * Несколько вакансий в одной компании — нормальный интерес, двадцать — нет.
 * Значение задаётся переменной окружения, потому что у разных поисков разная
 * специфика: в крупной компании несколько вакансий одного профиля обычны.
 */
function companyDailyCap(): number {
  const raw = process.env.AUTOAPPLY_PER_COMPANY;
  const n = raw === undefined || raw.trim() === '' ? 4 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 4;
}

/**
 * На сколько останавливаем отклики при 403.
 *
 * Длиннее, чем пауза anti-ban: ограничение держится часами, и короткая пауза
 * означала бы, что сервис полезет пробовать снова через несколько минут и
 * только добьёт аккаунт. Снимается либо временем, либо успешным откликом.
 */
const BLOCK_STOP_MS = 6 * 60 * 60 * 1000;

/** Ответ hh → вид отказа для паузера. */
export function toFailureKind(kind: NonNullable<VacancyApplyResult['kind']>): FailureKind {
  switch (kind) {
    case 'auth':
      return 'blocked';
    case 'rate_limit':
      return 'rate_limit';
    // Истёкший токен — это не ограничение аккаунта. Останавливать на шесть
    // часов нельзя: он лечится перепривязкой в кабинете за минуту.
    case 'token':
      return 'rate_limit';
    // «network» и «other» — таймаут, 5xx, невнятный код: про риск для
    // аккаунта они не говорят, поэтому пауза короткая.
    default:
      return 'network';
  }
}

export function blockedUntil(userId: number): number {
  const row = db
    .prepare('SELECT autoapply_blocked_until AS v FROM users WHERE id = ?')
    .get(userId) as { v: number | null } | undefined;
  const v = row?.v ?? 0;
  return v && v > Date.now() ? v : 0;
}

export function blockedReason(userId: number): string {
  const row = db
    .prepare('SELECT autoapply_block_reason AS v FROM users WHERE id = ?')
    .get(userId) as { v: string | null } | undefined;
  return row?.v ?? '';
}

function setBlockedUntil(userId: number, until: number, reason: string): void {
  db.prepare(
    `UPDATE users SET autoapply_blocked_until = ?, autoapply_block_reason = ? WHERE id = ?`,
  ).run(until, reason, userId);
}

function todayCount(userId: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db
    .prepare(
      'SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND sent_at >= ? AND withdrawn = 0',
    )
    .get(userId, start.getTime()) as { c: number };
  return row.c;
}

function getActiveSearches(userId: number): SearchRow[] {
  return db
    .prepare('SELECT * FROM searches WHERE user_id = ? AND active = 1')
    .all(userId) as SearchRow[];
}

type LetterRow = { id: number; title: string; content: string };

function getLetters(userId: number): LetterRow[] {
  return db
    .prepare('SELECT id, title, content FROM letters WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as LetterRow[];
}

/**
 * Текст резюме пользователя — нужен, чтобы письмо опиралось на реальный опыт,
 * а не на шаблон. Берём последнее обновлённое.
 */
function getLatestResume(userId: number): { id: number; title: string; content: string } | null {
  const row = db
    .prepare(
      'SELECT id, title, content FROM resumes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(userId) as { id: number; title: string; content: string } | undefined;
  return row ?? null;
}

/**
 * Все резюме пользователя для подбора и назначения.
 *
 * Порядок — по обновлению, чтобы при полном равенстве совпадений выбор падал
 * на то, за которым человек работает сейчас, а не на случайно созданное
 * раньше. Совпадения считаются в resume-targeting по навыкам, а не здесь.
 *
 * Экспортируется, потому что подбор резюме нужен и планировщику, и боту: если
 * каждый напишет свой запрос, рано или поздно они разойдутся, и список в чате
 * перестанет совпадать с тем, что реально уходит.
 */
export function getUserResumes(userId: number): ResumeTarget[] {
  return db
    .prepare(
      'SELECT id, title, content, hh_id FROM resumes WHERE user_id = ? ORDER BY updated_at DESC, id DESC',
    )
    .all(userId) as ResumeTarget[];
}

/**
 * Паузер живёт в модульной памяти и переживает вызовы runAutoApply: иначе
 * часовой и суточный лимиты сбрасывались бы на каждом тике планировщика,
 * и AntiBan не ограничивал бы ничего. Ключ — id пользователя.
 */
const pacingByUser = new Map<number, Pacing>();

function pacingFor(userId: number, cfg: Partial<PacingConfig>, nowFn: () => number): Pacing {
  const existing = pacingByUser.get(userId);
  if (existing) return existing;
  const created = createPacing(cfg, nowFn);
  pacingByUser.set(userId, created);
  return created;
}

/** Сброс паузеров (используется в тестах). */
export function resetPacing(): void {
  pacingByUser.clear();
}

/**
 * Подбор письма под вакансию.
 *
 * Берём лучшее из сохранённых писем по совпадению навыков. Если подходящих
 * нет — подставляем вакансию и компанию в шаблон пользователя.
 *
 * Почему без LLM: `personalizeLetter` ходит в сеть с таймаутом 30 секунд на
 * КАЖДУЮ вакансию. Планировщик обрабатывает пользователей по очереди, и один
 * медленный отклик к LLM задержал бы весь цикл — включая отклики других
 * пользователей. В автоотклике письмо строим шаблоном (это мгновенно),
 * а генерацию через модель оставляем там, где человек смотрит на результат
 * и может подождать, — в кабинете.
 */
async function buildLetter(
  vacancy: Vacancy,
  letters: LetterRow[],
  resumeContent: string,
): Promise<{ text: string; letterId: number | null } | null> {
  if (letters.length > 0) {
    const ranked = rankLettersForVacancy(letters, vacancy);
    const best = ranked[0];
    // Совпадение хотя бы с одним навыком вакансии — письмо релевантно.
    // Если ноль, лучше отправить резюме с минимальным шаблоном, чем чужое письмо.
    if (best && best.score > 0) {
      return { text: best.content, letterId: best.id };
    }
  }

  const template = defaultLetterTemplate(resumeContent);
  const text = renderLetterTemplate(template, vacancy).trim();
  return text ? { text, letterId: null } : null;
}

/**
 * Шаблон письма по умолчанию.
 *
 * Из резюме берётся первая строка достижения с цифрой — именно она отвечает
 * на главный вопрос работодателя «почему вы», а «Здравствуйте, меня
 * заинтересовала ваша вакансия» не отвечает ни на что.
 */
function defaultLetterTemplate(resumeContent: string): string {
  const achievement = (resumeContent ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /\d/.test(l) && l.length > 20 && l.length < 300);

  const why = achievement
    ? `В последней работе: ${achievement}.`
    : 'Готов обсудить детали и показать релевантные примеры.';

  return (
    'Здравствуйте!\n\n' +
    'Меня заинтересовала вакансия {вакансия} в компании {компания} ({город}). ' +
    `${why}\n\n` +
    'Буду рад обсудить задачи и рассказать, как могу быть полезен.\n\n' +
    'С уважением'
  );
}

/**
 * Максимальный возраст вакансии для автоотклика.
 *
 * Два дня — не произвольное число. При лимите 50 откликов в сутки и паузах
 * 45–180 секунд весь дневной лимит расходуется примерно за полчаса-час. За
 * это время список вакансий устаревает, и часть записей к моменту отклика
 * уже закрыта.
 *
 * Потеря от отказа на закрытой вакансии двойная: тратится слот дневного
 * лимита (а он один на день) и включается backoff, который замедляет все
 * последующие отклики. Вакансия, которой два дня, ещё может быть открыта;
 * вакансия недельной давности — почти наверняка нет.
 */
const MAX_APPLY_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Только вакансии, на которые ещё имеет смысл откликаться.
 *
 * Дата публикации неизвестна (площадка её не отдала) — вакансия пропускается:
 * сказать «свежая» без данных было бы предположением, а предположение здесь
 * стоит слота дневного лимита. Для источников без даты (RSS-фиды компаний)
 * это заметно консервативнее, но консервативно — правильно: лимит конечен.
 */
export function onlyFresh(
  vacancies: Vacancy[],
  now = Date.now(),
  maxAgeMs = MAX_APPLY_AGE_MS,
): Vacancy[] {
  return vacancies.filter((v) => {
    if (typeof v.published_at !== 'number') return false;
    const age = now - v.published_at;
    // Дата из будущего — мусор в данных площадки, а не свежая вакансия.
    if (age < 0) return false;
    return age <= maxAgeMs;
  });
}

export async function runAutoApply(opts?: {
  pacing?: Partial<PacingConfig>;
  now?: () => number;
}): Promise<AutoApplyRun> {
  const nowFn = opts?.now ?? (() => Date.now());
  const users = db.prepare('SELECT * FROM users').all() as User[];
  let searches = 0;
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  let staleTotal = 0;
  let ran = false;
  let pausedFor: string | null = null;
  let pausedDetail: string | null = null;
  let pausedUsers = 0;
  /** Аккаунты, которые hh ограничил: их отклики остановлены до снятия. */
  let blockedUsers = 0;
  let withLetter = 0;
  let withoutLetter = 0;
  let demoUsers = 0;
  /** Пользователи, у которых прогон упал целиком. Видно в отчёте. */
  let erroredUsers = 0;
  /**
   * Общий «стоп» для прогона: площадка ограничила аккаунт.
   *
   * Раньше здесь стоял `break` прямо в теле цикла по пользователям. Когда тело
   * обернули в try/catch ради изоляции сбоев, `break` стал невозможен, и его
   * пришлось заменить флагом с той же семантикой: остановить обход после
   * текущего пользователя.
   */
  let stopAll = false;

  for (const user of users) {
    /*
     * Демо-режим — единственная причина пропустить пользователя целиком.
     *
     * Проверка стоит выше тарифа и паузы намеренно: демо-режим не про лимит и
     * не про настройку, это решение человека, и оно должно быть видно в
     * отчёте, а не прятаться за формулировкой «нет активных поисков».
     *
     * Раньше этой строки не было вовсе — планировщик обходил всех, у кого
     * активный тариф, независимо от режима. Человек, который никогда не
     * включал живой режим, всё равно получал реальные отклики от своего имени.
     */
    if (!isLiveMode(user)) {
      if (isPlanActive(user)) demoUsers++;
      continue;
    }
    if (!isPlanActive(user)) continue;
    const limit = planDailyLimit(user.plan);
    if (limit <= 0) continue;

    // Пользователь поставил автоотклики на паузу.
    if (user.autoapply_paused) {
      pausedUsers++;
      continue;
    }

    /*
     * Аккаунт ограничен площадкой — не трогаем его до снятия ограничения.
     *
     * Без этой проверки каждый тик планировщика снова стучался бы в hh и снова
     * получал 403. Ограничение держится часами, и повторные попытки только
     * ухудшают положение аккаунта.
     */
    const stopUntil = blockedUntil(user.id);
    if (stopUntil > 0) {
      blockedUsers++;
      continue;
    }

    const activeSearches = getActiveSearches(user.id);
    if (activeSearches.length === 0) continue;
    ran = true;

    /*
     * Изоляция одного пользователя от остальных.
     *
     * Раньше тело цикла шло без try/catch, и любое исключение — от
     * getValidHhToken до похода в hh — выходило из runAutoApply целиком.
     * Дальше это ловил runScheduledJobs, который просто логировал, и
     * автоотклик не срабатывал НИ ДЛЯ КОГО: один человек с битым токеном,
     * недоступной сетью или испорченными данными глушил отклики всех
     * остальных. При этом в отчёте стояло «0 откликов» без единого слова о
     * причине — то есть выглядело как «вакансий нет».
     *
     * Теперь сбой одного пользователя учётная запись не трогает: он считается,
     * попадает в отчёт отдельной строкой и пишется в лог с его id.
     */
    try {
      const used = todayCount(user.id);
      const remaining = Math.max(0, limit - used);
      if (remaining <= 0) continue;

      // Анти-бан: суточный лимит = остаток от тарифа (с учётом глобального
      // потолка), часовой лимит и паузы — из конфигурации.
      const base = effectivePacing(limit);
      const effectiveDaily = Math.min(remaining, base.dailyCap);
      /*
       * Переданные извне паузы имеют приоритет над конфигурацией.
       *
       * Раньше здесь стояло `pacing.configure({ ...base, dailyLimit })` уже
       * ПОСЛЕ createPacing с opts.pacing — и configure делает Object.assign, то
       * есть затирал инъекцию значениями по умолчанию. Инъекция existла, была
       * задокументирована параметром opts.pacing и молча ничего не делала:
       * тест, который просил нулевую паузу, получал 45 секунд и мог проверить
       * только первый отклик за тик. Теперь явные значения побеждают.
       */
      const overrides = opts?.pacing ?? {};
      const pacing = opts?.pacing
        ? createPacing({ ...base, ...overrides, dailyLimit: effectiveDaily }, nowFn)
        : pacingFor(user.id, { ...base, dailyLimit: effectiveDaily }, nowFn);
      pacing.configure({ ...base, dailyLimit: effectiveDaily, ...overrides });

      const appliedSet = new Set<string>();
      /*
       * Резюме пользователя — все, а не одно.
       *
       * Раньше подбор шёл по последнему обновлённому резюме, а отправлялось
       * users.hh_resume_id. При нескольких резюме это расхождение становилось
       * системным: система выбирала вакансии под «Python», а уходило резюме
       * «React». Теперь на каждую вакансию резюме выбирается отдельно.
       *
       * Резюме, созданные вручную, отправлять нельзя — hh принимает свой id.
       * Они остаются в оценке и письме, но id отклика берётся из того резюме,
       * которое реально привязано к hh, либо из общего hh_resume_id.
       */
      const resumes = getUserResumes(user.id);
      const sendableResumes = resumes.filter((r) => r.hh_id);
      const fallbackResumeId = user.hh_resume_id?.trim() || null;
      // Отправлять имеет смысл, только если резюме на hh вообще есть: либо
      // привязанное к конкретному резюме, либо общее на уровне аккаунта.
      const anySendable = sendableResumes.length > 0 || fallbackResumeId !== null;
      /*
       * Токен берём только если есть куда отправлять. Раньше здесь стояло
       * `resumeId ? await getValidHhToken(user) : null` — без привязанного резюме
       * токен не трогали вовсе. Обращение к hh лишнее, когда отправлять нечего.
       */
      const token = anySendable ? ((await getValidHhToken(user))?.token ?? null) : null;

      const letters = getLetters(user.id);
      // Резюме для письма: последнее обновлённое, как и раньше. Письмо — это
      // текст, и тут важно совпадение с резюме человека, а не с вакансией.
      const primaryResume = getLatestResume(user.id);
      const primaryResumeText = primaryResume?.content ?? '';

      // Каталог и навыки — один раз на пользователя, а не на каждый поиск.
      const catalog = getCatalog();
      const skillsCache = skillsByVacancy(catalog);

      /*
       * Аккаунт ограничили площадкой.
       *
       * Один 403 означает, что продолжать нельзя: пока ограничение висит, каждый
       * следующий отклик только ухудшает положение. Поэтому цикл обрывается, а
       * причина сохраняется — иначе после перезапуска сервис снова пошёл бы
       * откликаться, не понимая, что вчера его остановили.
       */
      let blockedUser = false;
      let blockReason = '';
      const blockedUntilCol = blockedUntil(user.id);
      /** Отклики за сегодня — для потолка на компанию. Собирается один раз. */
      let slugs: { job_slug: string; company: string }[] | null = null;
      const dayStartMs = new Date().setHours(0, 0, 0, 0);

      for (const search of activeSearches) {
        if (appliedSet.size >= remaining) break;
        searches++;

        const candidates = catalog.filter(
          (v) => v.source === 'hh' && matchesSearch(v, search, skillsCache.get(v.slug)),
        );
        if (candidates.length === 0) continue;

        /*
         * Порядок отправки.
         *
         * Раньше вакансии шли в порядке каталога, то есть лимит расходовался на
         * первые попавшиеся, а не на подходящие. Здесь сортируем так, чтобы
         * раньше шли те, где пересечение с резюме больше: при лимите 50 в день
         * разница между «первые 50 из каталога» и «50 самых подходящих» — это
         * разница между откликами в пустоту и откликами в ответ.
         */
        const fresh = onlyFresh(candidates);
        const stale = candidates.length - fresh.length;
        if (stale > 0) {
          /*
           * Отдельно считаем пропущенные по устаревшим вакансиям: это не то же
           * самое, что «уже отправлено». Человек, у которого лимит расходуется
           * впустую на закрытые вакансии, должен видеть, сколько именно таких.
           */
          staleTotal += stale;
          skipped += stale;
        }
        if (fresh.length === 0) continue;

        /*
         * Порядок отправки и назначение резюме — одним проходом.
         *
         * Раньше сортировка шла по пересечению с ОДНИМ резюме (последним
         * обновлённым), и вакансия, идеально подходящая под второе резюме,
         * могла оказаться в конце списка просто потому, что с первым не
         * пересекалась. Теперь оценка берётся от лучшего подходящего резюме, то
         * есть отвечает на вопрос «насколько эта вакансия подходит кому-то из
         * моих резюме» — именно его человек и задаёт, заполняя несколько
         * резюме.
         *
         * Ранжировать только по отправляемым нельзя: ручное резюме без привязки к
         * hh годится для оценки, и его навыки должны влиять на порядок.
         */
        const ranked = rankVacancies(fresh, resumes.length > 0 ? resumes : [], skillsCache);

        for (const { vacancy, resume: picked } of ranked) {
          if (appliedSet.size >= remaining) break;
          if (appliedSet.has(vacancy.slug)) continue;

          /*
           * id резюме для отклика.
           *
           * Приоритет у привязанного резюме, подобранного под вакансию. Если
           * подходящего привязанного нет — берётся общее hh_resume_id: так
           * продолжают работать люди, у которых резюме заведено вручную и
           * привязка задана на уровне аккаунта.
           *
           * Резюме без привязки отправлять нельзя: hh принимает только свой id,
           * и подставлять локальный — значит отправлять мусор.
           */
          const sendableId = picked?.hh_id ?? null ?? fallbackResumeId;
          const canApply = hhProvider.canApply
            ? hhProvider.canApply(token, sendableId)
            : Boolean(token && sendableId);
          if (!canApply) {
            // Считаем только те вакансии этого поиска, которые ещё не отправлены
            // в этом прогоне. Раньше здесь стояло `skipped += candidates.length`:
            // список целиком учитывался для КАЖДОГО поиска, и уже отправленные
            // вакансии попадали в «пропущено» повторно — метрика раздувалась
            // в разы и показывала несуществующую проблему в статистике.
            skipped += ranked.filter((r) => !appliedSet.has(r.vacancy.slug)).length;
            break;
          }

          const decision = pacing.decide();
          if (!decision.allowed) {
            // Любой отказ AntiBan останавливает пользователя до следующего тика.
            // Раньше условие `reason !== "night"` пропускало ночные отказы: код
            // выходил из цикла только если причина была не "night", поэтому ночью
            // отказы по часовому/суточному лимиту игнорировались.
            pausedFor = decision.reason;
            pausedDetail = decision.detail ?? null;
            break;
          }

          const already = db
            .prepare(
              'SELECT id FROM applications WHERE user_id = ? AND job_slug = ? AND withdrawn = 0',
            )
            .get(user.id, vacancy.slug);
          if (already) continue;

          if (!hhProvider.apply || !sendableId) break;

          /*
           * Потолок на одну компанию за день.
           *
           * Без него бывает так: у человека активный поиск по фронтенду, у
           * компании Авито двадцать подходящих вакансий, и двадцать откликов у
           * неё за день. Работодатель видит это в своей ленте, для площадки это
           * выглядит как аномалия, и под удар попадает аккаунт человека, а не
           * абстрактный «бот».
           *
           * Лимит небольшой и осмысленный: несколько вакансий в одной компании —
           * это нормальный интерес, двадцать — нет. Отклик переносится на завтра
           * сам, вакансия не теряется.
           */
          if (!slugs) {
            slugs = db
              .prepare(
                `SELECT a.job_slug AS job_slug, COALESCE(v.company, '') AS company
                 FROM applications a
                 LEFT JOIN vacancies v ON v.slug = a.job_slug
                 WHERE a.user_id = ? AND a.sent_at >= ? AND a.withdrawn = 0
                 ORDER BY a.sent_at DESC LIMIT 500`,
              )
              .all(user.id, dayStartMs) as { job_slug: string; company: string }[];
          }
          const company = vacancy.company.trim();
          const cap = companyDailyCap();
          // cap = 0 отключает потолок — так же, как AUTOAPPLY_DAILY_CAP в этом
          // же сервисе: ноль означает «ограничения нет», а не «не отправлять».
          if (company && cap > 0) {
            const used = slugs.filter((r) => r.company === company).length;
            if (used >= cap) continue;
          }

          /*
           * Письмо.
           *
           * Раньше здесь было `message: undefined` — письмо не уходило никогда.
           * Теперь подбираем письмо под конкретную вакансию. Если письмо
           * построить не удалось (LLM недоступен и шаблон пуст), отклик всё
           * равно отправляется — письмо улучшает отклик, но не является его
           * условием, и лучше отправить резюме, чем не отправить ничего.
           *
           * Текст для письма берётся из того же резюме, которое уходит на hh.
           * Раньше письмо писалось по последнему обновлённому резюме, а уходило
           * другое — то есть человек мог писать в сопроводительном «5 лет Python»,
           * а отклик уходил с резюме «React». Берём то, что действительно отправляется.
           */
          const letterResumeText = picked?.content || primaryResumeText;
          const letter = await buildLetter(vacancy, letters, letterResumeText);
          const message = letter?.text;

          const result = await hhProvider.apply(vacancy, {
            resumeId: sendableId,
            ...(message ? { message } : {}),
            accessToken: token ?? undefined,
          });
          if (!result.ok) {
            failed++;
            /*
             * Backoff включается не на каждый отказ, а только на тот, который
             * говорит о риске для аккаунта.
             *
             * Раньше здесь стояло безусловное recordFailure("platform"), и
             * закрытая вакансия — а каталог держит записи неделю — включала
             * экспоненциальную паузу. То есть мёртвая запись, попавшая в
             * подбор, замедляла все последующие отклики на часы. Теперь
             * «вакансии больше нет» просто пропускается: это не отказ платформы
             * и никакого отношения к риску блокировки не имеет.
             */
            /*
             * Отказ из hh разбирается по виду, а не по факту неудачи.
             *
             * Раньше здесь стояло `kind === "rate_limit" ? "platform" :
             * "network"`, то есть 403 от hh — аккаунт ограничен — считался
             * сетевым сбоем и получал паузу в несколько минут вместо остановки
             * на часы. Это ровно тот случай, когда надо молчать нельзя: если
             * аккаунт ограничили, человек теряет отклики и не понимает почему.
             *
             * Закрытая вакансия — не отказ платформы и никакого отношения к риску
             * блокировки не имеет: каталог хранит записи неделю, и мёртвая
             * запись, попавшая в подбор, замедляла бы все последующие отклики.
             */
            const kind = result.kind ?? 'other';
            if (kind === 'closed') {
              skipped++;
              continue;
            }
            if (kind === 'auth') {
              blockedUser = true;
              blockReason = 'hh.ru ограничил доступ к аккаунту';
            }
            pacing.recordFailure(toFailureKind(kind));
            /*
             * Срок от площадки важнее рассчитанной паузы.
             *
             * Если hh назвал конкретный срок, ждать меньше — значит прийти раньше
             * и получить 429 ещё раз. Раньше заголовок терялся в HTTP-клиенте, и
             * паузер считал паузу сам, то есть почти наверняка неправильно.
             */
            if (result.retryAfterMs && result.retryAfterMs > 0) {
              pacing.respectRetryAfter(result.retryAfterMs);
            }
            logError('autoapply', new Error(result.error ?? 'apply failed'), {
              userId: user.id,
              slug: vacancy.slug,
              kind,
            });
            continue;
          }

          pacing.recordSent();
          const now = Date.now();
          /* В applications пишется именно то резюме, что ушло, а не общее
             users.hh_resume_id. Иначе история откликов показывала бы чужое
             резюме, и понять, почему на вакансию фронтенда ушло «Python», было
             бы невозможно. */
          db.prepare(
            `INSERT INTO applications (user_id, job_slug, search_id, resume_id, letter_id, message, status, origin, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, 'sent', 'real', ?)`,
          ).run(
            user.id,
            vacancy.slug,
            search.id,
            sendableId,
            letter?.letterId ?? null,
            message ?? '',
            now,
          );
          appliedSet.add(vacancy.slug);
          applied++;
          /*
           * Отклик записан в счёт потолка компании сразу.
           *
           * Список за день собирается один раз на прогон, и без этой строки он
           * оставался бы пустым до следующего тика: девять откликов в одну
           * компанию проходили как девять в разные.
           */
          if (company) slugs.push({ job_slug: vacancy.slug, company });
          if (message) withLetter++;
          else withoutLetter++;

          // Успех снимает прошлую блокировку: ограничение могло снять сам hh.
          if (blockedUntilCol > 0) {
            db.prepare(
              `UPDATE users SET autoapply_blocked_until = 0, autoapply_block_reason = '' WHERE id = ?`,
            ).run(user.id);
          }
        }
      }

      if (blockedUser) {
        /*
         * Останавливаемся сами, а не ждём следующего тика.
         *
         * Планировщик сам вызывает decide() каждый тик, но между тиками может
         * пройти минута, за которую успеет уйти ещё несколько откликов в
         * ограниченный аккаунт. Состояние пишется в БД, поэтому перезапуск
         * процесса его не сбросит.
         */
        setBlockedUntil(user.id, Date.now() + BLOCK_STOP_MS, blockReason);
        blockedUsers++;
        logError('autoapply', new Error(blockReason), { userId: user.id });
        /*
         * Сообщение сразу, а не в следующем дайджесте.
         *
         * При 403 отклики не уходят вообще: человек без уведомления видит только
         * «их мало» и никаких зацепок. Даже если уведомление не уйдёт, пауза уже
         * стоит — то есть худший случай здесь тишина, а не удар по аккаунту.
         */
        try {
          await notifyAccountBlocked(
            user.telegram_chat_id,
            blockReason,
            Date.now() + BLOCK_STOP_MS,
          );
        } catch (err) {
          logError('autoapply:notify', err, { userId: user.id });
        }
        stopAll = true;
      }

      if (appliedSet.size > 0) {
        logInfo('autoapply', `отправлено откликов: ${appliedSet.size}`, { userId: user.id });
      }
    } catch (err) {
      erroredUsers++;
      logError('autoapply:user', err, { userId: user.id });
    }

    if (stopAll) break;
  }

  const shared = {
    searches,
    applied,
    failed,
    skipped,
    stale: staleTotal,
    pausedFor,
    pausedDetail,
    pausedUsers,
    blockedUsers,
    withLetter,
    withoutLetter,
    demoUsers,
    erroredUsers,
  };

  if (!ran) {
    /*
     * Причина «ничего не было» называется точно.
     *
     * Раньше здесь стояла одна строка про «нет активных поисков», и она была
     * верной меньше чем в половине случаев: у человека мог быть активный
     * тариф, активные поиски и подходящие вакансии — и всё равно был ноль,
     * потому что он был в демо-режиме. Читать это как «вам нечего откликаться
     * на» — то самое враньё, ради которого отчёт и делается.
     */
    const reason =
      demoUsers > 0
        ? 'все активные аккаунты в демо-режиме: реальные отклики не отправляются'
        : 'нет активных поисков у пользователей с активным тарифом';
    return { ran: false, reason, ...shared };
  }
  return { ran: true, ...shared };
}

export type ApplyOutcome =
  | { ok: true; resumeId: string; withLetter: boolean }
  | {
      ok: false;
      kind:
        | 'closed'
        | 'rate_limit'
        | 'auth'
        | 'token'
        | 'network'
        | 'other'
        | 'not_found'
        | 'already'
        | 'paused'
        | 'no_resume'
        | 'stale'
        | 'demo';
      error: string;
    };

/**
 * Отклик на одну вакансию по прямому указанию человека.
 *
 * Нужен для команды бота `/отклик N`. Раньше бот на такую команду отвечал
 * «Запускаю отклики» и не делал ничего — человек нажимал и ждал откликов,
 * которых не было.
 *
 * Идёт через тот же путь, что и плановый прогон: подбор резюме, письмо,
 * классификация отказа, паузер, запись в applications. Отдельный путь означал бы
 * второе место, где эти правила могут разойтись с плановым — а они уже разошлись
 * один раз, когда сортировка брала одно резюме, а отправлялось другое.
 */
/**
 * Один отклик по прямому указанию: из бота или из кабинета.
 *
 * `opts.now` подменяет часы. Рабочее окно 9:00–20:00 — часть защиты
 * аккаунта, и ночью отклик не уходит; без подмены часов проверки этого пути
 * зависели от времени запуска и падали вечером при исправном коде.
 */
export async function applyToVacancy(
  user: User,
  vacancy: Vacancy,
  opts: { now?: () => number } = {},
): Promise<ApplyOutcome> {
  /*
   * Демо-режим отсекает отклик по указанию человека, и это первое, что надо
   * проверить: дальше идут тариф, пауза и квоты, но человеку они не помогут,
   * если он сам выбрал не отправлять.
   */
  if (!isLiveMode(user)) return { ok: false, kind: 'demo', error: DEMO_MODE_MESSAGE };
  if (!isPlanActive(user))
    return { ok: false, kind: 'auth', error: 'Тариф истёк — автоотклики на паузе' };
  if (user.autoapply_paused) return { ok: false, kind: 'paused', error: 'Автоотклики на паузе' };

  const limit = planDailyLimit(user.plan);
  if (todayCount(user.id) >= limit) {
    return { ok: false, kind: 'rate_limit', error: `Дневной лимит тарифа исчерпан (${limit})` };
  }

  if (!onlyFresh([vacancy]).length) {
    return {
      ok: false,
      kind: 'stale',
      error: 'Вакансия старше двух дней — скорее всего, она уже закрыта',
    };
  }

  const already = db
    .prepare('SELECT id FROM applications WHERE user_id = ? AND job_slug = ? AND withdrawn = 0')
    .get(user.id, vacancy.slug);
  if (already) return { ok: false, kind: 'already', error: 'Вы уже откликались на эту вакансию' };

  const resumes = getUserResumes(user.id);
  const fallbackResumeId = user.hh_resume_id?.trim() || null;
  const picked = bestResumeFor(vacancy, resumes);
  const sendableId = picked?.hh_id ?? fallbackResumeId;
  if (!sendableId) {
    return {
      ok: false,
      kind: 'no_resume',
      error: 'Нет резюме для отправки — импортируйте его с hh в кабинете',
    };
  }

  const valid = await getValidHhToken(user);
  const token = valid?.token ?? null;
  if (!token) return { ok: false, kind: 'auth', error: 'Аккаунт hh.ru не привязан' };
  if (!hhProvider.apply) return { ok: false, kind: 'other', error: 'Отправка недоступна' };

  const base = effectivePacing(limit);
  const remaining = Math.max(0, limit - todayCount(user.id));
  const pacing = pacingFor(
    user.id,
    { ...base, dailyLimit: Math.min(remaining, base.dailyCap) },
    opts.now ?? (() => Date.now()),
  );
  const decision = pacing.decide();
  if (!decision.allowed) {
    return {
      ok: false,
      kind: decision.reason === 'backoff' ? 'rate_limit' : 'paused',
      error:
        decision.reason === 'backoff'
          ? 'Пауза после отказа платформы — она снимется сама'
          : 'Сейчас не время отправки: лимит или ночной режим',
    };
  }

  const letter = await buildLetter(vacancy, getLetters(user.id), picked?.content ?? '');
  const message = letter?.text;
  const result = await hhProvider.apply(vacancy, {
    resumeId: sendableId,
    ...(message ? { message } : {}),
    accessToken: token,
  });

  if (!result.ok) {
    const kind = result.kind ?? 'other';
    if (kind === 'closed') {
      // Вакансию сняли — это не отказ платформы, откат здесь только вредит.
    } else if (kind === 'auth') {
      // Отклик из чата тоже может упереться в ограничение аккаунта.
      setBlockedUntil(user.id, Date.now() + BLOCK_STOP_MS, 'hh.ru ограничил доступ к аккаунту');
      pacing.recordFailure('blocked');
    } else {
      pacing.recordFailure(toFailureKind(kind));
    }
    return { ok: false, kind, error: result.error ?? 'Платформа отклонила отклик' };
  }

  pacing.recordSent();
  db.prepare(
    `INSERT INTO applications (user_id, job_slug, resume_id, letter_id, message, status, origin, sent_at)
     VALUES (?, ?, ?, ?, ?, 'sent', 'real', ?)`,
  ).run(user.id, vacancy.slug, sendableId, letter?.letterId ?? null, message ?? '', Date.now());

  return { ok: true, resumeId: sendableId, withLetter: Boolean(message) };
}
