/**
 * Единое чтение env. Одинокий `process.env.X ?? default` опасен: `??` не
 * срабатывает на пустой строке, а в .env.example почти все переменные
 * объявлены пустыми. Реальные поломки, которые это вызывало:
 *
 *  - EZOFFER_DB_PATH="" → better-sqlite3 открывал временную БД в памяти,
 *    данные пользователей исчезали при рестарте;
 *  - SITE_URL="" → sitemap с относительными url и пустой metadataBase;
 *  - CATALOG_TTL_MS="" → Number("") === 0, каталог считался просроченным
 *    всегда и обновлялся на каждом тике планировщика;
 *  - SCHEDULER_INTERVAL_MS="" → Number("") === 0, планировщик не запускался.
 */

/** Строка: пустое значение (в т.ч. из пробелов) равносильно отсутствию. */
export function envStr(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

/** Непустая строка или null — для секретов и опциональных фич. */
export function envOpt(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

/** Число с валидацией: мусор, пустое значение и неположительное → fallback. */
export function envNum(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {},
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n < min || n > max) return fallback;
  return n;
}

/** URL без хвостового слэша — для SITE_URL и базовых адресов. */
export function envBaseUrl(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  return envStr(env, key, fallback).replace(/\/$/, '');
}
