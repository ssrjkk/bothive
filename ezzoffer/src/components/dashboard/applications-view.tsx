'use client';

import { useEffect, useState } from 'react';
import { Badge, EmptyState, StatusMessage, btnDanger, btnGhost } from '@/components/dashboard/ui';
import { InterviewPrepPanel } from './interview-prep';
import type { InterviewPrep } from '@/lib/interview';

export type ApplicationItem = {
  id: number;
  job_slug: string;
  status: string;
  status_label: string;
  response: string;
  response_note: string;
  external_url: string | null;
  sent_at: number;
  viewed_at: number | null;
  responded_at: number | null;
  withdrawn: boolean;
  job: {
    title: string;
    company: string;
    salary: string;
    level: string;
    format: string;
    city: string;
    source?: string;
    source_url?: string | null;
  } | null;
};

import { SOURCE_LABELS } from '@/lib/source-labels';

/**
 * Загрузчик подготовки.
 *
 * Данные берутся по требованию: приглашений на странице обычно ноль, а
 * подготовка нужна одна и только по этому отклику. Загружать её для всех
 * приглашений сразу значило бы посылать запрос на каждое при открытии
 * страницы ради блока, который человек, скорее всего, не раскроет.
 */
function InterviewPrepLoader({ id }: { id: number }) {
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (prep || error) return;
          try {
            const res = await fetch(`/api/applications/${id}/interview`);
            const data = await res.json();
            if (!res.ok) {
              setError(data.error ?? 'Не удалось подготовить материалы');
              return;
            }
            setPrep(data.prep);
          } catch {
            setError('Сеть недоступна');
          }
        }}
        className="-my-2 inline-flex min-h-11 items-center py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent transition-colors hover:text-ink"
      >
        {prep ? 'Подготовиться к собеседованию' : 'Подготовиться к собеседованию'}
      </button>

      {/*
        Ошибка — в живой области. Иначе нажатие «Подготовиться» при
        недоступном сервере выглядит как ничего не сделавшее: экран молчит,
        и человек повторяет нажатие.
      */}
      <StatusMessage tone="error" className="mt-2 py-2 text-xs">
        {error}
      </StatusMessage>
      {prep ? <InterviewPrepPanel prep={prep} /> : null}
    </>
  );
}

type Filter = 'all' | 'sent' | 'viewed' | 'responded' | 'withdrawn';

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'sent', label: 'Отправлены' },
  { id: 'viewed', label: 'Просмотрены' },
  { id: 'responded', label: 'Ответы HR' },
  { id: 'withdrawn', label: 'Отозваны' },
];

function fmt(ts: number) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toneFor(app: ApplicationItem) {
  if (app.withdrawn) return 'neutral' as const;
  if (app.status === 'responded') {
    if (app.response === 'interview') return 'success' as const;
    if (app.response === 'question') return 'warn' as const;
    return 'danger' as const;
  }
  if (app.status === 'viewed') return 'cyan' as const;
  return 'accent' as const;
}

