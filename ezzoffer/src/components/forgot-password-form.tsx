'use client';

import { useState, type FormEvent } from 'react';
import { AuthPanel, Field, FormError, PanelLink, SubmitButton } from '@/components/auth-shell';
import { Eyebrow } from '@/components/ui';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Что-то пошло не так. Попробуйте ещё раз.');
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthPanel
        title="Проверьте почту"
        lead={
          <>
            Если аккаунт с адресом <span className="font-mono text-ink">{email}</span> существует,
            мы отправили на него письмо со ссылкой для смены пароля. Ссылка действует 1 час.
          </>
        }
      >
        <Eyebrow>Отправлено</Eyebrow>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Письма иногда попадают в спам — проверьте и эту папку.
        </p>
        <div className="mt-6">
          <PanelLink href="/login">Вернуться ко входу</PanelLink>
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Восстановление пароля"
      lead="Укажите email — отправим на него ссылку для смены пароля"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Eyebrow>Пароль</Eyebrow>

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

        <FormError>{error}</FormError>

        <SubmitButton busy={busy} busyLabel="Отправляем…">
          Отправить ссылку
        </SubmitButton>
      </form>
    </AuthPanel>
  );
}
