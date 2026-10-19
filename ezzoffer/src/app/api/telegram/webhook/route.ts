import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { telegramConfigured, telegramWebhookSecret, purgeExpiredCodes } from '@/lib/telegram';
import { handleUpdate, type TelegramUpdate } from '@/lib/telegram-bot';
import { logError, logInfo } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Webhook Telegram.
 *
 * Защита — заголовок X-Telegram-Bot-Api-Secret-Token, который задаётся при
 * регистрации webhook (setWebhook с secret_token). Без него любой желающий
 * мог бы слать апдейты от имени бота и привязывать чаты к аккаунтам.
 */
export async function POST(request: Request) {
  const secret = telegramWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET не настроен' }, { status: 503 });
  }
  /*
   * Сравнение по константному времени.
   *
   * Обычный `!==` выходит на первом же несовпавшем байте, и время ответа
   * зависит от того, сколько начальных байт угадано. Секрет — длинная
   * случайная строка, и снять его по времени через интернет нереально, но
   * timingSafeEqual стоит одну строку и убирает вопрос целиком. Неравная
   * длина отклоняется заранее: timingSafeEqual на разной длине бросает.
   */
  const got = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  const expected = Buffer.from(secret, 'utf8');
  const actual = Buffer.from(got, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  // Telegram ждёт 200 даже при ошибке обработки, иначе будет ретраить апдейт.
  try {
    const reply = await handleUpdate(update);
    if (reply) {
      // Нажатие кнопки и обычное сообщение различаются в логах: без этого
      // нельзя отличить «человек нажал кнопку и ничего не произошло» от
      // «сообщение дошло и осталось без ответа».
      logInfo('telegram', update.callback_query ? 'нажатие кнопки' : 'апдейт обработан', {
        updateId: update.update_id,
      });
    }
  } catch (err) {
    logError('telegram:webhook', err);
  } finally {
    purgeExpiredCodes();
  }

  return Response.json({ ok: true });
}

/** Статус настройки: удобно для дашборда и healthcheck. */
export async function GET() {
  return Response.json({
    configured: telegramConfigured(),
    webhook: Boolean(telegramWebhookSecret()),
  });
}
