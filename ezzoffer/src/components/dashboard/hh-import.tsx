'use client';

import { useEffect, useRef, useState } from 'react';
import { btnGhost } from '@/components/dashboard/ui';
import { StatusMessage } from '@/components/ui';
import { Download } from 'lucide-react';

/**
 * Импорт резюме с hh.ru.
 *
 * Кто ищет работу, уже имеет резюме на hh. Перепечатывать его в сторонний
 * сервис — преграда на входе: половина людей уходит, не увидев пользы. Поэтому
 * импорт стоит рядом с шаблонами, а не спрятан в настройках.
 *
 * Список резюме подгружается только при открытии: обращаться к hh при каждом
 * рендере страницы незачем, и человек, который не импортирует, не должен за
 * это платить запросом к внешнему API.
 */
export function HhImportButton({
  onImported,
  onError,
}: {
  /*
   * hh_id входит в тип намеренно. Импортированное резюме — единственное,
   * которое реально отправляется на hh, и метка «Отправляется на hh» обязана
   * появиться сразу после импорта. Без поля в типе она бы не появилась
   * вовсе, и человек решил бы, что импорт не дал ничего.
   */
  onImported: (resume: {
    id: number;
    title: string;
    content: string;
    years_label: string;
    ai_improved: number;
    hh_id: string | null;
    updated_at: number;
  }) => void;
  onError: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [items, setItems] = useState<{ id: string; title: string; updatedAt: string | null }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Клик вне и Escape закрывают панель: иначе она висит поверх интерфейса
  // после выбора.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setNote(null);
    try {
      const res = await fetch('/api/resumes/import-hh');
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? 'Не удалось получить резюме с hh.ru');
        setItems([]);
        return;
      }
      setItems(data.resumes ?? []);
    } catch {
      setNote('Сеть недоступна — список резюме не загрузился');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const importOne = async (id: string, title: string) => {
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch('/api/resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromHh: id, title }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? 'Не удалось импортировать резюме');
        onError(data.error ?? 'Не удалось импортировать резюме');
        return;
      }
      onImported(data.resume);
      setOpen(false);
    } catch {
      const text = 'Сеть недоступна — резюме не импортировано';
      setNote(text);
      onError(text);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="w-full sm:relative sm:w-auto" ref={panelRef}>
      <button type="button" className={btnGhost} onClick={load} aria-expanded={open}>
        <Download className="size-4" aria-hidden />
        Из hh.ru
      </button>

      {/*
        Привязка под телефон — та же ошибка, что была в меню шаблонов.

        `absolute left-0` привязывает левый край панели к ЛЕВОМУ краю кнопки.
        Кнопка «Из hh.ru» стоит в переносящемся тулбаре, и на 360px тулбар
        переносит её вправо — панель начиналась с середины экрана и уезжала
        за правый край. Ширина 320px тут не помогает: мерить надо от края
        кнопки, а кнопка не у левого края.

        Поэтому на узком экране панель становится обычным блоком во всю
        ширину тулбара — у неё просто нет края, за который можно уехать.
        На широком остаётся всплывающей и прижата к правому краю кнопки.
      */}
      {open ? (
        <div className="mt-2 w-full border border-line bg-surface p-3 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:shadow-[0_18px_40px_-20px_rgba(21,19,15,0.4)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Резюме на hh.ru
          </p>

          {loading ? <p className="mt-3 text-sm text-muted">Загружаем…</p> : null}

          {!loading && items.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {note ?? 'На hh.ru нет доступных резюме.'}
            </p>
          ) : null}

          {!loading && items.length > 0 ? (
            <ul className="mt-3">
              {items.map((r) => (
                <li key={r.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => importOne(r.id, r.title)}
                    className="w-full px-1 py-2.5 text-left text-sm text-ink transition-colors hover:text-accent disabled:opacity-60"
                  >
                    <span className="block">{busyId === r.id ? 'Импортируем…' : r.title}</span>
                    {r.updatedAt ? (
                      <span className="mt-0.5 block font-mono text-[11px] text-muted">
                        обновлено {new Date(r.updatedAt).toLocaleDateString('ru-RU')}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Ошибка импорта — живая область: без неё нажатие выглядит
              ничем не приведшим. */}
          <StatusMessage tone="error" className="mt-3 py-2 text-xs">
            {note}
          </StatusMessage>

          <p className="mt-3 text-xs leading-snug text-muted">
            Импорт создаёт копию. Оригинал на hh.ru не меняется.
          </p>
        </div>
      ) : null}
    </div>
  );
}
