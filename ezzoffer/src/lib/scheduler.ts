import type BetterSqlite3 from 'better-sqlite3';
import { db } from './db';
import { refreshCatalogForSearches, slowProvidersDue, fastProvidersDue } from './catalog-refresh';
import { runAutoApply } from './autoapply';
import { saveLastRun } from './autoapply-store';
import { sendAlerts, sendDigests } from './telegram-digest';
import { getVacancyBySlug } from './vacancies';
import { syncAllHhUsers } from './hh-sync';
import { logError, logInfo } from './logger';

/**
 * Центральный планировщик реальных фоновых задач (однопоточный, с блокировкой от перекрытия):
 *  1. Обновление каталога вакансий (если устарел);
 *  2. Автоотклики через анти-бан паузер;
 *  3. Синхронизация статусов с hh.ru.
 */

const LOCK_KEY = 'scheduler:lock';
const CATALOG_REFRESH_KEY = 'scheduler:catalog_refresh';
const CATALOG_FAST_REFRESH_KEY = 'scheduler:catalog_fast_refresh';
const LOCK_TTL_MS = 30 * 60 * 1000;

type MetaStore = Pick<BetterSqlite3.Database, 'prepare'>;

function getMeta(instance: MetaStore, key: string): string | null {
  const row = instance.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

function setMeta(instance: MetaStore, key: string, value: string): void {
  instance
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

/**
 * Блокировка от перекрытия прогонов планировщика.
 *
 * Метка хранится в таблице meta и должна сниматься вызывающим кодом. Если
 * предыдущий запуск упал и не снял её, новый ждёт TTL — иначе после рестарта
 * два процесса работали бы одновременно.
 *
 * Регрессия: проверка была `if (now - lockAt < TTL) return` сразу после
 * записи метки, из-за чего текущий же прогон выходил, думая, что метка
 * принадлежит другому. Здесь явная проверка `held > 0` отличает «метки нет»
 * от «метка только что поставлена».
 */
export function acquireLock(instance: MetaStore, now: number, ttlMs = LOCK_TTL_MS): boolean {
  const held = Number(getMeta(instance, LOCK_KEY) ?? 0);
  if (held > 0 && now - held < ttlMs) return false;
  setMeta(instance, LOCK_KEY, String(now));
  return true;
}

/**
 * Снимает блокировку, чтобы следующий тик мог запуститься.
 *
 * `token` — метка того, кто захватил блокировку (значение, переданное в
 * acquireLock). Если он передан, метка снимается только когда она всё ещё
 * принадлежит этому владельцу.
 *
 * Зачем: без проверки владельца снятие метки из чужого прогона стирало чужую
 * блокировку. Это не абстрактная тонкость. TTL — 30 минут, а прогон планировщика
 * включает обновление каталога по всем площадкам, автоотклики и синхронизацию с
 * hh; на медленной сети он уходит за TTL. Дальше метка считается свободной,
 * её перехватывает ручной запуск через /api/autoapply/run, а по завершении
 * ручного запуска releaseLock удаляет метку уже планировщика — и третий
 * запуск стартует поверх второго, не дожидаясь ни одного.
 *
 * Без `token` поведение прежнее (снять безусловно) — так пользуются тесты и
 * любой код, где блокировку точно никто не перехватил.
 */
export function releaseLock(instance: MetaStore, token?: number): void {
  if (token === undefined) {
    instance.prepare('DELETE FROM meta WHERE key = ?').run(LOCK_KEY);
    return;
  }
  instance.prepare('DELETE FROM meta WHERE key = ? AND value = ?').run(LOCK_KEY, String(token));
}

/** Метка времени текущего владельца блокировки; 0 — блокировка свободна. */
export function lockHeldAt(instance: MetaStore): number {
  return Number(getMeta(instance, LOCK_KEY) ?? 0);
}

async function refreshCatalogIfStale(now: number): Promise<void> {
  const last = Number(getMeta(db, CATALOG_REFRESH_KEY) ?? 0);
  /*
   * Каталог обновляется под активные поиски пользователей, а не «общей
   * витриной»: запросы берутся из searches. Раньше здесь стоял вызов
   * refreshProviders({ limit: 50 }) без текста запроса — то есть в базу
   * попадали первые 50 вакансий площадки вообще, независимо от того, что
   * кто-то ищет.
   */
  if (!slowProvidersDue(now, last)) return;
  try {
    const report = await refreshCatalogForSearches({ now: () => now });
    setMeta(db, CATALOG_REFRESH_KEY, String(now));
    if (!report.ran) {
      logInfo('scheduler', `каталог не обновлялся: ${report.skipped}`);
    }
  } catch (err) {
    logError('scheduler:refresh', err);
  }
}

/**
 * Быстрый круг: обновление только быстрых источников.
 *
 * Нужен, чтобы обещание «отклик в первые минуты после публикации» было
 * выполнимо. При шестичасовом интервале вакансия, опубликованная два часа
 * назад, попадала в автоотклик через шесть — то есть обещание нарушалось бы
 * по построению, независимо от настроек пользователя.
 */
async function refreshFastCatalog(now: number): Promise<void> {
  const last = Number(getMeta(db, CATALOG_FAST_REFRESH_KEY) ?? 0);
  if (!fastProvidersDue(now, last)) return;
  try {
    await refreshCatalogForSearches({ now: () => now });
    setMeta(db, CATALOG_FAST_REFRESH_KEY, String(now));
  } catch (err) {
    logError('scheduler:refresh-fast', err);
  }
}

export async function runScheduledJobs(): Promise<void> {
  const now = Date.now();
  if (!acquireLock(db, now)) return;

  try {
    await refreshFastCatalog(now);
    await refreshCatalogIfStale(now);
    /*
     * Итог прогона сохраняем, а не только логируем.
     *
     * Иначе человек открывает панель автооткликов и не видит ничего: откликов
     * «молча ноль», и это неотличимо от поломки. Разбор прогона (почему столько,
     * что мешает) берётся из этой записи.
     */
    saveLastRun(await runAutoApply(), now);
    await syncAllHhUsers();

    /*
     * Уведомления в Telegram.
     *
     * Идут после синхронизации: приглашения и ответы приходят оттуда, и
     * рассылка до неё видела бы пустую таблицу и молчала. Сначала — по одному
     * ответу на конкретную вакансию, потом — общий дайджест об откликах.
     *
     * Ошибки не поднимаются: упавший Telegram не должен ломать планировщик и
     * останавливать автоотклики.
     */
    try {
      await sendAlerts((slug) => getVacancyBySlug(slug)?.title ?? null);
      await sendDigests();
    } catch (err) {
      logError('scheduler:telegram', err);
    }
  } catch (err) {
    logError('scheduler', err);
  } finally {
    // С меткой: снять можно только свою блокировку, иначе прогон, успевший
    // перехватить её по TTL, потерял бы её из-под себя.
    releaseLock(db, now);
  }
}
