'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { NextAction } from '@/lib/pipeline';

/**
 * Что делать дальше.
 *
 * Блок ставится первым на странице кабинета не по дизайну, а по смыслу:
 * человек открыл кабинет с одним вопросом — «что делать». Статистика ниже
 * отвечает на другой вопрос («как идут дела»), и, поставленная первой,
 * она же перехватывала внимание, не дав ответить на главный.
 *
 * Порядок и срочность приходят из `pipeline.ts`: то, что протухает, раньше
 * того, что подождёт.
 */
export function NextActionsPanel({ actions }: { actions: NextAction[] }) {
  if (actions.length === 0) return null;

  return (
    <section aria-labelledby="next-actions-heading" className="border-t-2 border-ink pt-6">
      <h2 id="next-actions-heading" className="font-serif text-xl leading-snug text-ink">
        Что делать дальше
      </h2>

      <ol className="mt-5">
        {actions.map((a) => (
          <li key={`${a.kind}-${a.count}`} className="border-b border-line py-4 first:border-t">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="font-serif leading-snug text-ink">{a.title}</h3>
              {a.urgency === 1 ? (
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                  сегодня
                </span>
              ) : null}
            </div>

            <p className="measure mt-1.5 text-sm leading-relaxed text-muted">{a.detail}</p>

            {a.draft ? (
              /*
               * Готовый текст показывается, а не отправляется. API hh не даёт
               * кандидату писать работодателю самому: устаревшие методы
               * переписки есть только у работодателя. Поэтому здесь честная
               * кнопка «скопировать», а не имитация действия, которого сервис
               * выполнить не может.
               */
              <DraftBlock text={a.draft} />
            ) : null}

            <Link
              href={a.href}
              className="mt-3 inline-flex items-center gap-2 border-b border-ink pb-0.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Перейти
              <span aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Текст напоминания с копированием в буфер. */
function DraftBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Возврат в исходное состояние: иначе надпись «скопировано» остаётся
      // навсегда и перестаёт что-либо значить.
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details className="mt-3">
      <summary className="-my-2 inline-flex min-h-11 cursor-pointer items-center py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted hover:text-accent">
        Текст напоминания
      </summary>
      <div className="mt-2 border border-line bg-surface-2 p-4">
        <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{text}</p>

        {/*
          Статус копирования — живая область: иначе после нажатия ничего не
          происходит на экране и человек не понимает, что текст ушёл.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="-my-2 inline-flex min-h-11 items-center py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent underline underline-offset-4 hover:text-ink"
          >
            Скопировать
          </button>
          <span role="status" aria-live="polite" className="text-xs text-success">
            {copied ? 'Скопировано' : ''}
          </span>
        </div>

        <p className="mt-2 text-xs leading-snug text-muted">
          Вставьте в чат на hh.ru. Отправку делает сам человек: API hh не даёт сервису писать
          работодателю от имени соискателя.
        </p>
      </div>
    </details>
  );
}
