'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, StatusMessage } from '@/components/dashboard/ui';

export function PlanBanner({ active, trialStarted }: { active: boolean; trialStarted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (active) return null;

  const startTrial = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/trial', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Не удалось активировать пробный период');
        return;
      }
      router.refresh();
    } catch {
      setError('Сеть недоступна — пробный период не активирован');
    } finally {
      setBusy(false);
    }
  };

  /*
   * Баннер.
   *
   * Был фиолетово-циановый градиент с фиолетовой же кнопкой — та же
   * пара, что была на главной в тёмной теме, только светлее. Из-за
   * градиента пришлось ставить на подпись text-ink вместо text-muted:
   * у градиента background-color прозрачный, поэтому статический расчёт
   * контраста считает всё в порядке, а Lighthouse растеризует градиент
   * и меряет реальные пиксели — и находит провал. То есть градиент не
   * просто некрасив, он ломает проверку доступности.
   *
   * Теперь плоская поверхность с линейкой сверху: контраст считается,
   * баннер читается как объявление, а не как рекламная плашка.
   */
  return (
    <div className="mb-6 flex flex-col gap-4 border-t-2 border-accent bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          {trialStarted ? 'Пробный период завершён' : 'Бесплатный период'}
        </p>
        <p className="mt-2 font-serif text-lg leading-snug text-ink">
          {trialStarted
            ? 'Продлите тариф, чтобы вернуться к откликам'
            : 'Запустите поиск прямо сейчас'}
        </p>
        <p className="measure mt-1.5 text-sm leading-relaxed text-muted">
          {trialStarted
            ? 'Отклики, вакансии и статистика доступны после активации.'
            : '24 часа бесплатно, 50 откликов в день, без привязки карты.'}
        </p>
        <StatusMessage tone="error" className="mt-3 py-2 text-xs">
          {error}
        </StatusMessage>
      </div>

      {!trialStarted ? (
        <button
          type="button"
          onClick={startTrial}
          disabled={busy}
          className="inline-flex flex-none items-center justify-center gap-2 rounded-sm bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Активация…' : 'Активировать бесплатно'}
        </button>
      ) : (
        <Badge tone="warn">Ожидание тарифа</Badge>
      )}
    </div>
  );
}

/**
 * Счётчик дневного лимита.
 *
 * Полоса заполнения была градиентом фиолетовый→циан — два не связанных
 * между собой цвета на элементе, который должен сообщать об одном числе.
 * Теперь одна заливка: акцент в норме, красная на исчерпанном лимите,
 * и никакого перехода между оттенками.
 */
export function TodayLimitBar({ today, todayLimit }: { today: number; todayLimit: number }) {
  const pct = todayLimit > 0 ? Math.min(100, Math.round((today / todayLimit) * 100)) : 0;
  const spent = pct >= 100;

  return (
    <div className="border-t-2 border-ink pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Откликов за сегодня
        </span>
        <span className="font-mono text-2xl tabular-nums text-ink">
          {today}
          <span className="text-sm text-muted"> / {todayLimit}</span>
        </span>
      </div>

      <div
        className="mt-3 h-1.5 bg-line"
        role="progressbar"
        aria-valuenow={today}
        aria-valuemin={0}
        aria-valuemax={todayLimit}
        aria-label="Использование дневного лимита откликов"
      >
        <div
          className={`h-full transition-all duration-700 ${spent ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-muted">
        {spent ? 'Лимит исчерпан — сброс в полночь' : `Осталось ${todayLimit - today} откликов`}
      </p>
    </div>
  );
}
