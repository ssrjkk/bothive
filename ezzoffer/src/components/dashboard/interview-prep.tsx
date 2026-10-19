'use client';

import { useState } from 'react';
import type { InterviewPrep } from '@/lib/interview';

/**
 * Подготовка к собеседованию по конкретному отклику.
 *
 * Показывается только там, где есть приглашение: человек без приглашения
 * не готовится к собеседованию, а человек с приглашением обычно готовится
 * в панике и не знает, с чего начать.
 *
 * Данные приходят с сервера уже посчитанными (`InterviewPrep`): считать их
 * в браузере нельзя, оценка зависит от словаря навыков и версии сервера, и
 * клиент и сервер разошлись бы при первом же обновлении.
 */
export function InterviewPrepPanel({ prep }: { prep: InterviewPrep }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-my-2 inline-flex min-h-11 cursor-pointer items-center py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent transition-colors hover:text-ink"
      >
        {open ? 'Свернуть подготовку' : 'Подготовиться к собеседованию'}
      </button>

      {open ? (
        <div className="mt-4 space-y-5">
          {prep.riskyGaps.length > 0 ? (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                Спросят про то, чего в резюме нет
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{prep.riskyGaps.join(', ')}</p>
              <p className="mt-1 text-xs leading-snug text-muted">
                Честное «не работал, но вот как подошёл бы» ценится выше блефа.
              </p>
            </div>
          ) : null}

          {prep.strongCards.length > 0 ? (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Проговорите в первую очередь
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">
                {prep.strongCards.join(', ')}
              </p>
            </div>
          ) : null}

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Вероятные вопросы
            </p>
            <ol className="mt-2">
              {prep.questions.map((q, i) => (
                <li
                  key={`${q.category}-${i}`}
                  className="border-b border-line py-3 last:border-b-0"
                >
                  <p className="text-sm leading-relaxed text-ink">{q.question}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{q.hint}</p>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Взять с собой
            </p>
            <ul className="mt-2">
              {prep.checklist.map((c) => (
                <li key={c} className="flex gap-2.5 py-1.5 text-sm leading-relaxed text-ink">
                  <span aria-hidden className="mt-2 block h-px w-3 shrink-0 bg-line" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
