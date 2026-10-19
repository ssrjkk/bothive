import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { readJson } from '@/lib/api';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { sendMail, siteUrl } from '@/lib/mail';

/**
 * Запрос сброса пароля.
 *
 * Ответ всегда одинаков (200) независимо от того, существует ли email: иначе
 * по разнице ответов можно было бы перечислить зарегистрированные адреса.
 * Раньше обработчик вообще ничего не делал — возвращал { ok: true }, и
 * пользователь оставался без письма, не понимая причину.
 */

const RESET_TTL_MS = 60 * 60 * 1000;

/** Письмо не должно улететь на тысячу адресов одним запросом. */
const MAX_PER_HOUR = 5;

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (ip) {
    const ipLimiter = rateLimit(`reset-ip:${ip}`, { windowMs: 15 * 60 * 1000, max: 10 });
    if (!ipLimiter.allowed) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(ipLimiter.retryAfterSeconds) } },
      );
    }
  }

  const { data, error } = await readJson<{ email?: string }>(request);
  if (error) return error;

  const email = data?.email?.trim().toLowerCase() ?? '';
  if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Укажите корректный email' }, { status: 400 });
  }

  const emailLimiter = rateLimit(`reset-email:${email}`, {
    windowMs: 60 * 60 * 1000,
    max: MAX_PER_HOUR,
  });
  if (!emailLimiter.allowed) {
    // Здесь тоже отвечаем одинаково — иначе по 429 раскрывается, что
    // ограничение сработало именно на существующий адрес.
    return NextResponse.json({ ok: true });
  }

  const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email) as
    { id: number; email: string; name: string } | undefined;

  if (user) {
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + RESET_TTL_MS;
    db.prepare(
      'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
    ).run(token, expires, user.id);

    const link = `${siteUrl()}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: 'Восстановление пароля EZOffer',
      text: [
        `Здравствуйте${user.name ? `, ${user.name}` : ''}!`,
        '',
        'Вы запросили восстановление пароля. Откройте ссылку, чтобы задать новый пароль:',
        link,
        '',
        'Ссылка действует 1 час. Если вы не запрашивали восстановление, просто проигнорируйте письмо.',
      ].join('\n'),
    });
  }

  return NextResponse.json({ ok: true });
}
