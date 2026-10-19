'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Section, SectionHead, StatusMessage } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { plans, type PlanPeriod } from '@/lib/data';

const PLAN_IDS = ['start', 'pro', 'expert'];

const periods: { days: PlanPeriod; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 14, label: '14 дней' },
  { days: 30, label: '30 дней' },
];

export function PricingSection({ compact = false }: { compact?: boolean }) {
  const [period, setPeriod] = useState<PlanPeriod>(14);
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setHasAccount(Boolean(d?.user)))
      .catch(() => setHasAccount(false));
  }, []);

  const choose = async (planId: string) => {
    setNotice(null);
    if (!hasAccount) {
      router.push('/signup');
      return;
    }
    setBusy(planId);
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, period }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error ?? 'Не удалось активировать тариф');
        return;
      }
      router.push('/dashboard/settings');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      id={compact ? undefined : 'tariff'}
      className={
        compact ? 'border-t border-line bg-surface-2' : 'relative border-y border-line bg-surface-2'
      }
    >
      <SectionHead
        eyebrow="Подписочная модель"
        title={
          <>
            Тариф, который <span className="text-accent">окупается на первом оффере</span>
          </>
        }
        sub="Попробуйте весь функционал бесплатно и выберите подходящий период"
      />

      <div className="mb-10 flex justify-center">
        <div className=" inline-flex rounded-sm p-1">
          {periods.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setPeriod(p.days)}
              className={`rounded-sm px-5 py-2 text-sm font-medium transition-all ${
                period === p.days ? 'bg-accent text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {notice ? (
        <div className="mx-auto mb-6 max-w-md">
          <StatusMessage tone="error">{notice}</StatusMessage>
        </div>
      ) : null}

      <div className="grid gap-px border border-line bg-line lg:grid-cols-3">
        {plans.map((plan, idx) => (
          <Reveal key={plan.name} delay={idx * 80}>
            {/*
              Тарифы разделены линейками, а не заливкой. Раньше «популярный»
              отличался тремя средствами сразу — градиентом, свечением и парящим
              бейджем. Теперь его выделяет верхняя черта вдвое толще и
              моноширинная метка.
            */}
            <article
              className={`flex h-full flex-col bg-surface p-7 md:p-8 ${
                plan.popular ? 'border-t-2 border-accent' : 'border-t-2 border-transparent'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-serif text-2xl leading-snug">{plan.name}</p>
                {plan.popular ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                    Выбор
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">{plan.tagline}</p>

              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-mono text-4xl tabular-nums md:text-5xl">
                  {plan.prices[period].toLocaleString('ru-RU')}
                </span>
                <span className="text-sm text-muted">₽ / {period} дн.</span>
              </div>

              <ul className="mt-7 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    {/* Галочка — типографский знак, а не круглая плашка */}
                    <span aria-hidden className="mt-0.5 font-mono text-success">
                      ✓
                    </span>
                    <span className="leading-relaxed text-ink">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={busy === PLAN_IDS[idx]}
                onClick={() => choose(PLAN_IDS[idx])}
                className={`mt-8 inline-flex items-center justify-center gap-2 rounded-sm px-6 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  plan.popular
                    ? 'bg-accent text-white hover:bg-accent-hover'
                    : 'border border-line-strong text-ink hover:bg-surface-2'
                }`}
              >
                {busy === PLAN_IDS[idx] ? 'Активируем…' : hasAccount ? 'Выбрать тариф' : plan.cta}
              </button>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={100}>
        <p className="mt-8 text-center text-xs text-muted">
          {hasAccount ? (
            'Тариф активируется мгновенно без оплаты — демо-режим. Затем он откроется в кабинете.'
          ) : (
            <>
              Приобретая тариф, вы соглашаетесь с{' '}
              <Link
                href="/faq"
                className="underline decoration-line underline-offset-2 hover:text-ink"
              >
                условиями сервиса
              </Link>
              . Авторизуйтесь, чтобы активировать тариф.
            </>
          )}
        </p>
      </Reveal>
    </Section>
  );
}
