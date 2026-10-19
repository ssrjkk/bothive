import Link from 'next/link';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { StatusMessage } from '@/components/ui';

/*
 * Оболочка форм входа.
 *
 * Форм авторизации три: вход, регистрация, восстановление и смена
 * пароля. Раньше у каждой была своя копия разметки — и две из трёх
 * остались в тёмной теме целиком: красный текст ошибки светло-красным,
 * рамка поля волосяная (1.16:1 к бумаге — не видна и не проходит
 * WCAG 1.4.11), фиолетовое свечение под кнопкой, пилюли.
 *
 * Копии разошлись не сразу: правки на странице входа до двух других
 * не дошли. Поэтому здесь не «переиспользуем общий компонент», а
 * физически одна разметка, из которой собираются все три экрана.
 * Разойтись им больше негде.
 */

/** Панель формы: линейка сверху, заголовок антиквой, текст слева. */
export function AuthPanel({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md border-t-2 border-ink bg-surface px-6 py-8 sm:px-8 sm:py-10">
      <h1 className="font-serif text-2xl leading-snug text-ink sm:text-3xl">{title}</h1>
      {lead ? <p className="measure mt-3 text-sm leading-relaxed text-muted">{lead}</p> : null}
      <div className="mt-7">{children}</div>
    </div>
  );
}

/**
 * Поле ввода.
 *
 * Рамка — line-strong, а не line: волосяная линия на бумаге не читается
 * как граница контрола, и пользователь с нарушениями зрения её не видит.
 * Скругление — как у всех прямых элементов на сайте.
 */
export function Field({
  label,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = props.id ?? `f-${label.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-')}`;
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      <input
        {...props}
        id={id}
        className={`w-full rounded-sm border border-line-strong bg-surface-2 px-4 py-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 ${className}`}
      />
      {hint ? <span className="mt-1.5 block text-xs leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}

export function SubmitButton({
  busy,
  children,
  busyLabel = 'Подождите…',
}: {
  busy: boolean;
  children: ReactNode;
  busyLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-sm bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? busyLabel : children}
    </button>
  );
}

/** Акцентная кнопка-ссылка внутри панели (после успешного действия). */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-sm bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
    >
      {children}
    </Link>
  );
}

/** Тихое переключение между экранами входа. */
export function SwitchLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-accent"
    >
      {children}
    </Link>
  );
}

/**
 * Ошибка формы.
 *
 * Раньше в двух формах ошибка была просто серым абзацем без живой области:
 * пользователь нажимал «Сохранить» и не получал ни звука, ни текста.
 * Здесь используется StatusMessage — она держит role="alert" и озвучивается
 * скринридером.
 */
export function FormError({ children }: { children?: ReactNode }) {
  return <StatusMessage tone="error">{children}</StatusMessage>;
}
