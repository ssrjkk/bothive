import type { JSX } from 'react';

// Живая область для сообщений живёт в общем модуле: она нужна и кабинету,
// и публичным страницам (тарифы, формы входа). Здесь — реэкспорт, чтобы
// существующие импорты кабинетных компонентов не ломались.
export { StatusMessage } from '@/components/ui';

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'accent-2' | 'cyan' | 'success' | 'warn' | 'danger';
}) {
  const cls = {
    neutral: 'border-line bg-surface-2 text-muted',
    // text-accent-2, а не text-accent: accent настроен как ФОН под белый текст
    // (5.22:1), но как цвет текста на своей подложке даёт 3.28:1.
    accent: 'border-accent/20 bg-accent/10 text-accent-2',
    'accent-2': 'border-accent-2/20 bg-accent-2/10 text-accent-2',
    cyan: 'border-cyan/20 bg-cyan/10 text-cyan',
    success: 'border-success/20 bg-success/10 text-success',
    warn: 'border-warn/20 bg-warn/10 text-warn',
    danger: 'border-danger/20 bg-danger/10 text-danger',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] ${cls}`}
    >
      {children}
    </span>
  );
}

/*
 * Заголовок раздела кабинета.
 *
 * Прежний вариант совпадал с публичным и отличался только тем, что был
 * по умолчанию центрирован, — то есть кабинет выглядел как витрина, а не
 * как рабочий инструмент. Теперь выключен по центру, метка моноширинным
 * с линейкой, заголовок антиквой. Проп center остался: пара мест его
 * действительно просит, и молча менять их раскладку нельзя.
 */
export function SectionHead({
  eyebrow,
  title,
  sub,
  center = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
  center?: boolean;
}) {
  if (center) {
    return (
      <div className="mx-auto mb-12 max-w-3xl text-center md:mb-16">
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          {eyebrow}
        </p>
        <h2 className="display text-balance text-3xl text-ink md:text-5xl">{title}</h2>
        {sub ? (
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted md:text-lg">
            {sub}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-12 max-w-3xl md:mb-16">
      <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
        <span aria-hidden className="block h-px w-7 bg-accent" />
        {eyebrow}
      </p>
      <h2 className="display mt-4 text-balance text-3xl text-ink md:text-5xl">{title}</h2>
      {sub ? (
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted md:text-lg">{sub}</p>
      ) : null}
    </div>
  );
}

export function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`border border-line bg-surface p-5 ${className}`}>{children}</div>;
}

/**
 * Показатель.
 *
 * Раньше — карточка с заливкой и рамкой, где подпись стояла над числом.
 * Теперь — колонка под линейкой: те же шесть карточек статистики
 * превращаются в строку цифр, как в отчётности, и выравниваются по
 * разрядам благодаря моноширинному начертанию.
 */
export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = 'accent',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: JSX.Element;
  accent?: 'accent' | 'accent-2' | 'cyan' | 'success' | 'warn';
}) {
  const color = {
    accent: 'text-accent',
    'accent-2': 'text-accent-2',
    cyan: 'text-cyan',
    success: 'text-success',
    warn: 'text-warn',
  }[accent];

  return (
    <div className="flex flex-col gap-1.5 border-t-2 border-ink pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-3xl tabular-nums text-ink md:text-4xl">{value}</span>
        {icon ? <span className={`shrink-0 ${color}`}>{icon}</span> : null}
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Подсказка под полем: зачем оно и что будет, если его не заполнить. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * Пустое состояние.
 *
 * Прежний вид — пунктирная коробка с круглой иконкой посередине: самый
 * узнаваемый силуэт пустого состояния из шаблонов. Тот же смысл здесь
 * достигается иначе — линейка сверху, метка моноширинным, текст слева.
 * Иконка убрана: она ничего не сообщала, а только украшала пустоту.
 */
export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border-t-2 border-ink py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Пока пусто</p>
      <h2 className="mt-3 font-serif text-xl leading-snug text-ink">{title}</h2>
      <p className="measure mt-2 text-sm leading-relaxed text-muted">{text}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * Общий вид поля ввода. ШИРИНЫ ЗДЕСЬ НЕТ.
 *
 * Раньше строка заканчивалась на `w-full`, и это молча ломало всё, что её
 * использовало: в jobs-explorer к `${inputCls}` дописывались `w-44`, `w-36`,
 * `w-32`, `w-56` для фильтров, и они не работали.
 *
 * Причина в том, как Tailwind собирает CSS: порядок правил в табличении
 * решает каскад, а НЕ порядок классов в атрибуте. Проверено на той же
 * сборке проекта (tailwindcss 4.3.3):
 *
 *     623:  .w-32
 *     626:  .w-36
 *     632:  .w-44
 *     638:  .w-56
 *     653:  .w-full      ← позже всех, поэтому побеждает
 *
 * То есть шесть полей фильтра рисовались во всю ширину контейнера, а их
 * `w-*` были мёртвым кодом: панель фильтров выглядела пятью полноширинными
 * строками вместо компактного кластера. Ни ошибки, ни предупреждения.
 *
 * Ширина теперь задаётся на месте использования: `w-full sm:w-44` и так
 * далее. Так она работает всегда и читается сразу.
 */
export const inputCls =
  'min-w-0 rounded-sm border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

export const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-sm border border-line-strong bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60';

export const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-sm border border-danger/40 bg-danger/10 px-4 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-60';
