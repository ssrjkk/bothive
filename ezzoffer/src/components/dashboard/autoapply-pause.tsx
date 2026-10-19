'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Panel, btnPrimary, btnGhost, StatusMessage } from '@/components/dashboard/ui';
import type { LastRunReport } from '@/lib/autoapply-report';

/**
 * Тон рамки по типу сообщения.
 *
 * Отдельная карта, а не тернарник в разметке: у тонов разные пары «цвет рамки —
 * цвет текста», и в тернарнике эти пары пришлось бы собирать в одном месте,
 * где их легко перепутать между собой — а это ровно тот класс ошибок, который
 * уже стоил контраста.
 */
const TONE: Record<LastRunReport['reasons'][number]['tone'], string> = {
  good: 'border-l-success',
  warn: 'border-l-warn',
  bad: 'border-l-danger',
  muted: 'border-l-line-strong',
};

/**
 * Человеческое время.
 *
 * Первая версия различала только «сегодня» и «завтра», а ограничение
 * продлевается при каждом новом 403 — то есть срок вполне может уйти за
 * полночь и даже за несколько суток. Тогда человек читал бы «завтра» про
 * ограничение через неделю. Поэтому дальше первых двух дней выводится дата.
 */
function untilText(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `сегодня в ${time}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `завтра в ${time}`;

  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${time}`;
}

export function AutoApplyPause({ initialPaused }: { initialPaused: boolean }) {
  const [paused, setPaused] = useState(initialPaused);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRunReport | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [blockedReason, setBlockedReason] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/autoapply/state', { cache: 'no-store' })
      .then((r) => r.json())
      .then(
        (data: {
          paused: boolean;
          blocked?: boolean;
          blockedUntil?: number;
          blockedReason?: string;
          lastRun: LastRunReport | null;
        }) => {
          if (!alive) return;
          setPaused(Boolean(data.paused));
          setBlocked(Boolean(data.blocked));
          setBlockedUntil(data.blockedUntil ?? 0);
          setBlockedReason(data.blockedReason ?? '');
          setLastRun(data.lastRun ?? null);
        },
      )
      .catch(() => undefined)
      .finally(() => {
        alive = false;
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(paused ? '/api/autoapply/resume' : '/api/autoapply/pause', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось переключить');
        return;
      }
      setPaused(Boolean(data.paused));
    } catch {
      setError('Не удалось переключить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg leading-snug text-ink">Автоотклики</h2>
          <p className="mt-1 text-sm text-muted">
            {blocked
              ? 'Отклики остановлены ограничением hh. Пауза ни при чём — состояние снимается только на площадке.'
              : 'Пауза мгновенно останавливает все автоотклики и активные поиски. Настройки сохраняются.'}
          </p>
        </div>
        <Badge tone={blocked ? 'danger' : paused ? 'warn' : 'success'}>
          {blocked ? 'Аккаунт ограничен' : paused ? 'На паузе' : 'Активны'}
        </Badge>
      </div>

      {/*
        Ограничение площадки — самое важное, что здесь может быть сказано, и
        раньше оно не говорилось ничего.

        Человек видел «Активны», отклики не уходили, и у него не было ни одной
        зацепки: ни цифры, ни срока, ни причины. Теперь состояние называется
        прямо, указано, когда сервис попробует снова, и сказано, что делать —
        иначе человек ищет проблему в резюме или в поисках, а она не там.
      */}
      {blocked ? (
        <div className="mt-4 border-l-2 border-l-danger bg-surface-2 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            {blockedReason || 'hh.ru ограничил доступ к аккаунту'}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Отклики остановлены до {blockedUntil ? untilText(blockedUntil) : 'снятия ограничения'}.
            Пока ограничение висит, любая отправка только ухудшает положение аккаунта, поэтому
            сервис ждёт и не повторяет попытки.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Снять это можно только на hh.ru: проверьте, нет ли там ограничений или требования
            подтвердить аккаунт. Если после снятия отклики так и не пошли, переподключите его в{' '}
            <Link
              href="/dashboard/settings"
              className="font-medium text-accent-2 underline-offset-2 hover:underline"
            >
              настройках
            </Link>
            .
          </p>
        </div>
      ) : null}

      <StatusMessage tone="error" className="mt-3">
        {error}
      </StatusMessage>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/*
          Кнопка паузы при ограничении бессмысленна: пауза не то состояние, и
          её снятие ничего не вернёт. Вместо неё — прямое действие туда, где
          ограничение снимается.
        */}
        {blocked ? (
          <Link href="/dashboard/settings" className={btnPrimary}>
            Проверить аккаунт hh
          </Link>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={toggle}
            className={paused ? btnPrimary : btnGhost}
          >
            {busy ? 'Сохраняем…' : paused ? 'Возобновить автоотклики' : 'Поставить на паузу'}
          </button>
        )}
        <Link
          href="/platform-rules"
          className="-my-1 inline-flex min-h-11 items-center text-sm font-medium text-accent-2 underline-offset-2 transition-colors hover:underline"
        >
          Правила платформ и риски
        </Link>
      </div>

      {/*
       * Разбор последнего прогона.
       *
       * Порядок и тон несут смысл, а не украшают: сначала то, что мешает,
       * потом то, что произошло. Поэтому причины идут списком с рамкой слева —
       * глаз считывает их как отдельные факты, а не как один блок текста.
       */}
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="font-serif text-base leading-snug text-ink">Последний прогон</h3>

        {!lastRun ? (
          <p className="mt-2 text-sm text-muted">
            Прогон ещё не выполнялся. Он запускается автоматически, когда есть активные поиски и
            привязанный аккаунт hh.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              {new Date(lastRun.at).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <ul className="mt-3 space-y-2">
              {lastRun.reasons.map((r) => (
                <li
                  key={r.title}
                  className={`border-l-2 pl-3 ${TONE[r.tone]}`}
                  data-tone={r.tone}
                  data-reason={r.title}
                >
                  <p className="text-sm font-medium text-ink">{r.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{r.detail}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}
