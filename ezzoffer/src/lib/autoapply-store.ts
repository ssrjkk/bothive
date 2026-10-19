import { db } from './db';
import { explain, type LastRunReport } from './autoapply-report';
import type { AutoApplyRun } from './autoapply';

/**
 * Хранение итога последнего прогона автоотклика.
 *
 * Отдельно от разбора (`autoapply-report`), потому что разбор — чистые функции
 * над числами, а здесь идёт запись в БД. Смешивать их в одном модуле опасно
 * для тестов: `db` создаётся при импорте, поэтому тест, подставляющий путь к
 * БД, обязан сделать это до загрузки модуля, иначе он пишет в рабочую базу.
 * Один такой тест и оставил в базе битую запись.
 */

const KEY = 'autoapply:last_run';

export function saveLastRun(report: AutoApplyRun, at = Date.now()): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY, JSON.stringify({ at, ...report }));
}

export function loadLastRun(): LastRunReport | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as
    { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const raw = JSON.parse(row.value) as Partial<LastRunReport> & AutoApplyRun;
    return {
      at: Number(raw.at ?? 0),
      applied: Number(raw.applied ?? 0),
      failed: Number(raw.failed ?? 0),
      skipped: Number(raw.skipped ?? 0),
      stale: Number(raw.stale ?? 0),
      withLetter: Number(raw.withLetter ?? 0),
      pausedFor: raw.pausedFor ?? null,
      reasons: explain(raw),
    };
  } catch {
    /*
     * Битая запись в meta не должна ронять страницу кабинета.
     *
     * Запись пишется без транзакции и может остаться обрезанной, если процесс
     * убит посреди сохранения. Панель автооткликов — второстепенный блок: падать
     * из-за неё весь кабинет нельзя, показывать «прогон ещё не выполнялся»
     * можно.
     */
    return null;
  }
}
