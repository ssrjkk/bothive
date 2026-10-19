'use client';

import { useState } from 'react';
import { Badge, btnGhost } from '@/components/dashboard/ui';

/**
 * A/B-варианты резюме: создать редакцию и честно сравнить.
 *
 * Сравнение показывает выборку и отказывается называть победителя, пока её
 * недостаточно. Это не осторожность оформления: на двух-трёх откликах разница
 * между редакциями — шум, и названный «победитель» потом увел бы человека
 * переписывать резюме не туда.
 *
 * Вариант без hh_id показан честно: на площадке его не существует, откликов у
 * него не будет, пока он туда не загружен. Это не ошибка, это его текущее
 * состояние — и прятать его значило бы показывать ноль без причины.
 */

type Stat = {
  id: number;
  label: string;
  title: string;
  uploaded: boolean;
  sent: number;
  responded: number;
  rate: number | null;
};

type Comparison = {
  enough: boolean;
  leader: string | null;
  notice: string;
};

export function VariantPanel({ resumeId }: { resumeId: number }) {
  const [open, setOpen] = useState(false);
  const [variants, setVariants] = useState<Stat[] | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/resumes/${resumeId}/variants`, { cache: 'no-store' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'Не удалось загрузить варианты');
      return;
    }
    const data = await res.json();
    setVariants(data.variants ?? null);
    setComparison(data.comparison ?? null);
  };

  const reveal = async () => {
    setOpen((v) => !v);
    if (!open && variants === null) await load();
  };

  const addVariant = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/resumes/${resumeId}/variants`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Не удалось создать вариант');
        return;
      }
      await load();
    } catch {
      setError('Не удалось создать вариант: нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        className="-my-2 inline-flex min-h-11 items-center text-xs text-muted underline"
        onClick={() => void reveal()}
      >
        {open ? 'Скрыть варианты' : 'Варианты резюме (A/B)'}
      </button>

      {open && (
        <div className="mt-3 border-t border-line pt-3" data-variant-panel={resumeId}>
          {variants === null && !error && <p className="text-sm text-muted">Загружаем…</p>}

          {variants !== null && variants.length === 0 && (
            <p className="text-sm text-muted">
              Это резюме ещё не вариантировалось. Создайте вторую редакцию, чтобы было что
              сравнивать.
            </p>
          )}

          {variants !== null && variants.length > 0 && (
            <ul className="space-y-2">
              {variants.map((v) => (
                <li key={v.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-mono text-xs text-muted">{v.label}</span>
                  <span className="text-ink">{v.title}</span>
                  {v.label === comparison?.leader && <Badge tone="success">ведёт</Badge>}
                  {!v.uploaded && <Badge tone="warn">нет на hh</Badge>}
                  <span className="text-xs text-muted">
                    откликов {v.sent}
                    {v.sent > 0 && v.rate !== null && ` · ответов ${Math.round(v.rate * 100)}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {variants !== null && comparison && variants.length > 0 && (
            <p className="mt-3 text-sm text-muted">{comparison.notice}</p>
          )}

          {/*
            Кнопка нужна и в пустом состоянии. Раньше она рендерилась только
            при variants.length > 0, и первый вариант создать было нечем:
            панель честно говорила «создайте вторую редакцию», а создать её
            было некем.
          */}
          {variants !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void addVariant()}
              className={`mt-3 ${btnGhost}`}
            >
              {busy ? 'Создаём…' : 'Создать вариант'}
            </button>
          )}

          <p role="alert" className={error ? 'mt-2 text-sm text-danger' : 'sr-only'}>
            {error ?? ''}
          </p>
        </div>
      )}
    </div>
  );
}
