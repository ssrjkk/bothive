/**
 * Анти-бан паузер для автооткликов.
 *
 * Сервис не браузерный: он ходит в hh.ru обычными HTTP-запросами от имени
 * пользователя, и подделывать нечего — отпечатка браузера у него нет. Поэтому
 * «не выглядеть ботом» здесь сводится к трём вещам: не превышать лимиты,
 * держать паузу между откликами и правильно реагировать на отказы площадки.
 *
 * Классификация отказов — главное, что здесь изменилось.
 *
 * Раньше отказов было два вида: «platform» и «network». На практике это не
 * работало: тело ответа различало четыре ситуации, а сюда попадали все,
 * кроме закрытой вакансии. В итоге 403 от hh — то есть аккаунт ограничен,
 * самый опасный сигнал из возможных — считался тем же, что и таймаут сети,
 * и получал пятиминутную паузу вместо остановки на часы. Обратная ошибка тоже
 * была: сетевой сбой эскалировал паузу так же, как отказ площадки, хотя
 * ничего о риске для аккаунта не говорит.
 *
 * Теперь видов три, и у каждого своя политика:
 *
 *  - `network` — таймаут, обрыв, 5xx. Про площадку ничего не известно, пауза
 *    короткая и почти не растёт.
 *  - `rate_limit` — 429/503. Площадка прямо попросила замедлиться: пауза
 *    длинная и растёт.
 *  - `blocked` — 401/403. Аккаунт ограничен. Это надо останавливать на часы и
 *    говорить человеку, а не молча продолжать.
 *
 * Счётчик отказов обнуляется успешной отправкой: один плохой день иначе
 * навсегда оставил бы завышенные паузы, и каждая следующая мелочь ждала бы
 * дольше предыдущей.
 *
 * Retry-After от площадки — это инструкция, а не намёк, поэтому он
 * выполняется, но с потолком: один капризный апстрим не должен вставать
 * колом на сутки.
 *
 * Чистая функция-фабрика: состояние в замыкании, инжектируется now для тестов.
 */

export type PacingConfig = {
  dailyLimit: number;
  hourlyLimit: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** Локальный час начала работы (0-23). */
  workStartHour: number;
  /** Локальный час окончания работы (0-23). */
  workEndHour: number;
  /** Минуты, округляем вниз к границе часа (защита от ровного ритма). */
  jitterMinutes: number;
};

