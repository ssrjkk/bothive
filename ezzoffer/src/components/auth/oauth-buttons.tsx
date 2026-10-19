'use client';

import { useState } from 'react';
import { btnGhost } from '@/components/dashboard/ui';

/**
 * Кнопки внешнего входа.
 *
 * Роут /api/auth/oauth/[provider] существовал, а интерфейса для него не было:
 * зарегистрировав приложение на dev.github.ru, человек открывал страницу
 * входа и не видел ни одной кнопки — вывод «не работает» был логичным.
 *
 * НЕГОТОВЫЕ способы не рисуются вовсе, а не показываются серыми. Здесь
 * спорный выбор: серая кнопка обещает действие и не выполняет его. Человек
 * жмёт, ничего не происходит, и уходит. Отсутствие кнопки читается честнее:
 * значит, способ пока не настроен.
 *
 * Ошибка сервера показывается дословно. Молчаливый переход без ссылки
 * выглядел бы как «кнопка сломалась».
 */

type Method = { id: string; title: string; ready: boolean };

export function OAuthButtons({
  methods,
  onNavigate,
}: {
  methods: Method[];
  /** Переход по ссылке входа. Внедряется, потому что jsdom не даёт подменить
   *  window.location.assign, а проверять надо именно факт перехода. */
  onNavigate?: (url: string) => void;
}) {
  const ready = methods.filter((m) => m.ready);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (ready.length === 0) return null;

  const go = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/auth/oauth/${id}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Вход через этот способ сейчас недоступен');
        return;
      }
      (onNavigate ?? ((u: string) => window.location.assign(u)))(data.url as string);
    } catch {
      setError('Не удалось начать вход: нет связи с сервером');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3" data-oauth-buttons="">
      <div className="flex flex-wrap gap-2">
        {ready.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={busy === m.id}
            onClick={() => void go(m.id)}
            className={btnGhost}
          >
            {busy === m.id ? 'Переходим…' : `Войти через ${m.title}`}
          </button>
        ))}
      </div>

      <p role="alert" className={error ? 'text-sm text-danger' : 'sr-only'}>
        {error ?? ''}
      </p>
    </div>
  );
}
