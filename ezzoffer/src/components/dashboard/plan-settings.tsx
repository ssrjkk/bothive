'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { plans } from '@/lib/data';
import { Badge, Panel, btnPrimary, btnGhost, StatusMessage } from '@/components/dashboard/ui';

const PLAN_IDS: Record<string, string> = { Старт: 'start', Про: 'pro', Эксперт: 'expert' };
const PERIODS = [7, 14, 30] as const;

function fmtDate(ts: number | null | undefined) {
  return ts ? new Date(ts).toLocaleDateString('ru-RU') : '—';
}

export function PlanSettings({
  plan,
  planLabel,
  active,
  planDays,
  planLimit,
  planPermanent,
  trialStarted,
  trialExpiresAt,
}: {
  plan: string;
  planLabel: string;
  active: boolean;
  planDays: number;
  planLimit: number;
  /** Вечный тариф: дней до окончания нет, показывать «без срока», а не 0. */
  planPermanent: boolean;
  trialStarted: boolean;
  trialExpiresAt: number | null;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activatePlan = async (planId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, period }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось активировать тариф');
        return;
      }
      setNotice(data.note ?? 'Тариф активирован.');
      router.refresh();
    } catch {
      setError('Сеть недоступна — тариф не активирован');
    } finally {
      setBusy(false);
    }
  };

  const activateTrial = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/trial', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось активировать пробный период');
        return;
      }
      setNotice('Пробный период активирован на 24 часа.');
      router.refresh();
    } catch {
      setError('Сеть недоступна — пробный период не активирован');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg leading-snug text-ink">Тариф</h2>
          <p className="mt-1 text-sm text-muted">
            Демо-режим: оплата отключена, активация мгновенная.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={active ? 'success' : 'warn'}>{active ? 'Активен' : 'Не активен'}</Badge>
          <span className="text-sm font-semibold">{planLabel}</span>
        </div>
      </div>

      <div className="mb-5 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <p className="text-xs text-muted">Лимит откликов/день</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{active ? planLimit : 0}</p>
        </div>
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <p className="text-xs text-muted">Дней до окончания</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {planPermanent ? '∞' : active ? planDays : '—'}
          </p>
        </div>
        <div className="rounded-sm border border-line bg-surface-2 p-4">
          <p className="text-xs text-muted">Пробный период</p>
          <p className="mt-1 text-lg font-semibold">
            {trialStarted ? (
              <span className="text-muted">был {fmtDate(trialExpiresAt)}</span>
            ) : (
              'не использован'
            )}
          </p>
        </div>
      </div>

      <StatusMessage tone="error" className="mb-4">
        {error}
      </StatusMessage>
      <StatusMessage tone="success" className="mb-4">
        {notice}
      </StatusMessage>

      {!trialStarted && plan === 'none' ? (
        <div className="mb-6">
          <button type="button" disabled={busy} onClick={activateTrial} className={btnPrimary}>
            {busy ? 'Активация…' : 'Активировать 24 часа бесплатно'}
          </button>
          <p className="mt-2 text-xs text-muted">
            50 откликов в день · без карты · без ограничений функций
          </p>
        </div>
      ) : null}

      {/*
        flex-wrap обязателен: подпись «Срок» плюс три кнопки («7 дней»,
        «14 дней», «30 дней») — это 367 px при боксе панели 244 px на 360px.
        Ряд не переносился и уводил всю страницу вбок.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Срок:</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-sm border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? 'border-accent/40 bg-accent/15 text-accent-2'
                : 'border-line bg-surface-2 text-muted hover:text-ink'
            }`}
          >
            {p} дней
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const planId = PLAN_IDS[p.name];
          const alreadyCurrent = active && plan === planId;
          return (
            <div
              key={p.name}
              className={`relative rounded-sm border p-5 ${p.popular ? 'border-accent/50 bg-accent/[0.06]' : 'border-line bg-surface-2'}`}
            >
              {p.popular ? (
                <span className="absolute -top-2.5 left-4 rounded-sm bg-accent px-3 py-0.5 text-[11px] font-semibold text-white">
                  Популярный
                </span>
              ) : null}
              <h3 className="font-serif leading-snug text-ink">{p.name}</h3>
              <p className="mt-1 text-sm text-muted">{p.tagline}</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {p.prices[period].toLocaleString('ru-RU')} ₽
                <span className="text-sm font-normal text-muted"> / {period} дн.</span>
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-muted">
                {p.features.slice(0, 4).map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="mt-[5px] size-1 shrink-0 rounded-full bg-accent-2" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy || alreadyCurrent}
                onClick={() => activatePlan(planId)}
                className={alreadyCurrent ? `${btnGhost} mt-4 w-full` : `${btnPrimary} mt-4 w-full`}
              >
                {alreadyCurrent
                  ? 'Текущий тариф'
                  : busy
                    ? 'Активация…'
                    : `Выбрать ${period}-дневный`}
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
