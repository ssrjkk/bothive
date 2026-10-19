'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

/**
 * Появление блока при прокрутке.
 *
 * Проп as — не украшение. Появление при прокрутке почти всегда применяют
 * внутри списков, а <ol>/<ul> допускают только <li> прямыми потомками:
 * обёртка-<div> внутри списка ломает семантику, и axe репортит
 * «list/listitem has wrong structure», а скринридер объявляет список
 * как обычный блок без позиций.
 *
 * Поэтому элемент задаётся явно: <Reveal as="li"> внутри <ol>.
 *
 * ## Почему контент виден без JavaScript
 *
 * Раньше `shown` начинался с `false`, то есть СЕРВЕР отдавал `opacity-0`
 * каждому обёрнутому блоку, и видимым он становился только после срабатывания
 * IntersectionObserver. Без JS — а это отключённый JS, экономия трафика,
 * встроенный браузер Telegram, VK, почтового клиента, режим «экономия
 * батареи» — восемь публичных страниц (/, /about, /faq, /pricing, /reviews,
 * /internships, /platform-rules, /resume-examples) отдавались пустыми: шапка,
 * подвал и ничего между ними.
 *
 * Это хуже отсутствия анимации: анимация — украшение, а пустая страница —
 * это отказ. Поэтому скрытое состояние теперь opt-in:
 *
 *  - `useEffect` выставляет `canHide` — значит, JS точно есть, и стартовать
 *    с прозрачности безопасно;
 *  - до этого момента блок виден по умолчанию, и серверная разметка читается
 *    полностью;
 *  - если `IntersectionObserver` недоступен (старый браузер, отключённые
 *    скрипты), `canHide` остаётся false и содержимое просто не анимируется.
 *
 * Итог: без JS страница полная, с JS — та же анимация, что и раньше.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /** Элемент-обёртка. Ставьте "li" внутри <ol>/<ul>, "figure" внутри списка
   *  цитат и т. п. */
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);
  /** JS есть и скрывать безопасно. Ставится только в браузере. */
  const [canHide, setCanHide] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // Нет IntersectionObserver — анимировать нечем, но и прятать незачем.
    if (!el || typeof IntersectionObserver === 'undefined') return;
    setCanHide(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`transition-all duration-700 ease-out ${
        // До подтверждения, что JS работает, — видно. Иначе пустая страница.
        !canHide || shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
