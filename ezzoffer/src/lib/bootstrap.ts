import { logError, logInfo } from './logger';
import { envNum } from './env';
import { purgeExpiredAuthRows } from './auth';

/**
 * Node-часть bootstrap.
 *
 * Отдельный модуль нужен из-за того, как Turbopack собирает Edge-бандл: он
 * анализирует тело instrumentation.ts СТАТИЧЕСКИ, независимо от проверки
 * `process.env.NEXT_RUNTIME`. Из-за этого `process.on(...)` и `setInterval`
 * прямо в instrumentation давали предупреждение
 * "A Node.js API is used (process.on) which is not supported in the Edge
 * Runtime" — рантайм-код не запускался в Edge, но анализатор всё равно его
 * видел.
 *
 * Здесь этот код живёт и подключается из instrumentation.ts динамическим
 * import() уже ПОСЛЕ проверки рантайма. Edge-бандл до сюда не доходит,
 * а Turbopack корректно собирает модуль для Node-части.
 */

let schedulerStarted = false;

export async function startNodeRuntime(): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    logError(
      'process:unhandledRejection',
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  });

  // Разовая уборка просроченных сессий и OAuth-состояний на старте: за время
  // простоя база накапливает строки, которые без этого никогда не удаляются.
  try {
    purgeExpiredAuthRows();
  } catch (err) {
    logError('bootstrap:purge', err);
  }

  // envNum, а не Number(process.env.X ?? default): Number("") === 0, и пустая
  // переменная в .env.example полностью отключала бы планировщик.
  const intervalMs = envNum(process.env, 'SCHEDULER_INTERVAL_MS', 5 * 60 * 1000, { min: 60_000 });

  // Защита от двойного запуска: register() зовётся и при старте, и в некоторых
  // dev-сценариях повторно. Два интервала означали бы двойной поток откликов.
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (intervalMs < 60_000) {
    logInfo('scheduler', 'интервал меньше минуты — планировщик не запущен');
    return;
  }

  logInfo('scheduler', `интервал запуска: ${Math.round(intervalMs / 1000)} с`);
  const tick = async (): Promise<void> => {
    try {
      const { runScheduledJobs } = await import('./scheduler');
      await runScheduledJobs();
    } catch (err) {
      logError('scheduler:schedule', err);
    }
  };
  const id = setInterval(() => {
    void tick();
  }, intervalMs);
  id.unref?.();
}
