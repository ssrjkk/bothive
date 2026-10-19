'use client';

import { useEffect, useState } from 'react';
import type { Stats } from '@/lib/stats';
import { StatCard, Panel } from '@/components/dashboard/ui';
import { TodayLimitBar } from '@/components/dashboard/plan-banner';

/**
 * Ряд графика: подпись, значение, ключ в stats.series и заливка.
 *
 * Цвет и подпись хранятся вместе именно поэтому. До этого легенда и
 * столбцы описывались двумя независимыми списками классов, и они
 * разошлись: точки легенды красились сырыми hex через Tailwind
 * (violet-500/cyan-400/emerald-400), столбцы — токенами темы. На
 * бумаге фиолетовая точка оказывалась рядом с тёмно-синим столбцом, и
 * подпись переставала означать то, что нарисовано.
 */
const SERIES = [
  { key: 'sent', label: 'Отправлено', color: 'bg-accent-2' },
  { key: 'viewed', label: 'Просмотрено', color: 'bg-cyan' },
  { key: 'invited', label: 'Приглашения', color: 'bg-success' },
] as const satisfies readonly {
  key: 'sent' | 'viewed' | 'invited';
  label: string;
  color: string;
}[];

export function StatsPanel({ initial }: { initial: Stats }) {
  const [stats, setStats] = useState<Stats>(initial);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch('/api/stats', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data.stats) setStats(data.stats);
      } catch {}
    };
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const max = Math.max(1, ...stats.series.map((d) => Math.max(d.sent, d.viewed, d.invited)));

  return (
    <div className="space-y-6">
      <TodayLimitBar today={stats.today} todayLimit={stats.todayLimit} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Отправлено" value={stats.sent} accent="accent" />
        <StatCard label="Просмотрено" value={stats.viewed} accent="accent-2" />
        <StatCard label="Ответов HR" value={stats.responded} accent="success" />
        <StatCard label="Приглашения" value={stats.invited} accent="success" />
        <StatCard label="Вопросы" value={stats.questions} accent="warn" />
        <StatCard label="Отказы" value={stats.declined} accent="warn" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Panel className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Просмотры
          </span>
          <span className="font-mono text-xl tabular-nums text-ink">{stats.viewRate}%</span>
        </Panel>
        <Panel className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Отответы HR
          </span>
          <span className="font-mono text-xl tabular-nums text-ink">{stats.respondRate}%</span>
        </Panel>
        <Panel className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Приглашения
          </span>
          <span className="font-mono text-xl tabular-nums text-ink">{stats.inviteRate}%</span>
        </Panel>
      </div>

      <Panel>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg">Динамика за 7 дней</h2>
          {/*
            Легенда и столбцы обязаны ссылаться на один и тот же набор
            цветов. Раньше точки легенды были сырыми (bg-violet-500,
            bg-cyan-400, bg-emerald-400), а столбцы — токенными
            (accent-2, cyan, success): на бумаге фиолетовая точка стояла
            рядом с тёмно-синим столбцом, и подписи переставали
            соответствовать данным. Оба набора теперь одни.
          */}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className={`block h-2.5 w-2.5 ${s.color}`} />
                {s.label}
              </li>
            ))}
          </ul>
        </div>

        {/*
            Семь дней по четыре полосы (отправлено / просмотрено / приглашено
            / отказано) не помещались в ширину панели на телефоне: у каждой
            группы свой min-content 38px (3×w-2.5 + 2×gap-1), а `flex-1` не
            даёт колонке сжаться меньше него. Итого 338px при боксе 286px —
            график выходил за край и уводил вбок всю страницу.

            Полосы сделаны `w-full` внутри группы с `min-w-0`, поэтому
            делят доступную ширину, а не требуют минимум. Столбцы прижаты к
            низу, подписи остаются под ними.
          */}
        <div className="flex h-44 items-end gap-2 sm:gap-3">
          {stats.series.map((d) => (
            <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-36 w-full min-w-0 items-end justify-center gap-0.5 sm:gap-1">
                {SERIES.map((s) => (
                  <div
                    key={s.key}
                    /* Подпись видна с клавиатуры и читается скринридером.
                       Раньше данные были только в title, который на
                       клавиатуре недоступен и озвучивается лишь частью
                       браузеров. */
                    role="img"
                    aria-label={`${d.label}: ${s.label} — ${d[s.key]}`}
                    className={`w-full max-w-2.5 transition-opacity hover:opacity-100 ${s.color} opacity-85`}
                    style={{ height: `${(d[s.key] / max) * 100}%` }}
                  />
                ))}
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
