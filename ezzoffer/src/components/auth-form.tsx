'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthPanel, Field, FormError, SubmitButton, SwitchLink } from '@/components/auth-shell';
import { Eyebrow } from '@/components/ui';
import { OAuthButtons } from '@/components/auth/oauth-buttons';

export type AuthMode = 'login' | 'signup';

export function AuthForm({
  mode,
  next,
  methods = [],
}: {
  mode: AuthMode;
  next?: string;
  /** Готовые способы внешнего входа; список приходит с сервера. */
  methods?: { id: string; title: string; ready: boolean }[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Аккаунт создан, но вход закрыт до подтверждения почты: сервер не выдал
   * сессию (needsVerification). Редиректить в кабинет нельзя — там 401, и
   * человек решит, что регистрация сломалась. Показываем, что делать дальше.
   */
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resent, setResent] = useState(false);

  // next берётся из query-строки и уходит в редирект: при «//evil.com» или
  // «https://…» это открытая переадресация, поэтому допускаем только путь.
  const dest = next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Что-то пошло не так. Попробуйте ещё раз.');
        return;
      }
      if (mode === 'signup' && data.needsVerification) {
        setNeedsVerification(true);
        return;
      }
      router.push(dest);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Ответ всегда одинаковый (см. роут) — показываем «отправлено» в любом
      // случае, иначе по разнице можно вычислить адрес.
      setResent(true);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'login' ? 'Вход в аккаунт' : 'Создать аккаунт';
  const submitLabel = mode === 'login' ? 'Войти' : 'Создать аккаунт и получить 24 часа бесплатно';
  const otherHref = mode === 'login' ? '/signup' : '/login';
  const otherLabel =
    mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти';

  return (
    <AuthPanel
      title={title}
      lead={
        mode === 'signup'
          ? '24 часа бесплатно. Без привязки карты, отмена в один клик.'
          : 'Рады видеть вас снова'
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Eyebrow>{mode === 'login' ? 'Кабинет' : 'Регистрация'}</Eyebrow>

        {mode === 'signup' ? (
          <Field
            label="Имя"
            required
            autoComplete="name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Как к вам обращаться"
          />
        ) : null}

        <Field
          label="Email"
          type="email"
          required
          autoComplete="email"
          maxLength={100}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />

        <Field
          label="Пароль"
          type="password"
          required
          minLength={6}
          maxLength={100}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        {mode === 'signup' ? (
          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-muted">
            <input type="checkbox" required className="mt-0.5 size-4 accent-accent" />
            <span>
              Согласен с{' '}
              <Link
                href="/platform-rules"
                className="text-ink underline decoration-line underline-offset-2 hover:text-accent"
              >
                правилами платформ
              </Link>{' '}
              и{' '}
              <Link
                href="/faq"
                className="text-ink underline decoration-line underline-offset-2 hover:text-accent"
              >
                условиями сервиса
              </Link>
              . Мы храним данные для авторизации — подробности в правилах платформ.
            </span>
          </label>
        ) : null}

        {mode === 'login' ? (
          <div className="flex justify-end">
            <SwitchLink href="/forgot-password">Забыли пароль?</SwitchLink>
          </div>
        ) : null}

        <FormError>{error}</FormError>

        {mode === 'signup' && needsVerification ? (
          <div
            role="status"
            className="rounded-xl border border-line bg-paper px-4 py-3 text-sm leading-relaxed text-ink"
          >
            <p className="font-semibold">
              Проверьте почту — мы отправили письмо на {email || 'ваш адрес'}.
            </p>
            <p className="mt-1 text-muted">
              Откройте ссылку из письма, чтобы подтвердить адрес и войти. Ссылка действует 24 часа.
            </p>
            <button
              type="button"
              onClick={resend}
              disabled={busy || resent}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline decoration-line underline-offset-2 hover:text-accent-2 disabled:opacity-60"
            >
              {resent ? 'Письмо отправлено повторно' : 'Отправить письмо ещё раз'}
            </button>
          </div>
        ) : (
          <SubmitButton busy={busy}>{submitLabel}</SubmitButton>
        )}

        {mode === 'login' ? (
          <>
            {/*
              Внешний вход только при входе, не при регистрации. Во внешнем
              сервисе человек уже есть, и «создать аккаунт через GitHub»
              означало бы завести второй аккаунт тому же человеку.
            */}
            <div className="flex items-center gap-3 pt-1">
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs uppercase tracking-[0.12em] text-muted">или</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <OAuthButtons methods={methods} />
          </>
        ) : null}

        <p className="pt-1 text-sm text-muted">
          <SwitchLink href={otherHref}>{otherLabel}</SwitchLink>
        </p>
      </form>
    </AuthPanel>
  );
}
