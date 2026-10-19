import { randomBytes } from 'node:crypto';
import { db } from '../db';
import { sendMail, siteUrl } from '../mail';
import { logInfo } from '../logger';

/**
 * Подтверждение почты.
 *
 * ## Какую дыру это закрывает
 *
 * Регистрация ставила `email_verified = 1` сразу, безо всякой проверки, — а
 * вход при этом требует verified. То есть флаг был заглушкой: любой аккаунт
 * считался подтверждённым с рождения.
 *
 * Ущерб конкретный, а не теоретический. Злоумышленник регистрирует аккаунт на
 * ЧУЖОЙ адрес со своим паролем — флаг сразу 1, аккаунт полноценный. Жертва,
 * пытаясь зарегистрироваться, получает 409 «уже существует». Дальше жертва
 * жмёт «забыли пароль», письмо приходит ЕЙ (настоящему владельцу ящика), она
 * сбрасывает пароль и входит — в аккаунт, который уже обжил злоумышленник:
 * привязанный hh, телеграм, поиски. Это классический account pre-takeover, и
 * закрывается он только подтверждением владения ящиком ДО активации.
 *
 * ## Как устроено
 *
 * При регистрации аккаунт создаётся с `email_verified = 0` и одноразовым
 * токеном (TTL 24 часа — ящик за сутки владельца не сменит, а вечный токен в
 * старом письме подтверждал бы что угодно). Письмо уходит, только если
 * настроен SMTP. Вход не пускает неподтверждённых — эта проверка в login уже
 * была, но раньше была мёртвой: дойти до неё не мог никто, потому что все
 * рождались с флагом 1.
 *
 * ## Что если SMTP не настроен
 *
 * Подтвердить нечем — требовать подтверждение, которое нельзя отправить,
 * значит закрыть регистрацию вообще. Поэтому без SMTP аккаунт создаётся сразу
 * подтверждённым, как раньше, но это фиксируется warn'ом в лог и уже светится
 * в /api/health («восстановление пароля не работает»). Размен осознанный:
 * видимый риск вместо невидимого.
 */

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** Сколько раз в час можно просить письмо повторно на один адрес. */
const RESEND_LIMIT = 5;

export function issueVerificationToken(userId: number, now = Date.now()): string {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    'UPDATE users SET email_verification_token = ?, email_verification_expires = ? WHERE id = ?',
  ).run(token, now + VERIFY_TTL_MS, userId);
  return token;
}

export async function sendVerificationMail(
  to: string,
  name: string,
  token: string,
): Promise<boolean> {
  const link = `${siteUrl()}/api/auth/verify?token=${token}`;
  return sendMail({
    to,
    subject: 'Подтвердите почту EZOffer',
    text: [
      `Здравствуйте${name ? `, ${name}` : ''}!`,
      '',
      'Вы зарегистрировались в EZOffer. Подтвердите, что этот адрес — ваш:',
      link,
      '',
      'Ссылка действует 24 часа. Если вы не регистрировались, просто проигнорируйте письмо.',
    ].join('\n'),
  });
}

/**
 * Подтверждает ящик по токену. Возвращает id пользователя или null.
 *
 * Токен одноразовый: после успеха гасится. Просроченный тоже гасится — иначе
 * таблица хранила бы вечно мёртвые токены, а повторный проход по ним давал бы
 * разные ответы в зависимости от порядка проверок.
 */
export function confirmEmail(token: string, now = Date.now()): number | null {
  const normalized = (token ?? '').trim();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return null;

  const row = db
    .prepare('SELECT id, email_verification_expires FROM users WHERE email_verification_token = ?')
    .get(normalized) as { id: number; email_verification_expires: number | null } | undefined;
  if (!row) return null;

  // Гасим в обоих случаях — см. комментарий выше.
  db.prepare(
    'UPDATE users SET email_verification_token = NULL, email_verification_expires = NULL WHERE id = ?',
  ).run(row.id);

  if (!row.email_verification_expires || row.email_verification_expires <= now) return null;

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.id);
  logInfo('auth', 'email подтверждён', { userId: row.id });
  return row.id;
}

export { RESEND_LIMIT };
