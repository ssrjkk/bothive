'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthPanel, Field, FormError, PanelLink, SubmitButton } from '@/components/auth-shell';
import { Eyebrow } from '@/components/ui';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Токен — 64 hex-символа. Проверка на клиенте не защита (сервер проверяет
  // своё), а защита от показа формы на заведомо битой ссылке.
  const valid = /^[0-9a-f]{64}$/.test(token);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Что-то пошло не так. Попробуйте ещё раз.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } finally {
      setBusy(false);
    }
  };

  if (!valid) {
    return (
      <AuthPanel
        title="Ссылка недействительна"
        lead="Возможно, ссылка уже использована или введена с ошибкой. Запросите новую — старая больше не работает."
      >
        <Eyebrow>Ошибка 400</Eyebrow>
        <div className="mt-5">
          <PanelLink href="/login">Вернуться ко входу</PanelLink>
        </div>
      </AuthPanel>
    );
  }

  if (done) {
    return (
      <AuthPanel
        title="Пароль обновлён"
        lead="Все сессии завершены — войдите с новым паролем. Перенаправляем на страницу входа…"
      >
        <Eyebrow>Готово</Eyebrow>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Новый пароль" lead="Придумайте пароль не короче 8 символов">
      <form onSubmit={onSubmit} className="space-y-5">
        <Eyebrow>Смена пароля</Eyebrow>

        <Field
          label="Новый пароль"
          type="password"
          required
          minLength={8}
          maxLength={100}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        <Field
          label="Повторите пароль"
          type="password"
          required
          minLength={8}
          maxLength={100}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
        />

        <FormError>{error}</FormError>

        <SubmitButton busy={busy} busyLabel="Сохраняем…">
          Сохранить пароль
        </SubmitButton>
      </form>
    </AuthPanel>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-md border-t-2 border-ink bg-surface px-6 py-10 text-center text-sm text-muted sm:px-8">
          Загрузка…
        </div>
      }
    >
      <ResetForm />
    </Suspense>
  );
}
