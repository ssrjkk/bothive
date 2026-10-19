import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * Базовые элементы в редакционном ключе.
 *
 * Прежняя версия была собрана из приёмов, которые дают узнаваемый вид
 * сгенерированного лендинга: пилюли, фиолетовое свечение под кнопкой,
 * блик, пробегающий по ссылке, градиентный текст в заголовках.
 *
 * Теперь форма следует типографике печатного издания: прямые углы,
 * линейки, прописные метки моноширинным, антиква в заголовках. Ничего
 * из перечисленного здесь больше нет — и это осознанно, а не забыто.
 */

/**
 * Сообщение формы, которое слышно скринридеру.
 *
 * Почему это отдельный компонент, а не просто div: текст ошибки в кабинете
 * появлялся по действию пользователя (нажал «Сохранить» — ничего не
 * произошло). Без живой области он остаётся немым, и с точки зрения
 * пользователя на экране просто не сработала кнопка. Раньше таких мест
 * было восемь, и в каждом атрибут надо было не забыть.
 *
 * Важно: компонент нужно рендерить ВСЕГДА, а текст передавать пропом.
 * Если область и её содержимое монтируются одним рендером, часть
 * скринридеров не объявляет вставку — они наблюдают за регионом, которого
 * на момент изменения ещё не существовало. Поэтому пустой вызов не
 * исчезает из DOM, а лишь теряет оформление.
 *
 * Ошибка идёт через role="alert" (прерывает озвучку), подтверждение — через
 * role="status" (вежливо, не перебивая).
 */
export function StatusMessage({
  tone = 'error',
  children,
  className = '',
}: {
  tone?: 'error' | 'success' | 'notice';
  children?: React.ReactNode;
  className?: string;
}) {
  const isError = tone === 'error';
  const live = isError
    ? { role: 'alert' as const, 'aria-live': 'assertive' as const }
    : { role: 'status' as const, 'aria-live': 'polite' as const };

  // Пустая область остаётся в DOM, но без оформления: иначе она занимала
  // бы место в вёрстке между нажатием и ответом сервера. Отступ у <p> здесь
  // не обнулён префлайтом, поэтому задаём margin явно.
  if (children === null || children === undefined || children === '') {
    return <p {...live} className="m-0" />;
  }

  const cls = isError
    ? 'border-danger/30 bg-danger/10 text-danger'
    : tone === 'success'
      ? 'border-success/30 bg-success/10 text-success'
      : 'border-accent/30 bg-accent/10 text-accent-2';
  return (
    <p {...live} className={`rounded-sm border px-4 py-3 text-sm ${cls} ${className}`}>
      {children}
    </p>
  );
}

/** Прописная метка-«рубрика». Единственный красный элемент в разделе. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent ${className}`}
    >
      <span aria-hidden className="block h-px w-7 bg-accent" />
      {children}
    </p>
  );
}

/**
 * Заголовок раздела.
 *
 * По умолчанию выключен по центру: центрированный заголовок над сеткой
 * одинаковых карточек — тот самый вид, который мы разбираем. Асимметрия
 * даёт странице ось.
 */
export function SectionHead({
  eyebrow,
  title,
  sub,
  center = false,
  level: Heading = 'h2',
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: string;
  center?: boolean;
  /**
   * Уровень заголовка.
   *
   * На странице должен быть ровно один `h1` — и им должен быть её собственный
   * заголовок, а не первый блок на ней. На «Подработке» и «Навыках» его не
   * было вовсе: первым заголовком шёл `h2` из SectionHead, и страница начиналась
   * сразу со второго уровня. Для навигации по заголовкам это значит, что
   * страницы не было в списке вообще.
   */
  level?: 'h1' | 'h2';
}) {
  if (center) {
    return (
      <div className="mb-12 md:mb-16 mx-auto max-w-3xl text-center">
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          {eyebrow}
        </p>
        <Heading className="display text-3xl text-balance md:text-5xl">{title}</Heading>
        {sub ? (
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted md:text-lg">
            {sub}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mb-12 md:mb-16 max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading className="display mt-4 text-3xl text-balance md:text-5xl">{title}</Heading>
      {sub ? (
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted md:text-lg">{sub}</p>
      ) : null}
    </div>
  );
}

export function PrimaryButton({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      {children}
    </Link>
  );
}

/**
 * Вторичная кнопка — не «стеклянная капсула», а подчёркнутая ссылка в
 * духе газетной навигации. Так иерархия действий читается без заливки.
 */
export function GhostButton({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-2 border-b border-ink px-1 py-2 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      {children}
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}

export function Section({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`border-t border-line py-20 md:py-28 ${className}`}>
      <div className="container-x">{children}</div>
    </section>
  );
}

/**
 * Карточка. Прямые углы и одна волосяная рамка вместо пилюли с тенью —
 * на бумаге объём создаёт не тень, а линия.
 */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-line bg-surface px-6 py-6 ${className}`}>{children}</div>;
}

/** Число в моноширинном — данные читаются ровно, а не «примерно». */
export function Figure({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="border-t-2 border-ink pt-4">
      <p className="font-mono text-3xl tabular-nums text-ink md:text-4xl">{value}</p>
      <p className="mt-2 text-xs leading-snug text-muted">{label}</p>
    </div>
  );
}
