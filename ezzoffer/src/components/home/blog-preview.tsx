import Link from 'next/link';
import { Section, Eyebrow } from '@/components/ui';
import { Reveal } from '@/components/reveal';
import { articles } from '@/lib/data';
import { articleDateIso } from '@/lib/article-date';

/*
 * Превью блога на главной.
 *
 * Те же карточки с обложкой-заглушкой, что и на странице блога: одинаковая
 * иконка домика для всех материалов, градиентная подложка, сетка. Обложка
 * не сообщала ни о чём, а заголовок уезжал под неё в мелкий кегль.
 *
 * Теперь три записи строкой с линейками — как анонсы в полосе.
 */

export function BlogPreview() {
  const preview = articles.slice(0, 3);

  return (
    <Section>
      <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <Eyebrow>Из блога</Eyebrow>
          <h2 className="display mt-4 text-3xl text-balance md:text-5xl">
            Статьи и советы о <span className="text-accent">поиске работы</span>
          </h2>
        </div>
        <Link
          href="/blog"
          className="inline-flex w-fit items-center gap-2 -my-1 inline-flex min-h-11 items-center border-b border-ink py-1 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Все статьи
          <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="border-t-2 border-ink">
        {preview.map((article, idx) => (
          <Reveal key={article.slug} delay={idx * 70}>
            <Link
              href={`/blog/${article.slug}`}
              className="group grid gap-2 border-b border-line py-6 transition-colors hover:bg-surface-2 md:grid-cols-12 md:gap-8 md:px-4"
            >
              <div className="md:col-span-8">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                  {article.category}
                </p>
                <h3 className="mt-2 font-serif text-xl leading-snug text-ink group-hover:text-accent md:text-2xl">
                  {article.title}
                </h3>
                <p className="measure mt-2 text-sm leading-relaxed text-muted">{article.excerpt}</p>
              </div>

              <div className="flex items-baseline gap-4 md:col-span-4 md:justify-end">
                <time
                  dateTime={articleDateIso(article.date) ?? undefined}
                  className="font-mono text-xs tabular-nums text-muted"
                >
                  {article.date}
                </time>
                <span className="font-mono text-xs text-muted">{article.minutes} мин</span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
