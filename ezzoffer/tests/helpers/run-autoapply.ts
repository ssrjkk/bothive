import { runAutoApply as realRunAutoApply } from '../../src/lib/autoapply';
import type { PacingConfig } from '../../src/lib/anti-ban';

/**
 * Прогон автоотклика на фиксированном времени.
 *
 * `runAutoApply` по замыслу не отправляет ночью: рабочее окно 9:00–20:00 —
 * это часть защиты аккаунта, и убирать её нельзя. Но из-за неё сквозные тесты
 * зависели от времени запуска: после 20:00 и до 9:00 паузер честно отказывался
 * слать, и тесты падали, хотя код был в порядке. Тринадцать тестов в одном
 * прогоне выглядели сломанными из-за настенных часов.
 *
 * Часы подменяются: полдень сегодняшнего дня гарантированно попадает в
 * рабочее окно при любом часовом поясе и в любое время суток.
 *
 * Передать свои часы можно через `now`, паузы — через `pacing`, как обычно.
 */

/** Полдень сегодняшнего дня: любое время суток одинаково годно для прогона. */
export const TEST_NOW = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
})();

export function runAutoApply(opts?: {
  pacing?: Partial<PacingConfig>;
  now?: () => number;
}): Promise<import('../../src/lib/autoapply').AutoApplyRun> {
  return realRunAutoApply({ ...opts, now: opts?.now ?? (() => TEST_NOW) });
}
