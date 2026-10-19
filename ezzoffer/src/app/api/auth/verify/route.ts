import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJson } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { mailConfigured } from '@/lib/mail';
import {
  confirmEmail,
  issueVerificationToken,
  sendVerificationMail,
  RESEND_LIMIT,
} from '@/lib/auth/verify';
import { NO_STORE_HEADERS } from '@/lib/http';

/**
 * Подтверждение почты.
 *
 * GET ?token= — ссылка из письма: подтверждает и уводит на вход с флагом.
 * POST { email } — «письмо потерялось»: переотправка, ответ всегда одинаковый
 * (как forgot-password), чтобы по нему нельзя было вычислить адрес.
 *
 * Без переотправки потерянное письмо означало бы мёртвый аккаунт без пути
 * восстановления: вход закрыт (403), а сброс пароля флаг verified не ставит.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const userId = confirmEmail(token);
  const url = new URL('/login', request.url);
  if (userId !== null) {
    url.searchParams.set('verified', '1');
  } else {
    url.searchParams.set('verified', '0');
  }
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const { data, error } = await readJson<{ email?: string }>(request);
  if (error) return error;

  const email = data?.email?.trim().toLowerCase() ?? '';
  if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Укажите корректный email' }, { status: 400 });
  }

  const emailLimiter = rateLimit(`verify-email:${email}`, {
    windowMs: 60 * 60 * 1000,
    max: RESEND_LIMIT,
  });
  if (!emailLimiter.allowed) {
    // Как в forgot-password: по 429 было бы видно, что адрес существует.
    return NextResponse.json({ ok: true });
  }

  const user = db
    .prepare('SELECT id, email, name, email_verified FROM users WHERE email = ?')
    .get(email) as { id: number; email: string; name: string; email_verified: number } | undefined;

  // Подтверждённым и несуществующим — тот же ответ, письма нет.
  if (user && !user.email_verified && mailConfigured()) {
    const token = issueVerificationToken(user.id);
    await sendVerificationMail(user.email, user.name, token);
  }

  return NextResponse.json({ ok: true });
}
