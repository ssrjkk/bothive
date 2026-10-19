'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Доступные модальные окна.
 *
 * До этого обе модалки кабинета (резюме и письма) были свёрстаны вручную:
 * без role="dialog", без ловушки фокуса, без Escape. Скринридер не понимал,
 * что открылся диалог, Tab уезжал за подложку, а закрыть можно было только
 * мышью. Удаление вообще было без подтверждения — промах по кнопке стирал
 * резюме безвозвратно, корзины в проекте нет.
 *
 * Рендер идёт через портал в body. Причина техническая, а не stylistic:
 * любой предок с transform, filter, perspective или backdrop-filter
 * становится containing block для position:fixed, и тогда панель
 * позиционируется относительно него, а не вьюпорта. Модалка «уезжает»
 * при прокрутке — без единой ошибки в консоли. Портал от этого
 * защищает независимо от того, как устроен конкретный предок.
 */

/** Всё, на что можно поставить фокус внутри диалога. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Видимые фокусируемые элементы внутри контейнера.
 *
 * Отсев по вычисленному стилю, а не по getClientRects().length > 0:
 *  - getClientRects требует раскладки и в jsdom возвращает пустое для
 *    ЛЮБОГО элемента, из-за чего ловушку фокуса нельзя было бы покрыть
 *    тестом вовсе — а это ровно тот код, который обязан быть покрыт;
 *  - он также не ловит visibility:hidden, который фокусирует элемент,
 *    но не показывает его.
 */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute('hidden')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    // Без вычисленных стилей (например, в изолированном окружении) считаем
    // элемент видимым: иначе ловушка выродится в «нечего фокусировать».
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/**
 * Поведение диалога: ловушка фокуса, Escape, блокировка скролла, возврат
 * фокуса. Вынесено в хук, потому что у нас два вида окон (обычное и
 * подтверждение) — две копии этой логики неизбежно разъехались бы.
 */
function useDialogBehavior(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  /** Элемент в фокусе до открытия — туда вернём фокус при закрытии. */
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // Слушатель висит на document, а не на панели: в момент открытия фокус
  // ещё не внутри, и Escape мог бы до панели не дойти.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = focusableWithin(panel);
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    // Помеченный автофокусом элемент получает фокус — так разрушительное
    // действие не становится дефолтным для Enter. Если пометки нет, фокус
    // идёт на панель: скринридер объявит имя окна, а Tab начнётся изнутри,
    // а не с начала страницы.
    const panel = panelRef.current;
    const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
    (preferred ?? panel)?.focus();

    document.addEventListener('keydown', onKeyDown, true);

    // Фон под диалогом не должен скроллиться: на мобильных жест внутри
    // панели тянул за собой страницу.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Возвращаем фокус кнопке, открывшей окно, — иначе клавиатурный
      // пользователь после закрытия остаётся «в пустоте», и следующий Tab
      // начинается с начала документа.
      restoreFocusTo.current?.focus?.();
    };
  }, [open, onKeyDown]);

  return panelRef;
}

function Overlay({
  open,
  onClose,
  labelledBy,
  role,
  maxWidth,
  zIndex,
  onBackdropClick,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  role: 'dialog' | 'alertdialog';
  maxWidth: string;
  zIndex: string;
  onBackdropClick?: () => void;
  children: ReactNode;
}) {
  const panelRef = useDialogBehavior(open, onClose);
  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4 supports-[height:100dvh]:p-[max(1rem,env(safe-area-inset-top))_1rem_max(1rem,env(safe-area-inset-bottom))]`}
      /* dvh вместо vh: в iOS Safari 100vh — это высота с развёрнутой
           адресной строкой, то есть БОЛЬШЕ видимой области. Диалог с
           редактором резюме (rows=14) уезжал за нижний край, а с
           открытой клавиатурой заголовок выдавливало из экрана целиком.
           supports-[height:100dvh] — чтобы старые браузеры не потеряли
           обычное ограничение по 100vh. */
    >
      {/*
        Подложка. Раньше была bg-black/70 с размытием — на бумажной теме
        это даёт грязную серую пелену, сквозь которую просвечивает текст
        страницы. Теперь ровный полупрозрачный слой: он отделяет диалог,
        не добавляя оттенка.
      */}
      <div className="absolute inset-0 bg-ink/70" onClick={onBackdropClick} aria-hidden />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`relative max-h-[calc(100vh-2rem)] w-full ${maxWidth} overflow-y-auto overscroll-contain border border-line bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_24px_60px_-24px_rgba(21,19,15,0.45)] outline-none supports-[height:100dvh]:max-h-[calc(100dvh-2rem)] sm:p-8 sm:pb-8`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-2xl',
  dismissOnBackdrop = false,
}: {
  open: boolean;
  /** Запрос на закрытие (Escape, крестик, по желанию — клик по подложке). */
  onClose: () => void;
  /** Заголовок — он же accessible name диалога. */
  title: string;
  children: ReactNode;
  maxWidth?: string;
  /**
   * Закрывать ли кликом по затемнению.
   *
   * По умолчанию нет: оба диалога кабинета — формы с несохранённым текстом,
   * и случайный клик мимо панели обнулял черновик вместе с написанным
   * письмом. Escape и крестик остаются — это намеренные действия.
   */
  dismissOnBackdrop?: boolean;
}) {
  const titleId = useId();

  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      role="dialog"
      maxWidth={maxWidth}
      zIndex="z-50"
      onBackdropClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id={titleId} className="font-serif text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2"
          aria-label="Закрыть"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="mt-5">{children}</div>
    </Overlay>
  );
}

/**
 * Подтверждение разрушительного действия.
 *
 * Роль alertdialog, а не dialog: такие окна предназначены для прерывания
 * и озвучиваются скринридером немедленно, поверх содержимого страницы.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Удалить',
  busy = false,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const titleId = useId();
  const descId = useId();

  return (
    <Overlay
      open={open}
      onClose={onCancel}
      labelledBy={`${titleId} ${descId}`}
      role="alertdialog"
      maxWidth="max-w-md"
      zIndex="z-[60]"
    >
      <h2 id={titleId} className="font-serif text-xl leading-snug text-ink">
        {title}
      </h2>
      <p id={descId} className="mt-2 text-sm leading-relaxed text-muted">
        {description}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={ghostBtn}
          onClick={onCancel}
          disabled={busy}
          data-autofocus
        >
          Отмена
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-sm bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Удаляем…' : confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}

const ghostBtn =
  'inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2 disabled:opacity-50';
