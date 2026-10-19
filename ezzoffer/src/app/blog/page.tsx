import type { Metadata } from 'next';
import Link from 'next/link';
import { articles } from '@/lib/data';
import { articleDateIso } from '@/lib/article-date';
import { Eyebrow } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Блог',
  description:
    'Статьи и советы о поиске работы: автоотклики, резюме, ATS, сопроводительные письма и карьерные стратегии.',
};

export default function BlogPage() {
  return (
    <div className="container-x py-14 md:py-20">
      <div className="max-w-3xl">
        <Eyebrow>Блог</Eyebrow>
        <h1 className="display mt-5 text-4xl text-balance md:text-5xl">
          Статьи о том, как находить работу <span className="text-accent">быстрее</span>
        </h1>
        <p className="measure mt-5 text-base leading-relaxed text-muted md:text-lg">
          Разборы, гайды и данные о рынке — без воды и «ловушек успешного успеха».
        </p>
      </div>

      {/*
        Раньше каждая статья была карточкой с обложкой: градиентная
        подложка, сетка и одна и та же иконка домика для всех материалов.
        Обложка-заглушка ничего не сообщала, а заголовок прятался в мелкий
        sans-serif под ней.

        Теперь это указатель: номер, рубрика, заголовок антиквой, лид и
        колонка с датой и временем чтения. Заголовок стал главным — так он
        и работает в печатном указателе.
      */}
      <div className="mt-14 border-t-2 border-ink">
        {articles.map((article, idx) => (
          <Link
            key={article.slug}
            href={`/blog/${article.slug}`}
            className="group grid gap-3 border-b border-line py-7 transition-colors hover:bg-surface-2 md:grid-cols-12 md:gap-8 md:px-4"
          >
            <span className="font-mono text-xs tabular-nums text-muted md:col-span-1">
              {String(idx + 1).padStart(2, '0')}
            </span>

            <div className="md:col-span-7">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                {article.category}
              </p>
              <h2 className="mt-2 font-serif text-2xl leading-snug text-ink group-hover:text-accent">
                {article.title}
              </h2>
              <p className="measure mt-2 text-sm leading-relaxed text-muted">{article.excerpt}</p>
            </div>

            <div className="md:col-span-3 md:col-start-10 md:text-right">
              <time
                dateTime={articleDateIso(article.date) ?? undefined}
                className="block font-mono text-xs tabular-nums text-muted"
              >
                {article.date}
              </time>
              <span className="mt-1 block font-mono text-xs text-muted">{article.minutes} мин</span>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">
                Читать
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
