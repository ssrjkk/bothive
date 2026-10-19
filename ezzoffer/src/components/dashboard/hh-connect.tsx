'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Badge, Panel, btnPrimary, btnGhost, StatusMessage } from '@/components/dashboard/ui';

type HhStatus = {
  configured: boolean;
  connected: boolean;
  refreshable?: boolean;
  resume_id: string | null;
  expires_at: number | null;
};

const HH_ERROR_MESSAGES: Record<string, string> = {
  error: 'Отказ в авторизации на hh.ru',
  expired: 'Ссылка авторизации устарела, попробуйте снова',
  failed: 'Не удалось подключить аккаунт hh.ru',
  'no-resume': 'На аккаунте hh.ru не найдено резюме — создайте хотя бы одно',
};

/** Единственный источник данных о подключении: и эффект, и кнопка «Отключить». */
async function fetchHhStatus(): Promise<HhStatus | null> {
  const res = await fetch('/api/hh/status', { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()) as HhStatus;
}

export function HhConnect() {
  const [status, setStatus] = useState<HhStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  const hhCode = searchParams.get('hh');

  const applyStatus = useCallback((data: HhStatus) => {
    setStatus(data);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchHhStatus();
      if (data) applyStatus(data);
    } catch {
      setError('Не удалось проверить подключение к hh.ru');
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    if (hhCode) {
      // Убираем параметр результата OAuth из URL (без обновления состояния).
      router.replace(window.location.pathname);
    }
    let alive = true;
    fetchHhStatus()
      .then((data) => {
        if (alive && data) applyStatus(data);
      })
      .catch(() => {
        if (alive) {
          setError('Не удалось проверить подключение к hh.ru');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [hhCode, router, applyStatus]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/hh/connect', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Подключение к hh.ru недоступно');
        return;
      }
      window.location.assign(data.url as string);
    } catch {
      setError('Не удалось начать подключение');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/hh/disconnect', { method: 'POST' });
      if (!res.ok) return;
      await load();
    } catch {
      setError('Не удалось отключить аккаунт');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg leading-snug text-ink">Автоотклики на hh.ru</h2>
          <p className="mt-1 text-sm text-muted">
            Подключите аккаунт hh.ru — сервис будет отправлять реальные отклики по вашим поискам
            через API.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <Badge tone="neutral">Проверка…</Badge>
          ) : status?.connected ? (
            <Badge tone={status.refreshable ? 'warn' : 'success'}>
              {status.refreshable ? 'Подключён · токен обновится' : 'Подключён'}
            </Badge>
          ) : status && !status.configured ? (
            <Badge tone="warn">Не настроено на сервере</Badge>
          ) : (
            <Badge tone="neutral">Не подключён</Badge>
          )}
        </div>
      </div>

      {/* Всегда смонтировано: область и текст должны появиться разными
          рендерами, иначе часть скринридеров не объявит вставку. */}
      <StatusMessage tone="error" className="mt-3">
        {error ?? (hhCode && hhCode !== 'ok' ? HH_ERROR_MESSAGES[hhCode] : null)}
      </StatusMessage>

      {!loading && status && (
        <div className="mt-4">
          {status.connected ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Резюме на hh.ru:{' '}
                <span className="font-mono text-xs">{status.resume_id ?? '—'}</span>
                {status.refreshable && status.expires_at ? (
                  <span className="block text-xs text-warn">
                    Сеанс истёк {new Date(status.expires_at).toLocaleString('ru-RU')} — доступ
                    обновится автоматически при следующем отклике.
                  </span>
                ) : status.expires_at ? (
                  <span className="block text-xs">
                    Доступ до {new Date(status.expires_at).toLocaleString('ru-RU')}
                  </span>
                ) : null}
              </p>
              <p className="text-sm text-muted">
                Автоотклики отправляются автоматически по активным поискам (интервал настраивается
                через env).
              </p>
              <button type="button" disabled={connecting} onClick={disconnect} className={btnGhost}>
                {connecting ? 'Отключаем…' : 'Отключить аккаунт'}
              </button>
            </div>
          ) : status.configured ? (
            <button type="button" disabled={connecting} onClick={connect} className={btnPrimary}>
              {connecting ? 'Перенаправляем…' : 'Подключить аккаунт hh.ru'}
            </button>
          ) : (
            <p className="text-sm text-muted">
              Администратор не настроил OAuth-приложение hh.ru (нужны HH_CLIENT_ID,
              HH_CLIENT_SECRET, HH_REDIRECT_URI).
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