export const DEFAULT_PACING: PacingConfig = {
  dailyLimit: 50,
  hourlyLimit: 12,
  minDelayMs: 45_000,
  maxDelayMs: 3 * 60_000,
  workStartHour: 9,
  workEndHour: 20,
  jitterMinutes: 3,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Виды отказа и пауза после него.
 *
 * `blocked` — самый длинный и самый быстрорастущий: если аккаунт ограничили,
 * продолжать откликаться значит добивать его. Потолок — сутки, дальше ждать
 * бессмысленно, потому что состояние сбрасывает человек.
 */
const BACKOFF: Record<FailureKind, (streak: number) => number> = {
  // Таймаут не говорит о риске для аккаунта, поэтому растёт слабо.
  network: (streak) => Math.min(10, 2 * Math.max(1, streak)) * MINUTE,
  rate_limit: (streak) => Math.min(120, 15 * 2 ** Math.min(Math.max(1, streak) - 1, 3)) * MINUTE,
  blocked: (streak) => Math.min(24 * HOUR, 6 * HOUR * Math.max(1, streak)),
};

/** Потолок для Retry-After: иначе 429 с Retry-After: 3600 встал бы на час. */
const RETRY_AFTER_CAP = 2 * HOUR;

export type FailureKind = 'network' | 'rate_limit' | 'blocked';

export type PaceDecision =
  | { allowed: true; delayMs: number }
  | {
      allowed: false;
      reason: 'night' | 'daily' | 'hourly' | 'backoff';
      retryAfterMs: number;
      /** Что именно площадка сказала — показывается человеку. */
      detail?: string;
    };

export type Pacing = {
  decide(now?: number): PaceDecision;
  recordSent(now?: number): void;
  recordFailure(kind: FailureKind, now?: number): void;
  /** Запрос площадки «не приходи раньше» — выполняется досрочно. */
  respectRetryAfter(ms: number, now?: number): void;
  /** До какого момента аккаунт заблокирован (0 — не заблокирован). */
  blockedUntil(now?: number): number;
  /** Обновляет лимиты на ходу: остаток дневного лимита меняется каждый тик. */
  configure(patch: Partial<PacingConfig>): void;
};

function startOfLocalHour(now: number, hour: number): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

function hourFloor(now: number): number {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function dayFloor(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function createPacing(
  config: Partial<PacingConfig> = {},
  nowFn: () => number = Date.now,
): Pacing {
  const cfg: PacingConfig = { ...DEFAULT_PACING, ...config };
  const sentTimestamps: number[] = [];
  let lastFailureAt = 0;
  let failureStreak = 0;
  /** Вид последнего отказа — от него зависит, чем считать паузу. */
  let failureKind: FailureKind = 'network';
  /** Пауза до следующей отправки: реальный планировщик зовёт decide() один раз на тик. */
  let cooldownUntil = 0;
  /** Инструкция площадки «не раньше»: важнее расчётного backoff, но с потолком. */
  let retryAfterUntil = 0;
  let retryAfterDetail = '';
  /** Аккаунт ограничен площадкой — самый сильный сигнал, держим дольше всех. */
  let blockUntil = 0;
  /** Задержка, возвращённая последним разрешённым decide(); применяется в recordSent. */
  let pendingDelayMs = 0;

  const randomDelay = (): number => {
    const base = Math.round(cfg.minDelayMs + Math.random() * (cfg.maxDelayMs - cfg.minDelayMs));
    const jitter = Math.floor(Math.random() * (cfg.jitterMinutes + 1)) * 60_000;
    return base + jitter;
  };

  return {
    configure(patch: Partial<PacingConfig>): void {
      Object.assign(cfg, patch);
    },

    decide(now = nowFn()): PaceDecision {
      const t = now;

      // Аккаунт ограничен площадкой — самый приоритетный отказ.
      if (blockUntil > t) {
        return {
          allowed: false,
          reason: 'backoff',
          retryAfterMs: blockUntil - t,
          detail: 'hh.ru ограничил доступ к аккаунту',
        };
      }

      // Выдержка после предыдущей отправки внутри того же процесса.
      if (cooldownUntil > t) {
        return { allowed: false, reason: 'backoff', retryAfterMs: cooldownUntil - t };
      }

      // Ночь: пауза до начала рабочего дня.
      const hour = new Date(t).getHours();
      if (hour < cfg.workStartHour || hour >= cfg.workEndHour) {
        const start = startOfLocalHour(t, cfg.workStartHour);
        const retry = start <= t ? start + 24 * HOUR : start;
        return { allowed: false, reason: 'night', retryAfterMs: retry - t };
      }

      // Инструкция площадки важнее расчётного backoff.
      if (retryAfterUntil > t) {
        return {
          allowed: false,
          reason: 'backoff',
          retryAfterMs: retryAfterUntil - t,
          detail: retryAfterDetail || undefined,
        };
      }

      // Backoff после отказа. Считается от последнего отказа, а не от старта
      // процесса: иначе пауза накапливалась бы сама.
      if (lastFailureAt > 0) {
        const wait = BACKOFF[failureKind](failureStreak);
        if (t - lastFailureAt < wait) {
          return {
            allowed: false,
            reason: 'backoff',
            retryAfterMs: wait - (t - lastFailureAt),
            detail: FAILURE_LABEL[failureKind],
          };
        }
      }

      // Часовой лимит.
      const hourStart = hourFloor(t);
      const hourlyUsed = sentTimestamps.filter((ts) => ts >= hourStart).length;
      if (hourlyUsed >= cfg.hourlyLimit) {
        const nextHour = hourStart + HOUR;
        return { allowed: false, reason: 'hourly', retryAfterMs: nextHour - t };
      }

      // Суточный лимит.
      const dayStart = dayFloor(t);
      const dailyUsed = sentTimestamps.filter((ts) => ts >= dayStart).length;
      if (dailyUsed >= cfg.dailyLimit) {
        const nextDay = dayStart + 24 * HOUR;
        return { allowed: false, reason: 'daily', retryAfterMs: nextDay - t };
      }

      // Джиттер-пауза между откликами. Вызывающий код обязан ждать delayMs
      // перед фактической отправкой — иначе паузы не существует.
      const delayMs = randomDelay();
      pendingDelayMs = delayMs;
      return { allowed: true, delayMs };
    },

    recordSent(now = nowFn()): void {
      sentTimestamps.push(now);
      cooldownUntil = now + pendingDelayMs;
      pendingDelayMs = 0;
      /*
       * Успешная отправка обнуляет серию отказов.
       *
       * Без этого счётчик копился весь срок жизни процесса, и у пользователя,
       * пережившего один плохой вечер, каждая последующая мелочь ждала бы
       * дольше предыдущей — вплоть до потолка в два часа на сетевой таймаут.
       */
      failureStreak = 0;
      lastFailureAt = 0;
      retryAfterUntil = 0;
      retryAfterDetail = '';
      // Храним только последние 24 часа.
      const cutoff = now - 24 * HOUR;
      for (let i = 0; i < sentTimestamps.length; i++) {
        if (sentTimestamps[i] < cutoff) {
          sentTimestamps.splice(i, 1);
          i--;
        }
      }
    },

    recordFailure(kind: FailureKind, now = nowFn()): void {
      lastFailureAt = now;
      /*
       * Серия растёт только внутри одного вида отказа.
       *
       * Смешивать виды нельзя: два сетевых таймаута подряд, а потом отказ
       * площадки, не должны превращаться в получасовую паузу — потому что
       * «отказов было три» само по себе ничего не значит, значит только их вид.
       */
      failureStreak = failureStreak > 0 && failureKind === kind ? failureStreak + 1 : 1;
      failureKind = kind;
      if (kind === 'blocked') {
        blockUntil = now + BACKOFF.blocked(failureStreak);
      }
    },

    respectRetryAfter(ms: number, now = nowFn()): void {
      if (!Number.isFinite(ms) || ms <= 0) return;
      retryAfterUntil = now + Math.min(ms, RETRY_AFTER_CAP);
      retryAfterDetail = 'hh.ru попросил замедлиться (Retry-After)';
    },

    blockedUntil(now = nowFn()): number {
      return blockUntil > now ? blockUntil : 0;
    },
  };
}

/** Человеческие подписи отказов — они показываются в кабинете и в Telegram. */
export const FAILURE_LABEL: Record<FailureKind, string> = {
  network: 'Сбой связи с hh.ru',
  rate_limit: 'hh.ru попросил замедлиться',
  blocked: 'hh.ru ограничил доступ к аккаунту',
};

/** Тестовый хелпер: мгновенная пауза, без лимитов и задержек. */
export function zeroPacing(): Pacing {
  return {
    decide: () => ({ allowed: true, delayMs: 0 }),
    recordSent: () => undefined,
    recordFailure: () => undefined,
    respectRetryAfter: () => undefined,
    blockedUntil: () => 0,
    configure: () => undefined,
  };
}
