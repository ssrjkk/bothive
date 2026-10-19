import Link from 'next/link';

/**
 * Врезка-призыв в конце страницы.
 *
 * Эта же разметка была скопирована на четыре страницы: статья блога,
 * вакансия, примеры резюме и отдельный пример. Копипаста, а не
 * переиспользование: менялась только строка заголовка. Теперь это
 * один компонент — иначе при смене палитры пришлось бы править четыре
 * копии, что и происходило.
 *
 * Форма — чёрная полоса во всю ширину контейнера, слева заголовок,
 * справа действие. Ни градиента, ни свечения, ни центрирования: всё это
 * было украшением без содержания.
 */
export function CtaPanel({
  title,
  text,
  cta = 'Попробовать бесплатно',
  href = '/signup',
}: {
  title: string;
  text: string;
  cta?: string;
  href?: string;
}) {
  return (
    <div className="mt-14 bg-ink px-7 py-10 md:mt-20 md:px-12 md:py-14">
      <div className="grid gap-8 md:grid-cols-12 md:items-end md:gap-12">
        <div className="md:col-span-7">
          <h2 className="font-serif text-2xl leading-snug text-paper md:text-3xl">{title}</h2>
          <p className="measure mt-4 leading-relaxed text-paper">{text}</p>
        </div>
        <div className="md:col-span-5 md:text-right">
          <Link
            href={href}
            className="inline-flex items-center justify-center gap-2 rounded-sm bg-paper px-7 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-accent hover:text-white"
          >
            {cta}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