export function ApplicationsView({ initial }: { initial: ApplicationItem[] }) {
  const [apps, setApps] = useState<ApplicationItem[]>(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<number | null>(null);
  const [externalUrl, setExternalUrl] = useState<Record<number, string>>({});
  const [markingExternal, setMarkingExternal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch('/api/applications', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data.applications) setApps(data.applications);
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const withdraw = async (id: number) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/applications/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      setApps((prev) => prev.map((a) => (a.id === id ? { ...a, withdrawn: true } : a)));
    } finally {
      setBusy(null);
    }
  };

  const markAsExternal = async (id: number) => {
    setMarkingExternal(id);
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalUrl: externalUrl[id] || null, markExternal: true }),
      });
      if (!res.ok) return;
      setApps((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, external_url: externalUrl[id] || a.external_url } : a,
        ),
      );
    } finally {
      setMarkingExternal(null);
    }
  };

  const shown = apps.filter((a) =>
    filter === 'all'
      ? true
      : filter === 'withdrawn'
        ? a.withdrawn
        : !a.withdrawn && a.status === filter,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const count =
            f.id === 'all'
              ? apps.length
              : f.id === 'withdrawn'
                ? apps.filter((a) => a.withdrawn).length
                : apps.filter((a) => !a.withdrawn && a.status === f.id).length;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-sm border px-4 py-2 text-sm font-medium transition-colors ${
                filter === f.id
                  ? 'border-accent/40 bg-accent/15 text-accent-2'
                  : 'border-line bg-surface-2 text-muted hover:text-ink'
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="Откликов пока нет"
          text={
            filter === 'all'
              ? 'Откройте раздел «Вакансии», чтобы отправить первый отклик или запустить автопоиск.'
              : 'В этой категории пока пусто.'
          }
        />
      ) : (
        <div className="space-y-2.5">
          {shown.map((a) => (
            <div
              key={a.id}
              className={` flex flex-col gap-3 rounded-sm p-5 sm:flex-row sm:items-center ${a.withdrawn ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-serif leading-snug text-ink">{a.job?.title ?? a.job_slug}</h2>
                  <Badge tone={toneFor(a)}>{a.withdrawn ? 'Отозван' : a.status_label}</Badge>
                  {a.job?.source && a.job.source !== 'local' ? (
                    <Badge tone="cyan">{SOURCE_LABELS[a.job.source] ?? a.job.source}</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {a.job ? `${a.job.company} · ${a.job.salary} · ${a.job.city}` : ''}
                  {a.job?.source_url ? (
                    <>
                      {' · '}
                      <a
                        href={a.job.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-2 underline-offset-2 hover:underline"
                      >
                        на сайте
                      </a>
                    </>
                  ) : null}
                  {a.external_url ? (
                    <>
                      {' · '}
                      <a
                        href={a.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-2 underline-offset-2 hover:underline"
                      >
                        ссылка на отклик
                      </a>
                    </>
                  ) : null}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span>отправлен {fmt(a.sent_at)}</span>
                  {a.viewed_at ? (
                    <span className="text-accent-2">просмотрен {fmt(a.viewed_at)}</span>
                  ) : null}
                  {a.responded_at ? (
                    <span className="text-success">ответ {fmt(a.responded_at)}</span>
                  ) : null}
                </div>
                {a.status === 'responded' ? (
                  <p className="mt-1.5 text-sm">
                    {a.response === 'interview' ? (
                      <span className="text-success">Приглашение на собеседование</span>
                    ) : a.response === 'question' ? (
                      <span className="text-warn">
                        Вопрос от HR в чате — ответьте как можно скорее
                      </span>
                    ) : (
                      <span className="text-danger">Отказ — двигаемся дальше</span>
                    )}
                  </p>
                ) : null}

                {/* Причина отказа с площадки: без неё «отказ» ничего не объясняет. */}
                {a.response === 'decline' && a.response_note ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Причина с hh.ru: {a.response_note}
                  </p>
                ) : null}

                {a.response === 'interview' ? <InterviewPrepLoader id={a.id} /> : null}
              </div>
              {!a.withdrawn ? (
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button
                    type="button"
                    disabled={busy === a.id}
                    className={`${btnDanger} shrink-0`}
                    onClick={() => withdraw(a.id)}
                  >
                    {busy === a.id ? 'Отзываем…' : 'Отозвать'}
                  </button>
                  <button
                    type="button"
                    disabled={markingExternal === a.id}
                    className={`${btnGhost} shrink-0`}
                    onClick={() => markAsExternal(a.id)}
                  >
                    {markingExternal === a.id ? 'Отмечаем…' : 'Отметить отклик'}
                  </button>
                  <input
                    className="w-full rounded-sm border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs text-ink outline-none transition placeholder:text-muted focus:border-accent sm:w-48"
                    placeholder="Ссылка на отклик"
                    value={externalUrl[a.id] ?? ''}
                    onChange={(e) =>
                      setExternalUrl((prev) => ({ ...prev, [a.id]: e.target.value }))
                    }
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
