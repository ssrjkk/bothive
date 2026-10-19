import { NextResponse } from 'next/server';
import { getUserByEmail, db } from '@/lib/db';
import {
  createSession,
  verifyPassword,
  publicUser,
  SESSION_COOKIE,
  isHttpsRequest,
} from '@/lib/auth';
import { hashPassword, needsRehash } from '@/lib/password';
import { readJson } from '@/lib/api';
import { rateLimit, resetRateLimit, clientIp } from '@/lib/rate-limit';

// Защита от перебора: лимит привязан к аккаунту (работает и без TRUST_PROXY),
// а не к глобальному "local"-ключу, который заблокировал бы всех пользователей.
const ACCOUNT_LIMIT = { windowMs: 15 * 60 * 1000, max: 10 };

/**
 * Фиктивный хеш для выравнивания времени проверки несуществующего аккаунта:
 * scrypt отрабатывает одинаково, не позволяя перечислять email по таймингу.
 *
 * Раньше он считался на верхнем уровне модуля синхронным scryptSync, из-за чего
 * импорт route.ts на старте сервера тратил ~100 мс CPU. Теперь хеширование
 * асинхронное, а модульный await сделал бы весь файл асинхронным модулем,
 * что несовместимо с его использованием. Вместо этого подставлен корректно
 * сформированный хеш с теми же параметрами: verifyPassword делает полный
 * derive и уходит в ту же ветку, поэтому время ответа совпадает.
 */
const DUMMY_STORED = `scrypt$65536$8$1$${'0'.repeat(32)}${'0'.repeat(128)}`;

export async function POST(request: Request) {
  const { data, error } = await readJson<{ email?: string; password?: string }>(request);
  if (error) return error;

  const email = data?.email?.trim().toLowerCase() ?? '';
  const password = data?.password ?? '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Укажите email и пароль' }, { status: 400 });
  }

  const ip = clientIp(request);
  if (ip) {
    const ipLimiter = rateLimit(`login-ip:${ip}`, { windowMs: 15 * 60 * 1000, max: 30 });
    if (!ipLimiter.allowed) {
      return NextResponse.json(
        { error: 'Слишком много попыток входа. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(ipLimiter.retryAfterSeconds) } },
      );
    }
  }

  const accountLimiter = rateLimit(`login-account:${email}`, ACCOUNT_LIMIT);
  if (!accountLimiter.allowed) {
    return NextResponse.json(
      { error: 'Слишком много попыток входа для этого аккаунта. Попробуйте позже.' },
      { status: 429, headers: { 'Retry-After': String(accountLimiter.retryAfterSeconds) } },
    );
  }

  const user = getUserByEmail(email);
  // Всегда выполняем scrypt-проверку (против хэша аккаунта или фиктивного),
  // чтобы время ответа не зависело от существования email.
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_STORED);
  if (!user || !valid) {
    return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 });
  }

  /*
   * Успешный вход обнуляет счётчик попыток по аккаунту.
   *
   * Раньше бакет `login-account:${email}` только рос: верный пароль его не
   * сбрасывал. Владелец с нескольких устройств (или просто с перевходами)
   * набирал 10 входов за 15 минут и получал 429 на собственном аккаунте —
   * лимит, задуманный против подбора, бил по живому человеку. Сброс безопасен:
   * чтобы сбросить чужой бакет, нужен верный пароль, а с ним подбирать нечего.
   */
  resetRateLimit(`login-account:${email}`);

  if (!user.email_verified) {
    return NextResponse.json({ error: 'Подтвердите email по ссылке из письма' }, { status: 403 });
  }

  // Прозрачное обновление: пароль, сохранённый с прежними (дешёвыми) параметрами
  // scrypt, перехешируется новыми после успешного входа. Так стоимость растёт
  // постепенно, без единовременного «большого ремонта» всех паролей базы.
  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgraded, user.id);
  }

  const session = createSession(user.id);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expiresAt),
    secure: isHttpsRequest(request),
  });
  return res;
}
