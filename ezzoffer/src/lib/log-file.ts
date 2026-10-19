import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Файловая часть логирования. Живёт отдельно от logger.ts, потому что Next
 * собирает instrumentation для Edge, где node:fs недоступен: статический импорт
 * отсюда протаскивал бы Node-модули в Edge-бандл.
 *
 * Модуль используется только из Node-контекста (server routes, scheduler).
 */

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATIONS = 5;

/** Метка времени из имени ротации; для нечисловых имён — 0. */
export function rotationStamp(name: string): number {
  const n = Number(name.slice('app.log.'.length));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ротация по размеру, а не по факту записи: иначе каждая строка переименовывала
 * бы текущий файл, и в логе оставалась ровно одна строка. Текущий app.log
 * никогда не удаляется — только устаревшие app.log.<ts>.
 *
 * Сортировка по числовому суффиксу: имена вида app.log.<epoch-ms> (13 цифр)
 * при лексикографической сортировке оказываются "старее" app.log.300, и свежая
 * ротация удаляется первой.
 */
export function rotateLogFile(file: string, maxBytes = MAX_LOG_BYTES, keep = KEEP_ROTATIONS): void {
  try {
    const dir = dirname(file);
    if (statSync(file).size < maxBytes) return;

    renameSync(file, join(dir, `app.log.${Date.now()}`));

    const rotations = readdirSync(dir)
      .filter((f: string) => f.startsWith('app.log.') && f !== 'app.log')
      .sort((a: string, b: string) => rotationStamp(a) - rotationStamp(b));
    while (rotations.length > keep) {
      const oldest = rotations.shift();
      if (oldest) unlinkSync(join(dir, oldest));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Каталог логов всегда внутри ./data, а EZOFFER_LOG_DIR задаёт только имя
 * подкаталога. Произвольный путь не поддерживается намеренно: статический
 * префикс ./data нужен, чтобы file tracing не считал fs-доступ динамическим.
 * Иначе Turbopack трассирует весь проект и в .next/standalone попадают исходники,
 * тесты и локальная ezoffer.db с хэшами паролей и токенами.
 */
export function resolveLogDir(env: Record<string, string | undefined>, cwd: string): string {
  const raw = env.EZOFFER_LOG_DIR?.trim() ?? '';
  const segment = raw.split(/[/\\]+/).filter((s) => s && s !== '.' && s !== '..')[0];
  return join(cwd, 'data', segment || 'logs');
}

function logDir(): string {
  const dir = resolveLogDir(process.env, process.cwd());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Пишет строку в ./data/logs/app.log с ротацией по размеру. */
export function writeLogLine(line: string): void {
  try {
    const file = join(logDir(), 'app.log');
    appendFileSync(file, line + '\n', 'utf8');
    rotateLogFile(file);
  } catch {
    /* ignore */
  }
}
