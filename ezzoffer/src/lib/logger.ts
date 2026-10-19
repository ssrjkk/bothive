/**
 * Логирование.
 *
 * Next вызывает `register()` из instrumentation.ts во всех окружениях, включая
 * Edge, где `node:fs` недоступен. Раньше logger.ts импортировал fs/path на
 * верхнем уровне, и Turbopack ругался: "A Node.js module is loaded ('node:fs')
 * which is not supported in the Edge Runtime".
 *
 * Поэтому ядро (форматирование, консоль) кросс-рантаймовое, а файловая запись
 * лежит в log-file.ts и подключается лениво, только в Node-окружении.
 * Статический re-export из log-file здесь был бы ошибкой: Turbopack включил бы
 * node:fs в Edge-бандл по цепочке импортов, даже если код не выполняется.
 */

type Level = 'error' | 'info';

export type LogMeta = Record<string, unknown>;

/** Файловые логи — только в production и только в Node. */
function fileLoggingEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && typeof process.versions?.node === 'string';
}

function silent(): boolean {
  return process.env.EZOFFER_SILENT === '1';
}

export function formatLine(level: Level, scope: string, message: string, meta?: LogMeta): string {
  const ts = new Date().toISOString();
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level}] ${scope}: ${message}${suffix}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

// Модуль с node:fs грузится один раз и только когда файловые логи включены.
// Импорт динамический: статический require Turbopack считал бы литералом и
// включил бы node:fs в Edge-бандл (и заставил бы трассировать весь проект).
//
// turbopackIgnore здесь ставить нельзя: пометка оставляет "./log-file" как есть,
// импорт падает с ERR_MODULE_NOT_FOUND и writeLine молча уходит в catch — то
// есть в production просто не было бы файловых логов.
type FileLogger = { writeLine(line: string): void };
let fileLogger: FileLogger | null | undefined;

async function getFileLogger(): Promise<FileLogger | null> {
  if (fileLogger !== undefined) return fileLogger;
  if (!fileLoggingEnabled()) {
    fileLogger = null;
    return fileLogger;
  }
  try {
    const mod = (await import('./log-file')) as typeof import('./log-file');
    fileLogger = { writeLine: mod.writeLogLine };
  } catch {
    fileLogger = null;
  }
  return fileLogger;
}

/**
 * Пишет в файл, если файловые логи включены; иначе ничего не делает.
 * Первый вызов асинхронно подгружает модуль, последующие — синхронно.
 */
export function writeToFile(line: string): void {
  if (fileLogger) {
    fileLogger.writeLine(line);
    return;
  }
  if (!fileLoggingEnabled()) return;
  void getFileLogger().then((logger) => logger?.writeLine(line));
}

export function logError(scope: string, err: unknown, meta?: LogMeta): void {
  if (silent()) return;
  const line = formatLine('error', scope, errorMessage(err), meta);
  console.error(line);
  writeToFile(line);
}

export function logInfo(scope: string, message: string, meta?: LogMeta): void {
  if (silent()) return;
  const line = formatLine('info', scope, message, meta);
  console.log(line);
  writeToFile(line);
}
