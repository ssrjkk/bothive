import { NextResponse } from 'next/server';

import { db, getUserByEmail } from '@/lib/db';
import {
  createSession,
  hashPassword,
  publicUser,
  SESSION_COOKIE,
  isHttpsRequest,
} from '@/lib/auth';
import { readJson } from '@/lib/api';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { isUniqueViolation } from '@/lib/http';
import { mailConfigured } from '@/lib/mail';
import { logInfo } from '@/lib/logger';
import { issueVerificationToken, sendVerificationMail } from '@/lib/auth/verify';

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (ip) {
    const ipLimiter = rateLimit(`register-ip:${ip}`, { windowMs: 15 * 60 * 1000, max: 10 });
    if (!ipLimiter.allowed) {
      return NextResponse.json(
        { error: 'Слишком много запросов. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(ipLimiter.retryAfterSeconds) } },
      );
    }
  }

  const { data, error } = await readJson<{
    name?: string;
    email?: string;
    password?: string;
  }>(request);
  if (error) return error;

  const email = data?.email?.trim().toLowerCase();
  const password = data?.password ?? '';
  const name = (data?.name ?? '').trim();

  if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Укажите корректный email' }, { status: 400 });
  }
  if (password.length < 6 || password.length > 100) {
    return NextResponse.json({ error: 'Пароль должен быть от 6 до 100 символов' }, { status: 400 });
  }
  if (name.length > 60) {
    return NextResponse.json({ error: 'Имя слишком длинное (до 60 символов)' }, { status: 400 });
  }

  const emailLimiter = rateLimit(`register-email:${email}`, { windowMs: 60 * 60 * 1000, max: 5 });
  if (!emailLimiter.allowed) {
    return NextResponse.json(
      { error: 'Слишком много запросов. Попробуйте позже.' },
      { status: 429, headers: { 'Retry-After': String(emailLimiter.retryAfterSeconds) } },
    );
  }

  const existing = getUserByEmail(email);
  if (existing) {
    /*
     * Занятый адрес: перечисление гасится только для неподтверждённых.
     *
     * Если аккаунт не подтверждён, это, скорее всего, незавершённая
     * регистрация того же человека (письмо потерялось): перевыпускаем токен,
     * отправляем письмо заново и отвечаем как на новую регистрацию. Узнать из
     * ответа, существует ли адрес, нельзя — ответ одинаковый в обоих случаях.
     *
     * Если аккаунт подтверждён — 409. Перечисление подтверждённых адресов
     * остаётся, и это осознанный размен: полностью нейтральный ответ («мы
     * отправили письмо») без создания сессии сломал бы автологин после
     * регистрации, а с созданием сессии на чужой адрес — подарил бы вход.
     * Массовый перебор при этом бессмысленен: 5 запросов в час на адрес и
     * 10 за 15 минут с IP.
     */
    if (!existing.email_verified && mailConfigured()) {
      const token = issueVerificationToken(existing.id);
      await sendVerificationMail(existing.email, existing.name, token);
      return NextResponse.json({ user: null, needsVerification: true }, { status: 201 });
    }
    return NextResponse.json(
      { error: 'Пользователь с таким email уже существует' },
      { status: 409 },
    );
  }

  /*
   * Аккаунт рождается НЕподтверждённым — см. src/lib/auth/verify.ts, почему
   * `email_verified = 1` сразу был дырой (account pre-takeover).
   *
   * Два режима, и оба честные:
   *  - SMTP настроен: токен + письмо, сессии нет. Вход до подтверждения не
   *    пустит (проверка в login уже была, теперь она живая).
   *  - SMTP нет: подтвердить нечем, требовать подтверждение — значит закрыть
   *    регистрацию. Аккаунт сразу подтверждён, как раньше, но это видно в
   *    логе и в /api/health.
   */
  const verifiedUpfront = !mailConfigured();
  let userId: number;
  try {
    userId = Number(
      db
        .prepare(
          'INSERT INTO users (email, name, password_hash, email_verified, email_verification_token, email_verification_expires, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          email,
          name,
          await hashPassword(password),
          verifiedUpfront ? 1 : 0,
          null,
          null,
          Date.now(),
        ).lastInsertRowid,
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Гонка с параллельной регистрацией того же адреса.
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 409 },
      );
    }
    throw err;
  }

  if (verifiedUpfront) {
    logInfo('auth', 'SMTP не настроен: регистрация без подтверждения почты', { email });
    const user = getUserByEmail(email)!;
    const session = createSession(user.id);
    const res = NextResponse.json({ user: publicUser(user) }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(session.expiresAt),
      secure: isHttpsRequest(request),
    });
    return res;
  }

  const token = issueVerificationToken(userId);
  await sendVerificationMail(email, name, token);
  // Сессии нет намеренно: вход до подтверждения закрыт, выдавать cookie рано.
  return NextResponse.json({ user: null, needsVerification: true }, { status: 201 });
}
