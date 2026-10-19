'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel, btnPrimary, btnGhost, StatusMessage } from '@/components/dashboard/ui';

type LinkState = {
  botConfigured: boolean;
  linked: boolean;
  chatId: string | null;
  code: string | null;
  codeTtlMinutes: number;
};

export function TelegramConnect() {
  const [state, setState] = useState<LinkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GET только читает состояние: код выдаёт отдельный POST, иначе каждое
  // обновление страницы перевыпускало бы код и инвалидировало тот, который
  // пользователь уже продиктовал боту.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/link', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as LinkState;
      setState((prev) => ({ ...data, code: prev?.code ?? null }));
    } catch {
      setError('Сеть недоступна — не удалось загрузить статус бота');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/telegram/link', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<LinkState>) : null))
      .then((data) => {
        if (alive && data) setState(data);
      })
      .catch(() => {
        if (alive) setError('Сеть недоступна — не удалось загрузить статус бота');
      });
    return () => {
      alive = false;
    };
  }, []);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось получить код');
        return;
      }
      setState((prev) => (prev ? { ...prev, code: data.code } : prev));
    } catch {
      setError('Сеть недоступна — код не получен');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/telegram/link', { method: 'DELETE' });
      if (!res.ok) {
        setError('Не удалось отвязать чат');
        return;
      }
      setState((prev) => (prev ? { ...prev, linked: false, chatId: null } : prev));
      await load();
    } catch {
      setError('Сеть недоступна — чат не отвязан');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!state?.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
    } catch {
      setError('Не удалось скопировать — введите код вручную');
    }
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          {/*
          Иконка Telegram была синим градиентным квадратом со скруглением.
          Официальный синий бренда — #229ED9; он и стоит здесь, ровным
          квадратом с прямыми углами. Второй оттенок (#1C7ED6) в градиенте
          ничего не сообщал и только создавал ощущение объёма.
        */}
          <span className="grid size-9 shrink-0 place-items-center bg-[#229ED9] text-white">
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
              <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.2 12.7 1.4 11.2c-1-.3-1-1 .2-1.5l19.1-7.4c.9-.3 1.6.2 1.2 2z" />
            </svg>
          </span>
          <div>
            <h2 className="font-serif text-lg leading-snug text-ink">Telegram-бот</h2>
            <p className="mt-1 text-sm text-muted">
              Управляйте откликами из мессенджера: подбор вакансий, запуск откликов и статистика.
            </p>
          </div>
        </div>
        {state ? (
          <span
            className={`rounded-sm px-3 py-1 text-xs font-medium ${
              state.linked
                ? 'bg-success/10 text-success'
                : state.botConfigured
                  ? 'bg-warn/10 text-warn'
                  : 'bg-surface-2 text-muted'
            }`}
          >
            {state.linked
              ? 'Привязан'
              : state.botConfigured
                ? 'Не привязан'
                : 'Не настроен на сервере'}
          </span>
        ) : null}
      </div>

      <StatusMessage tone="error" className="mt-4">
        {error}
      </StatusMessage>

      {state?.botConfigured ? (
        state.linked ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted">
              Этот аккаунт привязан к чату <span className="font-mono text-xs">{state.chatId}</span>
              . Команды бота работают с теми же лимитами, что и кабинет.
            </p>
            <button type="button" disabled={busy} onClick={unlink} className={btnGhost}>
              {busy ? 'Отвязываем…' : 'Отвязать Telegram'}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <ol className="space-y-2 text-sm text-muted">
              <li>
                <span className="mr-2 inline-grid size-5 place-items-center rounded-sm bg-accent/15 text-xs font-semibold text-accent-2">
                  1
                </span>
                Откройте бота <span className="font-mono text-xs text-ink">@EZOfferBot</span> в
                Telegram
              </li>
              <li>
                <span className="mr-2 inline-grid size-5 place-items-center rounded-sm bg-accent/15 text-xs font-semibold text-accent-2">
                  2
                </span>
                Нажмите «Начать» — бот покажет инструкцию
              </li>
              <li>
                <span className="mr-2 inline-grid size-5 place-items-center rounded-sm bg-accent/15 text-xs font-semibold text-accent-2">
                  3
                </span>
                Отправьте боту{' '}
                <code className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-xs text-accent-2">
                  /связать
                </code>{' '}
                и код ниже
              </li>
            </ol>

            {/*
            Код привязки — единственное, что пользователю нужно отсюда
            перенести в мессенджер, поэтому он стоит под линейкой и
            набирается моноширинным с разрядкой: цифры нельзя спутать
            при переписывании. Пунктирная рамка исчезла — она делала
            элемент похожим на поле ввода, в которое код вводится.
          */}
            <div className="border-t-2 border-ink pt-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  Код привязки
                </p>
                {state.code ? (
                  <>
                    <p className="mt-2 font-mono text-3xl tabular-nums tracking-[0.3em] text-ink">
                      {state.code}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      Код одноразовый и живёт {state.codeTtlMinutes} минут
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    Нажмите «Получить код» — он действует {state.codeTtlMinutes} минут
                  </p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {state.code ? (
                  <button type="button" onClick={copyCode} className={btnPrimary}>
                    Скопировать
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={requestCode}
                    className={btnPrimary}
                  >
                    {busy ? 'Получаем…' : 'Получить код'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      ) : state ? (
        <p className="mt-4 text-sm text-muted">
          Бот ещё не настроен администратором: нужны переменные{' '}
          <code className="font-mono text-xs">TELEGRAM_BOT_TOKEN</code> и{' '}
          <code className="font-mono text-xs">TELEGRAM_WEBHOOK_SECRET</code>. Всё остальное работает
          как раньше — кабинет отправляет отклики самостоятельно.
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted">Загружаем статус бота…</p>
      )}
    </Panel>
  );
}
