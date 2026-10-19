import { createTransport, type Transporter } from 'nodemailer';
import { envOpt } from './env';
import { logInfo } from './logger';

/**
 * Отправка писем.
 *
 * Раньше nodemailer стоял в зависимостях, но не использовался нигде: сброс
 * пароля и подтверждение email возвращали «ok» и ничего не отправляли. Пользователь
 * нажимал «Восстановить пароль» и не получал ничего — при этом endpoint
 * выглядел как работающий.
 *
 * Транспорт настраивается через SMTP_* в env. Если они не заданы, письма
 * не отправляются, но и ответ всегда одинаковый (см. forgot-password), чтобы
 * по нему нельзя было вычислить существующий аккаунт.
 */

const MESSAGE_TIMEOUT_MS = 15_000;

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let transporter: Transporter | null | undefined;

export function mailConfigured(): boolean {
  return Boolean(envOpt(process.env, 'SMTP_HOST'));
}

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const host = envOpt(process.env, 'SMTP_HOST');
  if (!host) {
    transporter = null;
    return transporter;
  }
  const port = Number(envOpt(process.env, 'SMTP_PORT') ?? '587');
  const user = envOpt(process.env, 'SMTP_USER');
  const pass = envOpt(process.env, 'SMTP_PASSWORD');

  transporter = createTransport({
    host,
    // 465 — implicit TLS, остальное — STARTTLS на 587.
    secure: port === 465,
    port,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: MESSAGE_TIMEOUT_MS,
    greetingTimeout: MESSAGE_TIMEOUT_MS,
    socketTimeout: MESSAGE_TIMEOUT_MS,
  });
  return transporter;
}

function fromAddress(): string {
  return (
    envOpt(process.env, 'SMTP_FROM') ?? envOpt(process.env, 'SMTP_USER') ?? 'no-reply@ezoffer.ru'
  );
}

/**
 * Отправляет письмо. Возвращает false, если SMTP не настроен или отправка
 * не удалась — вызывающий код решает, что показать пользователю.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) {
    logInfo('mail', 'SMTP не настроен, письмо не отправлено', { to: message.to });
    return false;
  }
  try {
    await mailer.sendMail({ from: fromAddress(), ...message });
    logInfo('mail', 'письмо отправлено', { to: message.to, subject: message.subject });
    return true;
  } catch (err) {
    logInfo('mail', `ошибка отправки: ${err instanceof Error ? err.message : 'unknown'}`, {
      to: message.to,
    });
    return false;
  }
}

/** Публичная база приложения для ссылок в письмах. */
export function siteUrl(): string {
  return envOpt(process.env, 'SITE_URL') ?? 'http://localhost:3000';
}
