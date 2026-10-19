/**
 * Баннер демо-режима в раскладке кабинета (Фаза 1, задача 3).
 *
 * Серверный компонент без состояния: режим приходит из `users.mode` и рендерится
 * на сервере, поэтому страница не «мигает» — человек не успевает увидеть живые
 * цифры без пометки.
 *
 * Тон намеренно не «демо-версия» и не «beta». Демо-версия читается как
 * ограниченная функциональность, и её легко списать на маркетинг. Здесь
 * утверждается другое и более неприятное: числа на экране не отражают ответы
 * площадок. Принцип P1 карты требует, чтобы происхождение факта было видно
 * человеку, а не только лежало в колонке базы.
 *
 * В `live` компонент не рендерит ничего. Постоянная пометка была бы хуже
 * отсутствующей: она обесценивала бы настоящие данные и приучала игнорировать
 * плашку.
 */
export function DemoBanner({ mode }: { mode: 'demo' | 'live' }) {
  if (mode !== 'demo') return null;

  return (
    <div
      data-demo-banner=""
      role="note"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-warn/30 bg-warn/10 px-4 py-3"
    >
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-warn">Демо-режим</p>
        <p className="mt-1 text-sm text-ink">
          Цифры и статусы откликов здесь демонстрационные, а не реальные: они не отражают ответы
          площадок. Реальные отклики появятся после подключения аккаунта hh.ru.
        </p>
      </div>
      <a
        href="/dashboard/settings"
        className="shrink-0 rounded-sm border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-warn/40"
      >
        Подключить hh.ru
      </a>
    </div>
  );
}
