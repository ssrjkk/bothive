import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';
import {
  issueLinkCode,
  telegramConfigured,
  telegramWebhookSecret,
  unlinkChat,
} from '@/lib/telegram';
import { NO_STORE_HEADERS } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Привязка Telegram-чата.
 *
 * Регрессия: код выдавался в GET, то есть на КАЖДЫЙ вызов. Это значило три
 * проблемы:
 *  - GET с побочным эффектом: страница, краулер или предзагрузка вызывали
 *    DELETE + INSERT в telegram_codes, хотя по HTTP GET обязан быть безопасным;
 *  - код перевыпускался при каждом обновлении страницы, поэтому два открытых
 *    таба показывали разные коды и один проигрывал;
 *  - proxy.ts ограничивает rate-limit только для не-GET запросов, то есть
 *    этот эндпоинт оставался единственным, кто писал в БД без лимита.
 *
 * Теперь GET только читает состояние, а код выдаёт POST с лимитом.
 * При незавершённой привязке POST возвращает уже выданный код, если он ещё
 * жив: перевыпуск без нужды просто инвалидировал бы номер у пользователя.
 */

/** Выдача кода — дорогая операция (удаление + вставка), поэтому лимитируем. */
const CODE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

function botReady(): boolean {
  return telegramConfigured() && Boolean(telegramWebhookSecret());
}

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const fresh = db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(user.id) as
    { telegram_chat_id: string | null } | undefined;
  if (!fresh) return unauthorized();

  return Response.json(
    {
      botConfigured: botReady(),
      linked: Boolean(fresh.telegram_chat_id),
      chatId: fresh.telegram_chat_id ?? null,
      // GET намеренно не выдаёт код: чтобы его получить, нужно явно нажать
      // «Получить код» (POST).
      code: null,
      codeTtlMinutes: 15,
    },
    { headers: NO_STORE_HEADERS },
  );
}

/** Выдать (или перевыдать) код привязки. */
export async function POST() {
  const user = await requireUser();
  if (!user) return unauthorized();

  if (!botReady()) {
    return NextResponse.json(
      { error: 'Бот не настроен на сервере: нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET' },
      { status: 503 },
    );
  }

  const limiter = rateLimit(`telegram-code:${user.id}`, CODE_LIMIT);
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: 'Слишком много запросов кода. Подождите несколько минут.' },
      { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
    );
  }

  const code = issueLinkCode(user.id);
  return Response.json({ code, codeTtlMinutes: 15 }, { status: 201, headers: NO_STORE_HEADERS });
}

/** Отвязать чат. */
export async function DELETE() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const fresh = db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(user.id) as
    { telegram_chat_id: string | null } | undefined;
  if (!fresh) return unauthorized();

  const removed = unlinkChat(fresh.telegram_chat_id ?? '');
  return Response.json({ ok: true, removed: removed > 0 });
}
