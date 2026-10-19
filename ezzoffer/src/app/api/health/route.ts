import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hhConfigured } from '@/lib/hh-oauth';
import { mailConfigured } from '@/lib/mail';
import { telegramConfigured, telegramWebhookSecret } from '@/lib/telegram';
import { envStr } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Healthcheck для Docker, внешних балансировщиков и диагностики деплоя.
 *
 * Раньше ответ был `{status, db, uptime}` — этого хватало Docker'у, чтобы
 * понять «жив ли процесс», но совсем ничего не говорило о готовности
 * функциональности. При неудачном деплое (например, забытый SMTP_HOST при
 * настроенном восстановлении пароля) процесс оставался «здоровым», а фича
 * молча не работала.
 *
 * Теперь:
 *  - /api/health — краткий ответ для мониторинга (не раскрывает деталей);
 *  - /api/health?verbose=1 — диагностика конфигурации и БД для человека.
 *
 * Секты (токены, пароли) в ответ не попадают никогда: только факт наличия.
 */

type Check = { name: string; ok: boolean; detail?: string };

function checkDatabase(): Check {
  const started = Date.now();
  try {
    // Простой запрос к таблице, а не «SELECT 1»: проверяем, что схема реально
    // применена. На битой/старой БД «SELECT 1» проходит, а первый настоящий
    // запрос падает уже под нагрузкой.
    db.prepare('SELECT COUNT(*) AS c FROM users').get();
    /*
     * Без числа пользователей в ответе — намеренно.
     *
     * Раньше detail содержал `${row.c} users`: публичный эндпоинт отдавал
     * размер пользовательской базы любому желающему. Для мониторинга и
     * диагностики достаточно факта «база отвечает и за сколько».
     */
    return { name: 'database', ok: true, detail: `${Date.now() - started}ms` };
  } catch (err) {
    return {
      name: 'database',
      ok: false,
      detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
    };
  }
}

function checkWritability(): Check {
  try {
    // WAL-база может остаться читаемой после потери прав на каталог с файлом,
    // поэтому проверяем именно запись — именно она нужна автооткликам.
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('health:probe', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(Date.now()));
    db.prepare("DELETE FROM meta WHERE key = 'health:probe'").run();
    return { name: 'database_write', ok: true };
  } catch (err) {
    return {
      name: 'database_write',
      ok: false,
      detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
    };
  }
}

function integrations(): Check[] {
  return [
    {
      name: 'hh_oauth',
      ok: hhConfigured(),
      detail: hhConfigured() ? 'настроен' : 'нет HH_CLIENT_ID/SECRET/REDIRECT_URI',
    },
    {
      name: 'hh_global_token',
      ok: Boolean(envStr(process.env, 'HH_ACCESS_TOKEN', '')),
      detail: 'глобальный HH_ACCESS_TOKEN',
    },
    {
      name: 'telegram_bot',
      ok: telegramConfigured(),
      detail: telegramConfigured() ? 'настроен' : 'нет TELEGRAM_BOT_TOKEN',
    },
    {
      name: 'telegram_webhook_secret',
      ok: Boolean(telegramWebhookSecret()),
      detail: 'заголовок X-Telegram-Bot-Api-Secret-Token',
    },
    {
      name: 'smtp',
      ok: mailConfigured(),
      detail: mailConfigured() ? 'настроен' : 'нет SMTP_HOST — восстановление пароля не работает',
    },
    {
      name: 'cron_secret',
      ok: Boolean(envStr(process.env, 'CRON_SECRET', '')),
      detail: 'внешний запуск /api/autoapply/run',
    },
  ];
}

export async function GET(request: Request) {
  const verbose = new URL(request.url).searchParams.get('verbose') === '1';

  const dbCheck = checkDatabase();
  const writeCheck = checkWritability();

  // Критично только то, без чего сервис не может принимать отклики.
  const criticalOk = dbCheck.ok && writeCheck.ok;

  if (!verbose) {
    return NextResponse.json(
      {
        status: criticalOk ? 'ok' : 'degraded',
        db: dbCheck.ok ? 'up' : 'down',
        uptime: Math.round(process.uptime()),
      },
      {
        status: criticalOk ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  const external = integrations();
  /*
   * Версия Node и потребление памяти здесь не отдаются — намеренно.
   *
   * Это разведданные для атакующего (точная версия рантайма с известными
   * CVE, оценка нагрузки), а для диагностики деплоя они не нужны: человеку
   * нужны факты конфигурации (checks) и что чинить (hints). Кому нужны цифры
   * рантайма — тому доступны логи и сам сервер.
   */
  return NextResponse.json(
    {
      status: criticalOk ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      checks: [dbCheck, writeCheck, ...external],
      // Подсказки по типовым проблемам деплоя.
      hints: buildHints(dbCheck, writeCheck, external),
    },
    {
      status: criticalOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

/** Человеческие подсказки по типовым проблемам конфигурации. */
function buildHints(dbCheck: Check, writeCheck: Check, external: Check[]): string[] {
  const hints: string[] = [];
  if (!dbCheck.ok) {
    hints.push('БД недоступна на чтение: проверьте права на каталог data/ и монтирование volume.');
  }
  if (!writeCheck.ok) {
    hints.push('БД доступна только для чтения: автоотклики и регистрация работать не будут.');
  }
  const smtp = external.find((c) => c.name === 'smtp');
  if (smtp && !smtp.ok) {
    hints.push('SMTP не настроен — сброс пароля не пришлёт письмо (остальной сайт работает).');
  }
  const cron = external.find((c) => c.name === 'cron_secret');
  if (cron && !cron.ok) {
    hints.push('CRON_SECRET не задан — внешний планировщик не сможет запускать автоотклики.');
  }
  if (hints.length === 0) hints.push('Критичных проблем не обнаружено.');
  return hints;
}
