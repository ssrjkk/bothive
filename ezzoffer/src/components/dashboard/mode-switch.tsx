'use client';

import { useState } from 'react';
import { Badge, Panel, btnGhost } from '@/components/dashboard/ui';

/**
 * Переключатель режима demo|live в настройках (Фаза 1, задача 3).
 *
 * Роут `/api/mode` проверяет подключение hh и отказывает, если площадки нет.
 * Значит, и здесь кнопка «живой режим» не предлагается, пока hh не подключён:
 * предлагать действие, которое заведомо откажет, — это обучение человека
 * игнорировать ошибки.
 *
 * Единственное исключение — возврат в demo: он доступен всегда и всегда
 * разрешён на сервере. Человек должен иметь возможность убрать живые отклики
 * даже в момент, когда площадка ещё подключена.
 */

export function ModeSwitch({
  initialMode,
  hhConnected,
}: {
  initialMode: 'demo' | 'live';
  hhConnected: boolean;
}) {
  const [mode, setMode] = useState<'demo' | 'live'>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (next: 'demo' | 'live') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { mode?: string; error?: string };
      if (!res.ok) {
        // Причину показываем серверную: она говорит, чего именно не хватает.
        setError(data.error ?? 'Не удалось сменить режим');
        return;
      }
      setMode(data.mode === 'live' ? 'live' : 'demo');
    } catch {
      setError('Не удалось сменить режим: нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  return (
    // data-mode-switch — однозначный признак текущего режима для тестов.
    // Проверять текст всей панели нельзя: пояснение «в живом режиме симуляции
    // нет» присутствует на странице всегда и сбивает проверку «переключилось ли».
    <div data-mode-switch={mode}>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-serif text-lg leading-snug text-ink">Режим данных</h2>
            <p className="mt-1 text-sm text-muted">
              В демо-режиме отклики и статусы демонстрационные. В живом режиме симуляции нет:
              статусы приходят только от hh.ru.
            </p>
          </div>
          <Badge tone={mode === 'demo' ? 'warn' : 'success'}>
            {mode === 'demo' ? 'Демо' : 'Живой режим'}
          </Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {mode === 'demo' ? (
            hhConnected ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void send('live')}
                className={btnGhost}
              >
                {busy ? 'Включаем…' : 'Включить живой режим'}
              </button>
            ) : (
              <p className="text-sm text-muted">
                Сначала подключите аккаунт hh.ru — без него живого режима не бывает.
              </p>
            )
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send('demo')}
              className={btnGhost}
            >
              {busy ? 'Возвращаем…' : 'Вернуться в демо-режим'}
            </button>
          )}
        </div>

        {/* Всегда смонтировано: текст должен появиться отдельным рендером,
          иначе часть скринридеров не объявит вставку (см. StatusMessage). */}
        <p role="alert" className={error ? 'mt-3 text-sm text-danger' : 'sr-only'}>
          {error ?? ''}
        </p>
      </Panel>
    </div>
  );
}
