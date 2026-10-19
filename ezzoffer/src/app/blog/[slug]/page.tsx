import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { articles } from '@/lib/data';
import { articleDateIso } from '@/lib/article-date';
import { JsonLd } from '@/components/json-ld';
import { CtaPanel } from '@/components/cta-panel';

const siteUrl = process.env.SITE_URL ?? 'https://ezoffer.ru';

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = articles.find((a) => a.slug === slug);
  if (!article) return { title: 'Статья не найдена' };
  return { title: article.title, description: article.excerpt };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articles.find((a) => a.slug === slug);
  if (!article) notFound();

  const related = articles.filter((a) => a.slug !== article.slug).slice(0, 3);

  /**
   * Дата публикации для schema.org.
   *
   * Раньше здесь стояло `new Date().toISOString()` на уровне модуля, то есть
   * ВСЕ статьи в разметке объявлялись опубликованными в момент сборки.
   * Поисковики ориентируются на datePublished при индексации и оценке
   * свежести, поэтому такая разметка вводила в заблуждение.
   *
   * Теперь берётся реальная дата из статьи; если формат не распознан,
   * атрибут не подставляется — лучше отсутствие данных, чем заведомо ложные.
   */
  const publishedIso = articleDateIso(article.date);

  return (
    <div className="container-x py-12 md:py-16">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: article.title,
          description: article.excerpt,
          datePublished: publishedIso,
          dateModified: publishedIso,
          inLanguage: 'ru-RU',
          author: { '@type': 'Organization', name: 'EZOffer', url: siteUrl },
          publisher: {
            '@type': 'Organization',
            name: 'EZOffer',
            url: siteUrl,
            logo: `${siteUrl}/icon.svg`,
          },
        }}
      />
      <Link
        href="/blog"
        className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-accent"
      >
        <span aria-hidden>←</span> Все статьи
      </Link>

      <article className="mx-auto mt-8 max-w-3xl">
        <header className="border-t-2 border-ink pt-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <span className="text-accent">{article.category}</span>
            <span>{article.minutes} мин чтения</span>
            <time dateTime={articleDateIso(article.date) ?? undefined}>{article.date}</time>
          </div>
          <h1 className="display mt-5 text-balance text-3xl md:text-5xl">{article.title}</h1>
          <p className="measure mt-5 text-base leading-relaxed text-muted md:text-lg">
            {article.excerpt}
          </p>
        </header>

        <div className="mt-12 space-y-12">
          {article.body.map((block) => (
            <section key={block.h} className="border-t border-line pt-6">
              <h2 className="font-serif text-xl leading-snug text-ink md:text-2xl">{block.h}</h2>
              <div className="mt-4 space-y-4">
                {block.p.map((paragraph) => (
                  <p key={paragraph.slice(0, 24)} className="text-base leading-relaxed text-ink">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <CtaPanel
          title="Хватит делать это вручную"
          text="EZOffer улучшает резюме, подбирает вакансии и отправляет до 100 персональных откликов в день. Пробный период 24 часа без карты."
        />
      </article>

      <div className="mx-auto mt-16 max-w-3xl border-t-2 border-ink pt-8">
        <h2 className="font-serif text-2xl leading-snug text-ink">Читайте также</h2>
        <div className="mt-5">
          {related.map((r) => (
            <Link
              key={r.slug}
              href={`/blog/${r.slug}`}
              className="group block border-b border-line py-4 transition-colors"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                {r.category} · {r.minutes} мин
              </p>
              <p className="mt-2 font-serif text-lg leading-snug text-ink transition-colors group-hover:text-accent">
                {r.title}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
