/**
 * Конфигурация лимитов из env.
 * Глобальные мягкие лимиты позволяют администратору удерживать объём автооткликов
 * ниже порогов платформ, снижая риск блокировок.
 */

/**
 * Число из окружения.
 *
 * Ноль — допустимое значение, и раньше он молча заменялся значением по
 * умолчанию, потому что проверка была `n > 0`. Из-за этого нельзя было задать
 * `AUTOAPPLY_WORK_START=0` (полночь как начало рабочего дня превращалась в 9) и
 * `AUTOAPPLY_MIN_INTERVAL_SEC=0` (нулевая пауза превращалась в 45 секунд) —
 * администратор задавал переменную и получал другое поведение без ошибки.
 *
 * «Не задано» и «задано нулём» — разные вещи, поэтому пустая строка и
 * undefined отделяются от числа, а ноль пропускается.
 */
function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function globalDailyCap(): number {
  return num(process.env.AUTOAPPLY_DAILY_CAP, 0); // 0 = без глобального потолка
}

export function globalHourlyCap(): number {
  return num(process.env.AUTOAPPLY_HOURLY_CAP, 12);
}

/** Минимальный интервал между откликами, секунды. */
export function minApplyIntervalSec(): number {
  return num(process.env.AUTOAPPLY_MIN_INTERVAL_SEC, 45);
}

/** Максимальный интервал между откликами, секунды. */
export function maxApplyIntervalSec(): number {
  return num(process.env.AUTOAPPLY_MAX_INTERVAL_SEC, 180);
}

/** Часы работы локально (0-23). */
export function workStartHour(): number {
  const n = num(process.env.AUTOAPPLY_WORK_START, 9);
  return Math.min(23, Math.max(0, Math.round(n)));
}

export function workEndHour(): number {
  const n = num(process.env.AUTOAPPLY_WORK_END, 20);
  return Math.min(24, Math.max(1, Math.round(n)));
}

export type EffectivePacing = {
  dailyCap: number;
  hourlyCap: number;
  minDelayMs: number;
  maxDelayMs: number;
  workStartHour: number;
  workEndHour: number;
};

/** Параметры паузинга с учётом глобальных мягких лимитов. */
export function effectivePacing(planDaily: number): EffectivePacing {
  const globalDaily = globalDailyCap();
  const dailyCap = globalDaily > 0 ? Math.min(planDaily, globalDaily) : planDaily;
  return {
    dailyCap,
    hourlyCap: globalHourlyCap(),
    minDelayMs: minApplyIntervalSec() * 1000,
    maxDelayMs: maxApplyIntervalSec() * 1000,
    workStartHour: workStartHour(),
    workEndHour: workEndHour(),
  };
}
